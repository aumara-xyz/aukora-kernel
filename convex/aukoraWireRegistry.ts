// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.1 (P2, Peter §8 sign-off 2026-06-11) — the FROZEN central wire-format REGISTRY. The single source of truth for
 * the verify-many / write-one law, PER SURFACE: surfaces, head/envelope versions, the ratified historical versions a
 * verifier accepts, and the reserved (not-yet-minted) mesh domains. Versioning is PER SURFACE — checkpoint heads and
 * receipt heads are distinct surfaces with distinct formats, never one global chain-head number.
 *
 * The law: a WRITER emits exactly the `writer` version of a surface; a VERIFIER accepts any `accept` version of that
 * surface; an unknown surface, an unknown version, or a version on the WRONG surface FAILS CLOSED. A guard test asserts
 * code ↔ design-record (`canon/AUKORA_B3_1_WIRE_FORMAT_DESIGN.md` §3) equality, so drift fails closed.
 */
export const WIRE_SURFACES = Object.freeze(["checkpoint-head", "receipt-head", "export-envelope", "channel-v1", "node-import-v1"] as const);
export type WireSurface = (typeof WIRE_SURFACES)[number];

/** Per-surface version registry. `writer` = the ONE version a writer emits today; `accept` = every ratified version a
 *  verifier accepts (writer is always in accept); `retired` = refused (recorded for provenance). FROZEN. */
export const WIRE_VERSIONS = Object.freeze({
  // Checkpoint heads (manifests, rotations, genesis challenge, recall PoP, PoP caps/requests, revocation/del: heads).
  // V3 is WRITER-CURRENT (what was retired at B1.3b was V2/Ed25519, NOT V3).
  "checkpoint-head": Object.freeze({ writer: "v3", accept: Object.freeze(["v3"]), retired: Object.freeze(["v2"]) }),
  // Receipt heads moved to V4 (binds the Merkle receipt-history root); V3 receipt heads are historical/verify-supported.
  "receipt-head": Object.freeze({ writer: "v4", accept: Object.freeze(["v3", "v4"]), retired: Object.freeze([]) }),
  // The cross-node EXPORT ENVELOPE is its own versioned surface (B3.1). Writers emit env-v1 only; unknown fails closed.
  "export-envelope": Object.freeze({ writer: "env-v1", accept: Object.freeze(["env-v1"]), retired: Object.freeze([]) }),
  // B3.4 ML-KEM CHANNEL FRAME (the AEAD-sealed confidentiality envelope around an env-v1 payload). Writers emit chan-v1
  // only; an unratified version fails closed (DOOR 1 anti-downgrade). The channel adds confidentiality ONLY — B2.4 holds.
  "channel-v1": Object.freeze({ writer: "chan-v1", accept: Object.freeze(["chan-v1"]), retired: Object.freeze([]) }),
  // B3.5a CROSS-NODE IMPORT ENVELOPE (the audit-only manifest/memory/revocation-view record a node imports from an
  // explicitly-pinned peer). Writers emit node-import-v1 only; an unratified version fails closed. AUDIT record only —
  // an imported envelope grants ZERO local effect authority (honor-as-record; B2.4 holds).
  "node-import-v1": Object.freeze({ writer: "node-import-v1", accept: Object.freeze(["node-import-v1"]), retired: Object.freeze([]) }),
} as const);

/** ChainKey-prefix → surface classification (best-effort routing label; the SURFACE is always carried EXPLICITLY in an
 *  envelope, never inferred from bytes — this map is for local diagnostics only, not an authority input). */
export const CHAINKEY_SURFACE_PREFIXES = Object.freeze({
  "id:": "receipt-head", "mft:": "receipt-head", "mem:": "receipt-head", // V4 receipt/lifecycle chains
  "aumlok:": "checkpoint-head", "aukora-": "checkpoint-head",            // signing-preimage chainKeys (PoP/manifest/etc.)
} as const);

/** Reserved mesh/export DOMAIN names — claimed so they cannot be accidentally reused, but DELIBERATELY NOT YET minted
 *  into PQC_DOMAINS (they enter when the implementing brick lands). A guard test asserts they are ABSENT from
 *  PQC_DOMAINS — minting one early would be a silent format change. `aukora-witness-v1` was MINTED at B3.3 (it is now in
 *  PQC_DOMAINS as `aukoraWitness`); `aukora-node-import-v1` was MINTED at B3.5a (now `aukoraNodeImport`). The set is now
 *  EMPTY — every reserved mesh domain has been minted by its implementing brick. */
export const RESERVED_MESH_DOMAINS = Object.freeze([] as const);

/** Is `version` a ratified (accepted) version for `surface`? FALSE on unknown surface or unknown version. */
export function isAcceptedVersion(surface: string, version: unknown): boolean {
  const r = (WIRE_VERSIONS as any)[surface];
  return !!r && typeof version === "string" && (r.accept as readonly string[]).includes(version);
}

/** The single version a writer emits for `surface`. THROWS on unknown surface (fail closed). */
export function writerVersion(surface: string): string {
  const r = (WIRE_VERSIONS as any)[surface];
  if (!r) throw new Error("aukora_wire_surface_unknown");
  return r.writer;
}

/** Assert `(surface, version)` is ACCEPTED — fail closed on unknown surface, unknown version, or wrong-surface combo
 *  (e.g. a "v4" claimed for the checkpoint-head surface, or a "v3" claimed for export-envelope). */
export function assertAcceptedSurfaceVersion(surface: unknown, version: unknown): void {
  if (typeof surface !== "string" || !(WIRE_SURFACES as readonly string[]).includes(surface)) throw new Error("aukora_wire_surface_unknown");
  if (!isAcceptedVersion(surface, version)) throw new Error("aukora_wire_version_refused");
}
