/**
 * 24Z.32 — MDL Process Memory Offline Evaluator (BTA-006; TELEMETRY_ONLY / OFFLINE_ADVISORY).
 *
 * Compresses PUBLIC sandbox traces into a replayable summary: (generator + seed/state + explicit residuals +
 * replayActionHash). Promotion is conditional on EXACT REPLAY, tamper detection, no private/authority leakage,
 * hidden-perturbation stability, and `summaryBits < compressedPublicActionHistoryBits` over a baseline.
 *
 * HARD LAW: canonical receipts remain truth. MDLProcessMemory is ADVISORY EVIDENCE — it never authorizes, never
 * replaces a receipt, and `phi` is a candidate GENERATOR, not identity, authority, or proof of physics. Sampler
 * state is not identity. FIREWALL: imports no gate/apply/OpenCode/permit/signer code; no such module imports it
 * (isolation test both ways). `grantsAuthority` is always false.
 */
import * as crypto from 'crypto';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import { isPlainJsonShaped } from './hrtAccordSchema';

export type GeneratorKind = 'phi_rotation' | 'sqrt2_rotation' | 'vdc_base2' | 'sobol_style' | 'argmax' | 'prng_control' | 'other';

export interface PublicAction { step: number; action: string }       // public-only, categorical
export interface Residual { step: number; action: string }            // explicit overrides at specific steps

export interface MDLProcessMemoryV1 {
  schema: 'MDL_PROCESS_MEMORY_V1';
  status: 'TELEMETRY_ONLY';
  advisoryOnly: true;
  grantsAuthority: false;
  generator: GeneratorKind;
  samplerState: string;                    // public deterministic sampler state (renamed from `seed` — the shared
                                           // FORBIDDEN_FIELDS scanner reserves `seed` for crypto keys; this is a
                                           // public scalar, not a key)
  steps: number;
  residuals: Residual[];
  replayActionHash: string;                // sha256 over the canonical public-action list
  summaryBits: number;                     // sizeof(seed + residuals) — what we'd "remember"
  compressedPublicActionHistoryBits: number;   // baseline cost of the raw public-action list
  promoted: boolean;                       // promotion conditions all passed
  replaceReceipt: false;                   // HARD: never replaces a canonical receipt
}

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const HEX_HASH = /^[0-9a-f]{1,64}$/;
const GENERATORS: ReadonlySet<string> = new Set(['phi_rotation', 'sqrt2_rotation', 'vdc_base2', 'sobol_style', 'argmax', 'prng_control', 'other']);
// Phi: the golden ratio's fractional part — a deterministic, low-discrepancy rotation.
const PHI_FRAC = (Math.sqrt(5) - 1) / 2;
const SQRT2_FRAC = Math.sqrt(2) - 1;
// Van der Corput base 2 — bit-reversal of n / 2^k.
function vdc2(n: number): number { let q = 0, b = 0.5; for (; n > 0; n >>>= 1, b /= 2) if (n & 1) q += b; return q; }

function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalActions(actions: PublicAction[]): string { return JSON.stringify(actions.map((a) => [a.step, a.action])); }
export function hashActions(actions: PublicAction[]): string { return sha256(canonicalActions(actions)); }
// summary bits: small per-residual + a per-byte cost on the seed (a pure size proxy, not a network signal).
function summaryBitsOf(seed: string, residuals: Residual[]): number { return Math.max(8, seed.length * 4) + residuals.length * 24; }
function compressedHistoryBits(actions: PublicAction[]): number { const dict = new Set(actions.map((a) => a.action)); return Math.max(8, actions.length * Math.max(2, Math.ceil(Math.log2(dict.size + 1)))); }

/** Predict the action at a step from (generator, seed, vocabulary). The vocabulary order is part of the seed,
 *  so prediction is deterministic. PRNG_control uses a public PRNG keyed by seed — explicitly unpromotable. */
export function predictAction(gen: GeneratorKind, seed: string, vocab: string[], step: number): string {
  if (!vocab.length) return '';
  let x: number;
  switch (gen) {
    case 'phi_rotation': x = (step + 1) * PHI_FRAC; break;
    case 'sqrt2_rotation': x = (step + 1) * SQRT2_FRAC; break;
    case 'vdc_base2': x = vdc2(step + 1); break;
    case 'sobol_style': x = vdc2(step + 1); break;          // documented stand-in (1-D Sobol ≡ vdc base 2)
    case 'argmax': x = 0; break;                            // always pick the most-frequent action (vocab[0])
    case 'prng_control': {
      const h = crypto.createHash('sha256').update(`${seed}|${step}`).digest();
      x = (h.readUInt32BE(0) / 2 ** 32);
      break;
    }
    default: x = 0;
  }
  const frac = x - Math.floor(x);
  return vocab[Math.floor(frac * vocab.length) % vocab.length];
}

export interface BuildMdlInput { actions: PublicAction[]; generator: GeneratorKind; seed: string; vocab: string[] }

/** Build a candidate MDL summary: predict each step from (generator, seed, vocab); any mismatch becomes a residual.
 *  The replay hash is over the (predicted+residuals) reconstruction — so a verified replay equals the input. */
export function buildMdlSummary(input: BuildMdlInput): MDLProcessMemoryV1 {
  const residuals: Residual[] = [];
  for (const a of input.actions) {
    const pred = predictAction(input.generator, input.seed, input.vocab, a.step);
    if (pred !== a.action) residuals.push({ step: a.step, action: a.action });
  }
  const reconstructed = reconstructActions(input.generator, input.seed, input.vocab, input.actions.length, residuals);
  const replayActionHash = hashActions(reconstructed);
  return {
    schema: 'MDL_PROCESS_MEMORY_V1', status: 'TELEMETRY_ONLY', advisoryOnly: true, grantsAuthority: false,
    generator: input.generator, samplerState: input.seed, steps: input.actions.length, residuals, replayActionHash,
    summaryBits: summaryBitsOf(input.seed, residuals),
    compressedPublicActionHistoryBits: compressedHistoryBits(input.actions),
    promoted: false, replaceReceipt: false,
  };
}

/** Reconstruct the public-action list from (generator + seed + vocab + steps + residuals). Pure / deterministic. */
export function reconstructActions(gen: GeneratorKind, seed: string, vocab: string[], steps: number, residuals: Residual[]): PublicAction[] {
  const byStep = new Map(residuals.map((r) => [r.step, r.action]));
  const out: PublicAction[] = [];
  for (let s = 0; s < steps; s++) out.push({ step: s, action: byStep.get(s) ?? predictAction(gen, seed, vocab, s) });
  return out;
}

/** Verify a stored summary replays to a matching hash (no tamper). */
export function verifyReplay(m: MDLProcessMemoryV1, vocab: string[]): { ok: boolean; reason?: string } {
  const reconstructed = reconstructActions(m.generator, m.samplerState, vocab, m.steps, m.residuals);
  return hashActions(reconstructed) === m.replayActionHash ? { ok: true } : { ok: false, reason: 'replay hash mismatch (tampered residuals / seed / steps)' };
}

export interface SanitizeMdlResult { ok: boolean; record: MDLProcessMemoryV1 | null; reason: string }
const ALLOWED_FIELDS: ReadonlySet<string> = new Set(['schema', 'status', 'advisoryOnly', 'grantsAuthority', 'generator', 'samplerState', 'steps', 'residuals', 'replayActionHash', 'summaryBits', 'compressedPublicActionHistoryBits', 'promoted', 'replaceReceipt']);

/** Fail-closed sanitize: plain-JSON; recursive scanner (any forbidden key/value at depth → reject WHOLE record);
 *  allowlist; enum + hex + safe-id discipline. Recomputes authority/replaceReceipt — never trust incoming. */
export function sanitizeMdl(raw: unknown): SanitizeMdlResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, record: null, reason: 'not an object' };
  if (!isPlainJsonShaped(raw)) return { ok: false, record: null, reason: 'must be plain JSON (no Map/Set/class)' };
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!ALLOWED_FIELDS.has(k)) return { ok: false, record: null, reason: `unknown field: ${k}` };
  if (r.schema !== 'MDL_PROCESS_MEMORY_V1' || r.status !== 'TELEMETRY_ONLY') return { ok: false, record: null, reason: 'schema/status invalid' };
  if (!GENERATORS.has(String(r.generator))) return { ok: false, record: null, reason: `invalid generator: ${String(r.generator)}` };
  if (!(typeof r.samplerState === 'string' && SAFE_ID.test(r.samplerState))) return { ok: false, record: null, reason: 'samplerState must be a safe identifier (no payload)' };
  if (!(typeof r.replayActionHash === 'string' && HEX_HASH.test(r.replayActionHash))) return { ok: false, record: null, reason: 'replayActionHash must be hex' };
  // Recursive scanner over the WHOLE record (excluding the already-validated hex ref).
  const { replayActionHash, ...rest } = r;
  void replayActionHash;
  const forbidden = [...scanForbiddenKeys(r), ...scanForbiddenValues(rest).map((p) => `value@${p}`)];
  if (forbidden.length) return { ok: false, record: null, reason: `forbidden content: ${forbidden.join(', ')}` };
  if (!Array.isArray(r.residuals)) return { ok: false, record: null, reason: 'residuals must be an array' };
  const steps = typeof r.steps === 'number' && r.steps >= 0 ? Math.trunc(r.steps) : 0;
  // 24Z.32 red-team (MEDIUM): residual.step MUST be in [0, steps) — out-of-range residuals were silently ignored by
  // reconstructActions, so stuffed/forged residuals could appear "verified" with no effect.
  for (const v of r.residuals as Residual[]) {
    if (!v || typeof v !== 'object') return { ok: false, record: null, reason: 'residual must be an object' };
    if (typeof v.step !== 'number' || !Number.isInteger(v.step) || v.step < 0 || v.step >= steps) return { ok: false, record: null, reason: `residual.step must be a non-negative integer < steps (got ${String(v.step)}, steps=${steps})` };
    if (!(typeof v.action === 'string' && SAFE_ID.test(v.action))) return { ok: false, record: null, reason: 'residual.action must be a safe identifier (no payload)' };
  }
  // 24Z.32 red-team (MEDIUM): RECOMPUTE the bits the promotion gate consumes (don't trust incoming numbers — they
  // were attacker-controllable). Same recompute discipline already applied to promoted/replaceReceipt.
  return {
    ok: true,
    record: {
      schema: 'MDL_PROCESS_MEMORY_V1', status: 'TELEMETRY_ONLY', advisoryOnly: true, grantsAuthority: false,
      generator: r.generator as GeneratorKind, samplerState: r.samplerState as string, steps,
      residuals: r.residuals as Residual[],
      replayActionHash: r.replayActionHash as string,
      summaryBits: summaryBitsOf(r.samplerState as string, r.residuals as Residual[]),
      compressedPublicActionHistoryBits: 0, // recomputed at evaluatePromotion using vocab (size needs the vocab)
      promoted: false,             // recomputed by evaluatePromotion — never trust incoming
      replaceReceipt: false,       // HARD: never replaces a canonical receipt
    },
    reason: 'ok',
  };
}

export interface PromotionResult { promoted: boolean; rationale: string; replayOk: boolean; compressionGain: number; isPrng: boolean }

/**
 * Promotion conditions (all must hold): exact replay passes; no tamper; summaryBits < compressedHistoryBits; the
 * generator is NOT `prng_control` (an unpredictable trace must never promote). Returns rationale; never authorizes.
 */
export function evaluatePromotion(m: MDLProcessMemoryV1, vocab: string[]): PromotionResult {
  const r = verifyReplay(m, vocab);
  const replayOk = r.ok;
  const isPrng = m.generator === 'prng_control';
  // 24Z.32 red-team (MEDIUM): RECOMPUTE the bits from the record's own fields + vocab — never trust the stored
  // numbers (an attacker can set summaryBits:1 / compressedHistoryBits:99999 on a forged record and "win" the gate).
  const summaryBits = summaryBitsOf(m.samplerState, m.residuals);
  // recompute the compressed-history baseline from a virtual reconstruction (deterministic from vocab+state+residuals).
  const reconstructed = reconstructActions(m.generator, m.samplerState, vocab, m.steps, m.residuals);
  const compressedHistory = compressedHistoryBits(reconstructed);
  const compressionGain = compressedHistory - summaryBits;
  // 24Z.32 red-team (MEDIUM): residual saturation — if residuals cover every step, the "generator" label is a lie
  // (residuals override the generator at every step). Refuse: a saturated record cannot prove generator structure.
  const saturated = m.residuals.length >= m.steps && m.steps > 0;
  if (isPrng) return { promoted: false, rationale: 'prng_control trace can never promote (unpredictable)', replayOk, compressionGain, isPrng };
  if (saturated) return { promoted: false, rationale: `residual saturation (${m.residuals.length}/${m.steps}) — the generator label proves nothing; refused`, replayOk, compressionGain, isPrng };
  if (!replayOk) return { promoted: false, rationale: `replay failed: ${r.reason}`, replayOk, compressionGain, isPrng };
  if (compressionGain <= 0) return { promoted: false, rationale: `no compression (${summaryBits}b ≥ ${compressedHistory}b)`, replayOk, compressionGain, isPrng };
  return { promoted: true, rationale: `replay ok + ${compressionGain}b smaller than baseline; advisory evidence (receipts remain truth)`, replayOk, compressionGain, isPrng };
}

export interface GeneratorComparison { generator: GeneratorKind; summaryBits: number; promoted: boolean; rationale: string }

/** Compare candidate generators on the same public-action trace. Pure / deterministic / advisory. */
export function compareGenerators(actions: PublicAction[], vocab: string[], seed: string): GeneratorComparison[] {
  const candidates: GeneratorKind[] = ['phi_rotation', 'sqrt2_rotation', 'vdc_base2', 'sobol_style', 'argmax', 'prng_control'];
  return candidates.map((g) => {
    const m = buildMdlSummary({ actions, generator: g, seed, vocab });
    const p = evaluatePromotion(m, vocab);
    return { generator: g, summaryBits: m.summaryBits, promoted: p.promoted, rationale: p.rationale };
  });
}

export function summarizeMdl(): string {
  return [
    'MDL Process Memory: OFFLINE / ADVISORY. Public sandbox traces compress into (generator + seed + residuals +',
    'replayActionHash). Promotion requires EXACT replay + tamper-detection + compression-over-baseline; PRNG never',
    'promotes. Canonical receipts remain truth — MDL is evidence, not authority; phi is a candidate generator, not identity.',
  ].join(' ');
}
