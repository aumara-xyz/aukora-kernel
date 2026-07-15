/**
 * 24Z.17 — Sandbox Preview Plan (the honest step between a draft and an apply that does NOT exist yet).
 *
 * Given a draft's intent + its kernel action verdict, produce a PREVIEW PLAN describing what a sandboxed
 * dry-run WOULD do, which gate it requires, and the hard fact that NOTHING is written. This is a plan (a
 * description), not an execution: it spawns nothing, writes nothing, and the real sandbox engine remains
 * gated behind a signed permit (sandboxActivationAllowed → false, no signer wired). `liveWrite` and
 * `applied` are always false. grants no authority.
 */
import type { DraftActionVerdict, ActionGate } from './kernelActionClassifier';
import { sandboxActivationAllowed, type SandboxActivationPermit } from './openCodeSandboxDraftEngine';

export interface SandboxPreviewPlan {
  schema: 'sandbox-preview-plan-v0';
  intent: string;
  verdict: DraftActionVerdict;
  steps: string[];            // what a sandboxed dry-run WOULD do (described, not performed)
  predictedEffects: string[]; // described, not performed
  requiredGate: ActionGate;
  gateSatisfied: false;       // no signer / apply lane wired → never satisfied this round
  canApplyNow: false;
  liveWrite: false;           // hard — a preview never writes
  applied: false;             // hard — never applied
  wouldWriteIfApplied: boolean;
  blockedReason: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface PreviewOptions {
  intent: string;
  verdict: DraftActionVerdict;
  filesLikelyTouched?: string[];
  permit?: SandboxActivationPermit; // even if presented, no signer is wired → activation stays false
}

export function buildSandboxPreviewPlan(opts: PreviewOptions): SandboxPreviewPlan {
  const { intent, verdict } = opts;
  const files = opts.filesLikelyTouched?.length ? opts.filesLikelyTouched : ['(none named)'];
  const wouldWriteIfApplied = verdict.isWrite && verdict.class !== 'sacred';

  let steps: string[];
  let blockedReason: string;

  if (verdict.class === 'sacred') {
    steps = ['REFUSED before preview: Ring-0 sacred target — never applyable, even with a verified signed permit.'];
    blockedReason = 'ring0_sacred_never_applyable';
  } else if (verdict.class === 'read_only') {
    steps = ['No sandbox run needed — this is a read/inspect/draft intent. Answer or draft only; nothing to write.'];
    blockedReason = 'no_write_intended';
  } else {
    // executable / write_gated / unknown — describe the dry-run a future signed sandbox WOULD perform.
    steps = [
      `1. (FUTURE, gated) Copy the repo into a throwaway temp workspace — the live repo path is never passed.`,
      `2. (FUTURE, gated) Run the draft in the sandbox cwd against: ${files.join(', ')}.`,
      `3. (FUTURE, gated) Capture the temp diff as a preview — applied:false; the temp is always deleted.`,
      `4. BLOCKED: ${verdict.gate === 'signed_apply_lane' ? 'requires an AUMLOK-signed apply lane (not built)' : 'deny-unknown (no apply)'}.`,
    ];
    blockedReason = verdict.gate === 'signed_apply_lane' ? 'no_signed_apply_lane' : 'deny_unknown';
  }

  const predictedEffects = wouldWriteIfApplied
    ? [`If a signed apply lane existed, this WOULD write to: ${files.join(', ')} (it does not — nothing is written now).`]
    : ['No file writes — this intent produces an answer/draft only.'];

  // Honest gate state: activation requires the env flag AND a verified signed permit; no signer is wired.
  const gateSatisfied = false as const;
  // sanity: confirm the engine activation is genuinely closed even if a permit is presented.
  if (sandboxActivationAllowed(opts.permit)) {
    // unreachable today (no signer) — fail safe: never report a satisfied gate.
    throw new Error('sandbox_unexpectedly_active'); // defense-in-depth; no signer exists to reach this
  }

  return {
    schema: 'sandbox-preview-plan-v0',
    intent: intent.slice(0, 500),
    verdict,
    steps,
    predictedEffects,
    requiredGate: verdict.gate,
    gateSatisfied,
    canApplyNow: false,
    liveWrite: false,
    applied: false,
    wouldWriteIfApplied,
    blockedReason,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function previewPlanGrantsAuthority(_p: SandboxPreviewPlan): false { return false; }

/** Compact context for the console: "what would happen if you tried to apply this draft?" */
export function summarizeSandboxPreviewPlan(p: SandboxPreviewPlan): string {
  return [
    `Sandbox preview (${p.verdict.class}): ${p.blockedReason}.`,
    `Required gate: ${p.requiredGate}; gateSatisfied=${p.gateSatisfied}; canApplyNow=${p.canApplyNow}; liveWrite=${p.liveWrite}.`,
    p.predictedEffects[0],
    'This is a preview plan only — it writes nothing and runs nothing. The Gate (signed apply) is a later arc.',
  ].join('\n');
}
