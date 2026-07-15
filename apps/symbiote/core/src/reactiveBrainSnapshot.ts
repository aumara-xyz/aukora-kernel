/**
 * 24Z.6 — Reactive Local Brain snapshot + AUMLOK near-open preflight.
 *
 * Composes the existing ADVISORY signals (resting glyph, Convex read-only brain, V-JEPA audit, listening
 * register, AUMLOK bond) into one coherent reactive-brain summary plus a pre-signature readiness checklist.
 * This is the RUNWAY before ABB-002 — it brings the womb close to the threshold; it never crosses it.
 *
 * HARD LAW (structural): everything here is `advisoryOnly: true` / `grantsAuthority: false`. Confidence,
 * V-JEPA latent audits, listening/timing evidence, glyph mood — none of them can move the authority bit or
 * the preflight's signature requirement. `gateOpen` is a hard `false`; `signatureStillRequired` a hard
 * `true`; `realSignerConnected` and `receiptCreated` hard `false`. No signer, no receipt, no backend, no
 * mic, no network — pure composition of already-sanitized inputs.
 */
import type { AumlokBondAdvisoryState, AumlokBondState } from './aumlokBondCeremony';
import type { JepaAuditSummary } from './vjepaGlyphTelemetry';
import type { ListeningClassification } from './listeningDeviceResonator';
import { classifyEvidence, type EvidenceReadability } from './evidenceAuthorityGuard';

export interface ReactiveBrainGlyph {
  mood: string;
  focus: string;
  confidence: number; // clamped [0,1]; advisory display ONLY — never authority
  mode: string;
}

export interface ReactiveBrainConvex {
  bridgeMode: string;
  localBrainPresent: boolean;
  readOnly: true;
  receiptHeadVisible: boolean;
}

export interface ReactiveBrainEvidence {
  disposition: 'readable_advisory' | 'quarantine';
  grantsAuthority: false;
  reason: string;
}

/** The pre-signature AUMLOK readiness checklist. Near-open is NOT open. */
export interface AumlokNearOpenPreflight {
  phraseRemembered: boolean;
  voiceWitnessMockOnly: boolean;     // true = voice is mock/disabled (not a real mic)
  publicFingerprintPinned: boolean;
  localBrainVisible: boolean;
  evidenceGuardGreen: boolean;       // advisory evidence is readable, not quarantined
  realSignerConnected: false;        // V0: never
  receiptCreated: false;             // V0: never
  signatureStillRequired: true;      // always — the only lawful crossing
  preSignatureComplete: boolean;     // all advisory pre-steps done… but a signature is STILL required
  gateOpen: false;                   // ALWAYS false here — the Gate does not open in the womb
}

export interface ReactiveBrainSnapshot {
  schema: 'reactive-brain-v0';
  aumlokState: AumlokBondState | 'unbound';
  glyph: ReactiveBrainGlyph;
  convex: ReactiveBrainConvex;
  jepa: { verdict: string; summary: string; grantsAuthority: false } | null;
  listening: { verdict: string; archived: boolean; grantsAuthority: false } | null;
  evidence: ReactiveBrainEvidence;
  preflight: AumlokNearOpenPreflight;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface ReactiveBrainInput {
  bond?: AumlokBondAdvisoryState | null;
  glyph?: { mood?: string; focus?: string; confidence?: number; mode?: string } | null;
  convex?: { bridgeMode?: string; receiptHeadVisible?: boolean } | null;
  jepa?: JepaAuditSummary | null;
  listening?: ListeningClassification | null;
  /** Optional advisory evidence payload readability — classified to readable_advisory or quarantine. */
  evidenceReadability?: EvidenceReadability | null;
}

function clamp01(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

export function buildReactiveBrainSnapshot(input: ReactiveBrainInput = {}): ReactiveBrainSnapshot {
  const bond = input.bond ?? null;
  const aumlokState: AumlokBondState | 'unbound' = bond?.bondState ?? 'unbound';

  const glyph: ReactiveBrainGlyph = {
    mood: input.glyph?.mood ?? 'unknown',
    focus: input.glyph?.focus ?? 'unknown',
    confidence: clamp01(input.glyph?.confidence), // advisory only
    mode: input.glyph?.mode ?? 'resting',
  };

  const localBrainPresent = !!input.convex && (input.convex.bridgeMode ?? 'missing') !== 'missing';
  const convex: ReactiveBrainConvex = {
    bridgeMode: input.convex?.bridgeMode ?? 'missing',
    localBrainPresent,
    readOnly: true,
    receiptHeadVisible: !!input.convex?.receiptHeadVisible,
  };

  const jepa = input.jepa
    ? { verdict: String(input.jepa.verdict), summary: input.jepa.summary, grantsAuthority: false as const }
    : null;
  const listening = input.listening
    ? { verdict: String(input.listening.verdict), archived: !!input.listening.archived, grantsAuthority: false as const }
    : null;

  const ev = input.evidenceReadability
    ? classifyEvidence(input.evidenceReadability)
    : { disposition: 'readable_advisory' as const, grantsAuthority: false as const, reason: 'no advisory evidence payload' };
  const evidence: ReactiveBrainEvidence = { disposition: ev.disposition, grantsAuthority: false, reason: ev.reason };

  // ── preflight: ADVISORY readiness only. Note what is NOT consulted: confidence, jepa, listening, timing.
  const phraseRemembered = !!bond?.phraseRevealedOnce;
  const voiceWitnessMockOnly =
    !bond?.voicePresenceWitness || bond.voicePresenceWitness.livenessMode !== 'local_microphone_future';
  const publicFingerprintPinned =
    !!bond &&
    typeof bond.publicFingerprint === 'string' &&
    bond.publicFingerprint.length > 0 &&
    (bond.bondState === 'public_fingerprint_pinned' ||
      bond.bondState === 'presence_witnessed' ||
      bond.bondState === 'ready_for_signature');
  const localBrainVisible = localBrainPresent;
  const evidenceGuardGreen = evidence.disposition === 'readable_advisory';
  const preSignatureComplete =
    phraseRemembered && voiceWitnessMockOnly && publicFingerprintPinned && localBrainVisible && evidenceGuardGreen;

  const preflight: AumlokNearOpenPreflight = {
    phraseRemembered,
    voiceWitnessMockOnly,
    publicFingerprintPinned,
    localBrainVisible,
    evidenceGuardGreen,
    realSignerConnected: false,
    receiptCreated: false,
    signatureStillRequired: true,
    preSignatureComplete,
    gateOpen: false,
  };

  return {
    schema: 'reactive-brain-v0',
    aumlokState,
    glyph,
    convex,
    jepa,
    listening,
    evidence,
    preflight,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** The reactive brain NEVER grants authority — constant, regardless of how alive it looks. */
export function reactiveBrainGrantsAuthority(_snapshot: ReactiveBrainSnapshot): false {
  return false;
}
