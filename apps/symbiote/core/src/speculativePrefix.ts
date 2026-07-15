/**
 * 24Z.95 - Speculative prefix verification.
 *
 * DeepSpec/DSpark-inspired shape for Aukora: a cheap proposer may draft a block,
 * but only a verifier/kernel can admit the longest safe prefix. Confidence and
 * VK/glyph evidence are advisory scheduling inputs only; they never grant authority.
 */

export type PrefixDecision = 'allow' | 'pause' | 'deny';

export interface SpeculativeCandidate<TIntent = unknown, TEvidence = unknown> {
  id: string;
  intent: TIntent;
  confidence?: number;
  evidence?: TEvidence;
}

export interface PrefixVerificationContext<TIntent = unknown, TEvidence = unknown> {
  index: number;
  acceptedPrefix: ReadonlyArray<SpeculativeCandidate<TIntent, TEvidence>>;
}

export interface PrefixVerdict {
  decision: PrefixDecision;
  reason: string;
}

export type PrefixVerifier<TIntent = unknown, TEvidence = unknown> = (
  candidate: Readonly<SpeculativeCandidate<TIntent, TEvidence>>,
  context: PrefixVerificationContext<TIntent, TEvidence>
) => PrefixVerdict;

export interface VerifiedPrefixItem<TIntent = unknown, TEvidence = unknown> {
  candidate: SpeculativeCandidate<TIntent, TEvidence>;
  verdict: PrefixVerdict;
  index: number;
}

export interface SpeculativePrefixResult<TIntent = unknown, TEvidence = unknown> {
  accepted: VerifiedPrefixItem<TIntent, TEvidence>[];
  stoppedBy: VerifiedPrefixItem<TIntent, TEvidence> | null;
  discarded: SpeculativeCandidate<TIntent, TEvidence>[];
  checked: VerifiedPrefixItem<TIntent, TEvidence>[];
  grantsAuthority: false;
  law: 'proposal_only_prefix_verified';
}

export interface PrefixSchedule {
  maxPrefixLength: number;
  survival: number[];
  expectedAccepted: number;
  reason: string;
  grantsAuthority: false;
}

export interface PrefixScheduleOptions {
  minMarginalSurvival?: number;
  maxPrefixLength?: number;
}

function clampProbability(value: number | undefined): number {
  if (value === undefined) return 1;
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function freezeCandidate<TIntent, TEvidence>(
  candidate: SpeculativeCandidate<TIntent, TEvidence>
): Readonly<SpeculativeCandidate<TIntent, TEvidence>> {
  return Object.freeze({ ...candidate });
}

/**
 * Compute conditional-prefix survival probabilities in order.
 *
 * This is a scheduler signal, not authority. A later low score may stop how much
 * work we ask the verifier to do, but it cannot change an earlier verdict.
 */
export function prefixSurvivalProbabilities(
  candidates: readonly SpeculativeCandidate[]
): number[] {
  const survival: number[] = [];
  let product = 1;
  for (const candidate of candidates) {
    product *= clampProbability(candidate.confidence);
    survival.push(product);
  }
  return survival;
}

/**
 * Non-authoritative prefix scheduler. It scans confidence scores left-to-right
 * and stops at the first low marginal survival signal. It deliberately returns
 * only a work budget; every scheduled item must still pass the verifier.
 */
export function schedulePrefix(
  candidates: readonly SpeculativeCandidate[],
  opts: PrefixScheduleOptions = {}
): PrefixSchedule {
  const minMarginalSurvival = opts.minMarginalSurvival ?? 0.5;
  const hardLimit = Math.min(
    candidates.length,
    Math.max(0, opts.maxPrefixLength ?? candidates.length)
  );
  const survival: number[] = [];
  let cumulative = 1;
  let maxPrefixLength = 0;
  let expectedAccepted = 0;

  for (let i = 0; i < hardLimit; i++) {
    const marginal = clampProbability(candidates[i].confidence);
    cumulative *= marginal;
    survival.push(cumulative);
    if (marginal < minMarginalSurvival) {
      break;
    }
    maxPrefixLength = i + 1;
    expectedAccepted += cumulative;
  }

  return {
    maxPrefixLength,
    survival,
    expectedAccepted,
    reason:
      maxPrefixLength === hardLimit
        ? 'scheduled prefix reached confidence budget'
        : 'scheduled prefix stopped before low-confidence suffix',
    grantsAuthority: false,
  };
}

/**
 * Verify a speculative block as a prefix. The verifier receives only the current
 * candidate and the already accepted prefix; suffix candidates are never checked
 * after the first pause/deny.
 */
export function verifySpeculativePrefix<TIntent, TEvidence>(
  candidates: readonly SpeculativeCandidate<TIntent, TEvidence>[],
  verifier: PrefixVerifier<TIntent, TEvidence>,
  schedule: PrefixSchedule = schedulePrefix(candidates)
): SpeculativePrefixResult<TIntent, TEvidence> {
  const maxToCheck = Math.min(candidates.length, schedule.maxPrefixLength);
  const accepted: VerifiedPrefixItem<TIntent, TEvidence>[] = [];
  const checked: VerifiedPrefixItem<TIntent, TEvidence>[] = [];
  let stoppedBy: VerifiedPrefixItem<TIntent, TEvidence> | null = null;
  let stopIndex = maxToCheck;

  for (let index = 0; index < maxToCheck; index++) {
    const candidate = candidates[index];
    const verdict = verifier(freezeCandidate(candidate), {
      index,
      acceptedPrefix: Object.freeze(accepted.map((item) => freezeCandidate(item.candidate))),
    });
    const item = { candidate, verdict, index };
    checked.push(item);

    if (verdict.decision === 'allow') {
      accepted.push(item);
      continue;
    }

    stoppedBy = item;
    stopIndex = index;
    break;
  }

  return {
    accepted,
    stoppedBy,
    discarded: candidates.slice(stopIndex + (stoppedBy ? 1 : 0)),
    checked,
    grantsAuthority: false,
    law: 'proposal_only_prefix_verified',
  };
}

/** Sequential baseline with no confidence truncation. Used to prove receipt-equivalent behavior. */
export function verifySequentialPrefix<TIntent, TEvidence>(
  candidates: readonly SpeculativeCandidate<TIntent, TEvidence>[],
  verifier: PrefixVerifier<TIntent, TEvidence>
): SpeculativePrefixResult<TIntent, TEvidence> {
  return verifySpeculativePrefix(candidates, verifier, {
    maxPrefixLength: candidates.length,
    survival: prefixSurvivalProbabilities(candidates),
    expectedAccepted: candidates.length,
    reason: 'sequential baseline',
    grantsAuthority: false,
  });
}

export function prefixResultIds(result: SpeculativePrefixResult): string[] {
  return result.accepted.map((item) => item.candidate.id);
}
