import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildAumlokStatusSnapshot } from '../src/aumlokStatusSnapshot';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('aumlokStatusSnapshot: honest state, no secrets', () => {
  it('reports absent key/root honestly when nothing exists yet', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-aumlok-status-'));
    const s = buildAumlokStatusSnapshot({ homeDir: dir, repoRoot: REPO_ROOT });
    expect(s.keyPresent).toBe(false);
    expect(s.publicRootPinned).toBe(false);
    expect(s.keyId).toBeNull();
    expect(s.rehearsalReceiptCount).toBe(0);
    expect(s.latestRehearsalReceipt).toBeNull();
    expect(s.livePromotionUnlocked).toBe(false);
    expect(s.advisoryOnly).toBe(true);
    expect(s.grantsAuthority).toBe(false);
    expect(s.signedLiveApplyLaneBuilt).toBe(true);
    expect(s.appliedProposalCount).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a real applied-proposal count from the ledger, without ever exposing raw commit/repo paths', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-aumlok-status-'));
    fs.mkdirSync(path.join(dir, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'aumlok', 'applied-ledger.json'), JSON.stringify([
      { proposalHash: 'a'.repeat(64), appliedAt: '2026-01-01T00:00:00.000Z', commitSha: 'b'.repeat(40) },
      { proposalHash: 'c'.repeat(64), appliedAt: '2026-01-02T00:00:00.000Z', commitSha: 'd'.repeat(40) },
    ]));
    const s = buildAumlokStatusSnapshot({ homeDir: dir, repoRoot: REPO_ROOT });
    expect(s.appliedProposalCount).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never includes private key bytes even if a key file exists', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-aumlok-status-'));
    fs.mkdirSync(path.join(dir, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'aumlok', 'authority-ed25519.key'), 'deadbeef'.repeat(8), { mode: 0o600 });
    const s = buildAumlokStatusSnapshot({ homeDir: dir, repoRoot: REPO_ROOT });
    expect(s.keyPresent).toBe(true);
    const json = JSON.stringify(s);
    expect(json).not.toContain('deadbeef'.repeat(8));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects a pinned public root manifest (public key only, safe to display)', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-aumlok-status-'));
    fs.mkdirSync(path.join(dir, 'aumlok'), { recursive: true });
    const root = pinAuthorityRoot('a'.repeat(64));
    fs.writeFileSync(path.join(dir, 'aumlok', 'authority-root.json'), serializeRootManifest(root));
    const s = buildAumlokStatusSnapshot({ homeDir: dir, repoRoot: REPO_ROOT });
    expect(s.publicRootPinned).toBe(true);
    expect(s.keyId).toBe(root.keyId);
    expect(s.publicRootRevoked).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a tampered manifest (integrity check) rather than reporting it as pinned', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-aumlok-status-'));
    fs.mkdirSync(path.join(dir, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'aumlok', 'authority-root.json'), JSON.stringify({ schema: 'aumlok-authority-root-v1', keyId: 'x', integrity: 'wrong' }));
    const s = buildAumlokStatusSnapshot({ homeDir: dir, repoRoot: REPO_ROOT });
    expect(s.publicRootPinned).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('confirms the signer/verifier split is intact against the real repo source', () => {
    const s = buildAumlokStatusSnapshot({ homeDir: fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-aumlok-status-')), repoRoot: REPO_ROOT });
    expect(s.signerVerifierSplitIntact).toBe(true);
  });

  it('livePromotionUnlocked is always literally false regardless of any input', () => {
    const s = buildAumlokStatusSnapshot({ homeDir: '/does/not/exist', repoRoot: REPO_ROOT });
    expect(s.livePromotionUnlocked).toBe(false);
  });
});
