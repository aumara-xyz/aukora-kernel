/**
 * Kira loopback query server.
 *
 * This lives outside the pure kernel. It is the honest local Convex-style
 * surface: POST /api/query with an allowlisted path, Convex-like envelopes, no
 * mutations, no network egress, and no authority. It reads the real persistent
 * Kira state file and returns advisory recall/head data only.
 */
import * as http from 'http';
import * as path from 'path';
import { loadBrainState, recall, summarizeBrain, verifyBrainState, type RecallResult, type RecallHit } from '../core/src/kiraBrain';
import { toConvexMirror } from '../core/src/kiraConvexMirror';

export interface KiraLoopbackConfig {
  statePath: string;
}

export interface KiraHeadPublic {
  schema: 'AUKORA_KIRA_BRAIN_V1';
  receiptCount: number;
  atomCount: number;
  // Brick 0 (adversarial review): containment counts are part of the public head so a network
  // reader of this loopback surface sees jailed/erased atoms, never a clean count that hides a wipe.
  quarantinedCount: number;
  erasedCount: number;
  lastReceiptHash: string;
  updatedAt: string;
  summary: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

const QUERY_PATHS = new Set(['kira:getHeadPublic', 'kira:recall']);

function json(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        req.destroy();
        reject(new Error('kira_loopback_body_too_large'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('kira_loopback_bad_json'));
      }
    });
  });
}

export function getKiraHeadPublic(config: KiraLoopbackConfig): KiraHeadPublic {
  const state = loadBrainState(config.statePath);
  const mirror = toConvexMirror(state);
  return {
    schema: mirror.head.schema,
    receiptCount: mirror.head.receiptCount,
    atomCount: mirror.head.atomCount,
    quarantinedCount: mirror.head.quarantinedCount,
    erasedCount: mirror.head.erasedCount,
    lastReceiptHash: mirror.head.lastReceiptHash,
    updatedAt: mirror.head.updatedAt,
    summary: summarizeBrain(state),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// Issue #8 fix: the ALLOWLISTED wire response for kira:recall previously returned each hit's
// supportQuote (a verbatim ingested-text excerpt) and per-perceiver evidence strings — real repo
// content, broader than the "public metadata only" bar the allowlist's own header comment (in
// core/src/convexBrainReadonly.ts) sets, since anything reachable over this loopback HTTP surface is a
// real network-exposed leak surface, unlike in-process advisory use (e.g. Fusion's citation-only use of
// recall() results, which is untouched by this fix). Strips supportQuote/evidence at the WIRE boundary
// only — recall()/RecallHit themselves are unchanged, so every existing in-process consumer keeps working.
export interface RecallHitPublic {
  atomId: string;
  receiptId: string;
  source: string;
  scope: string;
  kind: RecallHit['kind'];
  tags: string[];
  perceivers: Array<{ name: RecallHit['perceivers'][number]['name']; score: number }>;
  interferenceScore: number;
  consensus: number;
  citation: string;
  advisoryOnly: true;
  grantsAuthority: false;
}
export interface RecallResultPublic {
  query: string;
  hits: RecallHitPublic[];
  advisoryOnly: true;
  grantsAuthority: false;
}

function stripRecallHitForWire(hit: RecallHit): RecallHitPublic {
  return {
    atomId: hit.atomId,
    receiptId: hit.receiptId,
    source: hit.source,
    scope: hit.scope,
    kind: hit.kind,
    tags: hit.tags,
    perceivers: hit.perceivers.map((p) => ({ name: p.name, score: p.score })), // evidence text dropped
    interferenceScore: hit.interferenceScore,
    consensus: hit.consensus,
    citation: hit.citation,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function stripRecallResultForWire(result: RecallResult): RecallResultPublic {
  return {
    query: result.query,
    hits: result.hits.map(stripRecallHitForWire), // supportQuote dropped per-hit
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function answerKiraQuery(config: KiraLoopbackConfig, queryPath: string, args: Record<string, unknown> = {}): unknown {
  if (!QUERY_PATHS.has(queryPath)) {
    throw new Error(`kira_query_not_allowed:${queryPath}`);
  }
  const state = loadBrainState(config.statePath);
  const verification = verifyBrainState(state);
  if (!verification.ok) throw new Error(`kira_state_invalid:${verification.errors.join(';')}`);

  if (queryPath === 'kira:getHeadPublic') return getKiraHeadPublic(config);

  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) throw new Error('kira_recall_requires_query');
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(24, Math.floor(args.limit)))
    : 8;
  return stripRecallResultForWire(recall(state, query, limit));
}

export function createKiraLoopbackServer(config: KiraLoopbackConfig): http.Server {
  const safeConfig = { statePath: path.resolve(config.statePath) };
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/api/query') {
        json(res, 404, { status: 'error', errorMessage: 'kira_loopback_query_only' });
        return;
      }
      const raw = await readBody(req);
      const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const queryPath = typeof body.path === 'string' ? body.path : '';
      const args = body.args && typeof body.args === 'object' ? body.args as Record<string, unknown> : {};
      const value = answerKiraQuery(safeConfig, queryPath, args);
      json(res, 200, { status: 'success', value });
    } catch (err) {
      json(res, 400, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function kiraLoopbackGrantsAuthority(): false {
  return false;
}
