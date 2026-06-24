// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { describe, expect, test } from "vitest";
import {
  appendArtifactReceipt,
  signArtifactChainHead,
  verifyArtifactCustodyChain,
  ARTIFACT_CUSTODY_DOMAIN,
  ARTIFACT_RECEIPT_TYPE,
  type ArtifactDescriptor,
  type ArtifactReceipt,
  type ArtifactReceiptInput,
} from "../convex/aukoraArtifactCustody";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";

const SEED = "42".repeat(32);
const OTHER_SEED = "43".repeat(32);

const v1: ArtifactReceiptInput = {
  content: "Aukora artifact custody demo\nversion: one\n",
  descriptor: {
    artifactId: "doc:demo:trust-layer",
    version: "1",
    kind: "document",
    mediaType: "text/plain",
    authorKeyId: "lab-root",
    metadata: { title: "Trust layer note", custodyClass: "public-demo" },
  },
};

const v2: ArtifactReceiptInput = {
  content: "Aukora artifact custody demo\nversion: two\n",
  descriptor: {
    artifactId: "doc:demo:trust-layer",
    version: "2",
    kind: "document",
    mediaType: "text/plain",
    authorKeyId: "lab-root",
    metadata: { title: "Trust layer note", custodyClass: "public-demo" },
  },
};

async function fixture() {
  const receipts: ArtifactReceipt[] = [];
  receipts.push(appendArtifactReceipt(receipts, v1));
  receipts.push(appendArtifactReceipt(receipts, v2));
  const head = await signArtifactChainHead({ seedHex: SEED, chainKey: "artifact:doc:demo:trust-layer", receipts, timestamp: 123456 });
  const publicKeyHex = await mlDsa65PublicKeyFromSeed(SEED);
  const entries = [
    { ...v1, receipt: receipts[0] },
    { ...v2, receipt: receipts[1] },
  ];
  return { entries, head, publicKeyHex };
}

describe("artifact custody receipts", () => {
  test("verifies an unmodified two-version artifact chain", async () => {
    const { entries, head, publicKeyHex } = await fixture();
    const result = await verifyArtifactCustodyChain({ publicKeyHex, chainKey: head.chainKey, entries, head });
    expect(result).toEqual({ ok: true, status: "verified", grantsAuthority: false });
    expect(head.headSigAlg).toBe("ml-dsa-65-chainhead-v4");
    expect(head.grantsAuthority).toBe(false);
    expect(entries[0].receipt.payload.domain).toBe(ARTIFACT_CUSTODY_DOMAIN);
    expect(entries[0].receipt.payload.receiptType).toBe(ARTIFACT_RECEIPT_TYPE);
    expect(entries[0].receipt.payload.grantsAuthority).toBe(false);
  });

  test("fails closed when one byte of artifact content changes", async () => {
    const { entries, head, publicKeyHex } = await fixture();
    const tampered = entries.map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1], content: "Aukora artifact custody demo\nversion: two!" };
    const result = await verifyArtifactCustodyChain({ publicKeyHex, chainKey: head.chainKey, entries: tampered, head });
    expect(result).toEqual({ ok: false, status: "content_mismatch", grantsAuthority: false });
  });

  test("fails closed when artifact metadata is rewritten", async () => {
    const { entries, head, publicKeyHex } = await fixture();
    const descriptor: ArtifactDescriptor = {
      ...entries[0].descriptor,
      metadata: { ...entries[0].descriptor.metadata, title: "Rewritten title" },
    };
    const tampered = [{ ...entries[0], descriptor }, entries[1]];
    const result = await verifyArtifactCustodyChain({ publicKeyHex, chainKey: head.chainKey, entries: tampered, head });
    expect(result).toEqual({ ok: false, status: "metadata_mismatch", grantsAuthority: false });
  });

  test("fails closed when receipt rows are reordered", async () => {
    const { entries, head, publicKeyHex } = await fixture();
    const result = await verifyArtifactCustodyChain({ publicKeyHex, chainKey: head.chainKey, entries: [entries[1], entries[0]], head });
    expect(result).toEqual({ ok: false, status: "seq_mismatch", grantsAuthority: false });
  });

  test("fails closed when the log is truncated under a longer signed head", async () => {
    const { entries, head, publicKeyHex } = await fixture();
    const result = await verifyArtifactCustodyChain({ publicKeyHex, chainKey: head.chainKey, entries: [entries[0]], head });
    expect(result).toEqual({ ok: false, status: "chain_length_mismatch", grantsAuthority: false });
  });

  test("fails closed under the wrong signing key", async () => {
    const { entries, head } = await fixture();
    const wrongPublicKeyHex = await mlDsa65PublicKeyFromSeed(OTHER_SEED);
    const result = await verifyArtifactCustodyChain({ publicKeyHex: wrongPublicKeyHex, chainKey: head.chainKey, entries, head });
    expect(result).toEqual({ ok: false, status: "signature_invalid", grantsAuthority: false });
  });

  test("domain separation refuses action-shaped receipt confusion", async () => {
    const { entries, head, publicKeyHex } = await fixture();
    const confused = entries.map((e) => ({ ...e, receipt: { ...e.receipt, payload: { ...e.receipt.payload } } }));
    (confused[0].receipt.payload as any).receiptType = "action_receipt_v1";
    const result = await verifyArtifactCustodyChain({ publicKeyHex, chainKey: head.chainKey, entries: confused, head });
    expect(result).toEqual({ ok: false, status: "metadata_mismatch", grantsAuthority: false });
  });
});
