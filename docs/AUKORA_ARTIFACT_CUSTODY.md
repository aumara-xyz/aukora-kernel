# Aukora Artifact Custody

> Verifiable custody for documents, media, exports, source files, and model outputs.

The Aukora kernel already proves governed agent effects with post-quantum signed receipts. Artifact custody extends the
same evidence spine to arbitrary digital payloads. A file does not need to be a code diff or an agent action: if it has
bytes, the kernel can hash it, chain it, sign it, and later prove whether the presented bytes still match the signed
history.

## What This Solves

AI makes digital state cheap to create and easy to mutate. Soon the hard question is not "can a model write this?" but
"who authorized this state, what exact bytes existed, and did anyone alter the history?" Aukora answers that question
with receipts.

Artifact custody is a headless primitive for:

- contracts and PDFs
- database or ledger exports
- source files and release artifacts
- research records and lab notes
- model outputs and generated media
- social/content attestations

It is **tamper-evident**, not tamper-proof. It proves the presented bytes match the signed custody chain. It does not
prove the content is true, legal, safe, original, or globally final.

## Flow

1. **Ingest bytes**: hash the artifact content with SHA-256.
2. **Bind metadata**: attach an artifact id, version, kind, media type, author key id, and small typed metadata.
3. **Domain separate**: mark the payload as `AUKORA-ARTIFACT/1` + `artifact_custody_v1` so it cannot be confused with an
   action receipt.
4. **Chain**: compute a receipt chain hash from `(previousHash, payload)`.
5. **Commit history**: compute the RFC 6962 receipt-history root over the ordered receipt hashes.
6. **Sign head**: sign the chain head with ML-DSA-65 using the existing SignedChainHeadV4 spine.
7. **Verify**: recompute content hash, metadata, chain order, Merkle root, and signature. Any mismatch fails closed.

## What Fails

The test suite proves these failures:

- one-byte content change -> `content_mismatch`
- metadata rewrite -> `metadata_mismatch`
- row reorder -> `seq_mismatch`
- truncation under a longer signed head -> `chain_length_mismatch`
- wrong signer -> `signature_invalid`
- action/document type confusion -> refused by domain separation

Run it:

```bash
npx vitest run tests/artifactCustody.test.ts
```

## What It Is Not

Artifact custody is not a cryptocurrency, token, notarization monopoly, consensus network, or truth oracle. It does not
say "this document is correct." It says:

> These exact bytes, with this metadata, appeared in this exact custody chain, under this signing key, and the chain
> still verifies.

That is enough to become a foundation for a verifiable web: AI actions, human approvals, documents, media, datasets, and
social content can all carry independently re-checkable custody evidence.

## Public Primitive

- Implementation: [`../convex/aukoraArtifactCustody.ts`](../convex/aukoraArtifactCustody.ts)
- Tests: [`../tests/artifactCustody.test.ts`](../tests/artifactCustody.test.ts)

The primitive is pure TypeScript and performs no file IO. Integrations can wrap it with PDF readers, upload handlers,
browser extensions, database export tools, IDE adapters, or social/content workflows without changing the cryptographic
core.
