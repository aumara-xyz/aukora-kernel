// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * TEST-ONLY legacy fixture — NOT live code. The B1.3b hard cutover removed Ed25519/SignedChainHeadV2 from the
 * kernel; this fixture re-creates the retired V2 format so the suite can keep PROVING the no-silent-dual-mode
 * property: genuine V2 material must REFUSE through every V3 path, forever. @noble/ed25519 is a devDependency
 * reachable only from tests. Layout replicated from the retired serializeSignedChainHeadV2 (RFC 6962
 * TreeHeadSignature shape): [0]=0x00 version, [1]=0x02 chain_hash sig_type, [2..17] chain_id, [18..25] ts u64BE,
 * [26..33] length u64BE, [34..65] head hash.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { deriveChainId, type ChainHeadFields } from "../convex/aukoraSignedHead";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));
ed.etc.sha512Async = (...m: Uint8Array[]) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

export const SIGNED_HEAD_V2_ALG = "ed25519-chainhead-v2"; // the retired tag, byte-identical to history

function writeU64BE(buf: Uint8Array, off: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`legacy_v2_u64_range:${value}`);
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  buf[off] = (high >>> 24) & 0xff; buf[off + 1] = (high >>> 16) & 0xff; buf[off + 2] = (high >>> 8) & 0xff; buf[off + 3] = high & 0xff;
  buf[off + 4] = (low >>> 24) & 0xff; buf[off + 5] = (low >>> 16) & 0xff; buf[off + 6] = (low >>> 8) & 0xff; buf[off + 7] = low & 0xff;
}

export function serializeSignedChainHeadV2(h: ChainHeadFields): Uint8Array {
  const buf = new Uint8Array(66);
  buf[0] = 0x00; // V2 version byte
  buf[1] = 0x02; // V2 sig_type chain_hash
  buf.set(deriveChainId(h.chainKey), 2);
  writeU64BE(buf, 18, h.timestamp);
  writeU64BE(buf, 26, h.chainLength);
  const hh = hexToBytes(h.chainHeadHash);
  if (hh.length !== 32) throw new Error(`legacy_v2_chain_hash_len:${hh.length}`);
  buf.set(hh, 34);
  return buf;
}

export async function ed25519PublicKeyFromSeedV2(seedHex: string): Promise<string> {
  return bytesToHex(await ed.getPublicKeyAsync(hexToBytes(seedHex)));
}

export async function signChainHeadV2(seedHex: string, h: ChainHeadFields): Promise<string> {
  return bytesToHex(await ed.signAsync(serializeSignedChainHeadV2(h), hexToBytes(seedHex)));
}

export async function verifyChainHeadV2(publicKeyHex: string, h: ChainHeadFields, sigHex: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(hexToBytes(sigHex), serializeSignedChainHeadV2(h), hexToBytes(publicKeyHex), { zip215: false });
  } catch {
    return false;
  }
}
