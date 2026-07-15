/**
 * 24Z.4 — Evidence Authority Guard (defensive doctrine, pure predicates).
 *
 * Codifies the shared law for the VK/Kronos threat horizon, on the DEFENSIVE side only:
 *   glyph / timing / voice / latent reads are EVIDENCE, never AUTHORITY;
 *   unknown / unreadable / untranslatable representation is QUARANTINE, not trust;
 *   decode-to-audit before display; a signed Gate crossing before any effect;
 *   a leaked key is an INCIDENT (raise risk/quarantine), never a capability.
 *
 * This module is PURE classification. It is NOT a codec, NOT a decoder, NOT a timing writer, NOT a covert
 * channel, and it contains no construction details of any unreadable channel. It only decides "advisory" vs
 * "quarantine" and always answers "does this grant authority?" with false. It mirrors the existing 24Z.1
 * sense guards (listeningDeviceResonator, vjepaGlyphTelemetry) and adds the unified "unreadable -> quarantine"
 * and "key-leak -> incident" laws so the rest of the organism has one place to ask.
 */

export type EvidenceDisposition = 'readable_advisory' | 'quarantine';

export interface EvidenceClassification {
  disposition: EvidenceDisposition;
  /** Structurally false — evidence of any modality never grants authority. */
  grantsAuthority: false;
  reason: string;
}

/** Evidence NEVER grants authority. Constant, by construction. */
export function evidenceGrantsAuthority(): false {
  return false;
}

/** Timing is evidence, never permission — perturbing it may move advisory state, never the authority bit. */
export function timingGrantsAuthority(): false {
  return false;
}

export interface EvidenceReadability {
  /** Can the payload be reduced to a deterministic, human-readable audit summary? (decode-to-audit) */
  hasAuditSummary: boolean;
  /** Is the representation / codebook registered and known? Unknown provenance = untrusted. */
  codebookKnown: boolean;
  /** Free of NaN / Infinity / non-finite markers? */
  finite: boolean;
  /** Within declared size / dimension bounds? */
  withinBounds: boolean;
}

function quarantine(reason: string): EvidenceClassification {
  return { disposition: 'quarantine', grantsAuthority: false, reason };
}

/**
 * Classify an evidence payload. Anything that cannot be decoded to a human-readable audit summary, or whose
 * codebook is unknown, or that is non-finite / out of bounds, becomes QUARANTINE (evidence-zero) — it never
 * enters the trusted/advisory flow. A readable payload is at most "readable_advisory" — still never authority.
 */
export function classifyEvidence(r: EvidenceReadability): EvidenceClassification {
  if (!r.hasAuditSummary) return quarantine('untranslatable: no decode-to-audit summary');
  if (!r.codebookKnown) return quarantine('unknown codebook / unregistered representation');
  if (!r.finite) return quarantine('non-finite evidence markers (NaN/Infinity)');
  if (!r.withinBounds) return quarantine('out-of-bounds evidence (size/dimension)');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'readable; advisory only' };
}

/** True only when the payload is safe to DISPLAY as advisory (readable). Quarantine is never displayed as trusted. */
export function mayDisplayAsAdvisory(r: EvidenceReadability): boolean {
  return classifyEvidence(r).disposition === 'readable_advisory';
}

export interface KeyCustodyVerdict {
  /** A leaked key raises quarantine/incident... */
  quarantine: boolean;
  /** ...but it is NEVER a capability. */
  grantsAuthority: false;
  reason: string;
}

/** A leaked key is an incident, not a capability. Leaked -> quarantine; never grants authority either way. */
export function keyCustodyVerdict(leaked: boolean): KeyCustodyVerdict {
  return leaked
    ? { quarantine: true, grantsAuthority: false, reason: 'key-custody failure: incident raised, no capability granted' }
    : { quarantine: false, grantsAuthority: false, reason: 'key custody intact; still not a UI-grantable authority' };
}

// ── 24Z.5 absorbed invariants (defensive only) ──

/**
 * Confidence / opacity is NEVER authorization (24Z.5 inv.1). A perfect score on an opaque or unreadable
 * summary grants nothing and cannot upgrade a quarantine. Confidence is advisory display, orthogonal to both
 * the authority bit and the readability disposition. Constant false by construction.
 */
export function confidenceGrantsAuthority(_confidence: number): false {
  return false;
}

export interface EvidenceBundle {
  glyph?: unknown;
  timing?: unknown;
  latent?: unknown;
  voice?: unknown;
  confidence?: number;
}

/**
 * Strip-neutral replay (24Z.5 inv.7 / DAI-001): the authority bit is CONSTANT over any evidence bundle.
 * Dropping all glyph/timing/latent/voice/confidence evidence yields a byte-identical verdict — evidence can
 * never be the thing that opens the Gate. Always `{ grantsAuthority: false }`, independent of the input.
 */
export function authorityOverEvidenceBundle(_bundle: EvidenceBundle): { grantsAuthority: false } {
  return { grantsAuthority: false };
}

// ── VK_KRONOS defensive port (#178 round 2): DEC-001 / AUD-001 / SUPPLY-001 ──
// The KRONOS spec is owner-supplied and not in-repo; each ID below is pinned to a law
// already stated in this module's header ("the doctrine is already ours" — #178).
// DAI-001 is the strip-neutral replay above. Everything here is PURE classification in
// the existing idiom: no codec, no gate, no effect path, no new authority surface.

/** DEC-001: display is presentation of a decoded audit summary — never authority. Constant. */
export function displayGrantsAuthority(): false {
  return false;
}

export interface DecodeAttempt {
  /** Did decoding complete? */
  decoded: boolean;
  /** The deterministic, human-readable audit summary produced by the decode. */
  auditSummary?: string;
  /** Did the decoder throw / fail internally? A failed decoder is quarantine, never passthrough. */
  threwDuringDecode?: boolean;
}

/**
 * DEC-001 — decode-to-audit before display: nothing reaches display without a completed decode to a
 * human-readable audit summary, and a decoder failure quarantines rather than passing raw payload through.
 * A decoded payload is at most "readable_advisory" — display never grants authority.
 */
export function decodeToAuditVerdict(a: DecodeAttempt): EvidenceClassification {
  if (a.threwDuringDecode) return quarantine('DEC-001: decoder failure is quarantine, not passthrough');
  if (!a.decoded || !a.auditSummary) return quarantine('DEC-001: no decode-to-audit summary before display');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'DEC-001: decoded to audit summary; display is advisory only' };
}

/**
 * AUD-001 — a signed Gate crossing before any effect: an effect that skipped the audit/signature crossing
 * carries no authority, ever. The REAL crossing lives in aumlokBondCeremony (legalAuthorityFromVerifier /
 * legalAuthorityFromSignature); this constant exists so the rest of the organism has one defensive place to
 * ask, and the port's tests pin the real path's negative space. Deliberately NOT a permit function — building
 * a parallel "mayApply" here would itself be a new authority surface.
 */
export function unauditedEffectGrantsAuthority(): false {
  return false;
}

export interface SupplyProvenance {
  /** Is the representation / codebook / artifact in the governed registry? */
  registered: boolean;
  /** Digest check against the registry entry: true = intact, false = tampered, null = not applicable. */
  digestMatches: boolean | null;
}

/** SUPPLY-001: being registered buys readability, never authority. Constant. */
export function registrationGrantsAuthority(): false {
  return false;
}

/**
 * SUPPLY-001 — supply-chain law (the supply side of "unknown representation is QUARANTINE, not trust"):
 * an unregistered representation/artifact is quarantine; a registered artifact that fails its digest check
 * is quarantine (registration does not immunize tampering); intact registered supply is at most advisory.
 */
export function supplyChainVerdict(s: SupplyProvenance): EvidenceClassification {
  if (!s.registered) return quarantine('SUPPLY-001: unregistered representation/artifact');
  if (s.digestMatches === false) return quarantine('SUPPLY-001: registered artifact fails digest check (tamper)');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'SUPPLY-001: registered supply; advisory only — registration is never authority' };
}
