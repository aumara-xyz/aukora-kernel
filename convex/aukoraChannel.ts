// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.4 — ML-KEM-768 NODE-CHANNEL CONFIDENTIALITY (witness-first). PURE module: no Convex, no Node APIs, no WASM.
 * @noble/post-quantum@0.6.1 (ML-KEM-768, FIPS 203) + @noble/ciphers (XChaCha20-Poly1305) + @noble/hashes (HKDF/SHA-256),
 * explicit .js subpaths (the only form @noble v2 exports). The Convex glue + fail-closed policy live in aukoraWitness.ts.
 *
 * WHAT THIS ADDS (and ONLY this): an application-layer CONFIDENTIALITY envelope for the B3.3 witness poll. It establishes
 * a per-request shared secret via ML-KEM-768 and AEAD-seals the env-v1 bodies-absent export under it. The B2.4 law holds:
 *   - CONFIDENTIALITY ONLY. The channel grants nothing, gates nothing, mints nothing. Strip the channel → witnessObserve
 *     sees the byte-identical envelope → byte-identical verdict (the "strip-neutral" property, proven in the suite).
 *   - AUTHORITY STAYS ML-DSA-65. The peer's channel KEM public key is BOUND to its node identity by an ML-DSA-65 signature
 *     under the dedicated `aukora-channel-v1` domain (domain-separated from chain heads — a head sig can never be lifted to
 *     a channel binding, nor the reverse), and pinned OUT-OF-BAND against the SAME identity key already in the trust
 *     registry (no TOFU; single trust anchor). A binding not signed by the pinned node key fails closed.
 *
 * The ratified §6.1 / §6.2 doors (canon/AUKORA_B3_4_ML_KEM_DESIGN.md), enforced here:
 *   - DOOR 1 (downgrade refusal): the frame's wireVersion is checked against the B3.1 registry (verify-many/write-one);
 *     an unratified version refuses. Plaintext fallback for a channel-capable peer fails closed (in aukoraWitness.ts).
 *   - DOOR 2 (rotation/epoch/no-FS): the KEM keypair is HKDF-derived from the node seed PER EPOCH (a monotone counter,
 *     NOT wall-clock); the epoch is bound INTO the signed binding and the transcript. No KEM secret is ever stored — it is
 *     re-derivable from (node seed, epoch). A static key has NO forward secrecy: that honesty is stated, never papered over.
 *   - DOOR 3 (stateless per-request): a FRESH encapsulation per request → a single-use shared secret. The AEAD key+nonce
 *     are HKDF-derived from (secret, a FRESH per-message random salt carried in the frame, the DIRECTION leg label, the
 *     transcript) — so the (key,nonce) pair is unique to each seal by CONSTRUCTION, never reused even if a secret is
 *     wrongly reused, and the two legs never share key material. No DB-persisted nonce counter, no secret-at-rest, no
 *     GCM/Poly1305 nonce-reuse hazard.
 *   - DOOR 4 (no metadata claim / freshness / no oracle): freshness rides the per-request ciphertext (unique per
 *     encapsulation), NOT a clock. `openFrame` returns ONE uniform `channel_refused` for EVERY failure (bad version,
 *     structural, tag failure, ML-KEM implicit-rejection mismatch) — no distinguishing error, no decrypt oracle.
 *   - DOOR 5 (conformance): the suite pins ML-KEM-768 known-answers (deterministic keygen-from-seed, implicit rejection)
 *     beyond round-trip smoke; the full FIPS-203 ACVP vector ingestion remains the named pre-CLAIM gate (evidence doc).
 *   - DOOR 6 (local-socket asymmetry): documented in the design note; this module is transport-agnostic (it wraps the
 *     payload, not the socket), so the stricter local-socket posture is a deployment ruling, not a code branch here.
 *
 * NOT a "quantum-secure system" (BANNED, lane-by-lane). NOT end-to-end PQC. This is B3.4 channel confidentiality for the
 * witness transport — claim only that exact surface. No independent audit of @noble/post-quantum exists (B1 accepted risk).
 */
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, randomBytes, concatBytes } from "@noble/hashes/utils.js";
import { pqcSign, pqcVerify } from "./aukoraPqcSigner";
import { isAcceptedVersion } from "./aukoraWireRegistry";

// ── Pinned constants (the wire surface + the KEM/AEAD identifiers). The frame version is governed by the B3.1 registry
//    ("channel-v1" surface, writer "chan-v1"); see aukoraWireRegistry.ts. The BINDING format tag equals the FIPS 204
//    domain label by design (one purpose, one label). ──
export const CHANNEL_SURFACE = "channel-v1" as const;
export const CHANNEL_WIRE = "chan-v1" as const;             // the frame's wireVersion (registry writer for channel-v1)
export const CHANNEL_BINDING_V = "aukora-channel-v1" as const; // the signed-binding format tag (== the PQC domain label)
export const CHANNEL_KEM_ALG = "ml-kem-768" as const;
export const CHANNEL_AEAD = "xchacha20poly1305" as const;
// The directional leg labels, bound into the AEAD key derivation so the two legs of a channel can NEVER share key
// material (a single ML-KEM encapsulation yields ONE shared secret; the direction label domain-separates the two AEAD
// keys derived from it). The witness PULL has TWO legs:
//   • r2i (responder→initiator): the RESPONSE — B seals the env-v1 export → A opens it (B3.4).
//   • i2r (initiator→responder): the REQUEST — A seals { chainKey } → B opens it (B3.5c, closes chainKey-privacy).
// The labels are NOT interchangeable: a frame sealed under one leg cannot be opened under the other (different AEAD key).
export const CHANNEL_DIR_R2I = "responder-to-initiator" as const;
export const CHANNEL_DIR_I2R = "initiator-to-responder" as const; // B3.5c: the sealed-REQUEST leg (chainKey privacy)
// The CLOSED set of valid direction labels — `deriveAead` refuses anything else, so the label can never be an
// attacker-influenced free string in the HKDF info. Adding a leg is a DELIBERATE enum edit (i2r added at B3.5c).
export const CHANNEL_DIRECTIONS = Object.freeze([CHANNEL_DIR_R2I, CHANNEL_DIR_I2R] as const);

// ML-KEM-768 (FIPS 203) exact byte sizes — asserted, never assumed.
const KEM_PUBLICKEY_BYTES = 1184, KEM_SECRETKEY_BYTES = 2400, KEM_CIPHERTEXT_BYTES = 1088, KEM_SHAREDSECRET_BYTES = 32;
const KEM_SEED_BYTES = 64;          // ml_kem768.keygen requires a 64-byte seed
const NODE_SEED_BYTES = 32;         // the node identity seed (AUKORA_CHAIN_SIGNING_SEED) is 32 bytes / 64 hex
const AEAD_KEY_BYTES = 32, AEAD_NONCE_BYTES = 24, AEAD_SALT_BYTES = 32; // XChaCha20-Poly1305 key/nonce; 256-bit per-message salt

const HEX_LOWER = /^[0-9a-f]+$/;
/** True only under a test runner (vitest sets VITEST + NODE_ENV=test). Convex deployments run with neither → the
 *  `saltOverride` determinism seam is unreachable in production. */
const isTestEnv = (): boolean => process.env.NODE_ENV === "test" || !!process.env.VITEST;
const isHexLen = (s: unknown, hexChars: number): s is string => typeof s === "string" && s.length === hexChars && HEX_LOWER.test(s);
const isNodeSeedHex = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s.toLowerCase()) && s.length === NODE_SEED_BYTES * 2;
export const isChannelPublicKeyHex = (s: unknown): boolean => isHexLen(s, KEM_PUBLICKEY_BYTES * 2);
const isChannelCiphertextHex = (s: unknown): boolean => isHexLen(s, KEM_CIPHERTEXT_BYTES * 2);
const isSafeEpoch = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Canonical key-sorted JSON — deterministic preimage bytes (insertion order can never drift sign/verify or A-vs-B
 *  transcripts). Self-contained (NO import from a Convex module) so this stays a pure, cycle-free leaf. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DOOR 2 — epoch-keyed KEM keypair derivation. The channel keypair is HKDF-derived from the node identity seed + epoch.
// No new secret to manage, nothing persisted: the secret key is re-derivable from (node seed, epoch). Rotating the epoch
// rotates the keypair deterministically. STATIC-KEY HONESTY: this gives confidentiality-in-transit, NOT forward secrecy.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Derive the 64-byte ML-KEM seed for (node seed, epoch). THROWS on a bad seed/epoch (fail closed at the deriver). */
export function deriveChannelKemSeed(nodeSeedHex: string, epoch: number): Uint8Array {
  if (!isNodeSeedHex(nodeSeedHex)) throw new Error("aukora_channel_node_seed_invalid");
  if (!isSafeEpoch(epoch)) throw new Error("aukora_channel_epoch_invalid");
  const ikm = hexToBytes(nodeSeedHex.toLowerCase());
  try {
    return hkdf(sha256, ikm, utf8ToBytes("aukora-channel-kem-seed-v1"), utf8ToBytes(`${CHANNEL_KEM_ALG}:epoch:${epoch}`), KEM_SEED_BYTES);
  } finally {
    ikm.fill(0); // best-effort hygiene; GC-era copies are the accepted JS residual (PQC decision §7.3 class)
  }
}

/** Derive the channel KEM keypair (public key hex + raw secret key) for (node seed, epoch). The caller MUST zeroize the
 *  returned secretKey after decapsulation. The 64-byte KEM seed is zeroized here. */
export function deriveChannelKeypair(nodeSeedHex: string, epoch: number): { publicKeyHex: string; secretKey: Uint8Array } {
  const seed = deriveChannelKemSeed(nodeSeedHex, epoch);
  try {
    const { publicKey, secretKey } = ml_kem768.keygen(seed);
    if (publicKey.length !== KEM_PUBLICKEY_BYTES || secretKey.length !== KEM_SECRETKEY_BYTES) throw new Error("aukora_channel_kem_size");
    return { publicKeyHex: bytesToHex(publicKey), secretKey };
  } finally {
    seed.fill(0);
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SIGNED BINDING — binds peer identity + channel CAPABILITY + KEM public key + epoch into ML-DSA-65-signed bytes,
// under the dedicated `aukora-channel-v1` domain. Verified against the SAME identity public key pinned for the head.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ChannelBinding = {
  v: typeof CHANNEL_BINDING_V; kemAlg: typeof CHANNEL_KEM_ALG; nodeId: string; headKeyId: string;
  epoch: number; channelPublicKey: string; channelCapable: true;
};

/** Reconstruct the canonical binding from EXACTLY the bound fields (rejects extra-field injection — a verifier and a
 *  signer always preimage the same fixed shape). */
function canonicalBinding(input: { nodeId: string; headKeyId: string; epoch: number; channelPublicKeyHex: string }): ChannelBinding {
  return { v: CHANNEL_BINDING_V, kemAlg: CHANNEL_KEM_ALG, nodeId: input.nodeId, headKeyId: input.headKeyId, epoch: input.epoch, channelPublicKey: input.channelPublicKeyHex, channelCapable: true };
}
const bindingPreimage = (b: ChannelBinding): Uint8Array => utf8ToBytes(canonicalStringify(b));

/** Build + sign a channel-key binding with the node identity seed (ML-DSA-65 under `aukora-channel-v1`). Deterministic. */
export async function signChannelBinding(nodeSeedHex: string, input: { nodeId: string; headKeyId: string; epoch: number; channelPublicKeyHex: string }): Promise<{ binding: ChannelBinding; sig: string }> {
  if (!isChannelPublicKeyHex(input.channelPublicKeyHex)) throw new Error("aukora_channel_pubkey_invalid");
  if (!isSafeEpoch(input.epoch)) throw new Error("aukora_channel_epoch_invalid");
  const binding = canonicalBinding(input);
  const sig = await pqcSign(nodeSeedHex, bindingPreimage(binding), "aukoraChannel");
  return { binding, sig };
}

/** Verify a binding against the pinned node identity public key. Returns FALSE on ANY structural or signature failure
 *  (a refusal, never an exception) — including unknown version, wrong KEM alg, non-true capability, bad pubkey shape,
 *  malformed epoch. The preimage is rebuilt from the fixed field set, so an injected extra field can never be signed-over. */
export async function verifyChannelBinding(pinnedNodePublicKeyHex: string, binding: unknown, sigHex: string): Promise<boolean> {
  if (!binding || typeof binding !== "object") return false;
  const b = binding as Record<string, unknown>;
  if (b.v !== CHANNEL_BINDING_V || b.kemAlg !== CHANNEL_KEM_ALG || b.channelCapable !== true) return false;
  if (typeof b.nodeId !== "string" || typeof b.headKeyId !== "string") return false;
  if (!isSafeEpoch(b.epoch) || !isChannelPublicKeyHex(b.channelPublicKey)) return false;
  const canonical = canonicalBinding({ nodeId: b.nodeId, headKeyId: b.headKeyId, epoch: b.epoch as number, channelPublicKeyHex: b.channelPublicKey as string });
  return pqcVerify(pinnedNodePublicKeyHex, bindingPreimage(canonical), sigHex, "aukoraChannel");
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DOOR 3 — stateless per-request key establishment. The initiator (witness A) encapsulates to the pinned channel key;
// the responder (peer B) decapsulates with its epoch-derived secret key. A fresh secret per request → single-use AEAD key.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Initiator (A): encapsulate to the binding's channel public key. Fresh per call (ML-KEM uses CSPRNG). Returns the
 *  ciphertext (goes on the wire) + the shared secret (A holds it ephemerally; the caller zeroizes). */
export function channelEncapsulate(binding: { channelPublicKey: string }): { ctHex: string; sharedSecret: Uint8Array } {
  if (!binding || !isChannelPublicKeyHex(binding.channelPublicKey)) throw new Error("aukora_channel_pubkey_invalid");
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(binding.channelPublicKey));
  if (cipherText.length !== KEM_CIPHERTEXT_BYTES || sharedSecret.length !== KEM_SHAREDSECRET_BYTES) throw new Error("aukora_channel_kem_size");
  return { ctHex: bytesToHex(cipherText), sharedSecret };
}

/** Responder (B): decapsulate. FIPS 203 IMPLICIT REJECTION — a tampered ciphertext yields a different (random-looking)
 *  shared secret, NEVER a crash, so there is no decapsulation oracle. Malformed LENGTH is a fail-closed input refusal. */
export function channelDecapsulate(channelSecretKey: Uint8Array, ctHex: string): Uint8Array {
  if (!(channelSecretKey instanceof Uint8Array) || channelSecretKey.length !== KEM_SECRETKEY_BYTES) throw new Error("aukora_channel_secretkey_invalid");
  if (!isChannelCiphertextHex(ctHex)) throw new Error("aukora_channel_ciphertext_invalid");
  const ss = ml_kem768.decapsulate(hexToBytes(ctHex), channelSecretKey); // implicit rejection on wrong content (no throw)
  if (ss.length !== KEM_SHAREDSECRET_BYTES) throw new Error("aukora_channel_kem_size");
  return ss;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DOOR 4 — transcript binding + the AEAD leg. The transcript binds (version, identity, epoch, KEM pubkey, ciphertext)
// into the AAD; freshness rides the unique-per-encapsulation ciphertext (NO wall-clock). Both A and B derive it from
// the SAME public material. The AEAD key+nonce are HKDF-derived from the single-use secret → no nonce reuse possible.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ChannelTranscript = { bytes: Uint8Array; hashHex: string; epoch: number; ctHex: string };

export function channelTranscript(input: { nodeId: string; headKeyId: string; epoch: number; channelPublicKeyHex: string; ctHex: string }): ChannelTranscript {
  if (typeof input.nodeId !== "string" || typeof input.headKeyId !== "string") throw new Error("aukora_channel_transcript_ids");
  if (!isSafeEpoch(input.epoch) || !isChannelPublicKeyHex(input.channelPublicKeyHex) || !isChannelCiphertextHex(input.ctHex)) throw new Error("aukora_channel_transcript_fields");
  const fields = { v: CHANNEL_WIRE, kemAlg: CHANNEL_KEM_ALG, nodeId: input.nodeId, headKeyId: input.headKeyId, epoch: input.epoch, channelPublicKey: input.channelPublicKeyHex, ct: input.ctHex };
  const bytes = utf8ToBytes(canonicalStringify(fields));
  return { bytes, hashHex: bytesToHex(sha256(bytes)), epoch: input.epoch, ctHex: input.ctHex };
}

/** AEAD key+nonce from the shared secret. HKDF salt = a FRESH per-message random salt (so the (key,nonce) pair is
 *  unique to THIS seal even if a single-use secret is wrongly reused — the single-use contract is enforced by
 *  construction, not assumed). HKDF info binds the DIRECTION label + the transcript hash (the two legs never share key
 *  material; the transcript stays bound). */
function deriveAead(sharedSecret: Uint8Array, transcriptBytes: Uint8Array, salt: Uint8Array, direction: string): { key: Uint8Array; nonce: Uint8Array } {
  if (!(sharedSecret instanceof Uint8Array) || sharedSecret.length !== KEM_SHAREDSECRET_BYTES) throw new Error("aukora_channel_ss_invalid");
  if (!(salt instanceof Uint8Array) || salt.length !== AEAD_SALT_BYTES) throw new Error("aukora_channel_salt_invalid");
  if (!(CHANNEL_DIRECTIONS as readonly string[]).includes(direction)) throw new Error("aukora_channel_direction_invalid"); // closed enum — no free-string info injection
  const info = concatBytes(utf8ToBytes(`aukora-channel-v1:aead:${CHANNEL_AEAD}:dir:${direction}:`), sha256(transcriptBytes));
  const okm = hkdf(sha256, sharedSecret, salt, info, AEAD_KEY_BYTES + AEAD_NONCE_BYTES);
  return { key: okm.slice(0, AEAD_KEY_BYTES), nonce: okm.slice(AEAD_KEY_BYTES, AEAD_KEY_BYTES + AEAD_NONCE_BYTES) };
}

export type ChannelFrame = { wireVersion: typeof CHANNEL_WIRE; surface: typeof CHANNEL_SURFACE; kemAlg: typeof CHANNEL_KEM_ALG; direction: string; epoch: number; ctHex: string; saltHex: string; ciphertextHex: string };

/** Responder (B): seal the plaintext payload under the established secret + transcript, for a given directional leg.
 *  A FRESH random per-message salt is drawn (carried in the frame) so two seals can never collide on (key,nonce) — even
 *  if the same shared secret were reused. `saltOverride` exists ONLY for deterministic known-answer tests. AAD = the
 *  full transcript (anti-downgrade + freshness); the salt + direction are bound via the key derivation. */
export function sealFrame(sharedSecret: Uint8Array, transcript: ChannelTranscript, plaintext: Uint8Array, direction: string = CHANNEL_DIR_R2I, saltOverride?: Uint8Array): ChannelFrame {
  // PRODUCTION GUARD: `saltOverride` is a test-only determinism seam (the KAT needs a fixed salt). Outside a test runner
  // it is FORBIDDEN — so it can never be threaded into a LIVE seal to force salt (and thus key+nonce) reuse. A live caller
  // that ever passes it fails loud, never silently reuses a salt.
  if (saltOverride !== undefined && !isTestEnv()) throw new Error("aukora_channel_salt_override_forbidden");
  const salt = saltOverride ?? randomBytes(AEAD_SALT_BYTES);
  if (!(salt instanceof Uint8Array) || salt.length !== AEAD_SALT_BYTES) throw new Error("aukora_channel_salt_invalid");
  const { key, nonce } = deriveAead(sharedSecret, transcript.bytes, salt, direction);
  try {
    const ciphertext = xchacha20poly1305(key, nonce, transcript.bytes).encrypt(plaintext);
    return { wireVersion: CHANNEL_WIRE, surface: CHANNEL_SURFACE, kemAlg: CHANNEL_KEM_ALG, direction, epoch: transcript.epoch, ctHex: transcript.ctHex, saltHex: bytesToHex(salt), ciphertextHex: bytesToHex(ciphertext) };
  } finally {
    key.fill(0); nonce.fill(0);
  }
}

/**
 * Initiator (A): open a sealed frame. Returns the plaintext, or THROWS a SINGLE uniform `channel_refused` on ANY failure
 * — unratified wireVersion (anti-downgrade), structural mismatch, frame-not-bound-to-this-transcript, or an AEAD tag
 * failure (which is how a wrong shared secret from ML-KEM implicit rejection, a tampered ciphertext, or a mismatched AAD
 * all surface). No distinguishing error is ever returned → no decrypt oracle (DOOR 4). The transcript MUST be the one A
 * built from its OWN ciphertext + the PINNED (pubkey, epoch); a frame echoing different values fails the equality gate.
 */
export function openFrame(sharedSecret: Uint8Array, transcript: ChannelTranscript, frame: unknown, expectedDirection: string = CHANNEL_DIR_R2I): Uint8Array {
  try {
    if (!frame || typeof frame !== "object") throw new Error("x");
    const f = frame as Record<string, unknown>;
    if (!isAcceptedVersion(CHANNEL_SURFACE, f.wireVersion as string)) throw new Error("x"); // DOOR 1: registry-ratified only
    if (f.surface !== CHANNEL_SURFACE || f.kemAlg !== CHANNEL_KEM_ALG) throw new Error("x");
    if (f.direction !== expectedDirection) throw new Error("x");                              // the leg label A expects
    if (f.epoch !== transcript.epoch || f.ctHex !== transcript.ctHex) throw new Error("x");   // bound to A's own encapsulation
    const saltHex = f.saltHex;
    if (typeof saltHex !== "string" || saltHex.length !== AEAD_SALT_BYTES * 2 || !HEX_LOWER.test(saltHex)) throw new Error("x");
    const ctxt = f.ciphertextHex;
    if (typeof ctxt !== "string" || ctxt.length < 32 || ctxt.length % 2 !== 0 || !HEX_LOWER.test(ctxt)) throw new Error("x"); // ≥16B AEAD tag, even lowercase hex
    const { key, nonce } = deriveAead(sharedSecret, transcript.bytes, hexToBytes(saltHex), f.direction as string);
    try {
      return xchacha20poly1305(key, nonce, transcript.bytes).decrypt(hexToBytes(ctxt)); // throws on tag failure
    } finally {
      key.fill(0); nonce.fill(0);
    }
  } catch {
    throw new Error("channel_refused"); // uniform — no oracle
  }
}

/**
 * A durable AUDIT digest binding a witnessed observation to the exact channel frame it was delivered in. NOT a gate and
 * NOT a secret — it is sha256 over PUBLIC channel-delivery metadata (peer ids, epoch, the KEM ciphertext, the AEAD salt,
 * the wire version). `witnessRecordOpened` records it in the witness record/HWM so an auditor can later see that an
 * observation arrived via the ML-KEM channel (and under which frame), without trusting an unsigned boolean flag. The
 * shared secret is NEVER an input here (the digest is over the ciphertext + salt, which are already on the wire).
 */
export function channelProofDigest(meta: { peerNodeId: string; headKeyId: string; epoch: number; ctHex: string; saltHex: string; wireVersion: string }): string {
  const canon = canonicalStringify({ v: CHANNEL_WIRE, kemAlg: CHANNEL_KEM_ALG, peerNodeId: meta.peerNodeId, headKeyId: meta.headKeyId, epoch: meta.epoch, ct: meta.ctHex, salt: meta.saltHex, wireVersion: meta.wireVersion });
  return bytesToHex(sha256(utf8ToBytes(canon)));
}
