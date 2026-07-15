import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateLabBuilderKey, signManifest, verifyManifest, fingerprint } from '../src/manifestSigner';
import { canonicalManifestPayload } from '../src/manifestCanonical';

// 24Z.35 — builder-origin signature tamper suite. Hermetic: an ephemeral keypair per run; no committed key needed.
const key = generateLabBuilderKey();
const fp = fingerprint(key.publicKeyHex);
const baseManifest = {
  schema: 'runtime-truth-manifest-v0', gitHead: 'abc1234', generatedAt: '2026-06-23T00:00:00.000Z',
  structuredTruth: { liveApplyBuilt: false, openCodeStatus: 'parked_partial', counts: [1, 2, 3], nested: { a: true, b: 'x' } },
  organs: ['x'], summaryText: 'unsigned-subset-field',   // NOT in SIGNED_FIELDS → changing it must NOT break verification
};

describe('24Z.35 builder-origin signature (tamper suite)', () => {
  it('an honest manifest verifies (pinned to the builder fingerprint)', () => {
    const sig = signManifest(baseManifest, key);
    expect(sig.mode).toBe('lab_builder_manifest');
    expect(sig.grantsAuthority).toBe(false);
    expect(verifyManifest(baseManifest, sig, fp).verified).toBe(true);
  });
  it('changing a structuredTruth field BREAKS verification', () => {
    const sig = signManifest(baseManifest, key);
    expect(verifyManifest({ ...baseManifest, structuredTruth: { ...baseManifest.structuredTruth, liveApplyBuilt: true } }, sig, fp).verified).toBe(false);
  });
  it('changing schema/version or gitHead or generatedAt BREAKS verification', () => {
    const sig = signManifest(baseManifest, key);
    expect(verifyManifest({ ...baseManifest, schema: 'evil-v1' }, sig, fp).verified).toBe(false);
    expect(verifyManifest({ ...baseManifest, gitHead: 'deadbeef' }, sig, fp).verified).toBe(false);
    expect(verifyManifest({ ...baseManifest, generatedAt: '2099-01-01T00:00:00.000Z' }, sig, fp).verified).toBe(false);
  });
  it('REORDERING JSON keys does NOT break verification (semantic canonicalization)', () => {
    const sig = signManifest(baseManifest, key);
    const reordered = { summaryText: baseManifest.summaryText, organs: baseManifest.organs, generatedAt: baseManifest.generatedAt, structuredTruth: { nested: { b: 'x', a: true }, counts: [1, 2, 3], openCodeStatus: 'parked_partial', liveApplyBuilt: false }, gitHead: baseManifest.gitHead, schema: baseManifest.schema };
    expect(verifyManifest(reordered, sig, fp).verified).toBe(true);
  });
  it('two semantically identical manifests produce the SAME canonical payload', () => {
    const a = canonicalManifestPayload(baseManifest);
    const b = canonicalManifestPayload({ generatedAt: baseManifest.generatedAt, schema: baseManifest.schema, gitHead: baseManifest.gitHead, structuredTruth: { nested: { b: 'x', a: true }, counts: [1, 2, 3], liveApplyBuilt: false, openCodeStatus: 'parked_partial' } });
    expect(a).toBe(b);
  });
  it('changing an UNSIGNED-subset field (summaryText/organs) does NOT break verification', () => {
    const sig = signManifest(baseManifest, key);
    expect(verifyManifest({ ...baseManifest, summaryText: 'changed', organs: ['y', 'z'] }, sig, fp).verified).toBe(true);
  });
  it('a MISSING signature fails closed', () => {
    expect(verifyManifest(baseManifest, undefined, fp).verified).toBe(false);
    expect(verifyManifest(baseManifest, null, fp).verified).toBe(false);
  });
  it('a FORGED signature does not verify', () => {
    const sig = signManifest(baseManifest, key);
    const forged = { ...sig, signatureHex: 'ab'.repeat(32) };
    expect(verifyManifest(baseManifest, forged, fp).verified).toBe(false);
  });
  it('a fingerprint MISMATCH (attacker-swapped key) does not verify', () => {
    const other = generateLabBuilderKey();
    const sig = signManifest(baseManifest, other);     // signed by a different key, re-fingerprinted to itself
    expect(verifyManifest(baseManifest, sig, fp).verified).toBe(false);   // pinned to `fp` → rejected
  });
});

describe('24Z.35 manifestCanonical mirror', () => {
  it('the canonical module is byte-identical in edge and tauri', () => {
    const edge = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'manifestCanonical.ts'), 'utf-8');
    const tauri = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tauri-womb', 'src', 'lib', 'manifestCanonical.ts'), 'utf-8');
    expect(edge).toBe(tauri);
  });
});
