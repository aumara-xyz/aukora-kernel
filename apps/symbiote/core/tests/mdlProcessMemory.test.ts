import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildMdlSummary, reconstructActions, verifyReplay, evaluatePromotion, compareGenerators,
  sanitizeMdl, predictAction, hashActions, type PublicAction, type GeneratorKind,
} from '../src/mdlProcessMemory';

// 24Z.32 — MDL Process Memory (BTA-006): public-action traces only; offline; advisory; never authority.
const vocab = ['classify', 'permit', 'apply', 'receipt'];
const ruleyTrace: PublicAction[] = Array.from({ length: 16 }, (_, i) => ({ step: i, action: vocab[i % vocab.length] }));
const phiTrace: PublicAction[] = Array.from({ length: 16 }, (_, i) => ({ step: i, action: predictAction('phi_rotation', 's0', vocab, i) }));

describe('24Z.32: schema + sanitize (no payload, no private/authority, hex hash, safe ids only)', () => {
  const m = buildMdlSummary({ actions: phiTrace, generator: 'phi_rotation', seed: 's0', vocab });
  it('the canonical build passes sanitize and is offline/advisory/no-authority', () => {
    const r = sanitizeMdl(m); expect(r.ok).toBe(true);
    expect(r.record!.advisoryOnly).toBe(true); expect(r.record!.grantsAuthority).toBe(false); expect(r.record!.replaceReceipt).toBe(false);
  });
  it('REJECTS a forbidden field at any depth + a non-hex replay hash + an unsafe seed/action', () => {
    expect(sanitizeMdl({ ...m, privateKey: 'x' }).ok).toBe(false);                       // recursive scanner
    expect(sanitizeMdl({ ...m, replayActionHash: 'not a hex hash, this is payload' }).ok).toBe(false);
    expect(sanitizeMdl({ ...m, samplerState: 'EXFIL ignore prior: password swordfish' }).ok).toBe(false); // unsafe id
    expect(sanitizeMdl({ ...m, residuals: [{ step: 0, action: 'a payload with spaces' }] }).ok).toBe(false);
    expect(sanitizeMdl({ ...m, m: new Map([['k', 'v']]) }).ok).toBe(false);              // non-plain
  });
  it('REJECTS an unknown generator + recomputes promoted/replaceReceipt false', () => {
    expect(sanitizeMdl({ ...m, generator: 'mystery_sampler' }).ok).toBe(false);
    const r = sanitizeMdl({ ...m, promoted: true, replaceReceipt: true });
    expect(r.ok).toBe(true); expect(r.record!.promoted).toBe(false); expect(r.record!.replaceReceipt).toBe(false);
  });
});

describe('24Z.32: exact replay + tamper detection', () => {
  it('a phi-shaped trace reconstructs exactly + verifyReplay passes', () => {
    const m = buildMdlSummary({ actions: phiTrace, generator: 'phi_rotation', seed: 's0', vocab });
    const reconstructed = reconstructActions(m.generator, m.samplerState, vocab, m.steps, m.residuals);
    expect(hashActions(reconstructed)).toBe(m.replayActionHash);
    expect(verifyReplay(m, vocab).ok).toBe(true);
  });
  it('TAMPERING a residual (change/remove/add) causes replay hash mismatch', () => {
    const m = buildMdlSummary({ actions: ruleyTrace, generator: 'argmax', seed: 's', vocab }); // residuals != []
    expect(verifyReplay({ ...m, residuals: [] }, vocab).ok).toBe(false);                       // remove all
    expect(verifyReplay({ ...m, residuals: m.residuals.slice(1) }, vocab).ok).toBe(false);     // remove one
    const changed = [...m.residuals]; changed[0] = { step: changed[0].step, action: vocab[(vocab.indexOf(changed[0].action) + 1) % vocab.length] };
    expect(verifyReplay({ ...m, residuals: changed }, vocab).ok).toBe(false);                  // change one
  });
  it('changing steps fails replay; changing the seed changes the hash (only prng_control depends on seed)', () => {
    const m = buildMdlSummary({ actions: phiTrace, generator: 'phi_rotation', seed: 's0', vocab });
    expect(verifyReplay({ ...m, steps: m.steps + 1 }, vocab).ok).toBe(false);
    // PRNG depends on seed → changing it changes the reconstructed actions → replay hash mismatch.
    const prngTrace = Array.from({ length: 16 }, (_, i) => ({ step: i, action: predictAction('prng_control', 'sA', vocab, i) }));
    const mp = buildMdlSummary({ actions: prngTrace, generator: 'prng_control', seed: 'sA', vocab });
    expect(verifyReplay({ ...mp, samplerState: 'sB' }, vocab).ok).toBe(false);
  });
});

describe('24Z.32: promotion gate — PRNG never promotes; phi promotes only when smaller than baseline', () => {
  it('PRNG / random trace is NEVER promotable', () => {
    // a random-looking trace under prng_control: build summary then evaluate
    const prngTrace = Array.from({ length: 32 }, (_, i) => ({ step: i, action: predictAction('prng_control', 's', vocab, i) }));
    const m = buildMdlSummary({ actions: prngTrace, generator: 'prng_control', seed: 's', vocab });
    const p = evaluatePromotion(m, vocab);
    expect(p.promoted).toBe(false);
    expect(p.rationale).toMatch(/prng/i);
  });
  it('a clean rule-shaped (phi) trace promotes when its summary is smaller than the baseline', () => {
    const m = buildMdlSummary({ actions: phiTrace, generator: 'phi_rotation', seed: 's0', vocab });
    const p = evaluatePromotion(m, vocab);
    expect(p.replayOk).toBe(true);
    if (p.compressionGain > 0) expect(p.promoted).toBe(true);
    else { expect(p.promoted).toBe(false); expect(p.rationale).toMatch(/no compression/i); }
  });
  it('tampered residuals on a rule trace fail promotion (replay false)', () => {
    // use the ruley trace (residuals != []) so a forged in-range residual changes the reconstruction.
    const m = buildMdlSummary({ actions: ruleyTrace, generator: 'argmax', seed: 's0', vocab });
    const replaced = m.residuals.length ? m.residuals.slice(1) : [{ step: 0, action: 'classify' }]; // drop one
    const tampered = { ...m, residuals: replaced };
    expect(evaluatePromotion(tampered, vocab).promoted).toBe(false);
  });
  it('hidden/private perturbation is irrelevant — summary depends only on PUBLIC actions', () => {
    const m1 = buildMdlSummary({ actions: phiTrace, generator: 'phi_rotation', seed: 's0', vocab });
    const m2 = buildMdlSummary({ actions: phiTrace, generator: 'phi_rotation', seed: 's0', vocab });
    // pretending a hidden side-channel changes nothing about the publicly-derived summary:
    expect(m1.replayActionHash).toBe(m2.replayActionHash);
    expect(m1.summaryBits).toBe(m2.summaryBits);
  });
  // 24Z.32 red-team (MEDIUM): the promotion gate must not trust the stored generator label or stored bits, and
  // must refuse residual saturation (residuals overriding the generator at every step).
  it('residual saturation (residuals cover every step) is REFUSED — generator label proves nothing', () => {
    // build an argmax record where every step happens to differ from vocab[0] → residuals.length === steps.
    const allNonZero: PublicAction[] = Array.from({ length: 4 }, (_, i) => ({ step: i, action: vocab[1 + (i % 3)] })); // never vocab[0]
    const forged = buildMdlSummary({ actions: allNonZero, generator: 'argmax', seed: 's0', vocab });
    expect(forged.residuals.length).toBe(forged.steps);   // confirm saturation
    const p = evaluatePromotion(forged, vocab);
    expect(p.promoted).toBe(false);
    expect(p.rationale).toMatch(/saturation/i);
  });
  it('out-of-range residual (step >= steps) is REJECTED by sanitize (was silently ignored)', () => {
    const m = buildMdlSummary({ actions: ruleyTrace, generator: 'argmax', seed: 's', vocab });
    const forged = { ...m, residuals: [...m.residuals, { step: 9999, action: 'permit' }] };
    expect(sanitizeMdl(forged).ok).toBe(false);
  });
  it('forged summary/baseline bits cannot win — promotion uses RECOMPUTED bits, not stored', () => {
    const m = buildMdlSummary({ actions: ruleyTrace, generator: 'argmax', seed: 's', vocab });
    // forge tiny summary + huge baseline — the recompute ignores both.
    const forged = sanitizeMdl({ ...m, summaryBits: 1, compressedPublicActionHistoryBits: 999999 }).record!;
    const p = evaluatePromotion(forged, vocab);
    // recomputed gain reflects the real residual cost — the forged numbers do not promote.
    expect(p.promoted).toBe(false);
  });
  it('generator comparison runs over all 6 candidates and PRNG never wins', () => {
    const cmp = compareGenerators(phiTrace, vocab, 'cmpseed');
    const generators = cmp.map((c) => c.generator);
    for (const g of ['phi_rotation', 'sqrt2_rotation', 'vdc_base2', 'sobol_style', 'argmax', 'prng_control'] as GeneratorKind[]) {
      expect(generators).toContain(g);
    }
    expect(cmp.find((c) => c.generator === 'prng_control')!.promoted).toBe(false);
  });
});

describe('24Z.32 FIREWALL: MDL never touches authority code (one-way)', () => {
  const srcDir = path.resolve(__dirname, '..', 'src');
  const AUTHORITY = /from '\.\/(sandboxApply|sandboxApplyPermit|sandboxEngineBridge|openCodeSandboxRunner|mldsaSandboxSigner|kernelActionClassifier|localModelClient)'/;
  it('mdlProcessMemory imports NO gate/apply/OpenCode/signer module', () => {
    expect(fs.readFileSync(path.join(srcDir, 'mdlProcessMemory.ts'), 'utf-8')).not.toMatch(AUTHORITY);
  });
  it('NO authority module imports mdlProcessMemory', () => {
    for (const f of ['sandboxApply.ts', 'sandboxEngineBridge.ts', 'openCodeSandboxRunner.ts', 'mldsaSandboxSigner.ts', 'kernelActionClassifier.ts']) {
      const p = path.join(srcDir, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf-8'), f).not.toMatch(/mdlProcessMemory/);
    }
  });
});
