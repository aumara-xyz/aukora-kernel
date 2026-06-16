// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * Code attestation (DEMO) — release-manifest provenance against the REAL verifier via convex-test.
 * Proves: a founder-release-key-signed manifest is required; forged/unknown/tampered/downgraded/revoked are refused;
 * version high-water blocks rollback. Does NOT prove the node is executing that bundle (named residual in the design).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { signReleaseManifest } from "../convex/codeAttestation";

const modules = import.meta.glob("../convex/**/*.*s");
const RELEASE = "33".repeat(32), ATTACKER = "44".repeat(32), AUTH = "aukora.release";
const SHA = "abc123gitsha", BH = "deadbeefbundlehash";

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId: AUTH, keyId: "rk-1", publicKey: await mlDsa65PublicKeyFromSeed(RELEASE) });
  const seed = async (manifestId: string, version: number, signSeed = RELEASE, over: any = {}) => {
    const m = { manifestId, version, gitSHA: SHA, bundleHash: BH, bundleHashAlg: "sha256-slice-tarball", releaseKeyId: "rk-1", ...over };
    await t.mutation(internal.codeAttestation.seedReleaseManifest, { ...m, signature: await signReleaseManifest(signSeed, m), status: over.status });
  };
  return { t, seed };
}
const attest = (t: any, manifestId: string, sourceNodeId: string) => t.mutation(internal.codeAttestation.attestImport, { manifestId, sourceNodeId });

describe("Code attestation — release-manifest provenance (demo runnable suite)", () => {
  it("VALID blessed manifest accepted", async () => {
    const s = await setup(); await s.seed("rel-1", 1);
    expect((await attest(s.t, "rel-1", "srcA")).ok).toBe(true);
  });
  it("FORGED signature (attacker release key) -> att_bad_signature", async () => {
    const s = await setup(); await s.seed("rel-f", 1, ATTACKER);
    await expect(attest(s.t, "rel-f", "srcB")).rejects.toThrow("att_bad_signature");
  });
  it("UNKNOWN manifestId -> att_unknown_manifest", async () => {
    const s = await setup();
    await expect(attest(s.t, "rel-ghost", "srcC")).rejects.toThrow("att_unknown_manifest");
  });
  it("gitSHA/bundleHash MISMATCH (tampered after signing) -> att_bad_signature", async () => {
    const s = await setup(); await s.seed("rel-mm", 1);
    await s.t.mutation(internal.codeAttestation.tamperManifestField, { manifestId: "rel-mm", bundleHash: "TAMPERED" });
    await expect(attest(s.t, "rel-mm", "srcD")).rejects.toThrow("att_bad_signature");
  });
  it("ROLLBACK/DOWNGRADE (v1 after v2 on same source) -> att_downgraded", async () => {
    const s = await setup(); await s.seed("rel-v2", 2); await s.seed("rel-v1", 1);
    expect((await attest(s.t, "rel-v2", "srcE")).ok).toBe(true);
    await expect(attest(s.t, "rel-v1", "srcE")).rejects.toThrow("att_downgraded");
  });
  it("REVOKED manifest -> att_revoked_manifest", async () => {
    const s = await setup(); await s.seed("rel-rev", 1, RELEASE, { status: "revoked" });
    await expect(attest(s.t, "rel-rev", "srcF")).rejects.toThrow("att_revoked_manifest");
  });
  it("REVOKED release key -> att_release_key_revoked", async () => {
    const s = await setup(); await s.seed("rel-rk", 1);
    await s.t.mutation(internal.popResolver.seedFounderKey, { founderUserId: AUTH, keyId: "rk-1", publicKey: await mlDsa65PublicKeyFromSeed(RELEASE), status: "revoked" });
    await expect(attest(s.t, "rel-rk", "srcG")).rejects.toThrow("att_release_key_revoked");
  });
  it("NON-ACTIVE status (e.g. 'draft') refused by the allow-list -> att_manifest_not_active", async () => {
    const s = await setup(); await s.seed("rel-draft", 1, RELEASE, { status: "draft" });
    await expect(attest(s.t, "rel-draft", "srcI")).rejects.toThrow("att_manifest_not_active");
  });
  it("same-version re-attest is NOT a downgrade (idempotent) -> accepted", async () => {
    const s = await setup(); await s.seed("rel-x", 3);
    expect((await attest(s.t, "rel-x", "srcH")).ok).toBe(true);
    expect((await attest(s.t, "rel-x", "srcH")).ok).toBe(true); // version == hwm, not < hwm
  });
});