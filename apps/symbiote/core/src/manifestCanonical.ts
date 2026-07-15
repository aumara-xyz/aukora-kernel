/**
 * 24Z.35 — canonical payload for the builder-signed runtime truth manifest. MIRRORED byte-identical in
 * internal/tauri-womb/src/lib/manifestCanonical.ts (a test asserts the mirror) so the edge signer and the tauri
 * verifier serialize the SAME bytes. Key-order-independent: two semantically-identical manifests canonicalize to
 * the same string (and therefore the same hash + signature check).
 *
 * The SIGNED SUBSET is the trust surface the cockpit + the console consume: the manifest identity (schema/gitHead/
 * generatedAt) + the entire structuredTruth (every capability/authority/readiness/Womb-Lab-displayed field is
 * derived from structuredTruth). Signing this binds "what the app shows" to "what the builder produced".
 */
export const SIGNED_FIELDS = ['schema', 'gitHead', 'generatedAt', 'structuredTruth'] as const;

// recursive, sorted-key canonicalization (arrays keep order; objects sort keys; scalars pass through).
function canon(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canon);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
  return out;
}

export function canonicalManifestPayload(manifest: unknown): string {
  const m = (manifest ?? {}) as Record<string, unknown>;
  const subset: Record<string, unknown> = {};
  for (const k of SIGNED_FIELDS) subset[k] = m[k];
  return JSON.stringify(canon(subset));
}
