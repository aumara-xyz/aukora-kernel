// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Self-modification readiness ladder — a fail-closed, honest report of exactly what stands between
 *   "she can REHEARSE changing herself in a padded room"        (BUILT today)
 * and
 *   "she can change her REAL body after a human signature"      (NOT built yet).
 *
 * It NEVER overclaims. The verdict cannot exceed READY_FOR_SIGNED_PROMOTION_REHEARSAL while live apply,
 * production key custody (HSM), an ML-DSA production root, promotion-grade rollback, and a wired
 * live-promotion path are absent. If `appliedLive` is ever true, that is a BREACH and the verdict is forced
 * to NOT_READY. This module grants no authority and wires nothing — it only tells the truth about the gap.
 */
import { runSelfEditHeartbeat, demoHeartbeatProposal } from './selfEditLoop';
import { isLivePromotionUnlocked, SUPPORTED_ALGORITHMS } from './aumlokAuthorityRoot';
import { createLocalAumlokRoot } from './aumlokApprovalRoot';
import { PROMOTION_ROLLBACK_STATUS } from './promotionRollback';

export type SelfModReadinessVerdict = 'NOT_READY' | 'READY_FOR_SIGNED_PROMOTION_REHEARSAL' | 'PROMOTION_READY';

export interface SelfModReadinessSignals {
  // ── REHEARSAL rungs (the padded room — BUILT + proven today) ──
  sandboxHeartbeatPresent: boolean;
  sandboxApplyTested: boolean;
  receiptEmitted: boolean;
  sandboxRollbackProven: boolean;
  aumlokDevShimActive: boolean;      // honest: the ACTIVE AUMLOK mode is the sha256 dev-shim (local_stub)
  ed25519VerifierBuilt: boolean;     // built — verifies human signatures only
  appliedLive: boolean;              // MUST be false; a true here is a BREACH, not progress
  // ── PRODUCTION rungs (the real body — must ALL be proven before live self-mod can EVER be allowed) ──
  ed25519LiveAuthorizing: boolean;   // does the verifier actually flip the live gate? (verify-only today)
  promotionGradeRollbackProven: boolean; // snapshot/restore of the REAL body, tested
  productionCustodyPresent: boolean; // HSM / hardware key custody
  mldsaProductionRootPresent: boolean;   // ML-DSA-65 production authority root, verifiable
  livePromotionWired: boolean;       // isLivePromotionUnlocked() && wired to the gate
}

export interface SelfModReadinessReport {
  verdict: SelfModReadinessVerdict;
  appliedLive: false;                // pinned — the report itself asserts no live apply happened
  breach: boolean;                   // true iff appliedLive was observed true (must never happen)
  rehearsalReady: boolean;
  rehearsalRungs: Record<string, boolean>;
  productionRungs: Record<string, boolean>;
  productionBlockers: string[];      // what remains before live self-modification can be allowed
  advisoryOnly: true;
  grantsAuthority: false;
  summary: string;
}

const REHEARSAL_KEYS = [
  'sandboxHeartbeatPresent', 'sandboxApplyTested', 'receiptEmitted',
  'sandboxRollbackProven', 'aumlokDevShimActive', 'ed25519VerifierBuilt',
] as const;

/** Pure verdict logic — fail-closed. Given signals, returns the readiness report. */
export function evaluateSelfModReadiness(s: SelfModReadinessSignals): SelfModReadinessReport {
  const breach = s.appliedLive === true;

  const rehearsalRungs: Record<string, boolean> = {};
  for (const k of REHEARSAL_KEYS) rehearsalRungs[k] = (s as unknown as Record<string, unknown>)[k] === true;
  const rehearsalReady = !breach && s.appliedLive === false && REHEARSAL_KEYS.every(k => (s as unknown as Record<string, unknown>)[k] === true);

  const productionRungs: Record<string, boolean> = {
    ed25519LiveAuthorizing: s.ed25519LiveAuthorizing === true,
    promotionGradeRollbackProven: s.promotionGradeRollbackProven === true,
    productionCustodyPresent: s.productionCustodyPresent === true,
    mldsaProductionRootPresent: s.mldsaProductionRootPresent === true,
    livePromotionWired: s.livePromotionWired === true,
  };

  const productionBlockers: string[] = [];
  if (!productionRungs.livePromotionWired) productionBlockers.push('live promotion is NOT wired (isLivePromotionUnlocked() returns false)');
  if (!productionRungs.productionCustodyPresent) productionBlockers.push('no production / HSM key custody');
  if (!productionRungs.mldsaProductionRootPresent) productionBlockers.push('no ML-DSA-65 production authority root (reserved, not verifiable yet)');
  if (!productionRungs.promotionGradeRollbackProven) productionBlockers.push('promotion-grade rollback (snapshot/restore of the real body) is NOT proven');
  if (!productionRungs.ed25519LiveAuthorizing) productionBlockers.push('Ed25519 verifier is verify-only — it does not authorize live apply');
  if (breach) productionBlockers.push('BREACH: appliedLive is true — this must never happen in a sandbox-only build');

  let verdict: SelfModReadinessVerdict;
  if (breach) verdict = 'NOT_READY';
  else if (productionBlockers.length === 0 && rehearsalReady) verdict = 'PROMOTION_READY';
  else if (rehearsalReady) verdict = 'READY_FOR_SIGNED_PROMOTION_REHEARSAL';
  else verdict = 'NOT_READY';

  const missingRehearsal = REHEARSAL_KEYS.filter(k => (s as unknown as Record<string, unknown>)[k] !== true);
  const summary = breach
    ? 'BREACH — appliedLive is true; readiness forced to NOT_READY.'
    : verdict === 'READY_FOR_SIGNED_PROMOTION_REHEARSAL'
      ? `She can REHEARSE the full signed-promotion ceremony safely (sandbox-only, appliedLive=false). She CANNOT touch her real body: ${productionBlockers.length} production rung(s) remain.`
      : verdict === 'PROMOTION_READY'
        ? 'All rehearsal AND production rungs are proven.'
        : `NOT READY — the rehearsal loop is incomplete (missing: ${missingRehearsal.join(', ') || 'unknown'}).`;

  return { verdict, appliedLive: false, breach, rehearsalReady, rehearsalRungs, productionRungs, productionBlockers, advisoryOnly: true, grantsAuthority: false, summary };
}

/** Ground truth — run ONE sandbox heartbeat and read the real flags; call the real authority functions. */
export function collectSelfModReadiness(): SelfModReadinessReport {
  const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal() });
  const sandbox = h.phases.find(p => p.phase === 'sandbox') as { appliedSandbox?: boolean } | undefined;
  const receipt = h.phases.find(p => p.phase === 'receipt') as { receiptHash?: string } | undefined;
  const rollback = h.phases.find(p => p.phase === 'rollback') as { sandboxRemoved?: boolean; liveRepoTouched?: boolean } | undefined;

  const signals: SelfModReadinessSignals = {
    sandboxHeartbeatPresent: typeof runSelfEditHeartbeat === 'function',
    sandboxApplyTested: h.outcome === 'tested_green' && sandbox?.appliedSandbox === true,
    receiptEmitted: typeof receipt?.receiptHash === 'string' && receipt.receiptHash.length > 0,
    sandboxRollbackProven: rollback?.liveRepoTouched === false && rollback?.sandboxRemoved === true,
    aumlokDevShimActive: createLocalAumlokRoot().mode === 'local_stub',
    ed25519VerifierBuilt: SUPPORTED_ALGORITHMS.has('ed25519'),
    appliedLive: Boolean(h.appliedLive), // ground-truth runtime read — should be false
    // production rungs — read honestly from the real state (all false today). Boolean() reads the runtime
    // value defensively even though these functions are typed to literal `false`.
    ed25519LiveAuthorizing: Boolean(isLivePromotionUnlocked()),
    promotionGradeRollbackProven: Boolean(PROMOTION_ROLLBACK_STATUS.restoreProven), // contract defined; restore NOT proven yet
    productionCustodyPresent: false,     // NOT built — no HSM / hardware key custody
    mldsaProductionRootPresent: SUPPORTED_ALGORITHMS.has('ml-dsa-65'), // reserved, not verifiable → false
    livePromotionWired: Boolean(isLivePromotionUnlocked()),
  };
  return evaluateSelfModReadiness(signals);
}

export function formatSelfModReadiness(r: SelfModReadinessReport): string[] {
  const mark = (b: boolean) => (b ? '✅' : '❌');
  const lines: string[] = [];
  lines.push('🔐 Aukora Symbiote — self-modification readiness ladder (advisory; grants no authority)');
  lines.push('');
  lines.push('  REHEARSAL (the padded room — can she PRACTICE changing herself, safely?)');
  for (const [k, v] of Object.entries(r.rehearsalRungs)) lines.push(`    ${mark(v)} ${k}`);
  lines.push(`    ${mark(r.appliedLive === false)} appliedLive === false (no live apply)`);
  lines.push('');
  lines.push('  PRODUCTION (the real body — proven BEFORE live self-mod can EVER be allowed)');
  for (const [k, v] of Object.entries(r.productionRungs)) lines.push(`    ${mark(v)} ${k}`);
  lines.push('');
  lines.push(`  VERDICT: ${r.verdict}`);
  if (r.productionBlockers.length) {
    lines.push('  Remaining before live self-modification:');
    for (const b of r.productionBlockers) lines.push(`    • ${b}`);
  }
  lines.push('');
  lines.push(`  ${r.summary}`);
  return lines;
}
