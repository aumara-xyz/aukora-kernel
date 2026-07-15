import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseModuleEdges, type ModuleEdge } from '../src/importGraphVerifier';

/**
 * 24Z.33 Part A.1 — the AUTHORITY IMPORT FIREWALL, as ONE comprehensive static guard (replaces the scattered
 * per-module isolation checks with a single source-of-truth lint that runs on every `npm test`).
 *
 * LAW: authority-bound modules (gate / apply / OpenCode runner+spawn / signer / permit / execution-approval /
 * Convex-write) MUST NOT import EVIDENCE/TELEMETRY modules (HRT Accord, continuity consolidation, episode memory,
 * Fable seed, MDL process memory, ceremony, telemetry stores/read accessors). Evidence may inform; evidence may
 * never authorize. The ONLY permitted authority→evidence edge is a single ONE-WAY void emit sink wired by the
 * designated orchestrator — recorded explicitly below so any NEW edge (especially a read accessor) fails the test.
 *
 * 24Z.33 red-team (HIGH): edges are parsed via the TypeScript AST (`parseModuleEdges`), NOT a line regex, so
 * multi-line imports, `export {..} from` re-exports, and dynamic `import()`/`require()` are ALL seen.
 */

const SRC = path.resolve(__dirname, '..', 'src');

const LEAF_AUTHORITY = [
  'index', 'executor', 'crypto', 'sandboxApply', 'sandboxApplyPermit', 'openCodeSandboxRunner',
  'openCodeSpawnTransport', 'mldsaSandboxSigner', 'kernelActionClassifier', 'convexExecutionApproval',
  'patchApproval', 'localModelClient',
];
const ORCHESTRATOR = 'sandboxEngineBridge';
const ALL_AUTHORITY = [...LEAF_AUTHORITY, ORCHESTRATOR];

// Pure evidence-PRODUCING modules. NOTE: `runtimeTruthManifest` is deliberately EXCLUDED — it is the read-only
// top-level aggregator that summarizes authority modules (summarizeSandboxApply, summarizeKernelActionTable, …);
// it is neither authority nor evidence-output, so it may read both sides. The firewall governs the producers.
const EVIDENCE = [
  'hrtAccordEvaluator', 'hrtAccordSchema', 'continuityConsolidation', 'episodeMemory', 'fableIngestionSeed',
  'mdlProcessMemory', 'aumlokCeremonySpec', 'vjepaGlyphTelemetry', 'boundaryTraceTelemetry', 'evidenceAuthorityGuard',
  'fableDryRun',
];

const READ_ACCESSORS = ['getTraces', 'auditStoredTraces', 'recordTraceEvent', 'sanitizeTraceEvent', 'telemetryGrantsAuthority', 'witnessGrantsCapability', 'summarizeTelemetry'];

// The ONE permitted authority→evidence edge in the whole codebase: the orchestrator's one-way void emit sink.
const ALLOWED_EDGES: Array<{ from: string; module: string; symbol: string }> = [
  { from: 'sandboxEngineBridge', module: 'boundaryTraceTelemetry', symbol: 'emitSandboxEvent' },
];

// only RELATIVE imports are our local modules; a bare specifier ('crypto', 'fs', '@noble/...') is a builtin/pkg —
// e.g. `import * as crypto from 'crypto'` (node builtin) must NOT be confused with `from './crypto'` (local authority).
function isLocal(modulePath: string): boolean { return modulePath.startsWith('.'); }
function localBasename(modulePath: string): string | null { return isLocal(modulePath) ? modulePath.replace(/^.*\//, '') : null; }
// type-only edges erase at compile time → no runtime influence; the firewall governs RUNTIME edges.
function runtimeEdges(mod: string): ModuleEdge[] | null {
  const p = path.join(SRC, `${mod}.ts`);
  if (!fs.existsSync(p)) return null;
  return parseModuleEdges(fs.readFileSync(p, 'utf-8')).filter((e) => !e.typeOnly);
}

describe('24Z.33 authority import firewall (single AST-based static guard)', () => {
  it('every authority module exists (the guard is not silently skipping missing files)', () => {
    for (const m of ALL_AUTHORITY) expect(fs.existsSync(path.join(SRC, `${m}.ts`)), `${m}.ts must exist`).toBe(true);
  });

  it('LEAF authority modules import ZERO evidence/telemetry modules (any import form: static/multiline/re-export/dynamic)', () => {
    const violations: string[] = [];
    for (const a of LEAF_AUTHORITY) {
      const edges = runtimeEdges(a);
      if (!edges) continue;
      for (const e of edges) { const m = localBasename(e.module); if (m && EVIDENCE.includes(m)) violations.push(`${a} -> ${m} (${e.kind}: ${e.symbols.join(',')})`); }
    }
    expect(violations, `leaf-authority modules must not import evidence:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the ORCHESTRATOR imports NO evidence module except the single allowed one-way emit sink', () => {
    const violations: string[] = [];
    for (const e of runtimeEdges(ORCHESTRATOR) ?? []) {
      const mod = localBasename(e.module);
      if (!mod || !EVIDENCE.includes(mod)) continue;
      if (e.symbols.length === 0) { violations.push(`${ORCHESTRATOR} -> ${mod} (${e.kind}, no named symbols — not an allowed edge)`); continue; }
      for (const sym of e.symbols) {
        const allowed = ALLOWED_EDGES.some((x) => x.from === ORCHESTRATOR && x.module === mod && x.symbol === sym);
        if (!allowed) violations.push(`${ORCHESTRATOR} -> ${mod}.${sym} (${e.kind}) — not an allowed edge`);
      }
    }
    expect(violations, `orchestrator may import only the allowed write-sink:\n${violations.join('\n')}`).toEqual([]);
  });

  it('NO authority module imports a telemetry READ accessor (the read direction is the real danger)', () => {
    const violations: string[] = [];
    for (const a of ALL_AUTHORITY) {
      const edges = runtimeEdges(a);
      if (!edges) continue;
      for (const e of edges) for (const sym of e.symbols) if (READ_ACCESSORS.includes(sym)) violations.push(`${a} imports read accessor ${sym} (${e.kind})`);
    }
    expect(violations, `authority must not import read accessors:\n${violations.join('\n')}`).toEqual([]);
  });

  it('NO evidence module imports an authority module (reverse direction — evidence never authorizes)', () => {
    const violations: string[] = [];
    for (const ev of EVIDENCE) {
      const edges = runtimeEdges(ev);
      if (!edges) continue;
      for (const e of edges) { const m = localBasename(e.module); if (m && ALL_AUTHORITY.includes(m)) violations.push(`${ev} -> ${m} (${e.kind})`); }
    }
    expect(violations, `evidence modules must not import authority:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the allowed-edge allowlist is MINIMAL — every listed edge actually exists (no stale carve-out)', () => {
    for (const edge of ALLOWED_EDGES) {
      const present = (runtimeEdges(edge.from) ?? []).some((e) => localBasename(e.module) === edge.module && e.symbols.includes(edge.symbol));
      expect(present, `allowed edge ${edge.from}->${edge.module}.${edge.symbol} no longer exists — remove it from the allowlist`).toBe(true);
    }
  });

  // 24Z.33 red-team (HIGH) — TEST THE TEST: prove the AST parser SEES the bypass forms the old line-regex missed.
  // (The old parseImportEdges returned [] for all of these, letting a multi-line read-accessor edge pass 6/6 green.)
  it('the AST edge parser detects multi-line imports, re-exports, and dynamic import()/require()', () => {
    const src = [
      "import {",
      "  getTraces,",
      "  auditStoredTraces,",
      "} from './boundaryTraceTelemetry';",
      "export { recordTraceEvent } from './episodeMemory';",
      "const a = await import('./mdlProcessMemory');",
      "const b = require('./continuityConsolidation');",
      "import type { Foo } from './hrtAccordEvaluator';",
    ].join('\n');
    const edges = parseModuleEdges(src);
    const byMod = (m: string) => edges.find((e) => e.module.endsWith(m));
    expect(byMod('boundaryTraceTelemetry')?.symbols).toEqual(expect.arrayContaining(['getTraces', 'auditStoredTraces']));
    expect(byMod('episodeMemory')?.kind).toBe('export-from');
    expect(byMod('mdlProcessMemory')?.kind).toBe('dynamic');
    expect(byMod('continuityConsolidation')?.kind).toBe('require');
    expect(byMod('hrtAccordEvaluator')?.typeOnly).toBe(true);   // type-only seen + flagged (erased, not a runtime edge)
  });
});
