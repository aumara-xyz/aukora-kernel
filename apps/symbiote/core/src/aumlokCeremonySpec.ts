/**
 * 24Z.30 — AUMLOK Ceremony DESIGN spec (INERT — a governed identity ceremony, NOT an authority portal).
 *
 * The AUMLOK Ceremony binds PETER'S identity / consent / signature into a legible, scoped, receipted, revocable
 * form — SEPARATE from the AI's agency. This module is a DESIGN artifact only: it describes the ceremony's phases,
 * scope template, authority EXCLUSIONS, and receipt SHAPE. It executes nothing, signs nothing, and holds no key.
 *
 * Hard law (this round = design + UI ritual only):
 *   - the AI NEVER holds Peter's authority key (`aiHoldsAuthorityKey:false`, and the type has no key field).
 *   - the ceremony grants IDENTITY BINDING + a CONSENT RECEIPT only — never Ring-0, never live apply, never
 *     production AUMLOK. A lab ceremony is NOT a production identity.
 *   - the consent phrase is a PLACEHOLDER, never a verified production proof-of-possession.
 *   - scope is a FIXED declared template (allowed/excluded), not prose that can be widened.
 *   - the spec carries NO private key / secret / raw signature body.
 * FIREWALL: imports no gate/apply/OpenCode/permit/signer code; no such module imports it. grantsAuthority is false.
 */
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';

export type CeremonyPhase =
  | 'preflight_truth' | 'scope_declaration' | 'authority_exclusions' | 'consent_phrase'
  | 'key_custody_declaration' | 'signer_label' | 'signature_receipt' | 'revocation_expiry' | 'post_ceremony_truth';

export interface CeremonyStep { phase: CeremonyPhase; title: string; humanLegible: string; grantsAuthority: false }

export type SignerLabel = 'lab_mldsa_sandbox' | 'production_not_built';

export interface ContinuityLayer { layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'; name: string; status: 'present' | 'seeded' | 'future' | 'experimental_gated'; note: string }

export interface AumlokCeremonyDesign {
  schema: 'aumlok-ceremony-design-v0';
  designOnly: true;
  signerLabel: SignerLabel;                 // never 'production_*' this round
  phases: CeremonyStep[];
  authorityExclusions: string[];            // what the ceremony explicitly does NOT grant
  scopeTemplate: { allowed: string[]; excluded: string[] };   // fixed declared scope (not prose-widenable)
  consentPhrasePlaceholder: string;         // a PLACEHOLDER, not a verified PoP
  humanConsentRequired: true;
  revocationRequired: true;
  expiryRequired: true;
  aiHoldsAuthorityKey: false;
  ring0Granted: false;
  liveApplyGranted: false;
  productionAumlok: false;
  grantsAuthority: false;
  continuityLayers: ContinuityLayer[];
}

const step = (phase: CeremonyPhase, title: string, humanLegible: string): CeremonyStep => ({ phase, title, humanLegible, grantsAuthority: false });

/** Build the inert ceremony design. Pure; describes the ceremony, grants nothing, holds no key. */
export function buildAumlokCeremonyDesign(): AumlokCeremonyDesign {
  return {
    schema: 'aumlok-ceremony-design-v0',
    designOnly: true,
    signerLabel: 'production_not_built',
    phases: [
      step('preflight_truth', 'Preflight truth', 'Show the structured-truth banner: what is live vs lab, what is parked, what cannot be done. The human reads the honest state before any consent.'),
      step('scope_declaration', 'Scope declaration', 'Declare the exact, fixed scope the identity binding covers — from a template, not free prose. Nothing outside the template is in scope.'),
      step('authority_exclusions', 'Authority exclusions', 'State plainly what this ceremony does NOT grant: no Ring-0, no live apply, no production AUMLOK, no autonomous authority.'),
      step('consent_phrase', 'Human consent', 'The human enters a consent phrase (a PLACEHOLDER this round). It is NOT a verified production proof-of-possession; it records intent, not power.'),
      step('key_custody_declaration', 'Key custody', 'Declare that the human alone holds the authority key. The AI never holds it. This ceremony performs no key handoff.'),
      step('signer_label', 'Signer label', 'Label the signer honestly: lab ML-DSA (sandbox) or production-not-built. A lab ceremony is never a production identity.'),
      step('signature_receipt', 'Signature receipt (shape only)', 'Describe the receipt SHAPE a real ceremony would emit — hashes of the scope + consent + truth snapshot. This round emits no real signature.'),
      step('revocation_expiry', 'Revocation & expiry', 'Every binding must be revocable and must expire. Declare the revocation path and expiry window.'),
      step('post_ceremony_truth', 'Post-ceremony truth', 'Re-show the structured-truth banner. The ceremony changed identity legibility/consent — it changed NO capability. Authority state is unchanged.'),
    ],
    authorityExclusions: [
      'does NOT grant Ring-0 permission',
      'does NOT grant live apply',
      'does NOT grant production AUMLOK',
      'does NOT grant autonomous authority',
      'does NOT hand any key to the AI',
      'does NOT make the AI self-building',
    ],
    scopeTemplate: {
      allowed: ['identity binding (lab)', 'human consent receipt', 'scope declaration', 'revocation/expiry policy'],
      excluded: ['gate authorization', 'sandbox/live apply', 'signer key custody by AI', 'Ring-0', 'production identity'],
    },
    consentPhrasePlaceholder: 'I, the human operator, consent to this LAB identity binding within the declared scope. (placeholder — not a production proof-of-possession)',
    humanConsentRequired: true,
    revocationRequired: true,
    expiryRequired: true,
    aiHoldsAuthorityKey: false,
    ring0Granted: false,
    liveApplyGranted: false,
    productionAumlok: false,
    grantsAuthority: false,
    continuityLayers: [
      { layer: 'L0', name: 'audited execution harness', status: 'present', note: 'lab ML-DSA signer + receipts + HRT + structured truth' },
      { layer: 'L1', name: 'episodic memory', status: 'seeded', note: '24Z.29 receipt-labeled episode memory (fixture-only)' },
      { layer: 'L2', name: 'consolidation / dream cycle', status: 'future', note: '24Z.31 candidate' },
      { layer: 'L3', name: 'identity anchors', status: 'future', note: 'linked to the AUMLOK ceremony (production design later)' },
      { layer: 'L4', name: 'latent / VK communication', status: 'experimental_gated', note: 'baseline vs JSON first; never authority' },
    ],
  };
}

export interface CeremonyValidation { ok: boolean; violations: string[] }

/** Validate the design is INERT + leak-free: all authority flags false, consent/revocation required, signer not
 *  production, no key/secret/signature material anywhere in the artifact. */
export function validateAumlokCeremonyDesign(d: AumlokCeremonyDesign): CeremonyValidation {
  const v: string[] = [];
  if (d.grantsAuthority !== false) v.push('grantsAuthority must be false');
  if (d.aiHoldsAuthorityKey !== false) v.push('aiHoldsAuthorityKey must be false (the AI never holds the key)');
  if (d.ring0Granted !== false) v.push('ring0Granted must be false');
  if (d.liveApplyGranted !== false) v.push('liveApplyGranted must be false');
  if (d.productionAumlok !== false) v.push('productionAumlok must be false (not built)');
  if (d.humanConsentRequired !== true) v.push('humanConsentRequired must be true');
  if (d.revocationRequired !== true) v.push('revocationRequired must be true');
  if (d.expiryRequired !== true) v.push('expiryRequired must be true');
  if (d.signerLabel !== 'lab_mldsa_sandbox' && d.signerLabel !== 'production_not_built') v.push('signerLabel invalid');
  if (d.signerLabel === 'lab_mldsa_sandbox' && d.productionAumlok) v.push('a lab signer is never a production identity');
  if (d.phases.some((p) => p.grantsAuthority !== false)) v.push('no ceremony phase may grant authority');
  // no key/secret/signature material anywhere in the design artifact.
  const leak = [...scanForbiddenKeys(d), ...scanForbiddenValues(d).map((p) => `value@${p}`)];
  if (leak.length) v.push(`ceremony design must carry no key/secret/signature material: ${leak.join(', ')}`);
  return { ok: v.length === 0, violations: v };
}

export function summarizeAumlokCeremony(): string {
  return [
    'AUMLOK Ceremony: DESIGN ONLY (a governed identity ceremony, not an authority portal). It binds the human’s',
    'identity/consent/signature — legible, scoped, receipted, revocable — SEPARATE from the AI’s agency. The AI never',
    'holds the key; it grants no Ring-0, no live apply, no production AUMLOK. Lab ≠ production. UI is a preview, not a power.',
  ].join(' ');
}
