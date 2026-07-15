// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Fu round controller. Builds a D6 EvidencePack for an exact target, freezes the claim basis, runs the
 * hardened eight-seat council through an injected transport, and assembles a canonical FuRoundArtifactV1.
 * Refuses (requirement 9) on missing evidence, mismatched target, stale basis, unknown field, secret-shaped
 * content, or an authority literal. Grants nothing (advisoryOnly:true / grantsAuthority:false).
 */
import {
  runAukoraFuCouncil, verifyClaimBasis, CANONICAL_SEATS, SpendMeter, SpendCeilingExceeded,
  type CouncilOutcome, type SeatResult, type Transport, type QuorumRule,
} from '../../src/aukoraFuCouncil';
import { textHasSecret, sha256Hex } from '../../src/evidence/index';
import { buildTargetPack, type PackTargetFile } from './pack';
import { newMeter, type TransportMeter } from './transport';
import {
  FU_ROUND_SCHEMA, validateFuRoundArtifact,
  type FuRoundArtifactV1, type FuRoundMode, type FuRoundSeatRecord, type SeatOutcomeStatus,
} from './artifact';

export interface FuRoundInput {
  readonly targetRepoId: string;
  readonly targetCommit: string;   // exact review-target commit (40-hex)
  readonly targetTree: string;     // exact review-target tree (40-hex)
  readonly reviewPath: string;     // primary relative POSIX path being reviewed
  readonly files: readonly PackTargetFile[];
  readonly mode: FuRoundMode;
  readonly problem: string;
  readonly claims: readonly string[];
  readonly transport: Transport;
  readonly meter: TransportMeter;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly spend?: SpendMeter;
  readonly now?: number;
  readonly quorum?: QuorumRule;
}
export type FuRoundResult =
  | { readonly ok: true; readonly artifact: FuRoundArtifactV1 }
  | { readonly ok: false; readonly code: string; readonly message: string };

const refuse = (code: string, message: string): FuRoundResult => ({ ok: false, code, message });
const enc = new TextEncoder();

/** V11: recursively freeze the serialized artifact so it cannot be mutated after its digest is taken. */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    for (const k of Object.keys(o as Record<string, unknown>)) deepFreeze((o as Record<string, unknown>)[k]);
    Object.freeze(o);
  }
  return o;
}

function seatStatusFor(r: SeatResult | undefined, providerContacted: boolean): SeatOutcomeStatus {
  const s = (r?.status ?? 'nonvote_error') as SeatOutcomeStatus;
  // Offline honesty: an "empty" non-vote when NO provider was ever contacted is a no-provider non-vote.
  if (!providerContacted && (s === 'nonvote_empty' || s === 'nonvote_error')) return 'nonvote_no_provider';
  return s;
}

function dissentingSeatIds(votes: readonly SeatResult[]): string[] {
  if (votes.length === 0) return [];
  const tally = new Map<string, number>();
  for (const v of votes) { const st = v.packet?.stance ?? '⊚'; tally.set(st, (tally.get(st) ?? 0) + 1); }
  let plurality = '⊚', best = -1;
  for (const [st, n] of tally) if (n > best) { best = n; plurality = st; }
  return votes.filter((v) => (v.packet?.stance ?? '⊚') !== plurality).map((v) => v.seatId).sort();
}

function assemble(input: FuRoundInput, evidencePackDigest: string, outcome: CouncilOutcome, meter: TransportMeter): FuRoundArtifactV1 {
  const seats: FuRoundSeatRecord[] = CANONICAL_SEATS.map((seat) => {
    const r2 = outcome.round2.find((r) => r.seatId === seat.id);
    const digs = meter.responseDigests.get(seat.id) ?? [];
    return {
      seatId: seat.id,
      requested: seat.slug,
      served: meter.served.get(seat.id) ?? null,
      status: seatStatusFor(r2, meter.providerContacted),
      responseDigest: digs.length ? sha256Hex(enc.encode(digs.join('|'))) : null,
      costMicroUsd: Math.round((meter.costUsd.get(seat.id) ?? 0) * 1_000_000),
    };
  });
  const servedRoster = [...new Set(seats.map((s) => s.served).filter((x): x is string => typeof x === 'string'))].sort();
  const liveEligible = input.mode === 'live' && meter.providerContacted && meter.paidCalls > 0 && outcome.votes.length > 0;
  // R24 orphan-billing reconciliation. An aborted/orphaned paid call is charged worst-case in the transport
  // meter but never reaches the council's SpendMeter (the seat threw before returning a response, so the
  // reservation is refunded and reconcile() adds 0). Report the LARGER of the two so the top-level actual
  // never undercounts a call the provider may have billed, and never falls below the sum of per-seat charges.
  const meterActualUsd = [...meter.costUsd.values()].reduce((a, b) => a + b, 0);
  const actualUsd = Math.max(outcome.actualUsd, meterActualUsd);
  return {
    schema: FU_ROUND_SCHEMA,
    mode: input.mode,
    liveEligible,
    target: { repoId: input.targetRepoId, commit: input.targetCommit, tree: input.targetTree, path: input.reviewPath },
    evidencePackDigest,
    claimBasisDigest: outcome.basis.digest,
    requestedRoster: CANONICAL_SEATS.map((s) => s.slug),
    servedRoster,
    seats,
    votes: outcome.votes.length,
    nonVotes: outcome.nonVotes.map((r) => ({ seatId: r.seatId, status: seatStatusFor(r, meter.providerContacted), reason: r.reason ?? '' })),
    dissent: {
      verdict: outcome.verdict,
      geometrySuspect: outcome.geometry.suspect,
      dissentingSeatIds: dissentingSeatIds(outcome.votes),
    },
    quorum: {
      met: outcome.quorumMet,
      minVotes: outcome.quorumRule.minVotes,
      minFamilies: outcome.quorumRule.minFamilies,
      requireSeatId: outcome.quorumRule.requireSeatId,
      votingFamilies: outcome.votingFamilies,
      fableVerified: outcome.fableVerified,
    },
    synthesis: { source: outcome.answerSource, answer: outcome.answer, usedClaims: outcome.synthUsedClaims ?? null },
    providerContacted: meter.providerContacted,
    paidCalls: meter.paidCalls,
    estimatedCostMicroUsd: Math.round(outcome.estimatedUsd * 1_000_000),
    actualCostMicroUsd: Math.round(actualUsd * 1_000_000),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export async function runFuRound(input: FuRoundInput): Promise<FuRoundResult> {
  // (9) missing evidence
  if (input.files.length === 0 || input.files.every((f) => f.content.trim() === '')) return refuse('E_MISSING_EVIDENCE', 'no non-empty target file');
  if (!/^[0-9a-f]{40}$/.test(input.targetCommit) || !/^[0-9a-f]{40}$/.test(input.targetTree)) return refuse('E_MISMATCHED_TARGET', 'target commit/tree must be 40-hex');
  // (9/V4) secret-shaped content — scan BOTH the target bytes AND the problem/claims, since the council
  // prompts on problem+claims (those are the bytes that actually reach a provider). Refuse before any call.
  for (const f of input.files) if (textHasSecret(f.content)) return refuse('E_SECRET_CONTENT', `secret-shaped content in ${f.path}`);
  if (textHasSecret(input.problem)) return refuse('E_SECRET_CONTENT', 'secret-shaped problem statement');
  for (const c of input.claims) if (textHasSecret(c)) return refuse('E_SECRET_CONTENT', 'secret-shaped claim');
  // build the D6 pack (frozen validator refuses oversize/secret/authority-shaped)
  const pack = buildTargetPack({ repoId: input.targetRepoId, headCommit: input.targetCommit, headTree: input.targetTree, files: input.files, toolVersions: input.toolVersions });
  if (!pack.ok) return refuse(pack.code, pack.message);
  // (9) mismatched target — the pack must bind exactly the requested target
  if (pack.body.headCommit !== input.targetCommit || pack.body.headTree !== input.targetTree) return refuse('E_MISMATCHED_TARGET', 'pack head != requested target');
  // run the council (basis frozen + digested inside, before any call). A worst-case spend-ceiling breach
  // (V8) fails CLOSED as a clean refusal rather than an uncaught throw.
  let outcome: CouncilOutcome;
  try {
    outcome = await runAukoraFuCouncil({ problem: input.problem, claims: input.claims }, input.transport, {
      spend: input.spend, now: input.now, quorum: input.quorum,
    });
  } catch (e) {
    if (e instanceof SpendCeilingExceeded) return refuse('E_SPEND_CEILING', String(e.message ?? 'spend ceiling exceeded'));
    return refuse('E_COUNCIL', String((e as Error).message ?? e));
  }
  // (9) stale artifact — the frozen basis must still verify against the problem
  if (!verifyClaimBasis(outcome.basis, input.problem)) return refuse('E_STALE_BASIS', 'claim basis does not verify against problem');
  const artifact = assemble(input, pack.digest, outcome, input.meter);
  // (9) unknown field / secret / authority literal / structural mode inconsistency
  const v = validateFuRoundArtifact(artifact);
  if (!v.ok) return refuse(v.code, v.message);
  // (V11) freeze the serialized evidence so its digest cannot be invalidated by later mutation
  return { ok: true, artifact: deepFreeze(artifact) };
}

export { newMeter };
