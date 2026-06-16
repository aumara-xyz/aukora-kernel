// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.1 (P1 + P2, Peter §8 sign-off 2026-06-11) — wire-format PRIMITIVES for cross-node receipt sharing. DORMANT: these
 * build the FORMAT that B3.5 will wire into actual cross-node networking; nothing here touches the live V4 receipt
 * chain, the B1.5 demo envelope, or the B2.4 authority path. PROVEN-LAB only.
 *
 * What it provides:
 *  - PER-FIELD digests that BIND the field NAME (a digest can never be transposed to another field).
 *  - KEYED (salted) digests for LOW-ENTROPY fields (e.g. memory content / memoryHash) — HMAC under a LOCAL key that is
 *    NEVER placed in an envelope, so a shared digest is not preimage-recoverable and is only LOCALLY re-derivable.
 *  - The versioned EXPORT ENVELOPE: explicit `envelopeVersion` + explicit `surface` (never inferred from bytes), the
 *    head, and per-field digests. Bodies are LOCAL by default; specific field bodies are shared only by explicit consent.
 *  - verify: ratified-version + surface fail-closed; re-derive shared bodies against their digests; honest
 *    verified-with-redactions when a body is absent; honest failure when a body is REQUIRED but absent.
 *
 * NOT a privacy claim: this proves the NARROW property (the shared digest of a keyed field reveals nothing about
 * guessable content without the local key, and bodies are not shared by default). It does NOT provide metadata privacy
 * (field presence / surface / counts still show), full content privacy, or unlinkability.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { stableStringify } from "./aukoraCore";
import { type WireSurface, assertAcceptedSurfaceVersion, writerVersion, isAcceptedVersion } from "./aukoraWireRegistry";

const FIELD_DIGEST_PREFIX = "aukora-field-digest-v1"; // domain-separates a field digest from any other hash in the system
const COMBINE_PREFIX = "aukora-field-combine-v1";     // domain-separates the combined commitment
// Canonical message for a field digest — BINDS the field name (so digest(nameA,v) !== digest(nameB,v): no transposition)
// AND encodes PRESENCE as a distinct tag: a present field is ["present", value], an absent (optional) field is
// ["absent"]. The two tuple shapes can never collide, so NO present value (not even an object) can impersonate an
// absent field — there is no in-band sentinel a caller could forge.
function fieldMessage(fieldName: string, value: unknown): Uint8Array {
  const tagged = value === undefined ? ["absent"] : ["present", value];
  return utf8ToBytes(stableStringify([FIELD_DIGEST_PREFIX, fieldName, tagged]));
}

/** Plain per-field digest (HIGH-entropy fields). Name-bound, deterministic. */
export function fieldDigest(fieldName: string, value: unknown): string {
  return bytesToHex(sha256(fieldMessage(fieldName, value)));
}

/** Keyed/salted per-field digest (LOW-entropy fields). HMAC-SHA256 under a LOCAL key — the key NEVER leaves the node,
 *  so the cross-node digest is not preimage-recoverable and verifies only for a holder of the same local key. */
export function keyedFieldDigest(fieldName: string, value: unknown, localKey: Uint8Array): string {
  if (!(localKey instanceof Uint8Array) || localKey.length < 16) throw new Error("aukora_wire_localkey_invalid");
  return bytesToHex(hmac(sha256, localKey, fieldMessage(fieldName, value)));
}

export type FieldDigestEntry = { field: string; digest: string; keyed: boolean };
export type ExportEnvelope = {
  envelopeVersion: string; // the CONTAINER version (registry "export-envelope" surface) — writer emits the current one only
  surface: WireSurface;    // EXPLICIT surface of the carried head — NEVER inferred from bytes
  headVersion: string;     // the head's surface-version (e.g. "v4" for a receipt head)
  head: unknown;           // the signed head row (public material)
  fields: FieldDigestEntry[]; // per-field digests (sorted by field name) — the PROOF material that crosses by default
  bodies?: Record<string, unknown>; // OPTIONAL consent-shared field bodies (ABSENT by default; never salts/keys)
};

/** Per-field digests for a payload. `keyedFields` names the LOW-entropy fields → keyed (HMAC) digest (needs `localKey`).
 *  Output is sorted by field name (deterministic). */
export function buildFieldDigests(
  payload: Record<string, unknown>,
  opts: { keyedFields?: readonly string[]; localKey?: Uint8Array } = {},
): FieldDigestEntry[] {
  const keyed = new Set(opts.keyedFields ?? []);
  return Object.keys(payload).sort().map((field) => {
    if (keyed.has(field)) {
      if (!opts.localKey) throw new Error("aukora_wire_keyed_field_no_localkey");
      return { field, digest: keyedFieldDigest(field, payload[field], opts.localKey), keyed: true };
    }
    return { field, digest: fieldDigest(field, payload[field]), keyed: false };
  });
}

/** Deterministic single-commitment combine over a digest set (sorted; binds field name + keyed flag). */
export function combineFieldDigests(entries: FieldDigestEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  return bytesToHex(sha256(utf8ToBytes(stableStringify([COMBINE_PREFIX, sorted.map((e) => [e.field, e.digest, e.keyed ? 1 : 0])]))));
}

/** Build the cross-node EXPORT ENVELOPE. The writer emits ONLY the current ratified envelope version. Bodies are LOCAL
 *  by default; `shareBodies` consent-shares specific field bodies. The local key/salt is NEVER serialized (structural
 *  guard rejects a leak). */
export function buildExportEnvelope(input: {
  surface: WireSurface; headVersion: string; head: unknown; payload: Record<string, unknown>;
  keyedFields?: readonly string[]; localKey?: Uint8Array; shareBodies?: readonly string[];
}): ExportEnvelope {
  assertAcceptedSurfaceVersion(input.surface, input.headVersion); // the carried head's surface/version must be ratified
  // Eager localKey validation — fail closed even when keyedFields is empty (so an invalid key is never silently accepted).
  if (input.localKey !== undefined && (!(input.localKey instanceof Uint8Array) || input.localKey.length < 16)) throw new Error("aukora_wire_localkey_invalid");
  // CALLER DISCIPLINE (B3.5): every LOW-ENTROPY / guessable field (e.g. memoryHash, status, goal) that may be
  // consent-shared MUST be listed in `keyedFields` — a low-entropy field left unkeyed and shared exposes its content.
  // The primitive is opt-in by design; the cross-node call sites are the place that enumerates the low-entropy set.
  const fields = buildFieldDigests(input.payload, { keyedFields: input.keyedFields, localKey: input.localKey });
  const env: ExportEnvelope = { envelopeVersion: writerVersion("export-envelope"), surface: input.surface, headVersion: input.headVersion, head: input.head, fields };
  if (input.shareBodies && input.shareBodies.length) {
    const bodies: Record<string, unknown> = {};
    for (const f of input.shareBodies) bodies[f] = input.payload[f]; // explicit consent-shared bodies only
    env.bodies = bodies;
  }
  // Defense-in-depth: a local key/salt must NEVER serialize into the envelope.
  if (input.localKey && JSON.stringify(env).includes(bytesToHex(input.localKey))) throw new Error("aukora_wire_localkey_leak");
  return env;
}

export type EnvelopeVerdict = { ok: boolean; reason?: string; verifiedBodies: string[]; redactedFields: string[] };
const fail = (reason: string): EnvelopeVerdict => ({ ok: false, reason, verifiedBodies: [], redactedFields: [] });

/** Verify an export envelope STRUCTURALLY (fail closed on unknown/wrong-surface version), and re-derive any
 *  consent-shared bodies against their digests. A KEYED field's shared body is verifiable only with the matching
 *  `localKey` (cross-node, without it, that field is treated as redacted — the narrow property). `requireBodies` makes
 *  named fields' bodies MANDATORY — an absent required body fails honestly (`body_required_absent`). */
export function verifyExportEnvelope(env: unknown, opts: { localKey?: Uint8Array; requireBodies?: readonly string[] } = {}): EnvelopeVerdict {
  if (!env || typeof env !== "object") return fail("malformed");
  const e = env as ExportEnvelope;
  if (!isAcceptedVersion("export-envelope", e.envelopeVersion)) return fail("envelope_version_refused"); // unknown envelope version → closed
  try { assertAcceptedSurfaceVersion(e.surface, e.headVersion); } catch { return fail("surface_version_refused"); }
  if (!Array.isArray(e.fields)) return fail("fields_malformed");
  const bodies: Record<string, unknown> = (e.bodies && typeof e.bodies === "object") ? e.bodies : {};
  const require = new Set(opts.requireBodies ?? []);
  const verifiedBodies: string[] = [], redactedFields: string[] = [];
  const seen = new Set<string>();
  for (const entry of e.fields) {
    if (!entry || typeof entry.field !== "string" || typeof entry.digest !== "string" || typeof entry.keyed !== "boolean") return fail("field_malformed");
    if (seen.has(entry.field)) return fail("field_duplicate"); // no two entries for one field (anti-confusion)
    seen.add(entry.field);
    const hasBody = Object.prototype.hasOwnProperty.call(bodies, entry.field);
    if (!hasBody) {
      if (require.has(entry.field)) return fail("body_required_absent"); // honest failure when a REQUIRED body is missing
      redactedFields.push(entry.field);
      continue;
    }
    if (entry.keyed) {
      if (!opts.localKey) { // a low-entropy field's body cannot be checked cross-node without the local key
        if (require.has(entry.field)) return fail("body_required_no_localkey");
        redactedFields.push(entry.field);
        continue;
      }
      if (keyedFieldDigest(entry.field, bodies[entry.field], opts.localKey) !== entry.digest) return fail("field_digest_mismatch");
    } else {
      if (fieldDigest(entry.field, bodies[entry.field]) !== entry.digest) return fail("field_digest_mismatch");
    }
    verifiedBodies.push(entry.field);
  }
  // any required field that had no entry at all is also a failure
  for (const f of require) if (!seen.has(f)) return fail("body_required_absent");
  return { ok: true, verifiedBodies, redactedFields };
}
