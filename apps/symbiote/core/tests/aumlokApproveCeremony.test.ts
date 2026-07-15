// #105b — the approve ceremony core. These tests only ever exercise REFUSAL paths that short-circuit BEFORE
// dispatchSignedLiveApply touches the live repo (its public entrypoint has no override and targets the real
// tree, exactly like the workbench apply tests). The success path — a real signature + real commit — is
// deliberately unreachable from a test: only the owner's live approval produces it.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { approveAndApplyProposal, aumlokKeyStatus } from '../src/aumlokApproveCeremony';
import { computeProposalHash } from '../src/proposalHash';
import { generateKeypair } from '../src/aumlokSigner';
import { recordRejectedDisposition } from '../src/proposalDispositionWrite';

let home: string;
const setup = () => { const h = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-approve-')); fs.mkdirSync(path.join(h, 'aumlok', 'pending-proposals'), { recursive: true }); return h; };
const HASH = 'b'.repeat(64);

describe('approveAndApplyProposal — fail-closed refusals (never reaches a live apply in tests)', () => {
  it('refuses an invalid proposal hash shape (no path/traversal, bare 64-hex only)', () => {
    home = setup();
    expect(approveAndApplyProposal('../../etc/passwd', 'n', { homeDir: home }).ok).toBe(false);
    expect(approveAndApplyProposal('short', 'n', { homeDir: home }).ok).toBe(false);
  });

  it('refuses a missing approval nonce', () => {
    home = setup();
    const r = approveAndApplyProposal(HASH, '', { homeDir: home });
    expect(r).toEqual({ ok: false, reason: 'missing approval nonce' });
  });

  it('refuses when the proposal artifact is not present', () => {
    home = setup();
    const r = approveAndApplyProposal(HASH, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not found');
  });

  const stageArtifact = (h: string, relPath: string) => {
    const artifact = { schema: 'self-edit-proposal-artifact-v1', goal: 'g', files: [{ relPath, content: 'hi\n' }], proposalHash: '', createdAt: new Date(0).toISOString() };
    artifact.proposalHash = computeProposalHash(artifact.goal, artifact.files);
    fs.writeFileSync(path.join(h, 'aumlok', 'pending-proposals', artifact.proposalHash + '.json'), JSON.stringify(artifact));
    return artifact.proposalHash;
  };

  it('refuses when no signing key is present (even with a valid proposal)', () => {
    home = setup();
    const hash = stageArtifact(home, 'docs/x.md'); // valid artifact loads, but NO key → refuse at key read
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toContain('key');
  });

  it('refuses a hash-mismatched (content-tampered) artifact — recomputed hash ≠ stored proposalHash, before any key read', () => {
    home = setup();
    const hash = stageArtifact(home, 'docs/x.md');
    // tamper the on-disk content so goal+files no longer hash to the filename/stored proposalHash
    const p = path.join(home, 'aumlok', 'pending-proposals', hash + '.json');
    const a = JSON.parse(fs.readFileSync(p, 'utf-8'));
    a.files[0].content = 'TAMPERED\n'; // proposalHash field unchanged → recompute mismatches
    fs.writeFileSync(p, JSON.stringify(a));
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toContain('not found or invalid');
  });

  it('refuses a swapped/renamed artifact — the file’s hash id ≠ the artifact’s own proposalHash', () => {
    home = setup();
    const realHash = stageArtifact(home, 'docs/x.md');
    // copy the valid artifact under a DIFFERENT (also-valid-shape) filename → readPendingProposalByHash cross-check fails
    const otherHash = 'c'.repeat(64);
    const src = path.join(home, 'aumlok', 'pending-proposals', realHash + '.json');
    fs.copyFileSync(src, path.join(home, 'aumlok', 'pending-proposals', otherHash + '.json'));
    const r = approveAndApplyProposal(otherHash, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toContain('not found or invalid');
  });

  it('refuses a rejected proposal before it reads the key or reaches live apply', () => {
    home = setup();
    const hash = stageArtifact(home, 'docs/x.md');
    expect(recordRejectedDisposition({ proposalHash: hash, decidedAt: '2026-07-10T00:00:00.000Z' }, home).ok).toBe(true);
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r).toEqual({ ok: false, reason: 'proposal already has terminal disposition: rejected' });
  });

  it('NEVER returns the PRIVATE KEY, even when it signs — a sacred target signs then apply refuses (no live write)', () => {
    home = setup();
    const kp = generateKeypair();
    fs.writeFileSync(path.join(home, 'aumlok', 'authority-ed25519.key'), kp.privateKeyHex, { mode: 0o600 });
    fs.chmodSync(path.join(home, 'aumlok', 'authority-ed25519.key'), 0o600);
    fs.writeFileSync(path.join(home, 'aumlok', 'authority-ed25519.pub'), kp.publicKeyHex);
    // a SACRED target: the key is read + a real signature is produced, but dispatchSignedLiveApply refuses
    // the sacred path before any write — so nothing lands, and we can inspect the (refusal) output.
    const hash = stageArtifact(home, 'authority/gate/leak-probe.ts');
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false); // sacred path refused at apply — no live commit
    expect(JSON.stringify(r)).not.toContain(kp.privateKeyHex); // the private key NEVER appears in the output
  });
});

describe('aumlokKeyStatus — existence only, never opens the key', () => {
  it('reports keyPresent false for an empty home, true when a key file exists', () => {
    home = setup();
    expect(aumlokKeyStatus(home).keyPresent).toBe(false);
    fs.writeFileSync(path.join(home, 'aumlok', 'authority-ed25519.key'), 'ab'.repeat(32), { mode: 0o600 });
    expect(aumlokKeyStatus(home).keyPresent).toBe(true);
  });
});
