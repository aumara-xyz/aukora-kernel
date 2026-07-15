// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Proprioception — the seed's read-only body-sense: "what is my body state right now?"
 *
 * Composes the already-honest organs (runtimeTruthManifest, rootOrganismRegistry, the adapter registry) plus
 * a few direct fs reads (git head, embedder presence, receipt count, self-map freshness) into ONE snapshot.
 * Pure + read-only: no mutation, no network, no secrets, no raw env. It REPORTS the body; it never steers it.
 * A UI may DISPLAY it; it may never be used as authority. grantsAuthority === false.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildRuntimeTruthManifest } from './runtimeTruthManifest';
import { ENGINE_ADAPTERS } from './adapters';

export interface ProprioceptionSnapshot {
  schema: 'proprioception-snapshot-v0';
  generatedFromRoot: string;
  gitHead: string;
  authority: { gatePresent: boolean; aumlokMode: 'sha256_dev_shim'; cryptographic: false; promotionLocked: true; note: string };
  memory: { advisoryOnly: true; grantsAuthority: false; convexWrite: 'quarantined'; localEmbedderPresent: boolean };
  convex: { readOnly: true; mutationExposed: false; productionConnection: false };
  selfEdit: { heartbeat: 'built' | 'absent'; mode: 'sandbox_only'; appliedLive: false; promotionReady: false };
  rollback: 'partial';
  receipts: { stateDirPresent: boolean; count: number; canonical: true };
  deferredTestDebt: number;
  organs: string[];
  adapters: Array<{ id: string; status: string }>;     // none is 'active' in the headless seed
  selfMap: { graphPresent: boolean; note: string };
  vision: { wired: false; lane: 'sensor_adapter'; note: string };
  gates: { headless: string; behavior: string; heartbeat: string };  // pointer commands, not live results
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface ProprioceptionOptions {
  repoRoot?: string;
  homeDir?: string;   // where live receipts/state live (defaults to ~/.aukora-symbiote)
}

function readGitHead(repoRoot: string): string {
  try {
    const head = fs.readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim();
      const refPath = path.join(repoRoot, '.git', ref);
      return fs.existsSync(refPath) ? fs.readFileSync(refPath, 'utf-8').trim().slice(0, 12) : ref;
    }
    return head.slice(0, 12);
  } catch { return 'unknown'; }
}

function countFilesIn(dir: string, suffix: string): number {
  let n = 0;
  const walk = (d: string) => {
    let ents: string[]; try { ents = fs.readdirSync(d); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e);
      let s; try { s = fs.statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p); else if (e.endsWith(suffix)) n++;
    }
  };
  walk(dir);
  return n;
}

export function buildProprioceptionSnapshot(opts: ProprioceptionOptions = {}): ProprioceptionSnapshot {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..');
  const homeDir = opts.homeDir ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  const m = buildRuntimeTruthManifest({ repoRoot });

  const heartbeatBuilt = (() => { try { return fs.readFileSync(path.join(repoRoot, 'core', 'src', 'selfEditLoop.ts'), 'utf-8').includes('self-edit-heartbeat-v0'); } catch { return false; } })();
  const receiptsDir = path.join(homeDir, 'receipts');
  const stateDirPresent = fs.existsSync(receiptsDir);

  return {
    schema: 'proprioception-snapshot-v0',
    generatedFromRoot: repoRoot,
    gitHead: readGitHead(repoRoot),
    authority: {
      gatePresent: m.authorityGate.present,
      aumlokMode: 'sha256_dev_shim',
      cryptographic: false,
      promotionLocked: true,
      note: 'AUMLOK is an honest dev-shim; live + authority promotion are LOCKED until the real root (Step-4) + a proven apply lane.',
    },
    memory: {
      advisoryOnly: true,
      grantsAuthority: false,
      convexWrite: 'quarantined',
      localEmbedderPresent: fs.existsSync(path.join(repoRoot, 'memory', 'embedder')),
    },
    convex: { readOnly: true, mutationExposed: false, productionConnection: false },
    selfEdit: { heartbeat: heartbeatBuilt ? 'built' : 'absent', mode: 'sandbox_only', appliedLive: false, promotionReady: false },
    rollback: 'partial',
    receipts: { stateDirPresent, count: stateDirPresent ? countFilesIn(receiptsDir, '') : 0, canonical: true },
    deferredTestDebt: m.deferredTestDebt.files,
    organs: m.organs,
    adapters: ENGINE_ADAPTERS.map((a) => ({ id: a.id, status: a.status })),
    selfMap: {
      graphPresent: fs.existsSync(path.join(repoRoot, 'graphify-out', 'graph.json')),
      note: 'regenerate with `graphify update .`; gitignored, not shipped',
    },
    vision: { wired: false, lane: 'sensor_adapter', note: 'planned: optional local sidecar; OCR/vision outputs are observations only, never authority, no auto memory write — see docs/VISION_CONTRACT.md' },
    gates: { headless: 'scripts/status.sh', behavior: 'scripts/test.sh', heartbeat: 'scripts/heartbeat.sh' },
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** Proprioception NEVER grants authority — it reports the body state; it does not steer it. */
export function proprioceptionGrantsAuthority(_s: ProprioceptionSnapshot): false { return false; }

/** A compact, prompt-safe one-screen body-sense summary. */
export function summarizeProprioception(s: ProprioceptionSnapshot): string {
  return [
    `Aukora Symbiote body-sense @ ${s.gitHead} — HEADLESS.`,
    `authority: gate ${s.authority.gatePresent ? 'present' : 'MISSING'} · AUMLOK ${s.authority.aumlokMode} (not cryptographic) · promotion LOCKED.`,
    `memory: advisory only · Convex write ${s.memory.convexWrite} · local embedder ${s.memory.localEmbedderPresent ? 'present' : 'absent'}.`,
    `convex: read-only (mutationExposed=${s.convex.mutationExposed}, productionConnection=${s.convex.productionConnection}).`,
    `self-edit: heartbeat ${s.selfEdit.heartbeat} · ${s.selfEdit.mode} · appliedLive=${s.selfEdit.appliedLive} · promotionReady=${s.selfEdit.promotionReady}. rollback ${s.rollback}.`,
    `receipts: ${s.receipts.count} · deferred-test debt: ${s.deferredTestDebt} · self-map graph ${s.selfMap.graphPresent ? 'present' : 'absent'}.`,
    `adapters: ${s.adapters.map((a) => `${a.id}=${a.status}`).join(', ')} (none active).`,
    `vision: ${s.vision.wired ? 'wired' : 'NOT wired'} — ${s.vision.lane}, observations only.`,
    `gates: ${s.gates.headless} · ${s.gates.behavior} · ${s.gates.heartbeat}.`,
    'Advisory only — proprioception reports the body; it grants no authority and changes nothing.',
  ].join('\n');
}
