// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * AUKORA ARTIFACT CUSTODY V1
 *
 * Headless, document-agnostic custody receipts over arbitrary digital payloads.
 * This module is evidence-only: it hashes bytes, chains receipts, signs the chain
 * head, and verifies that the presented bytes still match the signed history.
 * It grants no authority and performs no file IO.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { receiptHistoryRootHex } from "./aukoraMerkleLog";
import { signChainHeadV4, verifyChainHeadV4, SIGNED_HEAD_V4_ALG, type ChainHeadFields } from "./aukoraSignedHead";

export const ARTIFACT_CUSTODY_DOMAIN = "AUKORA-ARTIFACT/1" as const;
export const ARTIFACT_RECEIPT_TYPE = "artifact_custody_v1" as const;

const enc = new TextEncoder();
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export type ArtifactKind = "document" | "media" | "code" | "database_export" | "model_output" | "other";
export type ArtifactMetadataValue = string | number | boolean | null;

export type ArtifactDescriptor = {
  artifactId: string;
  version: string;
  kind: ArtifactKind;
  mediaType?: string;
  authorKeyId?: string;
  metadata?: Record<string, ArtifactMetadataValue>;
};

export type ArtifactReceiptPayload = {
  domain: typeof ARTIFACT_CUSTODY_DOMAIN;
  receiptType: typeof ARTIFACT_RECEIPT_TYPE;
  artifactId: string;
  version: string;
  kind: ArtifactKind;
  contentHash: string;
  contentLength: number;
  mediaType?: string;
  authorKeyId?: string;
  metadata: Record<string, ArtifactMetadataValue>;
  grantsAuthority: false;
};

export type ArtifactReceipt = {
  seq: number;
  prevHash: string | null;
  chainHash: string;
  payload: ArtifactReceiptPayload;
};

export type ArtifactChainHead = {
  chainKey: string;
  timestamp: number;
  chainLength: number;
  chainHeadHash: string;
  receiptLogRoot: string;
  headSig: string;
  headSigAlg: typeof SIGNED_HEAD_V4_ALG;
  grantsAuthority: false;
};

export type ArtifactReceiptInput = {
  descriptor: ArtifactDescriptor;
  content: string | Uint8Array;
};

export type ArtifactReceiptVerificationEntry = ArtifactReceiptInput & {
  receipt: ArtifactReceipt;
};

export type ArtifactVerifyStatus =
  | "verified"
  | "empty_chain"
  | "chain_key_mismatch"
  | "chain_length_mismatch"
  | "seq_mismatch"
  | "prev_hash_mismatch"
  | "content_mismatch"
  | "metadata_mismatch"
  | "chain_hash_mismatch"
  | "head_hash_mismatch"
  | "log_root_mismatch"
  | "signature_invalid"
  | "malformed";

export type ArtifactVerifyResult = {
  ok: boolean;
  status: ArtifactVerifyStatus;
  grantsAuthority: false;
};

function bytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? enc.encode(input) : input.slice();
}

function sha256Hex(input: Uint8Array): string {
  return bytesToHex(sha256(input));
}

function assertLabel(name: string, value: string, max = 160): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !PRINTABLE_ASCII.test(value)) {
    throw new Error(`aukora_artifact_bad_${name}`);
  }
  return value;
}

function assertMetadataValue(k: string, v: ArtifactMetadataValue): ArtifactMetadataValue {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`aukora_artifact_bad_metadata_value:${k}`);
    return v;
  }
  if (typeof v === "string") return assertLabel(`metadata_value:${k}`, v, 512);
  throw new Error(`aukora_artifact_bad_metadata_value:${k}`);
}

function normalizeMetadata(metadata: ArtifactDescriptor["metadata"]): Record<string, ArtifactMetadataValue> {
  const out: Record<string, ArtifactMetadataValue> = {};
  for (const [k, v] of Object.entries(metadata ?? {})) {
    const key = assertLabel("metadata_key", k, 80);
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("aukora_artifact_bad_metadata_key");
    out[key] = assertMetadataValue(key, v);
  }
  return out;
}

function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("aukora_artifact_nonfinite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
  }
  throw new Error("aukora_artifact_uncanonical_value");
}

function sameStable(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

export function artifactContentHash(content: string | Uint8Array): string {
  return sha256Hex(bytes(content));
}

export function buildArtifactReceiptPayload(input: ArtifactReceiptInput): ArtifactReceiptPayload {
  const contentBytes = bytes(input.content);
  const d = input.descriptor;
  return {
    domain: ARTIFACT_CUSTODY_DOMAIN,
    receiptType: ARTIFACT_RECEIPT_TYPE,
    artifactId: assertLabel("artifactId", d.artifactId),
    version: assertLabel("version", d.version, 80),
    kind: d.kind,
    contentHash: sha256Hex(contentBytes),
    contentLength: contentBytes.length,
    ...(d.mediaType ? { mediaType: assertLabel("mediaType", d.mediaType, 120) } : {}),
    ...(d.authorKeyId ? { authorKeyId: assertLabel("authorKeyId", d.authorKeyId, 160) } : {}),
    metadata: normalizeMetadata(d.metadata),
    grantsAuthority: false,
  };
}

export function artifactReceiptChainHash(payload: ArtifactReceiptPayload, prevHash: string | null): string {
  if (prevHash !== null && !HEX_64.test(prevHash)) throw new Error("aukora_artifact_prev_hash_invalid");
  return sha256Hex(enc.encode(stable({ domain: ARTIFACT_CUSTODY_DOMAIN, payload, prevHash })));
}

export function appendArtifactReceipt(previous: ArtifactReceipt[], input: ArtifactReceiptInput): ArtifactReceipt {
  const prevHash = previous.length ? previous[previous.length - 1].chainHash : null;
  const payload = buildArtifactReceiptPayload(input);
  return {
    seq: previous.length + 1,
    prevHash,
    chainHash: artifactReceiptChainHash(payload, prevHash),
    payload,
  };
}

export async function signArtifactChainHead(args: {
  seedHex: string;
  chainKey: string;
  receipts: ArtifactReceipt[];
  timestamp?: number;
}): Promise<ArtifactChainHead> {
  if (args.receipts.length === 0) throw new Error("aukora_artifact_empty_chain");
  const chainHeadHash = args.receipts[args.receipts.length - 1].chainHash;
  const receiptLogRoot = receiptHistoryRootHex(args.receipts.map((r) => r.chainHash));
  const fields: ChainHeadFields = {
    chainKey: assertLabel("chainKey", args.chainKey, 180),
    timestamp: args.timestamp ?? Date.now(),
    chainLength: args.receipts.length,
    chainHeadHash,
  };
  return {
    ...fields,
    receiptLogRoot,
    headSig: await signChainHeadV4(args.seedHex, fields, receiptLogRoot, "chainHead"),
    headSigAlg: SIGNED_HEAD_V4_ALG,
    grantsAuthority: false,
  };
}

export async function verifyArtifactCustodyChain(args: {
  publicKeyHex: string;
  chainKey: string;
  entries: ArtifactReceiptVerificationEntry[];
  head: ArtifactChainHead;
}): Promise<ArtifactVerifyResult> {
  try {
    const { entries, head } = args;
    if (entries.length === 0) return { ok: false, status: "empty_chain", grantsAuthority: false };
    if (head.chainKey !== args.chainKey) return { ok: false, status: "chain_key_mismatch", grantsAuthority: false };
    if (head.chainLength !== entries.length) return { ok: false, status: "chain_length_mismatch", grantsAuthority: false };

    let prev: string | null = null;
    const chainHashes: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const { receipt, content, descriptor } = entries[i];
      if (receipt.seq !== i + 1) return { ok: false, status: "seq_mismatch", grantsAuthority: false };
      if (receipt.prevHash !== prev) return { ok: false, status: "prev_hash_mismatch", grantsAuthority: false };

      const expectedPayload = buildArtifactReceiptPayload({ content, descriptor });
      if (receipt.payload.contentHash !== expectedPayload.contentHash || receipt.payload.contentLength !== expectedPayload.contentLength) {
        return { ok: false, status: "content_mismatch", grantsAuthority: false };
      }
      if (!sameStable(receipt.payload, expectedPayload)) return { ok: false, status: "metadata_mismatch", grantsAuthority: false };

      const expectedHash = artifactReceiptChainHash(receipt.payload, prev);
      if (receipt.chainHash !== expectedHash) return { ok: false, status: "chain_hash_mismatch", grantsAuthority: false };
      chainHashes.push(receipt.chainHash);
      prev = receipt.chainHash;
    }

    const chainHeadHash = chainHashes[chainHashes.length - 1];
    if (head.chainHeadHash !== chainHeadHash) return { ok: false, status: "head_hash_mismatch", grantsAuthority: false };

    const receiptLogRoot = receiptHistoryRootHex(chainHashes);
    if (head.receiptLogRoot !== receiptLogRoot) return { ok: false, status: "log_root_mismatch", grantsAuthority: false };

    const signedFields: ChainHeadFields = {
      chainKey: head.chainKey,
      timestamp: head.timestamp,
      chainLength: head.chainLength,
      chainHeadHash: head.chainHeadHash,
    };
    const sigOk = await verifyChainHeadV4(args.publicKeyHex, signedFields, head.receiptLogRoot, head.headSig, "chainHead");
    return sigOk
      ? { ok: true, status: "verified", grantsAuthority: false }
      : { ok: false, status: "signature_invalid", grantsAuthority: false };
  } catch {
    return { ok: false, status: "malformed", grantsAuthority: false };
  }
}
