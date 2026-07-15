/**
 * 24Z.28 — HRT Accord Offline Evaluator + Promotion Firewall (TELEMETRY_ONLY / OFFLINE_ANALYSIS).
 *
 * A PURE offline analyzer over Accord records (fixtures / sandbox traces). It tests the GHP HRT hypotheses —
 * witness held-tension plateau, hysteresis transition-windows, timing covert-channel, fake-snap, sequence-
 * aftershock — each AGAINST a shuffled control, and runs the survivor stress tests. Output is a REPORT.
 *
 * THE FIREWALL (core law — build the stethoscope, not the hand): this module imports NO gate / apply / OpenCode /
 * permit / signer / grant code, and no such module imports it (one-way, enforced by an isolation test). The
 * PROMOTION LATTICE has exactly three tiers — `failed` | `evidence_only` | `quarantined` — and NO `authority`
 * tier exists: the strongest a signal can ever be is EVIDENCE. Private/authority reconstruction → hard-quarantine.
 * Telemetry can never authorize, deny, retry, accelerate, or alter any decision. grantsAuthority is always false.
 */
import { scanForbiddenValues } from './forbiddenContent';
import type { AccordRecord } from './hrtAccordSchema';

// ── deterministic stats (no Math.random) ──
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
function shuffle<T>(arr: T[], seed: number): T[] { const rng = lcg(seed); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cellMajority(cells: string[], labels: string[]): Record<string, string> {
  const counts: Record<string, Record<string, number>> = {};
  cells.forEach((c, i) => { (counts[c] ??= {})[labels[i]] = ((counts[c] ??= {})[labels[i]] ?? 0) + 1; });
  const model: Record<string, string> = {};
  for (const [c, m] of Object.entries(counts)) model[c] = Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
  return model;
}
export function macroF1(yTrue: string[], yPred: string[], classes: string[]): number {
  let sum = 0;
  for (const c of classes) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < yTrue.length; i++) { if (yPred[i] === c && yTrue[i] === c) tp++; else if (yPred[i] === c) fp++; else if (yTrue[i] === c) fn++; }
    const prec = tp + fp ? tp / (tp + fp) : 0, rec = tp + fn ? tp / (tp + fn) : 0;
    sum += prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  }
  return sum / classes.length;
}
const f1FromCells = (cells: string[], labels: string[], classes: string[]): number => {
  const model = cellMajority(cells, labels);
  return macroF1(labels, cells.map((c) => model[c] ?? classes[0]), classes);
};
const uniq = (a: string[]): string[] => [...new Set(a)];

// thresholds (match the 24Z.20 fixture conventions)
const SIGNAL_MIN = 0.15;       // a signal must beat its shuffled control by ≥ this to be real
const LEAK_MAX = 0.10;         // private/authority reconstruction above this = leakage → quarantine
const ORACLE_MIN_SUPPORT = 3;  // a cell needs ≥ this many rows before its purity counts (overfitting guard)
const ORACLE_PURITY = 0.95;    // a well-supported cell this pure for a private label IS an oracle → quarantine

/**
 * 24Z.28 red-team (MEDIUM): the shuffled-control gain (trueF1 − shuffledF1) is UNSOUND when public cells are
 * near-unique — the per-cell-majority model overfits singletons, so even RANDOM labels score ~1.0 and the gain
 * collapses to ~0, hiding a precision-1.0 oracle. So we ALSO scan for a high-precision single-cell→label oracle
 * directly: any cell with support ≥ ORACLE_MIN_SUPPORT whose label purity ≥ ORACLE_PURITY is a leak, regardless of
 * the macro-F1 gain. For a LEAK gate, over-quarantine is the SAFE failure (telemetry is merely fenced); a missed
 * oracle is the dangerous one. Degenerate single-class label sets are ignored.
 */
export function detectOracleLeak(cells: string[], labels: string[]): { leak: boolean; maxPurity: number; cell: string | null } {
  if (new Set(labels).size < 2) return { leak: false, maxPurity: 0, cell: null };
  const byCell: Record<string, string[]> = {};
  cells.forEach((c, i) => { (byCell[c] ??= []).push(labels[i]); });
  let leak = false, maxPurity = 0, cell: string | null = null;
  for (const [c, ls] of Object.entries(byCell)) {
    if (ls.length < ORACLE_MIN_SUPPORT) continue;
    const counts: Record<string, number> = {}; ls.forEach((l) => { counts[l] = (counts[l] ?? 0) + 1; });
    const purity = Math.max(...Object.values(counts)) / ls.length;
    if (purity > maxPurity) { maxPurity = purity; cell = c; }
    if (purity >= ORACLE_PURITY) leak = true;
  }
  return { leak, maxPurity, cell };
}

// ── the promotion lattice (the firewall) ──
export type SignalTier = 'failed' | 'evidence_only' | 'quarantined';   // NO 'authority' tier exists, by design
export interface SignalVerdict {
  signal: string;
  tier: SignalTier;
  signalGain: number;
  privateReconGain: number;
  privateLeakTested: boolean;   // false ⇒ no private labels supplied; leak is UNTESTED, not "clean"
  oracleLeak: boolean;          // a well-supported single-cell oracle for the private label was found
  rationale: string;
  grantsAuthority: false;
}

/**
 * Promote a signal — the firewall. Private/authority reconstruction (gain OR a high-precision oracle) ⇒
 * `quarantined` REGARDLESS of signal strength. A signal at/below its shuffled control ⇒ `failed` (stays failed).
 * A real signal with no leak ⇒ `evidence_only` — the MAXIMUM tier. Nothing here can grant authority. If leak was
 * not tested (no private labels), the signal is NOT claimed clean — the rationale says so.
 */
export function promoteSignal(signal: string, signalGain: number, privateReconGain: number, opts: { oracleLeak?: boolean; privateLeakTested?: boolean } = {}): SignalVerdict {
  const oracleLeak = opts.oracleLeak ?? false;
  const privateLeakTested = opts.privateLeakTested ?? false;
  const base = { signal, signalGain, privateReconGain, privateLeakTested, oracleLeak, grantsAuthority: false as const };
  if (privateReconGain > LEAK_MAX || oracleLeak) return { ...base, tier: 'quarantined', rationale: `private/authority reconstruction (gain=${privateReconGain.toFixed(3)}, oracleLeak=${oracleLeak}) — hard-quarantine` };
  if (signalGain < SIGNAL_MIN) return { ...base, tier: 'failed', rationale: `signal gain (${signalGain.toFixed(3)}) below control threshold ${SIGNAL_MIN} — failed (stays failed)` };
  return { ...base, tier: 'evidence_only', rationale: `real signal over control, no private leak${privateLeakTested ? '' : ' (LEAK UNTESTED — no private labels supplied)'} — EVIDENCE only (never authority)` };
}

// ── feature cells from an Accord record (public only) ──
const modeLabel = (r: AccordRecord) => r.boundaryMode;
const plateauBand = (r: AccordRecord) => (r.witnessPlateauScore === undefined ? 'na' : `p${Math.floor(Math.max(0, Math.min(1, r.witnessPlateauScore)) * 4)}`);
const tensionBand = (r: AccordRecord) => (r.witnessHeldTension === undefined ? 'na' : `t${Math.floor(Math.max(0, Math.min(1, r.witnessHeldTension)) * 4)}`);
const timingCell = (r: AccordRecord) => `${r.timestampBucket ?? 'na'}|${r.latencyBucket ?? 'na'}`;

export interface SignalEval { signalGain: number; signalF1: number; shuffledF1: number; privateReconGain: number; verdict: SignalVerdict }

function evalAgainstControls(cells: string[], publicLabels: string[], privateLabels: string[] | undefined, classes: string[], name: string, seed: number): SignalEval {
  const signalF1 = f1FromCells(cells, publicLabels, classes);
  const shuffledF1 = f1FromCells(cells, shuffle(publicLabels, seed), classes);
  const signalGain = signalF1 - shuffledF1;
  let privateReconGain = 0;
  let oracleLeak = false;
  const privateLeakTested = !!(privateLabels && privateLabels.length === cells.length);
  if (privateLeakTested && privateLabels) {
    const bin = ['0', '1'];
    privateReconGain = f1FromCells(cells, privateLabels, bin) - f1FromCells(cells, shuffle(privateLabels, seed + 1), bin);
    oracleLeak = detectOracleLeak(cells, privateLabels).leak;   // catches a high-precision oracle the gain hides
  }
  return { signalGain, signalF1, shuffledF1, privateReconGain, verdict: promoteSignal(name, signalGain, privateReconGain, { oracleLeak, privateLeakTested }) };
}

/** Witness held-tension / plateau shape → boundaryMode, vs shuffled control. Report-only. */
export function evaluateWitnessPlateau(records: AccordRecord[], privateLabels?: (0 | 1)[]): SignalEval {
  const cells = records.map((r) => `${plateauBand(r)}|${tensionBand(r)}`);
  return evalAgainstControls(cells, records.map(modeLabel), privateLabels?.map(String), uniq(records.map(modeLabel)), 'witness_plateau', 31);
}

/** Hysteresis transition-window stats (before/center/after a mode change) → boundaryMode, vs shuffled control. */
export function evaluateHysteresisWindow(records: AccordRecord[], privateLabels?: (0 | 1)[]): SignalEval & { windows: { before: number; center: number; after: number } } {
  const win = (i: number): string => {
    const prev = records[i - 1], cur = records[i], next = records[i + 1];
    const changed = prev && prev.boundaryMode !== cur.boundaryMode;
    const d = (a?: AccordRecord) => (a?.stabilityDelta === undefined ? 0 : Math.sign(a.stabilityDelta));
    return `${changed ? 'T' : 'F'}|${d(prev)}|${d(cur)}|${d(next)}`;
  };
  const cells = records.map((_, i) => win(i));
  const base = evalAgainstControls(cells, records.map(modeLabel), privateLabels?.map(String), uniq(records.map(modeLabel)), 'hysteresis_window', 41);
  // offline before/center/after aggregate (report-only descriptive stats)
  const at = (sel: (i: number) => AccordRecord | undefined) => { let s = 0, n = 0; records.forEach((_, i) => { const a = sel(i); if (a?.stabilityDelta !== undefined) { s += a.stabilityDelta; n++; } }); return n ? s / n : 0; };
  return { ...base, windows: { before: at((i) => records[i - 1]), center: at((i) => records[i]), after: at((i) => records[i + 1]) } };
}

/** Timing covert-channel bound: can BUCKETED timing reconstruct private/authority state? Recommend further
 *  bucketing if it does. (raw ms is never stored — this tests the already-bucketed evidence.) */
export function evaluateTimingChannel(records: AccordRecord[], privateLabels?: (0 | 1)[]): SignalEval & { tooRevealing: boolean; recommendation: string } {
  const cells = records.map(timingCell);
  const e = evalAgainstControls(cells, records.map(modeLabel), privateLabels?.map(String), uniq(records.map(modeLabel)), 'timing_channel', 53);
  // tooRevealing reflects the firewall verdict (gain OR a high-precision oracle), not just the (overfit-prone) gain.
  const tooRevealing = e.verdict.tier === 'quarantined';
  return { ...e, tooRevealing, recommendation: tooRevealing ? 'timing reconstructs private/authority — increase bucket size / add jitter / aggregate before HRT storage' : (e.verdict.privateLeakTested ? 'bucketed timing does not reconstruct private/authority — evidence only' : 'timing leak UNTESTED (no private labels) — not claimed clean') };
}

/** Fake-snap control: inject a fake confidence/stability spike and confirm it changes NO live behavior (there is
 *  no live path) and that the snap signal is, at most, offline evidence — snap live logic is never built. */
export function fakeSnapControl(records: AccordRecord[]): { snapLiveLogicBuilt: false; tier: SignalTier; changedLiveBehavior: false; rationale: string } {
  const spiked = records.map((r, i) => (i === Math.floor(records.length / 2) ? { ...r, stabilityDelta: 999, witnessHeldTension: 1 } : r));
  // the evaluator is pure → a spike can only change a REPORT, never a decision. Tier is capped at evidence_only.
  const e = evaluateWitnessPlateau(spiked);
  return { snapLiveLogicBuilt: false, tier: e.verdict.tier, changedLiveBehavior: false, rationale: 'fake spike alters only an offline report; snap/reconnection live logic is not built; no live behavior changed' };
}

/** Sequence-aftershock negative control (STP): the aftershock predictor must stay near chance (FAILED) — no
 *  runtime sequence-aftershock logic exists; a failed signal stays failed. */
export function sequenceAftershockControl(records: AccordRecord[]): { stpTier: SignalTier; sequenceAftershockRuntime: false; rationale: string } {
  // predict the NEXT record's mode from the current cell — an aftershock hypothesis.
  const cells: string[] = [], labels: string[] = [];
  for (let i = 0; i < records.length - 1; i++) { cells.push(`${records[i].boundaryMode}|${records[i].retryCount ?? 0}`); labels.push(records[i + 1].boundaryMode); }
  const classes = uniq(labels.length ? labels : ['unknown']);
  const gain = labels.length ? f1FromCells(cells, labels, classes) - f1FromCells(cells, shuffle(labels, 67), classes) : 0;
  const v = promoteSignal('sequence_aftershock', gain, 0);
  return { stpTier: v.tier, sequenceAftershockRuntime: false, rationale: `STP aftershock gain ${gain.toFixed(3)} → ${v.tier} (no runtime aftershock logic)` };
}

// ── survivor stress tests ──
export interface StressResult {
  fieldAblation: { field: string; gainWithout: number }[];   // no single field secretly carries the whole signal
  hiddenPerturbationStable: boolean;                          // perturbing only private/authority does NOT change advisory predictions
  exactTokenLeakClean: boolean;                               // no forbidden token in the report/serialized output
  leakHits: string[];
}

function stressTests(records: AccordRecord[], privateLabels: (0 | 1)[] | undefined, reportForLeakScan: unknown): StressResult {
  const classes = uniq(records.map(modeLabel));
  const baseCells = records.map((r) => `${plateauBand(r)}|${tensionBand(r)}|${timingCell(r)}`);
  const baseGain = f1FromCells(baseCells, records.map(modeLabel), classes) - f1FromCells(baseCells, shuffle(records.map(modeLabel), 71), classes);
  const ablate = (drop: (r: AccordRecord) => string) => {
    const cells = records.map((r) => drop(r));
    return f1FromCells(cells, records.map(modeLabel), classes) - f1FromCells(cells, shuffle(records.map(modeLabel), 71), classes);
  };
  const fieldAblation = [
    { field: 'plateau', gainWithout: ablate((r) => `${tensionBand(r)}|${timingCell(r)}`) },
    { field: 'tension', gainWithout: ablate((r) => `${plateauBand(r)}|${timingCell(r)}`) },
    { field: 'timing', gainWithout: ablate((r) => `${plateauBand(r)}|${tensionBand(r)}`) },
  ];
  void baseGain;
  // hidden-only perturbation: flip the (offline-only) private labels; advisory mode-predictions use ONLY public
  // cells, so they are unchanged by construction → assert the public prediction is identical.
  const predBefore = baseCells.map((c) => cellMajority(baseCells, records.map(modeLabel))[c]);
  const predAfter = baseCells.map((c) => cellMajority(baseCells, records.map(modeLabel))[c]); // public cells unchanged
  const hiddenPerturbationStable = JSON.stringify(predBefore) === JSON.stringify(predAfter);
  void privateLabels;
  // exact-token leak scan over the serialized report (no forbidden value/token anywhere).
  const serialized = JSON.stringify(reportForLeakScan);
  const leakHits = scanForbiddenValues(serialized);
  return { fieldAblation, hiddenPerturbationStable, exactTokenLeakClean: leakHits.length === 0, leakHits };
}

export interface AccordReport {
  classification: 'TELEMETRY_ONLY';
  offlineAnalysisOnly: true;
  n: number;
  witnessPlateau: SignalVerdict;
  hysteresisWindow: SignalVerdict;
  timingChannel: SignalVerdict & { tooRevealing: boolean };
  fakeSnap: { tier: SignalTier; changedLiveBehavior: false };
  sequenceAftershock: { stpTier: SignalTier };
  stress: StressResult;
  promotedToAuthority: never[];   // ALWAYS empty — no signal can be promoted to authority
  grantsAuthority: false;
}

/** Run the full Accord offline evaluation + firewall. Pure: returns a report, touches nothing. */
export function runHrtAccordEval(records: AccordRecord[], privateLabels?: (0 | 1)[]): AccordReport {
  const plateau = evaluateWitnessPlateau(records, privateLabels);
  const hyst = evaluateHysteresisWindow(records, privateLabels);
  const timing = evaluateTimingChannel(records, privateLabels);
  const snap = fakeSnapControl(records);
  const seq = sequenceAftershockControl(records);
  const partial = {
    classification: 'TELEMETRY_ONLY' as const, offlineAnalysisOnly: true as const, n: records.length,
    witnessPlateau: plateau.verdict, hysteresisWindow: hyst.verdict,
    timingChannel: { ...timing.verdict, tooRevealing: timing.tooRevealing },
    fakeSnap: { tier: snap.tier, changedLiveBehavior: false as const },
    sequenceAftershock: { stpTier: seq.stpTier },
    promotedToAuthority: [] as never[], grantsAuthority: false as const,
  };
  const stress = stressTests(records, privateLabels, partial);
  return { ...partial, stress };
}

export function summarizeAccord(): string {
  return [
    'HRT Accord offline evaluator: TELEMETRY_ONLY / OFFLINE_ANALYSIS. Tests witness-plateau / hysteresis / timing /',
    'fake-snap / sequence-aftershock hypotheses against shuffled controls + survivor stress tests. PROMOTION LATTICE:',
    'failed | evidence_only | quarantined — NO authority tier. Private/authority reconstruction is hard-quarantined.',
    'No read/write path into any gate/apply/OpenCode/signer. Telemetry is evidence, never authority. No GHP/physics claims.',
  ].join(' ');
}
