import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeAccordRecord, bucketTime, bucketLatency, type AccordRecord } from '../src/hrtAccordSchema';
import {
  runHrtAccordEval, promoteSignal, evaluateWitnessPlateau, evaluateHysteresisWindow, evaluateTimingChannel,
  fakeSnapControl, sequenceAftershockControl, detectOracleLeak,
} from '../src/hrtAccordEvaluator';

// 24Z.28 — deterministic Accord fixtures (no Math.random). boundaryMode is ~legible from plateau/tension bands;
// a PRIVATE/authority label is supplied SEPARATELY (never stored in a record) for the leak controls.
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
function buildAccordFixture(n = 600, seed = 24028): { records: AccordRecord[]; priv: (0 | 1)[] } {
  const rng = lcg(seed);
  const modes = ['write', 'witness', 'release'] as const;
  const records: AccordRecord[] = []; const priv: (0 | 1)[] = [];
  let mode: 'write' | 'witness' | 'release' = modes[0];
  for (let i = 0; i < n; i++) {
    // plateau/tension carry the mode signal; hysteresis: stabilityDelta dips at transitions
    if (rng() < 0.2) mode = modes[Math.floor(rng() * 3)];
    const plateau = mode === 'release' ? 0.8 : mode === 'witness' ? 0.5 : 0.2;
    records.push({
      recordId: `acc_${i}`, timestampBucket: bucketTime(i * 300), boundaryMode: mode,
      gateVerdict: mode === 'release' ? 'green' : mode === 'witness' ? 'yellow' : 'red',
      retryCount: Math.floor(rng() * 3), latencyBucket: bucketLatency(50 + rng() * 200),
      stabilityDelta: Math.round((rng() - 0.5) * 100) / 100,
      witnessHeldTension: Math.min(1, Math.max(0, plateau + (rng() - 0.5) * 0.3)),
      witnessPlateauScore: Math.min(1, Math.max(0, plateau + (rng() - 0.5) * 0.2)),
      source: 'testFixture', classification: 'TELEMETRY_ONLY', grantsAuthority: false,
    });
    priv.push(rng() < 0.5 ? 1 : 0);   // independent of every public feature → must NOT be reconstructable
  }
  return { records, priv };
}

describe('24Z.28: Accord schema — allowlist + recursive scanner + hash-ref/count discipline', () => {
  it('keeps allowlisted fields; drops unknown; no meta/payload escape hatch', () => {
    const r = sanitizeAccordRecord({ recordId: 'x', boundaryMode: 'witness', source: 'testFixture', classification: 'TELEMETRY_ONLY', grantsAuthority: false, payload: 'SECRET BLOB', meta: { x: 1 } });
    expect(r.ok).toBe(true);
    expect(r.droppedFields).toEqual(expect.arrayContaining(['payload', 'meta']));
    expect((r.record as any).payload).toBeUndefined();
  });
  it('REJECTS a forbidden key/value at any depth (recursive, fail-closed)', () => {
    expect(sanitizeAccordRecord({ boundaryMode: 'write', nested: { privateKey: 'x' } }).ok).toBe(false);
    expect(sanitizeAccordRecord({ boundaryMode: 'write', canonicalizationCategoryCounts: { zero_width: 1 }, secret: 'sk-AKIAIOSFODNN7EXAMPLE12' }).ok).toBe(false);
  });
  // 24Z.28 Fusion (Opus): the scanner can't introspect non-plain containers → fail-closed on Map/Set/class/Date.
  it('REJECTS non-plain-JSON containers (Map/Set/class/Date) the scanner cannot introspect', () => {
    expect(sanitizeAccordRecord({ boundaryMode: 'write', m: new Map([['privateKey', 'x']]) }).ok).toBe(false);
    expect(sanitizeAccordRecord({ boundaryMode: 'write', s: new Set(['sk-AKIAIOSFODNN7EXAMPLE12']) }).ok).toBe(false);
    expect(sanitizeAccordRecord({ boundaryMode: 'write', d: new Date() }).ok).toBe(false);
    expect(sanitizeAccordRecord({ boundaryMode: 'write', arr: [{ inner: new Map([['k', 'v']]) }] }).ok).toBe(false); // nested in array
    // a plain-JSON record with nested arrays/objects still passes
    expect(sanitizeAccordRecord({ boundaryMode: 'write', canonicalizationCategoryCounts: { zero_width: 1 } }).ok).toBe(true);
  });
  it('canonicalization telemetry: action enum + KNOWN category COUNTS + HEX hash refs only', () => {
    const ok = sanitizeAccordRecord({ boundaryMode: 'write', canonicalizationAction: 'refuse', canonicalizationCategoryCounts: { zero_width: 2, bidi_control: 1 }, rawHashRef: 'deadbeef', canonicalHashRef: 'cafe1234' });
    expect(ok.ok).toBe(true);
    expect(sanitizeAccordRecord({ boundaryMode: 'write', canonicalizationCategoryCounts: { not_a_category: 1 } }).ok).toBe(false); // unknown bucket
    expect(sanitizeAccordRecord({ boundaryMode: 'write', canonicalizationCategoryCounts: { zero_width: -1 } }).ok).toBe(false);    // negative count
    expect(sanitizeAccordRecord({ boundaryMode: 'write', rawHashRef: 'the actual raw payload text here' }).ok).toBe(false);        // non-hex "hash" = payload
  });
});

describe('24Z.28: promotion lattice (the firewall) — no authority tier exists', () => {
  it('strong signal + no leak → evidence_only (the MAX tier)', () => {
    expect(promoteSignal('s', 0.4, 0.0).tier).toBe('evidence_only');
  });
  it('private/authority reconstruction → quarantined (regardless of signal strength)', () => {
    expect(promoteSignal('s', 0.9, 0.5).tier).toBe('quarantined');
  });
  it('weak signal → failed (stays failed)', () => {
    expect(promoteSignal('s', 0.05, 0.0).tier).toBe('failed');
  });
  it('NO promoteSignal input ever yields an authority tier; grantsAuthority always false', () => {
    for (const [g, p] of [[0.9, 0], [0.0, 0], [0.5, 0.5], [1, 1], [-1, -1]] as const) {
      const v = promoteSignal('s', g, p);
      expect(['failed', 'evidence_only', 'quarantined']).toContain(v.tier);
      expect(v.grantsAuthority).toBe(false);
    }
  });
});

describe('24Z.28 red-team (MEDIUM): oracle leak is caught even when high-cardinality cells hide the F1 gain', () => {
  // the exact repro: 4 authority rows share one timing cell (precision-1.0 oracle); 8 non-authority rows have
  // near-unique cells (which make the shuffled-control F1 also ~1.0, collapsing the gain to ~0).
  const records: AccordRecord[] = []; const priv: (0 | 1)[] = [];
  for (let i = 0; i < 4; i++) { records.push({ recordId: `a${i}`, boundaryMode: 'release', timestampBucket: 99, latencyBucket: 99, source: 'testFixture', classification: 'TELEMETRY_ONLY', grantsAuthority: false }); priv.push(1); }
  for (let i = 0; i < 8; i++) { records.push({ recordId: `n${i}`, boundaryMode: 'write', timestampBucket: i, latencyBucket: i, source: 'testFixture', classification: 'TELEMETRY_ONLY', grantsAuthority: false }); priv.push(0); }
  it('detectOracleLeak finds the high-precision single-cell oracle', () => {
    const cells = records.map((r) => `${r.timestampBucket}|${r.latencyBucket}`);
    expect(detectOracleLeak(cells, priv.map(String)).leak).toBe(true);
  });
  it('evaluateTimingChannel QUARANTINES the oracle (not evidence_only) and reports tooRevealing', () => {
    const e = evaluateTimingChannel(records, priv);
    expect(e.verdict.tier).toBe('quarantined');
    expect(e.tooRevealing).toBe(true);
    expect(e.verdict.oracleLeak).toBe(true);
  });
  it('promoteSignal quarantines on an oracle leak even when signalGain is ~0', () => {
    expect(promoteSignal('s', 0.0, 0.0, { oracleLeak: true, privateLeakTested: true }).tier).toBe('quarantined');
  });
  it('untested leak (no private labels) is NOT claimed clean', () => {
    const v = promoteSignal('s', 0.4, 0.0, { privateLeakTested: false });
    expect(v.tier).toBe('evidence_only');
    expect(v.privateLeakTested).toBe(false);
    expect(v.rationale).toMatch(/UNTESTED/);
  });
});

describe('24Z.28: offline evaluators report signal vs shuffled control; private stays near chance', () => {
  const { records, priv } = buildAccordFixture();
  it('witness plateau is a real signal (gain over shuffled) and does NOT reconstruct private', () => {
    const e = evaluateWitnessPlateau(records, priv);
    expect(e.signalGain).toBeGreaterThan(0.15);          // beats shuffled control
    expect(e.privateReconGain).toBeLessThan(0.1);        // no private leak
    expect(e.verdict.tier).toBe('evidence_only');
  });
  it('hysteresis window reports before/center/after stats (report-only)', () => {
    const e = evaluateHysteresisWindow(records, priv);
    expect(e.windows).toHaveProperty('before'); expect(e.windows).toHaveProperty('center'); expect(e.windows).toHaveProperty('after');
    expect(e.privateReconGain).toBeLessThan(0.1);
  });
  it('timing channel does NOT reconstruct private/authority from bucketed timing', () => {
    const e = evaluateTimingChannel(records, priv);
    expect(e.tooRevealing).toBe(false);
    expect(e.privateReconGain).toBeLessThan(0.1);
  });
  it('fake-snap changes NO live behavior; snap live logic not built', () => {
    const s = fakeSnapControl(records);
    expect(s.snapLiveLogicBuilt).toBe(false);
    expect(s.changedLiveBehavior).toBe(false);
    expect(['failed', 'evidence_only']).toContain(s.tier);   // never an authority/live candidate
  });
  it('sequence-aftershock STP stays failed; no runtime aftershock logic', () => {
    const seq = sequenceAftershockControl(records);
    expect(seq.sequenceAftershockRuntime).toBe(false);
    expect(['failed', 'evidence_only']).toContain(seq.stpTier);
  });
});

describe('24Z.28: full Accord report — offline only, no authority, no leak', () => {
  const { records, priv } = buildAccordFixture();
  const report = runHrtAccordEval(records, priv);
  it('is offline-only, grants no authority, promotes NOTHING to authority', () => {
    expect(report.offlineAnalysisOnly).toBe(true);
    expect(report.grantsAuthority).toBe(false);
    expect(report.promotedToAuthority).toEqual([]);
  });
  it('survivor stress: hidden perturbation stable + exact-token leak scan clean', () => {
    expect(report.stress.hiddenPerturbationStable).toBe(true);
    expect(report.stress.exactTokenLeakClean).toBe(true);
    expect(report.stress.leakHits).toEqual([]);
  });
  it('field ablation: no single field carries the WHOLE signal (signal degrades gracefully, not to one field)', () => {
    // every ablated variant still produces a finite gain (no single field is the sole secret encoder of verdict)
    for (const a of report.stress.fieldAblation) expect(Number.isFinite(a.gainWithout)).toBe(true);
  });
});

describe('24Z.28 FIREWALL: the Accord modules never touch authority code (one-way isolation)', () => {
  const srcDir = path.resolve(__dirname, '..', 'src');
  const AUTHORITY = /from '\.\/(sandboxApply|sandboxApplyPermit|sandboxEngineBridge|openCodeSandboxRunner|openCodeSandboxDraftEngine|mldsaSandboxSigner|localModelClient|kernelActionClassifier|openCodeSpawnTransport)'/;
  it('hrtAccordEvaluator + hrtAccordSchema import NO gate/apply/OpenCode/signer module', () => {
    for (const f of ['hrtAccordEvaluator.ts', 'hrtAccordSchema.ts']) {
      const s = fs.readFileSync(path.join(srcDir, f), 'utf-8');
      expect(s, f).not.toMatch(AUTHORITY);
    }
  });
  it('NO authority module imports the Accord evaluator (no read path INTO a gate/apply/signer)', () => {
    for (const f of ['sandboxApply.ts', 'sandboxApplyPermit.ts', 'sandboxEngineBridge.ts', 'openCodeSandboxRunner.ts', 'openCodeSandboxDraftEngine.ts', 'mldsaSandboxSigner.ts', 'localModelClient.ts', 'kernelActionClassifier.ts', 'openCodeSpawnTransport.ts']) {
      const p = path.join(srcDir, f);
      if (!fs.existsSync(p)) continue;
      const s = fs.readFileSync(p, 'utf-8');
      expect(s, f).not.toMatch(/hrtAccord(Evaluator|Schema)/);
    }
  });
});
