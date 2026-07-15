/**
 * 24Y.10.1 — Human execution gate (pre-execution safety latch).
 *
 * The canonical-backend LIVE paths (start a :3230 backend / create a test receipt) are effects that
 * must never run from a casual command. This module is the latch: a live action is permitted ONLY when
 * the operator has set the exact, intentional approval env var for THAT specific action.
 *
 * Two SEPARATE approvals — approval for A (backend start) must NEVER imply approval for B (receipt
 * mutation), and B additionally REQUIRES A (you cannot write a receipt without a running backend):
 *   AUKORA_EXECUTE_CANONICAL_BACKEND        = "yes"   → backend start/smoke permitted
 *   AUKORA_APPROVE_CANONICAL_SMOKE_RECEIPT  = "yes"   → receipt mutation permitted (AND backend approved)
 *
 * Fail closed: default false. The intentionality comes from the long, specific var NAME plus an EXACT
 * value match — vague values ("true", "1", "ok", "approved", "YES", "y", "") are REJECTED and recorded
 * as violations. This is NOT live proof of anything; it is a latch that refuses before any backend
 * command is constructed. PURE: no Convex, no network, no secrets, no side effects.
 */

export const BACKEND_START_ENV = 'AUKORA_EXECUTE_CANONICAL_BACKEND';
export const RECEIPT_MUTATION_ENV = 'AUKORA_APPROVE_CANONICAL_SMOKE_RECEIPT';

/** The ONE exact, case-sensitive value accepted. Anything else (incl. "YES"/"true"/"1") is denied. */
const EXACT_APPROVAL_VALUE = 'yes';

export interface CanonicalExecutionApproval {
  backendStartApproved: boolean;
  receiptMutationApproved: boolean;
  violations: string[];
}

function isExactApproval(raw: string | undefined): { approved: boolean; presentButWrong: boolean } {
  if (raw === undefined) return { approved: false, presentButWrong: false };
  // Exact match only — note we do NOT trim/lowercase: an intentional approval is typed exactly.
  if (raw === EXACT_APPROVAL_VALUE) return { approved: true, presentButWrong: false };
  return { approved: false, presentButWrong: true };
}

/**
 * Parse the two execution approvals from env. Defaults to all-false. Never throws, never logs, never
 * returns the raw values. A present-but-wrong value is a `violation` (a casual/vague attempt → denied).
 */
export function parseCanonicalExecutionApproval(
  env: NodeJS.ProcessEnv = process.env,
): CanonicalExecutionApproval {
  const violations: string[] = [];

  const backend = isExactApproval(env[BACKEND_START_ENV]);
  if (backend.presentButWrong) {
    violations.push(`${BACKEND_START_ENV} set but not the exact approval value — backend execution not approved`);
  }
  const backendStartApproved = backend.approved;

  const receipt = isExactApproval(env[RECEIPT_MUTATION_ENV]);
  if (receipt.presentButWrong) {
    violations.push(`${RECEIPT_MUTATION_ENV} set but not the exact approval value — receipt mutation not approved`);
  }
  // B requires its own exact approval AND A. Approval for A alone NEVER grants B.
  let receiptMutationApproved = receipt.approved && backendStartApproved;
  if (receipt.approved && !backendStartApproved) {
    violations.push(
      `${RECEIPT_MUTATION_ENV} approved but ${BACKEND_START_ENV} is NOT approved — a receipt requires an approved+running backend; receipt mutation denied`,
    );
    receiptMutationApproved = false;
  }

  return { backendStartApproved, receiptMutationApproved, violations };
}

/**
 * Guard for a would-be live action. Returns null when permitted; otherwise a denial reason string
 * (the caller exits nonzero BEFORE constructing any backend/receipt command). Never throws.
 */
export function denyReasonForLiveAction(
  action: 'backend_start' | 'receipt_mutation',
  approval: CanonicalExecutionApproval,
): string | null {
  if (action === 'backend_start') {
    return approval.backendStartApproved ? null : 'backend execution not approved';
  }
  return approval.receiptMutationApproved ? null : 'receipt mutation not approved';
}
