/**
 * 24Z.19 — Sandbox Engine Bridge (engine-agnostic: a coding engine → a gated temp-only apply + receipt).
 *
 * 24Z.18 applied a hand-given patch. This wires ANY `SandboxEngine` into that lane: the engine PROPOSES a
 * patch candidate (in-memory files), which is then routed through kernel classification → sandbox permit →
 * temp-only apply → a receipt that names the engine. The engine NEVER receives a live-repo handle and NEVER
 * applies anything itself — the bridge owns the gated apply. Proven end-to-end with a deterministic local
 * engine (no network); OpenCode is wired as a PARKED engine (its propose() refuses until the signed gate +
 * a model wire exist). Live apply, secrets, Convex, and shell remain out of scope entirely.
 */
import * as crypto from 'crypto';
import { buildKernelActionTable, classifyDraftAction, type KernelActionTable, type DraftActionVerdict } from './kernelActionClassifier';
import { issueSandboxApplyPermit } from './sandboxApplyPermit';
import { applySandboxPatch, type SandboxPatchFile, type SandboxApplyReceipt } from './sandboxApply';
import { resolveOpenCodeEngine, runOpenCodeSandboxDiff, runLocalLoopbackOpenCodeDiff, type RunOpenCodeDiffOptions } from './openCodeSandboxRunner';
import { resolveModelConfig, summarizeModelWire, providerDisplayToken, type OpenCodeModelConfig } from './openCodeModelWire';
import type { SandboxActivationPermit } from './openCodeSandboxDraftEngine';
import type { OpenCodeTransport } from './openCodeSpawnTransport';
import { emitSandboxEvent } from './boundaryTraceTelemetry';

export type EngineSource = 'local_planner' | 'opencode' | 'mock';

export interface EngineProposeInput { prompt: string; selectedFiles?: SandboxPatchFile[] }

export interface SandboxEngine {
  readonly id: EngineSource;
  /** Produce a patch candidate (in-memory). MUST be pure/bounded; NEVER touches the live repo. */
  propose(input: EngineProposeInput): SandboxPatchFile[];
}

/** Deterministic local engine — emits a tiny real patch derived from the prompt. No network, no model. */
export class LocalPlannerEngine implements SandboxEngine {
  readonly id = 'local_planner' as const;
  propose({ prompt }: EngineProposeInput): SandboxPatchFile[] {
    const slug = (prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'change';
    return [{
      relPath: `drafts/${slug}.md`,
      content: `# Sandbox draft\n\nrequest: ${prompt.slice(0, 200)}\n\n(produced by local_planner — sandbox only; not applied to the live repo)\n`,
    }];
  }
}

/**
 * OpenCode engine. PARKED by default — propose() refuses until OpenCode resolves to `active` (detection AND a
 * signed lab activation AND a configured local loopback model). When active, it runs the gated spawn through the
 * fused chokepoint, sanitizes the output at the defensive boundary, and returns a patch candidate that the bridge
 * routes like any other (classify → lab signer → temp apply → receipt → HRT). The transport is injectable so the
 * full loop is provable with a deterministic test double when no live local model is running.
 */
export interface OpenCodeEngineOpts { repoRoot: string; permit?: SandboxActivationPermit; modelConfig?: OpenCodeModelConfig; enabled?: boolean; transport?: OpenCodeTransport }
export class OpenCodeSandboxEngine implements SandboxEngine {
  readonly id = 'opencode' as const;
  private opts: OpenCodeEngineOpts;
  constructor(arg: string | OpenCodeEngineOpts) { this.opts = typeof arg === 'string' ? { repoRoot: arg } : arg; }
  propose({ prompt }: EngineProposeInput): SandboxPatchFile[] {
    // runOpenCodeSandboxDiff asserts the all-three gate (throws when parked → the bridge refuses cleanly),
    // runs the gated transport, and returns a SANITIZED candidate (hidden channels refused, parsed as data).
    const candidate = runOpenCodeSandboxDiff(this.opts.repoRoot, prompt, {
      permit: this.opts.permit, modelConfig: this.opts.modelConfig, enabled: this.opts.enabled, transport: this.opts.transport,
    });
    return candidate.files.map((f) => ({ relPath: f.relPath, content: f.content }));
  }
}

export interface RunEngineInput {
  prompt: string;
  engine: SandboxEngine;
  draftHash?: string;
  nonce?: string;
  now?: string;
  tmpBase?: string;
  table?: KernelActionTable;
}

export interface SandboxEngineRunResult {
  engineSource: EngineSource;
  classification: DraftActionVerdict;
  candidateFiles: string[];
  outcome: 'applied_sandbox' | 'refused';
  reason: string;
  receipt: SandboxApplyReceipt | null;
  appliedLive: false;
  liveRepoUnchanged: true;
  advisoryOnly: true;
  grantsAuthority: false;
}

function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }

/**
 * Run a coding engine into the gated sandbox lane. The prompt is classified; only a `write_gated` draft may
 * apply; the engine's candidate is applied to a THROWAWAY temp copy under a sandbox permit; the receipt names
 * the engine. A parked engine (OpenCode) refuses cleanly. The live repo is never touched.
 */
export function runSandboxEngine(input: RunEngineInput): SandboxEngineRunResult {
  const table = input.table ?? buildKernelActionTable();
  const classification = classifyDraftAction(input.prompt, table);
  const draftHash = input.draftHash ?? sha256(input.prompt);
  const base = {
    engineSource: input.engine.id, classification, appliedLive: false as const, liveRepoUnchanged: true as const,
    advisoryOnly: true as const, grantsAuthority: false as const,
  };
  const refused = (reason: string, candidateFiles: string[] = []): SandboxEngineRunResult =>
    ({ ...base, candidateFiles, outcome: 'refused', reason, receipt: null });

  // Only a write_gated draft may proceed (sacred/Ring-0/executable/read/unknown never apply).
  if (classification.class !== 'write_gated') {
    return refused(`classification=${classification.class} — only write_gated drafts apply to the sandbox (${classification.rationale})`);
  }

  // Engine proposes a candidate (parked engines throw → refuse cleanly).
  let files: SandboxPatchFile[];
  try {
    files = input.engine.propose({ prompt: input.prompt });
  } catch (e) {
    return refused(`engine ${input.engine.id} parked/refused: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!files.length) return refused(`engine ${input.engine.id} produced no patch candidate`);
  const candidateFiles = files.map((f) => f.relPath);

  // Issue a sandbox-only permit (write_gated) and apply to a temp copy only.
  const permitResult = issueSandboxApplyPermit({ draftHash, actionClass: 'write_gated', nonce: input.nonce ?? sha256(draftHash).slice(0, 12), issuedAt: input.now });
  if (!permitResult.ok) return refused(`permit refused: ${permitResult.reason}`, candidateFiles);

  const applied = applySandboxPatch({
    permit: permitResult.permit, draftHash, files, now: input.now, tmpBase: input.tmpBase,
    table, engineSource: input.engine.id,
    onEvent: emitSandboxEvent, // 24Z.23: one-way telemetry sink — records sandbox events, returns void, no read path
  });
  if (!applied.ok) return refused(`sandbox apply refused: ${applied.reason}`, candidateFiles);

  return { ...base, candidateFiles, outcome: 'applied_sandbox', reason: `applied ${candidateFiles.length} file(s) to a temp sandbox via ${input.engine.id}`, receipt: applied.receipt };
}

/** A pre-produced candidate (e.g. from a real local model) wrapped as an engine so it routes through the SAME
 *  gated lane (classify → permit → temp apply → receipt → HRT). It never touches the live repo. */
export class StaticCandidateEngine implements SandboxEngine {
  readonly id = 'opencode' as const;
  constructor(private files: SandboxPatchFile[]) {}
  propose(): SandboxPatchFile[] { return this.files; }
}

export interface LocalLoopbackDiffResult {
  ran: boolean;            // a real local endpoint produced a parsed candidate
  reachable: boolean;
  parked: boolean;         // honestly parked (gate closed / not configured / unreachable) — NOT a failure
  reason?: string;
  run?: SandboxEngineRunResult;     // the routed apply result (when ran)
}

/**
 * 24Z.27 — run a REAL local LOOPBACK model into the sandbox lane, honestly. Produces a sentinel-cleaned candidate
 * from the loopback model (or stays PARKED if not configured / gate closed / endpoint unreachable — never faking),
 * then routes the candidate through the existing gated lane (classify → lab signer → temp-only apply → receipt →
 * HRT). The live repo is never touched. `ran` is true ONLY if a real endpoint actually responded.
 */
export async function runLocalLoopbackSandboxDiff(repoRoot: string, prompt: string, opts: RunOpenCodeDiffOptions & { now?: string; tmpBase?: string; table?: KernelActionTable; call?: any; probe?: any; modelCallOpts?: any } = {}): Promise<LocalLoopbackDiffResult> {
  let produced;
  try {
    produced = await runLocalLoopbackOpenCodeDiff(repoRoot, prompt, opts);
  } catch (e) {
    // a Sentinel refusal (hidden channel / bad output) is a clean REFUSAL, not an apply — live repo untouched.
    return { ran: false, reachable: true, parked: false, reason: `model output refused: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (produced.parked || !produced.candidate) return { ran: false, reachable: produced.reachable, parked: true, reason: produced.reason };
  const run = runSandboxEngine({
    prompt, engine: new StaticCandidateEngine(produced.candidate.files.map((f) => ({ relPath: f.relPath, content: f.content }))),
    now: opts.now, tmpBase: opts.tmpBase, table: opts.table,
  });
  return { ran: true, reachable: true, parked: false, run };
}

/** Honest engine inventory for the manifest / the console. */
export interface SandboxEngineInventory {
  activeEngine: EngineSource;
  openCode: { detected: boolean; status: string; canSpawn: boolean; reason: string; modelProvider: 'none' | 'local' | 'scoped_api'; modelConfigured: boolean };
  liveApply: false;
  productionSigner: false;
}

export function buildSandboxEngineInventory(repoRoot: string): SandboxEngineInventory {
  const cfg = resolveModelConfig();
  const mw = summarizeModelWire(cfg);
  const oc = resolveOpenCodeEngine(repoRoot, { modelConfig: cfg });
  return {
    activeEngine: 'local_planner',
    // modelProvider is mapped to a SAFE display token (never names a vendor in the browser surface, never an
    // authority enum) so a tampered value can never echo an authority/live/production token to the console.
    openCode: { detected: oc.detected, status: oc.status, canSpawn: oc.canSpawn, reason: oc.reason, modelProvider: providerDisplayToken(mw.provider), modelConfigured: mw.configured },
    liveApply: false,
    productionSigner: false,
  };
}

export function summarizeSandboxEngines(inv: SandboxEngineInventory): string {
  return [
    `Sandbox engine: active=${inv.activeEngine}. OpenCode: status=${inv.openCode.status}, detected=${inv.openCode.detected}, canSpawn=${inv.openCode.canSpawn}, modelProvider=${inv.openCode.modelProvider}, modelConfigured=${inv.openCode.modelConfigured}.`,
    'A coding engine can produce a patch candidate that flows through kernel-classify → permit → temp-only apply → receipt → HRT trace. The engine never touches the live repo.',
    `LIVE apply: ${inv.liveApply}. Production signer: ${inv.productionSigner}. OpenCode real spawn: parked (needs signed gate + configured model).`,
  ].join('\n');
}
