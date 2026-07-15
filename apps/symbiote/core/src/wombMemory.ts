import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseImportEdges } from './importGraphVerifier';

// ── Types ──

export type WombMemoryKind = 'turn' | 'fusion' | 'receipt' | 'sleep' | 'burn' | 'safety' | 'preference' | 'code';
export type WombBoundaryEvent = 'prompt_turn' | 'fusion_result' | 'receipt_event' | 'sleep_insight' | 'burn_insight' | 'safety_refusal' | 'user_preference' | 'test_event';

export interface WombMemoryRecord {
  id: string;
  kind: WombMemoryKind;
  title: string;
  content: string;
  source: string;
  timestamp: string;
  immutable: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
  tags: string[];
}

export interface WombMemoryBoundary {
  event: WombBoundaryEvent;
  timestamp: string;
  previousRecordId: string | null;
  nextRecordId: string | null;
  reason: string;
}

export interface WombMemoryPointer {
  recordId: string;
  kind: WombMemoryKind;
  title: string;
  source: string;
  score: number;
  excerpt: string;
}

export interface WombWitnessSpan {
  recordId: string;
  source: string;
  startOffset: number;
  endOffset: number;
  matchedText: string;
  context: string;
}

export interface WombRetrievalQuery {
  text: string;
  allowKinds?: WombMemoryKind[];
  maxResults?: number;
  requireExact?: boolean;
}

export interface WombRetrievalResult {
  query: string;
  witnesses: WombWitnessSpan[];
  pointers: WombMemoryPointer[];
  hasWitness: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface WombMemoryIndexSnapshot {
  recordCount: number;
  kinds: Record<WombMemoryKind, number>;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  immutableCount: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface CodeMemoryPointer {
  module: string;
  file: string;
  surface: 'authority' | 'advisory' | 'test' | 'infrastructure';
  importCount: number;
  isGodNode: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Forbidden fields ──

const FORBIDDEN_MEMORY_FIELDS = new Set([
  'apiKey', 'api_key', 'privateKey', 'private_key',
  'seed', 'secretSeed', 'pop', 'proofOfPossession',
  'signedHead', 'signed_head', 'rawSignature', 'raw_signature',
  'kvCache', 'kv_cache', 'hiddenState', 'hidden_state',
  'rawActivations', 'raw_activations', 'privateSeed', 'private_seed',
  'modelWeights', 'model_weights', 'password', 'secret', 'token',
]);

export function validateMemoryRecord(record: WombMemoryRecord): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (record.advisoryOnly !== true) violations.push('advisoryOnly must be true');
  if ((record as any).grantsAuthority !== false) violations.push('grantsAuthority must be false');
  if (!record.id) violations.push('id is required');
  if (!record.kind) violations.push('kind is required');

  function scanObj(obj: unknown, path: string): void {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN_MEMORY_FIELDS.has(key)) violations.push(`forbidden field: ${path}.${key}`);
      if (typeof value === 'object' && value !== null) scanObj(value, `${path}.${key}`);
    }
  }
  scanObj(record, 'record');

  return { valid: violations.length === 0, violations };
}

export function validateRetrievalResult(result: WombRetrievalResult): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (result.advisoryOnly !== true) violations.push('advisoryOnly must be true');
  if ((result as any).grantsAuthority !== false) violations.push('grantsAuthority must be false');

  for (const w of result.witnesses) {
    if (FORBIDDEN_MEMORY_FIELDS.has(w.source)) violations.push(`witness source is forbidden field: ${w.source}`);
  }

  return { valid: violations.length === 0, violations };
}

// ── ID generation ──

function makeRecordId(kind: WombMemoryKind, content: string, timestamp: string): string {
  const hash = crypto.createHash('sha256')
    .update(`womb_memory_v0:${kind}:${content}:${timestamp}`)
    .digest('hex')
    .slice(0, 16);
  return `wmem_${hash}`;
}

// ── Markdown serialization ──

export function serializeToMarkdown(record: WombMemoryRecord): string {
  const lines = [
    '---',
    `id: ${record.id}`,
    `kind: ${record.kind}`,
    `title: ${record.title}`,
    `source: ${record.source}`,
    `timestamp: ${record.timestamp}`,
    `immutable: ${record.immutable}`,
    `tags: [${record.tags.join(', ')}]`,
    `advisoryOnly: true`,
    `grantsAuthority: false`,
    '---',
    '',
    record.content,
  ];
  return lines.join('\n');
}

export function parseFromMarkdown(markdown: string): WombMemoryRecord | null {
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const meta: Record<string, string> = {};
  for (const line of frontmatterMatch[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }

  const tagsMatch = meta.tags?.match(/\[(.*)\]/);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [];

  return {
    id: meta.id || '',
    kind: (meta.kind || 'turn') as WombMemoryKind,
    title: meta.title || '',
    content: frontmatterMatch[2],
    source: meta.source || '',
    timestamp: meta.timestamp || '',
    immutable: meta.immutable === 'true',
    advisoryOnly: true,
    grantsAuthority: false,
    tags,
  };
}

// ── Boundary detection ──

export function detectBoundary(event: string, context: string): WombMemoryBoundary | null {
  const lower = event.toLowerCase();
  const contextLower = context.toLowerCase();

  let boundaryEvent: WombBoundaryEvent | null = null;
  let reason = '';

  if (lower.includes('refused') || lower.includes('unsafe') || lower.includes('blocked') || lower.includes('disallowed')) {
    boundaryEvent = 'safety_refusal';
    reason = 'Safety refusal event';
  } else if (lower.includes('prompt') || lower.includes('user input') || lower.includes('womb turn')) {
    boundaryEvent = 'prompt_turn';
    reason = 'New prompt turn detected';
  } else if (lower.includes('fusion') || lower.includes('council') || lower.includes('quorum')) {
    boundaryEvent = 'fusion_result';
    reason = 'Fusion council result received';
  } else if (lower.includes('receipt') || lower.includes('chain') || lower.includes('verdict')) {
    boundaryEvent = 'receipt_event';
    reason = 'Receipt chain event';
  } else if (lower.includes('sleep') || lower.includes('skill') || lower.includes('proposal')) {
    boundaryEvent = 'sleep_insight';
    reason = 'Sleep skill insight';
  } else if (lower.includes('burn') || lower.includes('trace') || lower.includes('dataset')) {
    boundaryEvent = 'burn_insight';
    reason = 'Burn dataset insight';
  } else if (lower.includes('preference') || lower.includes('setting') || lower.includes('user wants')) {
    boundaryEvent = 'user_preference';
    reason = 'User preference change';
  } else if (lower.includes('test') && (contextLower.includes('pass') || contextLower.includes('fail') || contextLower.includes('green'))) {
    boundaryEvent = 'test_event';
    reason = 'Test suite event';
  }

  if (!boundaryEvent) return null;

  return {
    event: boundaryEvent,
    timestamp: new Date().toISOString(),
    previousRecordId: null,
    nextRecordId: null,
    reason,
  };
}

// ── WombMemoryStore ──

export class WombMemoryStore {
  private records: Map<string, WombMemoryRecord> = new Map();

  add(kind: WombMemoryKind, title: string, content: string, source: string, opts?: { immutable?: boolean; tags?: string[] }): WombMemoryRecord {
    const timestamp = new Date().toISOString();
    const record: WombMemoryRecord = {
      id: makeRecordId(kind, content, timestamp),
      kind,
      title,
      content,
      source,
      timestamp,
      immutable: opts?.immutable ?? false,
      advisoryOnly: true,
      grantsAuthority: false,
      tags: opts?.tags ?? [],
    };

    const validation = validateMemoryRecord(record);
    if (!validation.valid) {
      throw new Error(`Memory record validation failed: ${validation.violations.join(', ')}`);
    }

    this.records.set(record.id, record);
    return record;
  }

  get(id: string): WombMemoryRecord | null {
    return this.records.get(id) ?? null;
  }

  all(): WombMemoryRecord[] {
    return Array.from(this.records.values());
  }

  byKind(kind: WombMemoryKind): WombMemoryRecord[] {
    return this.all().filter(r => r.kind === kind);
  }

  snapshot(): WombMemoryIndexSnapshot {
    const records = this.all();
    const kinds = {} as Record<WombMemoryKind, number>;
    const allKinds: WombMemoryKind[] = ['turn', 'fusion', 'receipt', 'sleep', 'burn', 'safety', 'preference', 'code'];
    for (const k of allKinds) kinds[k] = 0;
    for (const r of records) kinds[r.kind]++;

    const timestamps = records.map(r => r.timestamp).sort();

    return {
      recordCount: records.length,
      kinds,
      oldestTimestamp: timestamps[0] ?? null,
      newestTimestamp: timestamps[timestamps.length - 1] ?? null,
      immutableCount: records.filter(r => r.immutable).length,
      advisoryOnly: true,
      grantsAuthority: false,
    };
  }

  clear(): void {
    this.records.clear();
  }
}

// ── Witness retrieval ──

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(t => t.length > 1);
}

function computeTermFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

function bm25Score(queryTokens: string[], docTokens: string[], totalDocs: number, avgDocLen: number, docFreqs: Map<string, number>): number {
  const k1 = 1.2;
  const b = 0.75;
  const docLen = docTokens.length;
  const tf = computeTermFrequency(docTokens);
  let score = 0;

  for (const qt of queryTokens) {
    const f = tf.get(qt) ?? 0;
    if (f === 0) continue;
    const df = docFreqs.get(qt) ?? 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * docLen / avgDocLen));
    score += idf * tfNorm;
  }

  return score;
}

export function extractWitnesses(query: string, records: WombMemoryRecord[]): WombWitnessSpan[] {
  const witnesses: WombWitnessSpan[] = [];
  const queryLower = query.toLowerCase();

  for (const record of records) {
    const contentLower = record.content.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < contentLower.length) {
      const idx = contentLower.indexOf(queryLower, searchFrom);
      if (idx === -1) break;

      const contextStart = Math.max(0, idx - 40);
      const contextEnd = Math.min(record.content.length, idx + queryLower.length + 40);

      witnesses.push({
        recordId: record.id,
        source: record.source,
        startOffset: idx,
        endOffset: idx + queryLower.length,
        matchedText: record.content.slice(idx, idx + query.length),
        context: record.content.slice(contextStart, contextEnd),
      });

      searchFrom = idx + queryLower.length;
    }
  }

  return witnesses;
}

export function retrieveFromMemory(query: WombRetrievalQuery, store: WombMemoryStore): WombRetrievalResult {
  let records = store.all();

  if (query.allowKinds && query.allowKinds.length > 0) {
    records = records.filter(r => query.allowKinds!.includes(r.kind));
  }

  const maxResults = query.maxResults ?? 5;
  const queryTokens = tokenize(query.text);

  // Exact witnesses
  const witnesses = extractWitnesses(query.text, records);

  // BM25-lite scoring
  const docTokensList = records.map(r => tokenize(`${r.title} ${r.content}`));
  const totalDocs = records.length;
  const avgDocLen = totalDocs > 0 ? docTokensList.reduce((s, d) => s + d.length, 0) / totalDocs : 1;

  const docFreqs = new Map<string, number>();
  for (const docTokens of docTokensList) {
    const unique = new Set(docTokens);
    for (const t of unique) docFreqs.set(t, (docFreqs.get(t) ?? 0) + 1);
  }

  const scored: Array<{ record: WombMemoryRecord; score: number }> = records.map((record, i) => {
    let score = bm25Score(queryTokens, docTokensList[i], totalDocs, avgDocLen, docFreqs);

    // Recency weight (newer = slight boost, max +0.5)
    if (!record.immutable) {
      const age = Date.now() - new Date(record.timestamp).getTime();
      const recencyBoost = Math.max(0, 0.5 - age / (1000 * 60 * 60 * 24 * 30));
      score += recencyBoost;
    }
    // Immutable anchor: no recency decay, slight base boost
    if (record.immutable) {
      score += 0.3;
    }

    return { record, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topPointers: WombMemoryPointer[] = scored
    .filter(s => s.score > 0)
    .slice(0, maxResults)
    .map(s => ({
      recordId: s.record.id,
      kind: s.record.kind,
      title: s.record.title,
      source: s.record.source,
      score: Math.round(s.score * 100) / 100,
      excerpt: s.record.content.slice(0, 120),
    }));

  if (query.requireExact && witnesses.length === 0) {
    return {
      query: query.text,
      witnesses: [],
      pointers: [],
      hasWitness: false,
      advisoryOnly: true,
      grantsAuthority: false,
    };
  }

  return {
    query: query.text,
    witnesses: witnesses.slice(0, maxResults),
    pointers: topPointers,
    hasWitness: witnesses.length > 0,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── Code memory pointers ──

const GOD_NODE_THRESHOLD = 5;

const AUTHORITY_MODULES = new Set(['index.ts', 'executor.ts', 'crypto.ts', 'patchApproval.ts']);
const ADVISORY_MODULES = new Set(['aumaWombPrompt.ts', 'fractalFusion.ts', 'restingGlyph.ts', 'senseBus.ts', 'wombMemory.ts']);
const TEST_PATTERN = /\.test\.ts$/;

export function buildCodeMemoryPointers(srcDir: string): CodeMemoryPointer[] {
  if (!fs.existsSync(srcDir)) return [];

  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
  const importCounts = new Map<string, number>();

  for (const file of files) {
    const src = fs.readFileSync(path.join(srcDir, file), 'utf-8');
    const edges = parseImportEdges(src);
    for (const edge of edges) {
      const target = edge.toModule.replace('./', '').replace('.ts', '') + '.ts';
      importCounts.set(target, (importCounts.get(target) ?? 0) + 1);
    }
  }

  return files.map(file => {
    const count = importCounts.get(file) ?? 0;
    let surface: CodeMemoryPointer['surface'] = 'infrastructure';
    if (AUTHORITY_MODULES.has(file)) surface = 'authority';
    else if (ADVISORY_MODULES.has(file)) surface = 'advisory';
    else if (TEST_PATTERN.test(file)) surface = 'test';

    return {
      module: file.replace('.ts', ''),
      file: `src/${file}`,
      surface,
      importCount: count,
      isGodNode: count >= GOD_NODE_THRESHOLD,
      advisoryOnly: true as const,
      grantsAuthority: false as const,
    };
  });
}

// ── Seed memory from artifacts ──

export function seedFromArtifacts(store: WombMemoryStore, evidenceDir: string): number {
  let seeded = 0;

  const artifactPath = path.join(evidenceDir, 'opencode-womb-advisory.json');
  if (fs.existsSync(artifactPath)) {
    try {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
      store.add('fusion', 'Current organism consensus', `Consensus: ${artifact.consensus}. ${artifact.findings_summary}`, 'opencode-womb-advisory.json', { immutable: true, tags: ['consensus', 'organism'] });
      seeded++;

      if (artifact.recommended_next) {
        store.add('fusion', 'Recommended next step', artifact.recommended_next, 'opencode-womb-advisory.json', { tags: ['next', 'recommendation'] });
        seeded++;
      }
    } catch {}
  }

  const fusionPath = path.join(evidenceDir, 'fusion-action-items.json');
  if (fs.existsSync(fusionPath)) {
    try {
      const items = JSON.parse(fs.readFileSync(fusionPath, 'utf-8'));
      for (const item of items.items ?? []) {
        store.add('fusion', `FAI: ${item.title}`, `${item.description} (status: ${item.status}, severity: ${item.severity})`, 'fusion-action-items.json', { immutable: item.status === 'implemented', tags: ['action-item', item.severity?.toLowerCase()] });
        seeded++;
      }
    } catch {}
  }

  const turnPath = path.join(evidenceDir, 'current-auma-womb-turn.json');
  if (fs.existsSync(turnPath)) {
    try {
      const turn = JSON.parse(fs.readFileSync(turnPath, 'utf-8'));
      const label = turn.label || turn.response?.label || 'unknown';
      const text = turn.responseText || turn.response?.responseText || '';
      if (text) {
        store.add('turn', `Last Auma turn (${label})`, text.slice(0, 500), 'current-auma-womb-turn.json', { tags: ['turn', label] });
        seeded++;
      }
    } catch {}
  }

  return seeded;
}
