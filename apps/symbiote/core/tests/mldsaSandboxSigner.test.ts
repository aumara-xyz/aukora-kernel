import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  generateLabSandboxKey, signSandboxPermit, verifySignedSandboxPermit, canonicalPermitPayload,
  keyFingerprint, signerStatus, type SignedSandboxPermit,
} from '../src/mldsaSandboxSigner';
import { applySignedSandboxPatch, validateSandboxApplyReceipt } from '../src/sandboxApply';

// 24Z.21 — REAL ML-DSA-65 sandbox signer (lab key). Sandbox-only. Live repo never touched.

const SEED = '07'.repeat(32);
const KEY = generateLabSandboxKey(SEED);
const DRAFT = crypto.createHash('sha256').update('a signed draft').digest('hex');
const NOW = '2026-06-22T12:00:00.000Z';
const sign = (over: Partial<Parameters<typeof signSandboxPermit>[0]> = {}) =>
  signSandboxPermit({ draftHash: DRAFT, nonce: 'n1', key: KEY, issuedAt: NOW, ...over });

describe('24Z.21: ML-DSA-65 signer (real crypto, lab key)', () => {
  it('signer mode is lab_mldsa_sandbox / ml-dsa-65, NOT production', () => {
    const s = signerStatus();
    expect(s.mode).toBe('lab_mldsa_sandbox');
    expect(s.alg).toBe('ml-dsa-65');
    expect(s.isRealSignature).toBe(true);
    expect(s.productionSigner).toBe(false);
  });
  it('deterministic lab keygen from a seed (stable fingerprint)', () => {
    expect(generateLabSandboxKey(SEED).publicKeyHex).toBe(KEY.publicKeyHex);
    expect(KEY.fingerprint).toBe(keyFingerprint(KEY.publicKeyHex));
  });
  it('a valid signed permit verifies (real ML-DSA signature)', () => {
    const r = verifySignedSandboxPermit(sign(), { draftHash: DRAFT, now: NOW });
    expect(r.valid).toBe(true);
    expect(r.signatureVerified).toBe(true);
  });
  it('the permit never carries the secret key', () => {
    expect(JSON.stringify(sign())).not.toMatch(/secretKey/i);
  });
});

describe('24Z.21: verification fails CLOSED', () => {
  it('rejects a tampered PAYLOAD (signature no longer matches)', () => {
    const p = sign();
    const evil: SignedSandboxPermit = { ...p, payload: { ...p.payload, draftHash: 'changed' } };
    const r = verifySignedSandboxPermit(evil, { draftHash: 'changed', now: NOW });
    expect(r.valid).toBe(false);
    expect(r.signatureVerified).toBe(false);
  });
  it('rejects a tampered SIGNATURE', () => {
    const p = sign();
    const bad = p.signatureHex.slice(0, -2) + (p.signatureHex.endsWith('00') ? '11' : '00');
    expect(verifySignedSandboxPermit({ ...p, signatureHex: bad }, { draftHash: DRAFT, now: NOW }).signatureVerified).toBe(false);
  });
  it('rejects the WRONG public key', () => {
    const p = sign();
    const other = generateLabSandboxKey('09'.repeat(32));
    const evil: SignedSandboxPermit = { ...p, signerPublicKeyHex: other.publicKeyHex, signerFingerprint: other.fingerprint };
    expect(verifySignedSandboxPermit(evil, { draftHash: DRAFT, now: NOW }).valid).toBe(false);
  });
  it('rejects an unpinned key when a specific signer is pinned', () => {
    expect(verifySignedSandboxPermit(sign(), { draftHash: DRAFT, now: NOW, expectedFingerprint: 'deadbeef'.repeat(4) }).valid).toBe(false);
  });
  it('rejects wrong draft hash, expiry, and a scope/canApplyLive tamper', () => {
    expect(verifySignedSandboxPermit(sign(), { draftHash: 'other', now: NOW }).valid).toBe(false);
    const later = new Date(new Date(NOW).getTime() + 10 * 60 * 1000).toISOString();
    expect(verifySignedSandboxPermit(sign({ ttlMs: 1000 }), { draftHash: DRAFT, now: later }).valid).toBe(false);
    const p = sign();
    expect(verifySignedSandboxPermit({ ...p, payload: { ...p.payload, canApplyLive: true as unknown as false } }, { draftHash: DRAFT, now: NOW }).valid).toBe(false);
    expect(verifySignedSandboxPermit({ ...p, payload: { ...p.payload, scope: 'live' as unknown as 'sandbox_only' } }, { draftHash: DRAFT, now: NOW }).valid).toBe(false);
  });
});

describe('24Z.21: signed sandbox apply (temp-only; live repo untouched)', () => {
  it('a verified signed permit applies a patch to a temp copy; receipt proves the signature', () => {
    const res = applySignedSandboxPatch({ signedPermit: sign(), draftHash: DRAFT, files: [{ relPath: 'drafts/x.md', content: 'hi' }], now: NOW, engineSource: 'local_planner' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.mode).toBe('lab_mldsa_sandbox');
    expect(res.receipt.signatureVerified).toBe(true);
    expect(res.receipt.signerFingerprint).toBe(KEY.fingerprint);
    expect(res.receipt.appliedLive).toBe(false);
    expect(res.receipt.liveRepoUnchanged).toBe(true);
    expect(res.receipt.signatureHash).toBeTruthy();
    expect(validateSandboxApplyReceipt(res.receipt).valid).toBe(true);
  });
  it('REFUSES an unsigned/forged permit (fails closed, writes nothing)', () => {
    const p = sign();
    const forged: SignedSandboxPermit = { ...p, signatureHex: '00'.repeat(p.signatureHex.length / 2) };
    const res = applySignedSandboxPatch({ signedPermit: forged, draftHash: DRAFT, files: [{ relPath: 'x.md', content: 'y' }], now: NOW });
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.appliedLive).toBe(false); expect(res.liveRepoUnchanged).toBe(true); }
  });
  it('REFUSES a sacred/Ring-0 file path even with a valid signature', () => {
    const res = applySignedSandboxPatch({ signedPermit: sign(), draftHash: DRAFT, files: [{ relPath: 'convex/aukora_kill_switch.ts', content: 'x' }], now: NOW });
    expect(res.ok).toBe(false);
  });
  it('honors a bound permittedRelPaths allowlist (a file outside it is refused)', () => {
    const permit = sign({ permittedRelPaths: ['drafts/allowed.md'] });
    expect(applySignedSandboxPatch({ signedPermit: permit, draftHash: DRAFT, files: [{ relPath: 'drafts/allowed.md', content: 'a' }], now: NOW }).ok).toBe(true);
    expect(applySignedSandboxPatch({ signedPermit: permit, draftHash: DRAFT, files: [{ relPath: 'drafts/other.md', content: 'b' }], now: NOW }).ok).toBe(false);
  });
  it('the LIVE repo is unchanged after a signed apply (this file keeps its hash)', () => {
    const live = path.resolve(__dirname, '..', 'src', 'mldsaSandboxSigner.ts');
    const before = crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
    applySignedSandboxPatch({ signedPermit: sign(), draftHash: DRAFT, files: [{ relPath: 'src/mldsaSandboxSigner.ts', content: 'HIJACK' }], now: NOW });
    expect(crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex')).toBe(before);
  });
  it('the receipt validator rejects a lab-mode receipt that lacks a verified signature', () => {
    const res = applySignedSandboxPatch({ signedPermit: sign(), draftHash: DRAFT, files: [{ relPath: 'd.md', content: 'c' }], now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateSandboxApplyReceipt({ ...res.receipt, signatureVerified: false as unknown as true }).valid).toBe(false);
  });
  it('source uses the real noble ML-DSA primitive (not a homemade signature) + never stores the secret key', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'mldsaSandboxSigner.ts'), 'utf-8');
    expect(src).toMatch(/@noble\/post-quantum\/ml-dsa/);
    expect(src).toMatch(/ml_dsa65\.(sign|verify)/);
  });
});
