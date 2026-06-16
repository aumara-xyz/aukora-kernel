// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.5a — revocation-freshness (§4(A), D2), channel-liveness (§8, D5), and graded post-finding consequences (§6, D3).
 * Proves: the pulled revocation view is verified + MONOTONE (epoch regression refused), fail-closed when stale by B's OWN
 * local clock; a failed channel open is recorded as LIVENESS (never an equivocation finding); a self-verifying finding
 * (fork/regression) → a REVERSIBLE import-rejection, while a weaker rewrite finding → rewrite_suspected (NO auto-reject).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { internal, api } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed, pqcSign } from "../convex/aukoraPqcSigner";
import { signChainHeadV3 } from "../convex/aukoraSignedHead";
import { manifestHash, manifestRootHead, manifestPopHead } from "../convex/aumlokManifests";
import { serializeRevocationViewV1, FRESHNESS_WINDOW_MS } from "../convex/nodeImport";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const modules = import.meta.glob("../convex/**/*.*s");
const ROOT_SEED = "c1".repeat(32), SUBJ_SEED = "d2".repeat(32);
const SRC = "aukora-node-b-real", ROOT_KID = "rk-1", ROOT_ID = "root.peerB", KID = "demo-key-1";

async function signedView({ epoch = 1, revoked = [] as string[], seed = ROOT_SEED }) {
  const timestamp = 1;
  const sig = await pqcSign(seed, utf8ToBytes(serializeRevocationViewV1({ sourceNodeId: SRC, rootId: ROOT_ID, epoch, revokedManifestIds: revoked, timestamp })), "aukoraNodeImport");
  return { sourceNodeId: SRC, rootId: ROOT_ID, rootKeyId: ROOT_KID, epoch, revokedManifestIds: revoked, timestamp, sig };
}
const pinRoot = async (t: any) => t.mutation(internal.nodeB.pinTrust, { sourceNodeId: SRC, headKeyId: `root:${ROOT_KID}`, publicKey: await mlDsa65PublicKeyFromSeed(ROOT_SEED) });
const recordView = (t: any, view: any) => t.mutation(internal.nodeImport.recordRevocationView, { view });

describe("B3.5a — pull-origin revocation freshness (§4, clock-free counter + B-local TTL)", () => {
  it("records a verified view; ADVANCES on a higher epoch; REFUSES an epoch regression (monotone)", async () => {
    const t = convexTest(schema, modules); await pinRoot(t);
    expect(await recordView(t, await signedView({ epoch: 1 }))).toMatchObject({ ok: true, epoch: 1 });
    expect(await recordView(t, await signedView({ epoch: 3 }))).toMatchObject({ ok: true, epoch: 3 });
    expect((await recordView(t, await signedView({ epoch: 2 }))).reason).toBe("epoch_regression"); // no stale rollback
  });
  it("unpinned root → unpinned_root; a wrong-key signature → bad_view_sig", async () => {
    const t = convexTest(schema, modules);
    expect((await recordView(t, await signedView({ epoch: 1 }))).reason).toBe("unpinned_root"); // no TOFU
    await pinRoot(t);
    expect((await recordView(t, await signedView({ epoch: 1, seed: "ee".repeat(32) }))).reason).toBe("bad_view_sig");
  });
  it("same-epoch DIFFERENT revoked set → epoch_conflict; same-epoch IDENTICAL set is an idempotent refresh", async () => {
    const t = convexTest(schema, modules); await pinRoot(t);
    expect(await recordView(t, await signedView({ epoch: 1, revoked: [] }))).toMatchObject({ ok: true });
    expect((await recordView(t, await signedView({ epoch: 1, revoked: ["mft-x"] }))).reason).toBe("epoch_conflict"); // never silently overwrite
    expect(await recordView(t, await signedView({ epoch: 1, revoked: [] }))).toMatchObject({ ok: true });            // identical → benign refresh
  });
  it("a manifest import with a STALE view (older than B's local window) → stale_revocation_view (fail-closed)", async () => {
    const t = convexTest(schema, modules); await pinRoot(t);
    const subjPub = await mlDsa65PublicKeyFromSeed(SUBJ_SEED);
    const m: any = { manifestId: "mft-b-1", rootId: ROOT_ID, rootKeyId: ROOT_KID, nodeId: "aukora-node-b-real", subjectId: "subject.echo", subjectKind: "agent", subjectPubKey: subjPub, permissions: [], allowedIntentCodecs: [], notBefore: 1, expiresAt: 9_999_999_999_999, maxUses: null, maxPerWindow: null, createdAt: 1 };
    const manifest = { ...m, manifestHash: await manifestHash(m), rootSig: await signChainHeadV3(ROOT_SEED, await manifestRootHead(m), "aumlokManifest"), subjectPopSig: await signChainHeadV3(SUBJ_SEED, await manifestPopHead(m), "aumlokSubjectPop") };
    // seed a view whose B-local verify time is OLDER than the freshness window
    const stale = Date.now() - FRESHNESS_WINDOW_MS - 5_000;
    await t.run((ctx: any) => ctx.db.insert("node_revocation_view", { sourceNodeId: SRC, rootId: ROOT_ID, epoch: 1, revokedManifestIdsJson: "[]", viewSig: "x", verifiedAtLocal: stale, updatedAt: stale }));
    expect((await t.mutation(internal.nodeImport.importForeignManifest, { env: { envelopeVersion: "node-import-v1", sourceNodeId: SRC, manifest } })).reason).toBe("stale_revocation_view");
  });
});

describe("B3.5a — channel-liveness (§8): a failed open is a transport fact, NEVER a finding", () => {
  it("records a channel-miss liveness row; node_witness_findings stays EMPTY", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.aukoraWitness.noteChannelLiveness, { peerNodeId: SRC, headKeyId: KID, chainKey: "mem:root.peerB:n1", reason: "channel_miss" });
    const live = await t.query(api.aukoraWitness.channelLiveness, { peerNodeId: SRC, headKeyId: KID });
    expect(live.length).toBe(1); expect(live[0].reason).toBe("channel_miss");
    expect((await t.run((ctx: any) => ctx.db.query("node_witness_findings").collect())).length).toBe(0);
  });
});

describe("B3.5a — graded local consequences (§6, D3): self-verifying → import-rejected; rewrite → suspected", () => {
  const seedFinding = (t: any, kind: string) => t.run((ctx: any) => ctx.db.insert("node_witness_findings", { witnessNodeId: "aukora-node-a-demo", peerNodeId: SRC, headKeyId: KID, chainId: "c", chainKey: "k", kind, headAJson: "{}", headBJson: "{}", recordJson: "{}", witnessSig: "s", observedAt: 1 }));
  it("a FORK finding → import_rejected; re-pin (clearConsequence) reverses it", async () => {
    const t = convexTest(schema, modules);
    const id = await seedFinding(t, "fork");
    expect(await t.mutation(internal.aukoraWitness.applyConsequence, { findingId: id })).toMatchObject({ ok: true, state: "import_rejected" });
    expect((await t.query(api.aukoraWitness.peerConsequences, { peerNodeId: SRC, headKeyId: KID }))[0].state).toBe("import_rejected");
    expect(await t.mutation(internal.aukoraWitness.clearConsequence, { peerNodeId: SRC, headKeyId: KID })).toMatchObject({ ok: true, cleared: 1 });
    expect((await t.query(api.aukoraWitness.peerConsequences, { peerNodeId: SRC, headKeyId: KID }))[0].clearedAt).toBeGreaterThan(0);
  });
  it("a REWRITE finding → rewrite_suspected (NO auto import-rejection); a re-request digest can be stored", async () => {
    const t = convexTest(schema, modules);
    const id = await seedFinding(t, "rewrite");
    expect(await t.mutation(internal.aukoraWitness.applyConsequence, { findingId: id })).toMatchObject({ ok: true, state: "rewrite_suspected" });
    expect(await t.mutation(internal.aukoraWitness.recordRewriteReRequest, { peerNodeId: SRC, headKeyId: KID, failedProofDigest: "deadbeef" })).toMatchObject({ ok: true });
    expect((await t.query(api.aukoraWitness.peerConsequences, { peerNodeId: SRC, headKeyId: KID }))[0].failedProofDigest).toBe("deadbeef");
  });
  it("a STRONGER (fork) finding SUPERSEDES a weaker rewrite_suspected → import_rejected (no downgrade the other way)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.aukoraWitness.applyConsequence, { findingId: await seedFinding(t, "rewrite") });
    expect(await t.mutation(internal.aukoraWitness.applyConsequence, { findingId: await seedFinding(t, "fork") })).toMatchObject({ ok: true, state: "import_rejected", superseded: true });
    const rows = await t.query(api.aukoraWitness.peerConsequences, { peerNodeId: SRC, headKeyId: KID });
    expect(rows.length).toBe(1); expect(rows[0].state).toBe("import_rejected"); // upgraded in place, not a second row
    // a later rewrite does NOT downgrade the import_rejected
    expect(await t.mutation(internal.aukoraWitness.applyConsequence, { findingId: await seedFinding(t, "rewrite") })).toMatchObject({ state: "import_rejected", alreadySet: true });
  });
});
