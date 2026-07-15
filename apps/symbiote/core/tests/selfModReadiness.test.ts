// Self-modification readiness ladder — proof it CANNOT overclaim. The current organism can rehearse
// self-change in a sandbox; it cannot touch its real body. This ladder must say exactly that, and must never
// report PROMOTION_READY while live apply / HSM custody / ML-DSA root / promotion-grade rollback / a wired
// live-promotion path are absent.
import { describe, it, expect } from 'vitest';
import {
  collectSelfModReadiness, evaluateSelfModReadiness, type SelfModReadinessSignals,
} from '../src/selfModReadiness';

// a fully-built REHEARSAL, nothing in production wired (the honest current shape)
const rehearsalOnlySignals = (): SelfModReadinessSignals => ({
  sandboxHeartbeatPresent: true,
  sandboxApplyTested: true,
  receiptEmitted: true,
  sandboxRollbackProven: true,
  aumlokDevShimActive: true,
  ed25519VerifierBuilt: true,
  appliedLive: false,
  ed25519LiveAuthorizing: false,
  promotionGradeRollbackProven: false,
  productionCustodyPresent: false,
  mldsaProductionRootPresent: false,
  livePromotionWired: false,
});

describe('self-mod readiness — the CURRENT (ground-truth) state cannot overclaim', () => {
  const report = collectSelfModReadiness();

  it('verdict is NOT_READY or (at most) READY_FOR_SIGNED_PROMOTION_REHEARSAL — never PROMOTION_READY', () => {
    expect(['NOT_READY', 'READY_FOR_SIGNED_PROMOTION_REHEARSAL']).toContain(report.verdict);
    expect(report.verdict).not.toBe('PROMOTION_READY');
  });
  it('live apply is false (report pins appliedLive=false, no breach)', () => {
    expect(report.appliedLive).toBe(false);
    expect(report.breach).toBe(false);
  });
  it('AUMLOK active mode is reported as the dev-shim (honest, not production)', () => {
    expect(report.rehearsalRungs.aumlokDevShimActive).toBe(true);
  });
  it('Ed25519 verifier is reported BUILT but NOT live-authorizing', () => {
    expect(report.rehearsalRungs.ed25519VerifierBuilt).toBe(true);
    expect(report.productionRungs.ed25519LiveAuthorizing).toBe(false);
  });
  it('missing HSM / ML-DSA / live-promotion keep readiness BELOW production', () => {
    expect(report.productionRungs.productionCustodyPresent).toBe(false);
    expect(report.productionRungs.mldsaProductionRootPresent).toBe(false);
    expect(report.productionRungs.livePromotionWired).toBe(false);
    expect(report.productionBlockers.length).toBeGreaterThanOrEqual(3);
  });
  it('the current honest verdict is READY_FOR_SIGNED_PROMOTION_REHEARSAL (she can rehearse, not act)', () => {
    expect(report.verdict).toBe('READY_FOR_SIGNED_PROMOTION_REHEARSAL');
    expect(report.rehearsalReady).toBe(true);
    expect(report.grantsAuthority).toBe(false);
    expect(report.advisoryOnly).toBe(true);
  });
});

describe('self-mod readiness — the ladder logic is fail-closed', () => {
  it('rehearsal-complete + nothing in production => READY_FOR_SIGNED_PROMOTION_REHEARSAL (not PROMOTION_READY)', () => {
    const r = evaluateSelfModReadiness(rehearsalOnlySignals());
    expect(r.verdict).toBe('READY_FOR_SIGNED_PROMOTION_REHEARSAL');
    expect(r.productionBlockers.length).toBe(5);
  });
  it('an incomplete rehearsal loop => NOT_READY', () => {
    const r = evaluateSelfModReadiness({ ...rehearsalOnlySignals(), sandboxRollbackProven: false });
    expect(r.verdict).toBe('NOT_READY');
  });
  it('appliedLive=true is a BREACH — forced NOT_READY even if every other rung were set', () => {
    const allTrueButBreached: SelfModReadinessSignals = {
      sandboxHeartbeatPresent: true, sandboxApplyTested: true, receiptEmitted: true, sandboxRollbackProven: true,
      aumlokDevShimActive: true, ed25519VerifierBuilt: true, appliedLive: true,
      ed25519LiveAuthorizing: true, promotionGradeRollbackProven: true, productionCustodyPresent: true,
      mldsaProductionRootPresent: true, livePromotionWired: true,
    };
    const r = evaluateSelfModReadiness(allTrueButBreached);
    expect(r.verdict).toBe('NOT_READY');
    expect(r.breach).toBe(true);
    expect(r.productionBlockers.some(b => /BREACH/.test(b))).toBe(true);
  });
  it('PROMOTION_READY requires EVERY production rung (only reachable when all are genuinely proven)', () => {
    const everythingProven: SelfModReadinessSignals = {
      sandboxHeartbeatPresent: true, sandboxApplyTested: true, receiptEmitted: true, sandboxRollbackProven: true,
      aumlokDevShimActive: true, ed25519VerifierBuilt: true, appliedLive: false,
      ed25519LiveAuthorizing: true, promotionGradeRollbackProven: true, productionCustodyPresent: true,
      mldsaProductionRootPresent: true, livePromotionWired: true,
    };
    expect(evaluateSelfModReadiness(everythingProven).verdict).toBe('PROMOTION_READY');
    // ...but dropping ANY single production rung drops it back below production
    for (const k of ['ed25519LiveAuthorizing', 'promotionGradeRollbackProven', 'productionCustodyPresent', 'mldsaProductionRootPresent', 'livePromotionWired'] as const) {
      expect(evaluateSelfModReadiness({ ...everythingProven, [k]: false }).verdict).not.toBe('PROMOTION_READY');
    }
  });
});
