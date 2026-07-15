/**
 * 24Z.20 — HRT-002 local synthetic fixture + control (fixture-first; no network/IPC; visibly fixture-labelled).
 *
 * Builds a DETERMINISTIC synthetic boundary-trace dataset and runs the adversarial proxy controls:
 *   - public trace predicts receiptMode ABOVE shuffled labels by ≥ 0.15 macro-F1 (the boundary mode is legible);
 *   - private/authority reconstruction from the PUBLIC trace stays NEAR CHANCE (no private leakage);
 *   - an illegal positive control reconstructs the private state ONLY when the forbidden field is injected
 *     (proving the methodology detects leakage) — that field is forbidden by the scanner;
 *   - latency-only is INSUFFICIENT (latency is independent of mode in the fixture).
 * Everything is labelled `source: 'testFixture'`; this is NOT live telemetry.
 */
import type { ReceiptMode } from './boundaryTraceTelemetry';

const MODES: ReceiptMode[] = ['write', 'witness', 'release'];

// deterministic LCG — stable fixtures, no Math.random
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

export interface FixtureRow {
  // public features
  gateVerdict: 'green' | 'yellow' | 'red';
  retryCount: number;
  stabilityDelta: number;
  latencyMs: number;
  // public label
  receiptMode: ReceiptMode;
  // PRIVATE — never part of a stored trace; the thing we must NOT be able to reconstruct
  _privateAuthority: 0 | 1;
}

export function buildBoundaryTraceFixture(n = 600, seed = 24020): FixtureRow[] {
  const rng = lcg(seed);
  const verdicts: FixtureRow['gateVerdict'][] = ['green', 'yellow', 'red'];
  // receiptMode is ~75% determined by the gate verdict (the legible public signal); 25% noise.
  const baseMode: Record<FixtureRow['gateVerdict'], ReceiptMode> = { green: 'release', yellow: 'witness', red: 'write' };
  const rows: FixtureRow[] = [];
  for (let i = 0; i < n; i++) {
    const gateVerdict = verdicts[Math.floor(rng() * 3)];
    const retryCount = Math.floor(rng() * 4);
    const receiptMode = rng() < 0.75 ? baseMode[gateVerdict] : MODES[Math.floor(rng() * 3)];
    rows.push({
      gateVerdict,
      retryCount,
      stabilityDelta: Math.round((rng() - 0.5) * 100) / 100,
      latencyMs: Math.round(50 + rng() * 200),          // independent of receiptMode → latency-only fails
      receiptMode,
      _privateAuthority: rng() < 0.5 ? 1 : 0,            // independent of EVERY public feature
    });
  }
  return rows;
}

// ── tiny per-cell-majority classifier (deterministic) + macro-F1 ──

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
    for (let i = 0; i < yTrue.length; i++) {
      if (yPred[i] === c && yTrue[i] === c) tp++;
      else if (yPred[i] === c && yTrue[i] !== c) fp++;
      else if (yPred[i] !== c && yTrue[i] === c) fn++;
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    sum += prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  }
  return sum / classes.length;
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const rng = lcg(seed); const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const f1FromCells = (cells: string[], labels: string[], classes: string[]): number =>
  macroF1(labels, cells.map((c) => cellMajority(cells, labels)[c] ?? classes[0]), classes);

export interface FixtureMetrics {
  n: number;
  receiptModeF1: number;        // public features → receiptMode
  shuffledModeF1: number;       // same, labels shuffled (control / chance)
  modeSignalGain: number;       // receiptModeF1 - shuffledModeF1  (must be ≥ 0.15)
  privateReconF1: number;       // public features → private authority (must stay near chance)
  shuffledPrivateF1: number;
  privateReconGain: number;     // privateReconF1 - shuffledPrivateF1 (must be ≤ ~0.10)
  illegalControlF1: number;     // WITH the forbidden field injected → reconstructs (proves the method works)
  latencyOnlyF1: number;        // latency-only → receiptMode (must be near chance)
  latencyOnlyGain: number;      // latencyOnlyF1 - shuffledModeF1 (must be ≤ ~0.10)
}

export function evaluateFixture(rows: FixtureRow[]): FixtureMetrics {
  const modes = MODES as string[];
  const bin = ['0', '1'];
  const publicCell = (r: FixtureRow) => `${r.gateVerdict}|${r.retryCount}`;
  const latBucket = (r: FixtureRow) => `${Math.floor(r.latencyMs / 80)}`;

  const modeLabels = rows.map((r) => r.receiptMode as string);
  const pubCells = rows.map(publicCell);
  const receiptModeF1 = f1FromCells(pubCells, modeLabels, modes);
  const shuffledModeF1 = f1FromCells(pubCells, shuffle(modeLabels, 7), modes);

  const privLabels = rows.map((r) => String(r._privateAuthority));
  const privateReconF1 = f1FromCells(pubCells, privLabels, bin);
  const shuffledPrivateF1 = f1FromCells(pubCells, shuffle(privLabels, 11), bin);

  // illegal positive control: the forbidden authority field IS a feature → perfect reconstruction
  const illegalCells = rows.map((r) => `auth:${r._privateAuthority}`);
  const illegalControlF1 = f1FromCells(illegalCells, privLabels, bin);

  const latencyOnlyF1 = f1FromCells(rows.map(latBucket), modeLabels, modes);

  return {
    n: rows.length,
    receiptModeF1, shuffledModeF1, modeSignalGain: receiptModeF1 - shuffledModeF1,
    privateReconF1, shuffledPrivateF1, privateReconGain: privateReconF1 - shuffledPrivateF1,
    illegalControlF1,
    latencyOnlyF1, latencyOnlyGain: latencyOnlyF1 - shuffledModeF1,
  };
}

export function runFixtureEval(n = 600): FixtureMetrics { return evaluateFixture(buildBoundaryTraceFixture(n)); }
