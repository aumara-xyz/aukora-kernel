// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.4 — ML-KEM-768 NODE-CHANNEL CONFIDENTIALITY (witness-first). Proves the ratified §6.1/§6.2 doors:
 *   - KAT/known-answer beyond round-trip smoke (DOOR 5): deterministic ML-KEM keygen-from-seed (pinned pubkey hash),
 *     implicit rejection, deterministic epoch-keyed KEM-seed derivation, deterministic binding sig + sealed frame.
 *   - The signed binding ties identity ↔ KEM key ↔ epoch ↔ capability; verifies ONLY against the pinned identity key
 *     (no TOFU); fails closed on any tamper; domain-separated from chain heads (anti-lifting).
 *   - KEM establishment + AEAD seal/open agree; fresh-per-request (DOOR 3); anti-downgrade (DOOR 1); and EVERY failure
 *     surfaces as ONE uniform `channel_refused` (DOOR 4 — no decrypt oracle), including ML-KEM implicit-rejection.
 *   - convex-test: pinChannel (fail-closed, epoch-forward-only DOOR 2); STRIP-NEUTRAL (a sealed observation gives the
 *     byte-identical witness verdict as plaintext); and DOOR 1 fail-closed — once channel-capable, plaintext is REFUSED.
 *
 * Disposable test seeds throughout — never real keys. Confidentiality ONLY: the channel grants/gates/mints nothing (B2.4).
 */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  deriveChannelKemSeed, deriveChannelKeypair, signChannelBinding, verifyChannelBinding,
  channelEncapsulate, channelDecapsulate, channelTranscript, sealFrame, openFrame, channelProofDigest,
  CHANNEL_WIRE, CHANNEL_SURFACE, CHANNEL_KEM_ALG, CHANNEL_BINDING_V, CHANNEL_DIR_R2I, CHANNEL_DIR_I2R,
} from "../convex/aukoraChannel";
import { signChainHeadV4, deriveChainId, type ChainHeadFields } from "../convex/aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { merkleRootHex, leafHash, consistencyProofHex } from "../convex/aukoraMerkleLog";
import { buildExportEnvelope } from "../convex/aukoraWireFormat";

const modules = import.meta.glob("../convex/**/*.*s");
const hex = (b: Uint8Array) => bytesToHex(b);
const enc = (s: string) => new TextEncoder().encode(s);
const flip = (h: string) => h.slice(0, -2) + (h.slice(-2) === "00" ? "01" : "00"); // flip the last hex byte
const catchMsg = (fn: () => unknown): string => { try { fn(); return "NO_THROW"; } catch (e) { return (e as Error).message; } };

const NODE_SEED = "11".repeat(32);              // disposable node identity seed
const SEED64 = new Uint8Array(64).fill(0x42);   // disposable ML-KEM keygen seed

describe("B3.4 — ML-KEM-768 + channel KNOWN-ANSWERS (beyond round-trip smoke; DOOR 5)", () => {
  // Pinned-at-implementation known answers — a library / HKDF / AEAD / derivation drift trips these LOUDLY (the same
  // discipline as the ML-DSA PINNED_SIG_SHA256). NOT the full FIPS-203 ACVP suite — that ingestion is the pre-CLAIM gate.
  const PINNED_KEM_PUB_SHA = "8cde1b49992415b527e361f52465634978fcc488d6f541c4a1fec97fd14b4661";
  const PINNED_KEM_SEED_SHA = "a379e3774d820456050234cafa1f703f609e01dc16b98e0e95aba93d83a2dd09";
  const PINNED_BINDING_SIG_SHA = "6704ea032abb237d6d9eb657c38e2ec617e4ecd18060a02f2ba4f3eccdce8649";
  const PINNED_SEAL_SHA = "bb767eae99e29a0e5a239808fc718f1ab237b7aaf0cdaf56d8bd12a0e624bbcc";

  it("ML-KEM-768 keygen-from-seed is deterministic at exact FIPS 203 sizes (pinned pubkey hash)", () => {
    const { publicKey, secretKey } = ml_kem768.keygen(SEED64);
    expect([publicKey.length, secretKey.length]).toEqual([1184, 2400]);
    expect(hex(sha256(publicKey))).toBe(PINNED_KEM_PUB_SHA);
  });
  it("ML-KEM-768 implicit rejection: a tampered ciphertext yields a DIFFERENT shared secret, never a crash", () => {
    const { publicKey, secretKey } = ml_kem768.keygen(SEED64);
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
    const bad = cipherText.slice(); bad[0] ^= 1;
    expect(hex(ml_kem768.decapsulate(bad, secretKey))).not.toBe(hex(sharedSecret));
  });
  it("epoch-keyed KEM-seed derivation is deterministic (pinned) and epoch-separated (DOOR 2)", () => {
    const s0 = deriveChannelKemSeed(NODE_SEED, 0);
    expect([s0.length, hex(sha256(s0))]).toEqual([64, PINNED_KEM_SEED_SHA]);
    expect(hex(deriveChannelKemSeed(NODE_SEED, 0))).toBe(hex(s0));            // deterministic
    expect(hex(deriveChannelKemSeed(NODE_SEED, 1))).not.toBe(hex(s0));        // a new epoch rotates the key
  });
  it("a channel binding signature is deterministic (pinned)", async () => {
    const { publicKeyHex } = deriveChannelKeypair(NODE_SEED, 0);
    const { sig } = await signChannelBinding(NODE_SEED, { nodeId: "n", headKeyId: "k", epoch: 0, channelPublicKeyHex: publicKeyHex });
    expect(hex(sha256(hexToBytes(sig)))).toBe(PINNED_BINDING_SIG_SHA);
  });
  it("a sealed frame is deterministic given (secret, transcript, plaintext, salt, direction) (pinned)", () => {
    const ss = new Uint8Array(32).fill(0x42);
    const salt = new Uint8Array(32).fill(0x24); // fixed salt for the KAT (production draws a fresh random salt per seal)
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch: 0, channelPublicKeyHex: "ab".repeat(1184), ctHex: "cd".repeat(1088) });
    const frame = sealFrame(ss, tr, enc("aukora-channel-kat-payload"), CHANNEL_DIR_R2I, salt);
    expect([frame.direction, frame.saltHex]).toEqual([CHANNEL_DIR_R2I, "24".repeat(32)]);
    expect(hex(sha256(hexToBytes(frame.ciphertextHex)))).toBe(PINNED_SEAL_SHA);
  });
});

describe("B3.4 — signed channel binding (identity ↔ KEM key ↔ epoch ↔ capability)", () => {
  it("round-trips against the pinned identity key; binds capability + epoch + pubkey", async () => {
    const idPub = await mlDsa65PublicKeyFromSeed(NODE_SEED);
    const { publicKeyHex } = deriveChannelKeypair(NODE_SEED, 2);
    const { binding, sig } = await signChannelBinding(NODE_SEED, { nodeId: "node-b", headKeyId: "k1", epoch: 2, channelPublicKeyHex: publicKeyHex });
    expect([binding.v, binding.kemAlg, binding.channelCapable, binding.epoch]).toEqual([CHANNEL_BINDING_V, CHANNEL_KEM_ALG, true, 2]);
    expect(await verifyChannelBinding(idPub, binding, sig)).toBe(true);
  });
  it("FAILS CLOSED: wrong identity key, tampered epoch, tampered pubkey, dropped capability, bad version", async () => {
    const idPub = await mlDsa65PublicKeyFromSeed(NODE_SEED);
    const otherPub = await mlDsa65PublicKeyFromSeed("99".repeat(32));
    const { publicKeyHex } = deriveChannelKeypair(NODE_SEED, 0);
    const { binding, sig } = await signChannelBinding(NODE_SEED, { nodeId: "node-b", headKeyId: "k1", epoch: 0, channelPublicKeyHex: publicKeyHex });
    expect(await verifyChannelBinding(otherPub, binding, sig)).toBe(false);                                          // wrong identity key
    expect(await verifyChannelBinding(idPub, { ...binding, epoch: 1 }, sig)).toBe(false);                            // tampered epoch
    expect(await verifyChannelBinding(idPub, { ...binding, channelPublicKey: "00".repeat(1184) }, sig)).toBe(false); // tampered KEM pubkey
    expect(await verifyChannelBinding(idPub, { ...binding, channelCapable: false as any }, sig)).toBe(false);        // capability must be true
    expect(await verifyChannelBinding(idPub, { ...binding, v: "evil" as any }, sig)).toBe(false);                    // unknown binding version
  });
  it("DOMAIN SEPARATION: a chainHead signature can never verify as a channel binding (anti-lifting)", async () => {
    const idPub = await mlDsa65PublicKeyFromSeed(NODE_SEED);
    const { publicKeyHex } = deriveChannelKeypair(NODE_SEED, 0);
    const { binding } = await signChannelBinding(NODE_SEED, { nodeId: "node-b", headKeyId: "k1", epoch: 0, channelPublicKeyHex: publicKeyHex });
    const hf: ChainHeadFields = { chainKey: "x", timestamp: 1, chainLength: 1, chainHeadHash: "aa".repeat(32) };
    const headSig = await signChainHeadV4(NODE_SEED, hf, "bb".repeat(32), "chainHead");
    expect(await verifyChannelBinding(idPub, binding, headSig)).toBe(false);
  });
});

describe("B3.4 — KEM establishment + AEAD seal/open (stateless per-request; DOORS 1/3/4)", () => {
  const setupKeys = (epoch = 0) => {
    const { publicKeyHex, secretKey } = deriveChannelKeypair(NODE_SEED, epoch);
    return { publicKeyHex, secretKey, epoch };
  };
  it("A encapsulates → B decapsulates → B seals → A opens === plaintext (strip-neutral crypto core)", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    expect(hex(ssA)).toBe(hex(ssB)); // ML-KEM agreement
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const pt = enc("the env-v1 bodies-absent payload bytes");
    const frame = sealFrame(ssB, tr, pt);
    expect([frame.wireVersion, frame.surface, frame.kemAlg]).toEqual([CHANNEL_WIRE, CHANNEL_SURFACE, CHANNEL_KEM_ALG]);
    const trA = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    expect(hex(openFrame(ssA, trA, frame))).toBe(hex(pt));
  });
  it("FRESH per request: two encapsulations to the same key differ in ciphertext AND secret (DOOR 3 stateless)", () => {
    const { publicKeyHex } = setupKeys();
    const e1 = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const e2 = channelEncapsulate({ channelPublicKey: publicKeyHex });
    expect(e1.ctHex).not.toBe(e2.ctHex);
    expect(hex(e1.sharedSecret)).not.toBe(hex(e2.sharedSecret));
  });
  it("DOOR 3 single-use ENFORCED by construction: two seals of IDENTICAL (secret,transcript,plaintext) differ (fresh salt) yet both open", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const pt = enc("identical payload, identical secret + transcript");
    const f1 = sealFrame(ssB, tr, pt);
    const f2 = sealFrame(ssB, tr, pt);
    expect(f1.saltHex).not.toBe(f2.saltHex);             // a FRESH per-message salt each seal
    expect(f1.ciphertextHex).not.toBe(f2.ciphertextHex); // → distinct (key,nonce) → no reuse even on secret misuse
    expect(hex(openFrame(ssA, tr, f1))).toBe(hex(pt));   // both still open correctly
    expect(hex(openFrame(ssA, tr, f2))).toBe(hex(pt));
  });
  it("DOOR 1 leg separation: the direction is bound — a wrong expected direction or a tampered direction refuses", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const frame = sealFrame(ssB, tr, enc("payload"), CHANNEL_DIR_R2I);
    expect(hex(openFrame(ssA, tr, frame, CHANNEL_DIR_R2I))).toBe(hex(enc("payload")));        // correct leg opens
    expect(() => openFrame(ssA, tr, frame, "initiator-to-responder")).toThrow("channel_refused"); // wrong expected leg
    expect(() => openFrame(ssA, tr, { ...frame, direction: "initiator-to-responder" })).toThrow("channel_refused"); // tampered label
    expect(() => sealFrame(ssB, tr, enc("x"), "bogus-leg")).toThrow(); // a non-allowlisted direction is refused at the deriver (closed enum)
  });
  it("B3.5c i2r REQUEST leg round-trips: initiator seals { chainKey }, responder opens it — chainKey NEVER on the wire in cleartext", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex }); // A encapsulates ONCE
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const CHAINKEY = "mem:root.secret:diary"; // a sensitive chainKey (the chain-existence oracle B3.5c closes)
    const reqFrame = sealFrame(ssA, tr, enc(JSON.stringify({ chainKey: CHAINKEY })), CHANNEL_DIR_I2R);
    expect(JSON.stringify(reqFrame).includes(CHAINKEY)).toBe(false);                                  // sealed → never in the request bytes
    expect([reqFrame.direction, reqFrame.wireVersion, reqFrame.surface]).toEqual([CHANNEL_DIR_I2R, CHANNEL_WIRE, CHANNEL_SURFACE]);
    const ssB = channelDecapsulate(secretKey, reqFrame.ctHex);                                        // responder: same shared secret
    const opened = JSON.parse(new TextDecoder().decode(openFrame(ssB, tr, reqFrame, CHANNEL_DIR_I2R)));
    expect(opened.chainKey).toBe(CHAINKEY);
  });
  it("B3.5c CROSS-LEG KEY separation: a frame sealed on one leg cannot be opened on the other even when RELABELED (distinct AEAD key, not just a label check)", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const reqFrame = sealFrame(ssA, tr, enc("REQ"), CHANNEL_DIR_I2R);
    // RELABEL the i2r frame as r2i and open as r2i: the label-equality check now PASSES, but the r2i-derived AEAD key
    // ≠ the i2r seal key → AEAD tag failure → channel_refused. Proves the two legs derive DISTINCT key material.
    expect(() => openFrame(ssB, tr, { ...reqFrame, direction: CHANNEL_DIR_R2I }, CHANNEL_DIR_R2I)).toThrow("channel_refused");
    const respFrame = sealFrame(ssB, tr, enc("RESP"), CHANNEL_DIR_R2I);
    expect(() => openFrame(ssA, tr, { ...respFrame, direction: CHANNEL_DIR_I2R }, CHANNEL_DIR_I2R)).toThrow("channel_refused");
  });
  it("B3.5c both legs from ONE encapsulation: request (i2r) + response (r2i) share the secret but NOT the key; a request can't open as a response", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const reqFrame = sealFrame(ssA, tr, enc(JSON.stringify({ chainKey: "mem:x:y" })), CHANNEL_DIR_I2R);   // A seals request
    const respFrame = sealFrame(ssB, tr, enc(JSON.stringify({ envelope: 1 })), CHANNEL_DIR_R2I);          // B seals response
    expect(reqFrame.ciphertextHex).not.toBe(respFrame.ciphertextHex);                                     // distinct keys → distinct ciphertext
    expect(JSON.parse(new TextDecoder().decode(openFrame(ssB, tr, reqFrame, CHANNEL_DIR_I2R))).chainKey).toBe("mem:x:y");
    expect(JSON.parse(new TextDecoder().decode(openFrame(ssA, tr, respFrame, CHANNEL_DIR_R2I))).envelope).toBe(1);
    expect(() => openFrame(ssB, tr, reqFrame)).toThrow("channel_refused"); // a request opened as a response (default r2i) is refused
  });
  it("DOOR 1 anti-downgrade: a frame with an unratified wireVersion → channel_refused", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const frame = sealFrame(ssB, tr, enc("x"));
    expect(() => openFrame(sharedSecret, tr, { ...frame, wireVersion: "chan-v2" })).toThrow("channel_refused");
    expect(() => openFrame(sharedSecret, tr, { ...frame, surface: "export-envelope" })).toThrow("channel_refused");
  });
  it("DOOR 4 NO ORACLE: wrong secret, tampered ciphertext, and wrong epoch ALL throw the identical channel_refused", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
    const frame = sealFrame(ssB, tr, enc("payload"));
    const msgs = [
      catchMsg(() => openFrame(new Uint8Array(32).fill(7), tr, frame)),                    // wrong shared secret
      catchMsg(() => openFrame(sharedSecret, tr, { ...frame, ciphertextHex: flip(frame.ciphertextHex) })), // tampered AEAD ciphertext
      catchMsg(() => openFrame(sharedSecret, tr, { ...frame, epoch: 9 })),                 // epoch not bound to A's transcript
    ];
    expect(new Set(msgs)).toEqual(new Set(["channel_refused"])); // ONE error for all → no distinguishing oracle
  });
  it("ML-KEM implicit rejection surfaces as channel_refused (a tampered KEM ciphertext → A cannot open B's seal)", () => {
    const { publicKeyHex, secretKey, epoch } = setupKeys();
    const { ctHex, sharedSecret: ssA } = channelEncapsulate({ channelPublicKey: publicKeyHex });
    const badCt = flip(ctHex);                                   // attacker flips the KEM ciphertext in transit to B
    const ssB = channelDecapsulate(secretKey, badCt);           // implicit rejection → a wrong-but-valid-looking secret
    const trB = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex: badCt });
    const frame = sealFrame(ssB, trB, enc("payload"));
    const trA = channelTranscript({ nodeId: "n", headKeyId: "k", epoch, channelPublicKeyHex: publicKeyHex, ctHex }); // A's own ct
    expect(() => openFrame(ssA, trA, frame)).toThrow("channel_refused");
  });
});

describe("B3.4 — channel pin + STRIP-NEUTRAL + fail-closed ingest (convex-test)", () => {
  const PEER = "aukora-lab-beta", KID = "beta-key-1", CK = "mem:peer:diary";
  const PEER_SEED = "22".repeat(32);
  const raw = Array.from({ length: 4 }, (_, i) => (`a${i}`).padEnd(2, "0").repeat(32).slice(0, 64));
  const leafHex = (rs: string[]) => rs.map((r) => bytesToHex(leafHash(hexToBytes(r))));
  const proofHex = (s1: number, s2: number) => consistencyProofHex(leafHex(raw).slice(0, s2), s1, s2);
  const chainId = () => bytesToHex(deriveChainId(CK));
  const rootState = (h: any) => ({ size: h.size, root: h.root, headHash: h.headHash, baselineSize: h.baselineSize, baselineRoot: h.baselineRoot, baselineHeadHash: h.baselineHeadHash, lastRecordType: h.lastRecordType, chainId: h.chainId, chainKey: h.chainKey, peerNodeId: h.peerNodeId, headKeyId: h.headKeyId, witnessNodeId: h.witnessNodeId, signedHeadJson: h.signedHeadJson });

  async function makeExport(size: number): Promise<any> {
    const root = merkleRootHex(raw.slice(0, size)); const headHash = raw[size - 1]; const ts = 1000 + size;
    const hf: ChainHeadFields = { chainKey: CK, timestamp: ts, chainLength: size, chainHeadHash: headHash };
    const headSig = await signChainHeadV4(PEER_SEED, hf, root, "chainHead");
    const head = { sourceNodeId: PEER, headKeyId: KID, chainKey: CK, lastChainHash: headHash, count: size, updatedAt: ts, headSig, headSigAlg: "ml-dsa-65-chainhead-v4", headSignedAt: ts, receiptLogRoot: root };
    return buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload: { n: String(size) } });
  }
  const pinHead = async (t: any) => {
    const publicKey = await mlDsa65PublicKeyFromSeed(PEER_SEED);
    await t.run(async (ctx: any) => ctx.db.insert("node_trust_registry", { sourceNodeId: PEER, headKeyId: KID, publicKey, pinnedAt: 1 }));
  };
  const bindAt = async (epoch: number) => {
    const { publicKeyHex } = deriveChannelKeypair(PEER_SEED, epoch);
    const { binding, sig } = await signChannelBinding(PEER_SEED, { nodeId: PEER, headKeyId: KID, epoch, channelPublicKeyHex: publicKeyHex });
    return { binding, sig, epoch };
  };
  // Peer B seals an observation under the channel; returns the args the witness (A) hands to witnessIngest.
  function sealObservation(binding: any, epoch: number, envelope: any, consistencyProof: string[] | null) {
    const { secretKey } = deriveChannelKeypair(PEER_SEED, epoch);
    const { ctHex, sharedSecret: ssA } = channelEncapsulate(binding);
    const ssB = channelDecapsulate(secretKey, ctHex);
    const tr = channelTranscript({ nodeId: PEER, headKeyId: KID, epoch, channelPublicKeyHex: binding.channelPublicKey, ctHex });
    const frame = sealFrame(ssB, tr, enc(JSON.stringify({ envelope, consistencyProof: consistencyProof ?? null })));
    return { ctHex, sharedSecretHex: bytesToHex(ssA), frame };
  }

  it("pinChannel verifies the binding against the head pin and stores the channel pin", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig, epoch } = await bindAt(0);
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig })).toMatchObject({ ok: true, epoch });
    const pin: any = await t.query(api.aukoraWitness.channelPin, { peerNodeId: PEER, headKeyId: KID });
    expect([pin.epoch, pin.kemAlg, pin.channelPublicKey.length]).toEqual([0, CHANNEL_KEM_ALG, 2368]);
  });
  it("pinChannel FAILS CLOSED: no head pin (no TOFU), and a corrupted binding signature", async () => {
    const tNoHead = convexTest(schema, modules);
    const { binding, sig } = await bindAt(0);
    expect(await tNoHead.mutation(internal.aukoraWitness.pinChannel, { binding, sig })).toMatchObject({ ok: false, reason: "no_head_pin" });
    const t = convexTest(schema, modules);
    await pinHead(t);
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig: flip(sig) })).toMatchObject({ ok: false, reason: "binding_invalid" });
  });
  it("epoch regression on re-pin is REFUSED (DOOR 2 forward-only rotation)", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const hi = await bindAt(5), lo = await bindAt(3);
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding: hi.binding, sig: hi.sig })).toMatchObject({ ok: true, epoch: 5 });
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding: lo.binding, sig: lo.sig })).toMatchObject({ ok: false, reason: "epoch_regression" });
  });
  it("STRIP-NEUTRAL (strengthened): sealed vs plaintext yield DEEP-EQUAL verdicts AND identical root-relevant HWM state — baseline AND a proof-advanced attestation", async () => {
    // CHANNEL node: baseline@3 then growth@4 with a VALID proof, both through sealed frames.
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig, epoch } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    const cBase = await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, channel: sealObservation(binding, epoch, await makeExport(3), null) });
    const cGrow = await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, channel: sealObservation(binding, epoch, await makeExport(4), proofHex(3, 4)) });
    // PLAINTEXT node (NOT channel-capable): the SAME envelopes + proof, processed without the channel.
    const tP = convexTest(schema, modules);
    await pinHead(tP);
    const pBase = await tP.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(3) });
    const pGrow = await tP.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(4), consistencyProof: proofHex(3, 4) });
    // (a) FULL verdict objects deep-equal (not partial fields) — baseline AND attestation.
    expect(cBase).toEqual(pBase);
    expect(cGrow).toEqual(pGrow);
    // (b) the resulting root-relevant witness state is byte-identical (the channel changed nothing the witness records).
    const hC = await t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: chainId() });
    const hP = await tP.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: chainId() });
    expect(rootState(hC)).toEqual(rootState(hP));
    // the channel node records its delivery PROVENANCE (a channelProof digest); the plaintext node does not — additive
    // audit, deliberately OUTSIDE the strip-neutral verdict/root state (rootState excludes it).
    expect(typeof hC.channelProof).toBe("string");
    expect(hP.channelProof).toBeUndefined();
  });
  it("FIX2: a sealed frame opened for peer B but carrying a DIFFERENT peer's head → peer_identity_mismatch", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig, epoch } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    const env = await makeExport(3);
    const foreign = { ...env, head: { ...env.head, sourceNodeId: "aukora-lab-gamma" } }; // sealed under B's channel, content claims gamma
    expect(await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, channel: sealObservation(binding, epoch, foreign, null) })).toMatchObject({ ok: false, reason: "peer_identity_mismatch" });
    expect(await t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: chainId() })).toBeNull();
  });
  it("FIX2 (plaintext path): a caller peerNodeId that does not match the envelope head → peer_identity_mismatch", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t); // NOT channel-capable
    expect(await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: "aukora-lab-gamma", headKeyId: KID, plaintext: { envelope: await makeExport(3) } })).toMatchObject({ ok: false, reason: "peer_identity_mismatch" });
  });
  it("FIX3: a DIRECT witnessObserve on a CHANNEL-CAPABLE peer is REFUSED (no plaintext-path bypass)", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(3) })).toMatchObject({ ok: false, reason: "channel_required" });
    expect(await t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: chainId() })).toBeNull();
  });
  it("FIX4: same epoch with a DIFFERENT channel key is REFUSED (epoch_key_conflict); same key is idempotent; no overwrite", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const e0 = await bindAt(0);
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding: e0.binding, sig: e0.sig })).toMatchObject({ ok: true, epoch: 0 });
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding: e0.binding, sig: e0.sig })).toMatchObject({ ok: true, epoch: 0 }); // idempotent same-key
    const otherKey = deriveChannelKeypair(PEER_SEED, 7).publicKeyHex; // a DIFFERENT KEM key...
    const conflict = await signChannelBinding(PEER_SEED, { nodeId: PEER, headKeyId: KID, epoch: 0, channelPublicKeyHex: otherKey }); // ...claimed at the SAME epoch 0
    expect(await t.mutation(internal.aukoraWitness.pinChannel, { binding: conflict.binding, sig: conflict.sig })).toMatchObject({ ok: false, reason: "epoch_key_conflict" });
    expect((await t.query(api.aukoraWitness.channelPin, { peerNodeId: PEER, headKeyId: KID })).channelPublicKey).toBe(e0.binding.channelPublicKey); // original NOT overwritten
  });
  it("FIX6: a MALFORMED consistency proof (non-hex element) → malformed_consistency_proof, NOT a false rewrite finding (plaintext + channel)", async () => {
    // plaintext path
    const t = convexTest(schema, modules);
    await pinHead(t);
    await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(3) }); // baseline@3
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(4), consistencyProof: ["not-a-hash", "zz"] })).toMatchObject({ ok: false, reason: "malformed_consistency_proof" });
    expect((await t.query(api.aukoraWitness.witnessFindings, { peerNodeId: PEER, chainId: chainId() })).length).toBe(0); // NO false rewrite finding
    expect((await t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: chainId() })).size).toBe(3); // HWM unchanged
    // channel path (malformed proof inside a validly-sealed frame)
    const tc = convexTest(schema, modules);
    await pinHead(tc);
    const { binding, sig, epoch } = await bindAt(0);
    await tc.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    await tc.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, channel: sealObservation(binding, epoch, await makeExport(3), null) });
    const res = await tc.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, channel: sealObservation(binding, epoch, await makeExport(4), ["bogus", "zz"]) });
    expect(res).toMatchObject({ ok: false, reason: "malformed_consistency_proof" });
    expect((await tc.query(api.aukoraWitness.witnessFindings, { peerNodeId: PEER, chainId: chainId() })).length).toBe(0);
  });
  it("DOOR 1: once channel-capable, a PLAINTEXT observation is REFUSED (channel_required); no HWM is written", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    const env = await makeExport(3);
    expect(await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, plaintext: { envelope: env } })).toMatchObject({ ok: false, reason: "channel_required" });
    expect(await t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: bytesToHex(deriveChainId(CK)) })).toBeNull();
  });
  it("DOOR 1/4: a TAMPERED sealed frame for a channel-capable peer → channel_refused (no plaintext fallback, no oracle)", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig, epoch } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    const chan = sealObservation(binding, epoch, await makeExport(3), null);
    const tampered = { ...chan, frame: { ...chan.frame, ciphertextHex: flip(chan.frame.ciphertextHex) } };
    expect(await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, channel: tampered })).toMatchObject({ ok: false, reason: "channel_refused" });
  });
  it("a NON-channel-capable peer accepts plaintext (optional rollout phase)", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t); // head pinned, but NO channel pin
    expect(await t.mutation(internal.aukoraWitness.witnessIngest, { peerNodeId: PEER, headKeyId: KID, plaintext: { envelope: await makeExport(3) } })).toMatchObject({ ok: true, recordType: "baseline" });
  });

  // ── B3.4 LIVE-PATH PREP (DORMANT; flags OFF; no live run) ──
  it("witnessRecordOpened (live no-secret path) records the channelProof digest in the HWM; fail-closed", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    const cp = { ctHex: "cd".repeat(1088), epoch: 0, saltHex: "24".repeat(32), wireVersion: CHANNEL_WIRE };
    const res = await t.mutation(internal.aukoraWitness.witnessRecordOpened, { peerNodeId: PEER, headKeyId: KID, envelope: await makeExport(3), channelProof: cp });
    expect(res).toMatchObject({ ok: true, recordType: "baseline", size: 3 });
    const hwm: any = await t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: chainId() });
    expect([typeof hwm.channelProof, hwm.channelProof.length]).toEqual(["string", 64]); // durable sha256 audit digest
    // the signed witness record also carries the digest (non-repudiable provenance)
    expect(JSON.parse(hwm.lastRecordJson).channelProofDigest).toBe(hwm.channelProof);
    // fail-closed: epoch mismatch
    expect(await t.mutation(internal.aukoraWitness.witnessRecordOpened, { peerNodeId: PEER, headKeyId: KID, envelope: await makeExport(3), channelProof: { ...cp, epoch: 9 } })).toMatchObject({ ok: false, reason: "epoch_mismatch" });
    // fail-closed: peer identity mismatch
    const foreign = { ...(await makeExport(3)), head: { ...(await makeExport(3)).head, sourceNodeId: "aukora-lab-gamma" } };
    expect(await t.mutation(internal.aukoraWitness.witnessRecordOpened, { peerNodeId: PEER, headKeyId: KID, envelope: foreign, channelProof: cp })).toMatchObject({ ok: false, reason: "peer_identity_mismatch" });
    // fail-closed: not channel-capable
    const t2 = convexTest(schema, modules); await pinHead(t2);
    expect(await t2.mutation(internal.aukoraWitness.witnessRecordOpened, { peerNodeId: PEER, headKeyId: KID, envelope: await makeExport(3), channelProof: cp })).toMatchObject({ ok: false, reason: "not_channel_capable" });
  });
  it("advanceChannelEpoch is MONOTONE; channelSelfEpoch reflects it; default 0", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.aukoraWitness.channelSelfEpoch, {})).toBe(0);
    expect(await t.mutation(internal.aukoraWitness.advanceChannelEpoch, {})).toMatchObject({ ok: true, epoch: 1 });
    expect(await t.query(api.aukoraWitness.channelSelfEpoch, {})).toBe(1);
    expect(await t.mutation(internal.aukoraWitness.advanceChannelEpoch, { toEpoch: 5 })).toMatchObject({ ok: true, epoch: 5 });
    expect(await t.mutation(internal.aukoraWitness.advanceChannelEpoch, { toEpoch: 5 })).toMatchObject({ ok: false, reason: "epoch_not_monotone" }); // not strictly increasing
    expect(await t.mutation(internal.aukoraWitness.advanceChannelEpoch, { toEpoch: 3 })).toMatchObject({ ok: false, reason: "epoch_not_monotone" }); // regression
    expect(await t.query(api.aukoraWitness.channelSelfEpoch, {})).toBe(5); // unchanged by the refused calls
  });
  it("unpinChannel ROLLBACK reverts a peer to plaintext (safe, reversible, idempotent)", async () => {
    const t = convexTest(schema, modules);
    await pinHead(t);
    const { binding, sig } = await bindAt(0);
    await t.mutation(internal.aukoraWitness.pinChannel, { binding, sig });
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(3) })).toMatchObject({ ok: false, reason: "channel_required" }); // channel-capable
    expect(await t.mutation(internal.aukoraWitness.unpinChannel, { peerNodeId: PEER, headKeyId: KID })).toMatchObject({ ok: true, unpinned: true });
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: await makeExport(3) })).toMatchObject({ ok: true, recordType: "baseline" }); // reverted to plaintext
    expect(await t.mutation(internal.aukoraWitness.unpinChannel, { peerNodeId: PEER, headKeyId: KID })).toMatchObject({ ok: true, unpinned: false }); // idempotent
  });
  it("channelPollPeer is DORMANT until the flag (off → channel_disabled; on + no pin → not_channel_capable, no fetch)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.action(internal.aukoraWitness.channelPollPeer, { peerNodeId: PEER, headKeyId: KID, chainKey: CK, peerBaseUrl: "http://unused.invalid" })).toMatchObject({ ok: false, reason: "channel_disabled" });
    process.env.AUKORA_B3_CHANNEL_ENABLED = "1";
    try {
      expect(await t.action(internal.aukoraWitness.channelPollPeer, { peerNodeId: PEER, headKeyId: KID, chainKey: CK, peerBaseUrl: "http://unused.invalid" })).toMatchObject({ ok: false, reason: "not_channel_capable" });
    } finally { delete process.env.AUKORA_B3_CHANNEL_ENABLED; }
  });
  it("channelProofDigest is deterministic over PUBLIC delivery metadata (no secret input); binds epoch + salt", () => {
    const m = { peerNodeId: "B", headKeyId: "k", epoch: 2, ctHex: "cd".repeat(1088), saltHex: "24".repeat(32), wireVersion: CHANNEL_WIRE };
    const d = channelProofDigest(m);
    expect([channelProofDigest(m), d.length]).toEqual([d, 64]);
    expect(channelProofDigest({ ...m, epoch: 3 })).not.toBe(d);
    expect(channelProofDigest({ ...m, saltHex: "25".repeat(32) })).not.toBe(d);
  });
  it("saltOverride is FORBIDDEN outside a test runner (production guard) — can't be used to force salt reuse live", () => {
    const ss = new Uint8Array(32).fill(1);
    const tr = channelTranscript({ nodeId: "n", headKeyId: "k", epoch: 0, channelPublicKeyHex: "ab".repeat(1184), ctHex: "cd".repeat(1088) });
    const salt = new Uint8Array(32).fill(2);
    expect(() => sealFrame(ss, tr, enc("x"), CHANNEL_DIR_R2I, salt)).not.toThrow(); // honored in the test runner
    const savedVitest = process.env.VITEST, savedNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.VITEST; process.env.NODE_ENV = "production"; // simulate a Convex deployment
      expect(() => sealFrame(ss, tr, enc("x"), CHANNEL_DIR_R2I, salt)).toThrow("aukora_channel_salt_override_forbidden");
      expect(() => sealFrame(ss, tr, enc("x"))).not.toThrow(); // without an override, a live seal still works (random salt)
    } finally {
      if (savedVitest === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitest;
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    }
  });
});
