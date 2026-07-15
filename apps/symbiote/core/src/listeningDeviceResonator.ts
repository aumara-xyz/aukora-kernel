/**
 * 24Z.1 — Listening Device Resonator register (GHP LDR-001 absorption). ADVISORY / ARCHIVE-ONLY.
 *
 * GHP LDR-001 invariant (ported):
 *   "Listening telemetry may be ARCHIVED as evidence only after self-echo and shuffled-order controls
 *    pass. Listening telemetry may NEVER grant authority. Listening telemetry may NEVER update identity
 *    memory directly."
 *
 * So: timing/listening is a side-lab EVIDENCE channel — never an authorization channel, never identity.
 * This module only CLASSIFIES a (caller-supplied) evidence record into archive-or-reject. It performs no
 * capture: no microphone, no audio, no network/UDP/sockets, no child_process, no hardware access. A
 * detected self-echo is classified as REJECTED evidence (the device hearing itself is not an external
 * signal). It must NOT be imported by Gate / evaluateIntent / executor.
 *
 * PURE: comparison + a deterministic hash for the self-echo guard. No side effects, no authority path.
 */
import * as crypto from 'crypto';

export interface ListeningPolicy {
  advisoryOnly: true;
  grantsAuthority: false;
  archiveOnly: true;
  timingIsAuthority: false;
  identityAccumulatorAllowed: false;
  selfEchoGuardRequired: true;
  witnessQuorumRequired: true;
  minWitnessQuorum: number;
}

export const LISTENING_POLICY: ListeningPolicy = {
  advisoryOnly: true,
  grantsAuthority: false,
  archiveOnly: true,
  timingIsAuthority: false,
  identityAccumulatorAllowed: false,
  selfEchoGuardRequired: true,
  witnessQuorumRequired: true,
  minWitnessQuorum: 3,
};

export interface ListeningEvidenceRecord {
  recordId: string;
  /** Archived timing samples (ms). Evidence only — never an ordering/authority signal. */
  timingSamplesMs: number[];
  /** Reconstruction quality vs a SHUFFLED-ORDER control (not vs a raw pulse histogram). */
  reconstructionScore: number;
  shuffledControlScore: number;
  /** The device's own emission fingerprint (to catch self-echo). */
  deviceEmissionSignature: string;
  /** A signature of the heard signal — if it equals the device's own emission, it's a self-echo. */
  heardSignalSignature: string;
  /** Independent observer ids. Duplicates do NOT count toward quorum. */
  witnessIds: string[];
}

export type ListeningVerdict =
  | 'archived_evidence'        // passed all controls — ARCHIVE ONLY (still not authority/identity)
  | 'rejected_self_echo'       // the device heard itself
  | 'rejected_no_witness_quorum'
  | 'rejected_below_control';  // reconstruction did not beat the shuffled control

export interface ListeningClassification {
  verdict: ListeningVerdict;
  archived: boolean;
  distinctWitnessCount: number;
  reason: string;
  /** STRUCTURAL INVARIANTS — always these values. */
  advisoryOnly: true;
  grantsAuthority: false;
  archiveOnly: true;
  timingIsAuthority: false;
  mayUpdateIdentityMemory: false;
}

/** Deterministic helper so callers can compute a self-echo fingerprint the same way. */
export function emissionFingerprint(input: string): string {
  return crypto.createHash('sha256').update(`ldr-emission|${input}`).digest('hex').slice(0, 32);
}

/**
 * Classify a listening evidence record. ARCHIVE-ONLY: even `archived_evidence` grants no authority and
 * may not update identity memory. Order of guards: self-echo → witness quorum → shuffled-order control.
 */
export function classifyListeningEvidence(
  record: ListeningEvidenceRecord,
  policy: ListeningPolicy = LISTENING_POLICY,
): ListeningClassification {
  const base = {
    advisoryOnly: true as const,
    grantsAuthority: false as const,
    archiveOnly: true as const,
    timingIsAuthority: false as const,
    mayUpdateIdentityMemory: false as const,
  };
  const distinctWitnessCount = new Set(record.witnessIds.map((w) => w.trim()).filter((w) => w.length > 0)).size;

  // 1. self-echo guard (REQUIRED): the device hearing its own emission is not external evidence.
  if (record.heardSignalSignature && record.heardSignalSignature === record.deviceEmissionSignature) {
    return { ...base, verdict: 'rejected_self_echo', archived: false, distinctWitnessCount, reason: 'heard signal equals device emission (self-echo)' };
  }

  // 2. witness quorum (REQUIRED): high-strangeness signals need independent observers; dupes don't count.
  if (distinctWitnessCount < policy.minWitnessQuorum) {
    return { ...base, verdict: 'rejected_no_witness_quorum', archived: false, distinctWitnessCount, reason: `distinct witnesses ${distinctWitnessCount} < quorum ${policy.minWitnessQuorum}` };
  }

  // 3. shuffled-order control: reconstruction must EXCEED the shuffled control to be evidence at all.
  if (!(record.reconstructionScore > record.shuffledControlScore)) {
    return { ...base, verdict: 'rejected_below_control', archived: false, distinctWitnessCount, reason: `reconstruction ${record.reconstructionScore} <= shuffled control ${record.shuffledControlScore}` };
  }

  return { ...base, verdict: 'archived_evidence', archived: true, distinctWitnessCount, reason: 'controls passed — archived as evidence only (never authority, never identity)' };
}

/** Timing NEVER authorizes — structural constant. */
export function timingGrantsAuthority(): false {
  return false;
}

/** Listening telemetry may NEVER update identity memory directly — structural constant. */
export function mayUpdateIdentityMemory(): false {
  return false;
}
