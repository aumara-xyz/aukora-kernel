// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.1 — wire-format PRIMITIVES (Peter §8 P1–P3). Proves: the per-surface verify-many/write-one registry fails closed;
 * V3 checkpoint heads and V4 receipt heads coexist; per-field digests bind the field name (no transposition) and encode
 * absent/tombstone deterministically; the versioned export envelope is surface-explicit with bodies LOCAL by default;
 * consent-shared bodies re-verify while absent ones yield verified-with-redactions (and required-but-absent fails
 * honestly); low-entropy keyed fields are not cross-node-verifiable without the LOCAL key, which never enters the
 * envelope; the dedicated genesis/memrecall domains exist and the mesh domains stay reserved-not-minted.
 */
import { describe, it, expect } from "vitest";
import { WIRE_SURFACES, WIRE_VERSIONS, RESERVED_MESH_DOMAINS, isAcceptedVersion, writerVersion, assertAcceptedSurfaceVersion } from "../convex/aukoraWireRegistry";
import { fieldDigest, keyedFieldDigest, buildFieldDigests, combineFieldDigests, buildExportEnvelope, verifyExportEnvelope } from "../convex/aukoraWireFormat";
import { PQC_DOMAINS } from "../convex/aukoraPqcSigner";
import { bytesToHex } from "@noble/hashes/utils.js";

const KEY = new Uint8Array(32).fill(7), KEY2 = new Uint8Array(32).fill(9);
const head = { sig: "abc", headSigAlg: "ml-dsa-65-chainhead-v4" };

describe("B3.1 — wire registry: verify-many / write-one, PER SURFACE (fail closed)", () => {
  it("writer emits one version per surface; verifiers accept the ratified set; unknown/wrong-surface fails closed", () => {
    expect([writerVersion("checkpoint-head"), writerVersion("receipt-head"), writerVersion("export-envelope")]).toEqual(["v3", "v4", "env-v1"]);
    expect(isAcceptedVersion("receipt-head", "v3")).toBe(true);          // historical receipt head still verify-accepted
    expect(isAcceptedVersion("checkpoint-head", "v4")).toBe(false);      // v4 is NOT a checkpoint-head version (wrong surface)
    expect(isAcceptedVersion("export-envelope", "v4")).toBe(false);
    expect(isAcceptedVersion("nope", "v3")).toBe(false);                 // unknown surface
    expect(() => assertAcceptedSurfaceVersion("checkpoint-head", "v4")).toThrow("aukora_wire_version_refused");
    expect(() => assertAcceptedSurfaceVersion("nope", "v3")).toThrow("aukora_wire_surface_unknown");
    expect(() => writerVersion("nope")).toThrow("aukora_wire_surface_unknown");
  });
  it("V3 checkpoint heads and V4 receipt heads coexist — different surfaces, not one global format", () => {
    expect(isAcceptedVersion("checkpoint-head", "v3")).toBe(true);       // V3 writer-current for checkpoint heads
    expect(isAcceptedVersion("receipt-head", "v4")).toBe(true);          // V4 writer-current for receipt heads
    expect(writerVersion("receipt-head")).not.toBe("v3");               // V3 is retired-WRITER for receipt heads...
    expect(isAcceptedVersion("receipt-head", "v3")).toBe(true);          // ...but still verify-accepted historically
  });
  it("registry GUARD: the per-surface writer/accept/retired sets match the ratified design (drift fails this test)", () => {
    expect([...WIRE_SURFACES]).toEqual(["checkpoint-head", "receipt-head", "export-envelope", "channel-v1", "node-import-v1"]);
    expect([WIRE_VERSIONS["checkpoint-head"].writer, [...WIRE_VERSIONS["checkpoint-head"].accept], [...WIRE_VERSIONS["checkpoint-head"].retired]]).toEqual(["v3", ["v3"], ["v2"]]);
    expect([WIRE_VERSIONS["receipt-head"].writer, [...WIRE_VERSIONS["receipt-head"].accept]]).toEqual(["v4", ["v3", "v4"]]);
    expect(WIRE_VERSIONS["export-envelope"].writer).toBe("env-v1");
    // B3.4: the channel-frame surface (writer chan-v1; only chan-v1 accepted → DOOR 1 anti-downgrade).
    expect([WIRE_VERSIONS["channel-v1"].writer, [...WIRE_VERSIONS["channel-v1"].accept], [...WIRE_VERSIONS["channel-v1"].retired]]).toEqual(["chan-v1", ["chan-v1"], []]);
    // B3.5a: the cross-node import envelope surface (writer node-import-v1; only it accepted → fail-closed).
    expect([WIRE_VERSIONS["node-import-v1"].writer, [...WIRE_VERSIONS["node-import-v1"].accept], [...WIRE_VERSIONS["node-import-v1"].retired]]).toEqual(["node-import-v1", ["node-import-v1"], []]);
  });
});

describe("B3.1 — dedicated domains + reserved mesh names (P3)", () => {
  it("genesis + memrecall domains are minted; every reserved mesh domain has now been minted by its brick", () => {
    expect(PQC_DOMAINS.aumlokGenesis).toBe("aukora-aumlok-genesis-v1");
    expect(PQC_DOMAINS.aumlokMemRecall).toBe("aukora-aumlok-memrecall-v1");
    const minted = new Set(Object.values(PQC_DOMAINS));
    for (const reserved of RESERVED_MESH_DOMAINS) expect(minted.has(reserved)).toBe(false); // reserved set is now EMPTY (all minted)
    expect([...RESERVED_MESH_DOMAINS]).toEqual([]);                                          // B3.5a minted the last one (aukora-node-import-v1)
    expect(minted.has("aukora-node-import-v1")).toBe(true);                                  // → now in PQC_DOMAINS
  });
});

describe("B3.1 — per-field digests (name-bound, no transposition, deterministic)", () => {
  it("a digest binds the field NAME — same value under a different field gives a different digest", () => {
    expect(fieldDigest("a", "x")).not.toBe(fieldDigest("b", "x")); // no transposition between fields
    expect(fieldDigest("a", "x")).toBe(fieldDigest("a", "x"));     // deterministic
  });
  it("absent (optional) field + tombstone encode deterministically and distinctly from empty/null/forged-sentinel", () => {
    expect(fieldDigest("a", undefined)).toBe(fieldDigest("a", undefined));
    expect(fieldDigest("a", undefined)).not.toBe(fieldDigest("a", ""));   // absent != empty string
    expect(fieldDigest("a", undefined)).not.toBe(fieldDigest("a", null)); // absent != null
    expect(fieldDigest("a", { redacted: true })).toBe(fieldDigest("a", { redacted: true })); // tombstone deterministic
    // a present value can NEVER impersonate an absent field (the explicit presence tag) — no forgeable in-band sentinel
    expect(fieldDigest("a", undefined)).not.toBe(fieldDigest("a", { __aukora_absent__: true }));
    expect(fieldDigest("a", undefined)).not.toBe(fieldDigest("a", ["absent"]));
  });
  it("the combine is deterministic and order-independent over the digest set", () => {
    const s1 = buildFieldDigests({ a: "1", b: "2" }), s2 = buildFieldDigests({ b: "2", a: "1" });
    expect(combineFieldDigests(s1)).toBe(combineFieldDigests(s2));
    expect(combineFieldDigests(s1)).toBe(combineFieldDigests([...s1].reverse()));
  });
});

describe("B3.1 — export envelope (versioned, surface-explicit, bodies-LOCAL by default)", () => {
  const payload = { goal: "memory.write", memoryHash: "deadbeef", actorModel: "agent-echo", proofJson: "{}" };
  it("writer emits only env-v1; bodies absent by default; structural verify passes (all redacted)", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload });
    expect([env.envelopeVersion, env.surface, env.bodies, env.fields.length]).toEqual(["env-v1", "receipt-head", undefined, 4]);
    const v = verifyExportEnvelope(env);
    expect(v.ok).toBe(true);
    expect(v.redactedFields.sort()).toEqual(["actorModel", "goal", "memoryHash", "proofJson"]);
  });
  it("unknown envelope version / wrong surface-version fails closed (both build and verify)", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload });
    expect(verifyExportEnvelope({ ...env, envelopeVersion: "env-v9" }).reason).toBe("envelope_version_refused");
    expect(verifyExportEnvelope({ ...env, headVersion: "v9" }).reason).toBe("surface_version_refused");
    expect(verifyExportEnvelope({ ...env, surface: "checkpoint-head" }).reason).toBe("surface_version_refused"); // v4 invalid for checkpoint
    expect(() => buildExportEnvelope({ surface: "checkpoint-head", headVersion: "v4", head, payload })).toThrow("aukora_wire_version_refused");
  });
  it("a consent-shared body re-derives + verifies; an absent body is verified-with-redactions, not broken; a tampered body fails", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload, shareBodies: ["goal", "actorModel"] });
    expect(Object.keys(env.bodies!).sort()).toEqual(["actorModel", "goal"]);
    const v = verifyExportEnvelope(env);
    expect([v.ok, v.verifiedBodies.sort(), v.redactedFields.sort()]).toEqual([true, ["actorModel", "goal"], ["memoryHash", "proofJson"]]);
    expect(verifyExportEnvelope({ ...env, bodies: { ...env.bodies, goal: "EVIL" } }).reason).toBe("field_digest_mismatch");
  });
  it("body-required verification fails honestly when a required body is absent", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload, shareBodies: ["goal"] });
    expect(verifyExportEnvelope(env, { requireBodies: ["goal"] }).ok).toBe(true);
    expect(verifyExportEnvelope(env, { requireBodies: ["proofJson"] }).reason).toBe("body_required_absent");
  });
  it("malformed / duplicate-field / non-Uint8Array-key all fail closed", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload });
    expect(verifyExportEnvelope({ ...env, fields: [...env.fields, env.fields[0]] }).reason).toBe("field_duplicate"); // duplicate entry refused
    expect(verifyExportEnvelope({ ...env, fields: [{ field: "x", digest: 123 }] }).reason).toBe("field_malformed");
    expect(verifyExportEnvelope(null).reason).toBe("malformed");
    expect(verifyExportEnvelope([]).reason).toBe("envelope_version_refused"); // an array has no ratified envelopeVersion
    expect(() => buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload, localKey: new Uint8Array(8) })).toThrow("aukora_wire_localkey_invalid"); // short key, even with no keyedFields
  });
});

describe("B3.1 — salted/keyed commitments for low-entropy fields (the memoryHash preimage fix)", () => {
  const lowEntropy = { memoryHash: "yes", goal: "memory.write" };
  it("a low-entropy keyed body is NOT cross-node-verifiable without the LOCAL key; the right key verifies, a wrong key fails", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload: lowEntropy, keyedFields: ["memoryHash"], localKey: KEY, shareBodies: ["memoryHash"] });
    const noKey = verifyExportEnvelope(env); // no local key → the keyed field cannot be checked → treated as redacted
    expect([noKey.ok, noKey.redactedFields.includes("memoryHash"), noKey.verifiedBodies.includes("memoryHash")]).toEqual([true, true, false]);
    expect(verifyExportEnvelope(env, { localKey: KEY }).verifiedBodies).toContain("memoryHash"); // right key verifies
    expect(verifyExportEnvelope(env, { localKey: KEY2 }).reason).toBe("field_digest_mismatch");   // wrong key fails honestly
    expect(verifyExportEnvelope(env, { requireBodies: ["memoryHash"] }).reason).toBe("body_required_no_localkey"); // required-but-no-key
    // a keyed digest differs from the plain digest, and differs per key
    expect(keyedFieldDigest("memoryHash", "yes", KEY)).not.toBe(fieldDigest("memoryHash", "yes"));
    expect(keyedFieldDigest("memoryHash", "yes", KEY)).not.toBe(keyedFieldDigest("memoryHash", "yes", KEY2));
  });
  it("the local key/salt NEVER appears in the export envelope (by construction + structurally)", () => {
    const env = buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload: lowEntropy, keyedFields: ["memoryHash"], localKey: KEY, shareBodies: ["memoryHash", "goal"] });
    const blob = JSON.stringify(env);
    expect(blob.includes(bytesToHex(KEY))).toBe(false); // the full key hex is absent
    for (const banned of ['"localKey"', '"salt"', '"key"', '"secret"']) expect(blob.includes(banned)).toBe(false);
  });
});
