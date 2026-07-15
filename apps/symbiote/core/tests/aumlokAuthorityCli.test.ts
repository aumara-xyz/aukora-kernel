// AUMLOK terminal CLI (scripts/aumlok-authority.sh) — end-to-end proof, not just static source-pattern
// checks. Spawns the REAL script against a throwaway AUKORA_SYMBIOTE_HOME (never the developer's real
// ~/.aukora-symbiote) and proves: private key never lands under the repo, keygen refuses to clobber an
// existing key, sign+rehearse produce a valid hash-chained receipt, and a bad receipt still fails closed
// (no crash) while a second rehearsal correctly chains onto the first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateRehearsalReceipt } from '../src/aumlokAuthorityRoot';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact } from '../src/selfEditProposalArtifact';

const REPO = join(__dirname, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'aumlok-authority.sh');

function run(args: string[], home: string) {
  return execFileSync('bash', [SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, AUKORA_SYMBIOTE_HOME: home },
    encoding: 'utf-8',
  });
}

describe('AUMLOK terminal CLI — end-to-end (real script, throwaway HOME)', () => {
  let home: string;
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'aumlok-cli-test-'));
  });
  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('keygen writes the private key ONLY under the throwaway HOME, mode 0600, never under the repo', () => {
    run(['keygen'], home);
    const priv = join(home, 'aumlok', 'authority-ed25519.key');
    expect(existsSync(priv)).toBe(true);
    expect(priv.startsWith(REPO)).toBe(false); // never inside the repo tree
    const mode = statSync(priv).mode & 0o777;
    expect(mode).toBe(0o600);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf-8' });
    expect(status).not.toMatch(/authority-ed25519/); // running keygen left no trace in the repo's own git status
  });

  it('keygen REFUSES to overwrite an existing key — private key content is unchanged after a second call', () => {
    const priv = join(home, 'aumlok', 'authority-ed25519.key');
    const before = readFileSync(priv, 'utf-8');
    expect(() => run(['keygen'], home)).toThrow(); // non-zero exit
    const after = readFileSync(priv, 'utf-8');
    expect(after).toBe(before);
  });

  let signedReceiptPath: string;
  let proposalArtifactPath: string;
  it('sign reads a proposal artifact, re-derives the hash, and produces a valid SignedPromotionReceipt on stdout', () => {
    const artifact = buildSelfEditProposalArtifact('cli test proposal', [{ relPath: 'docs/CLI_TEST.md', content: 'hello\n' }]);
    proposalArtifactPath = writeSelfEditProposalArtifact(artifact, home);
    const out = run(['sign', proposalArtifactPath], home);
    const receipt = JSON.parse(out);
    expect(receipt.schema).toBe('aumlok-signed-promotion-v1');
    expect(receipt.mode).toBe('dev_real');
    expect(receipt.algorithm).toBe('ed25519');
    expect(receipt.humanSignedAuthorization).toBe(true);
    expect(receipt.promotionExecuted).toBe(false);
    expect(receipt.authorization.proposalHash).toBe(artifact.proposalHash);
    expect(receipt.authorization.draftHash).toBe(artifact.proposalHash);
    signedReceiptPath = join(home, 'signed-receipt-1.json');
    writeFileSync(signedReceiptPath, out);
  });

  it('sign refuses a nonexistent proposal artifact path', () => {
    expect(() => run(['sign', join(home, 'does-not-exist.json')], home)).toThrow();
  });

  it('rehearse verifies + WRITES a hash-chained rehearsal receipt (seq 0, prevReceiptHash null)', () => {
    const out = run(['rehearse', signedReceiptPath], home);
    expect(out).toMatch(/promotionExecuted:\s*false/);
    const dir = join(home, 'aumlok', 'receipts');
    const files = readdirSync(dir).filter((f) => f.startsWith('rehearsal-'));
    expect(files.length).toBe(1);
    const rehearsal = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
    expect(validateRehearsalReceipt(rehearsal).valid).toBe(true);
    expect(rehearsal.verifierResult.valid).toBe(true);
    expect(rehearsal.promotionExecuted).toBe(false);
    expect(rehearsal.chain).toEqual({ seq: 0, prevReceiptHash: null });
    const mode = statSync(join(dir, files[0])).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('a TAMPERED receipt fails closed at rehearse time — no crash, and the record shows a failed verification', () => {
    const good = JSON.parse(readFileSync(signedReceiptPath, 'utf-8'));
    const tampered = { ...good, authorization: { ...good.authorization, draftHash: 'EVIL-TAMPERED' } };
    const tamperedPath = join(home, 'tampered-receipt.json');
    writeFileSync(tamperedPath, JSON.stringify(tampered));
    let out = '';
    expect(() => { out = run(['rehearse', tamperedPath], home); }).not.toThrow(); // exits 0 — a bad receipt is EVIDENCE, not a crash
    expect(out).toMatch(/"valid":false/);
  });

  it('the failed rehearsal correctly chains onto the first (seq increments, prevReceiptHash links)', () => {
    const dir = join(home, 'aumlok', 'receipts');
    const files = readdirSync(dir).filter((f) => f.startsWith('rehearsal-')).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);
    const first = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
    const second = JSON.parse(readFileSync(join(dir, files[1]), 'utf-8'));
    expect(first.chain.seq).toBe(0);
    expect(second.chain.seq).toBeGreaterThanOrEqual(1);
    expect(second.chain.prevReceiptHash).toBe(first.receiptHash);
    // whichever of the tampered-receipt calls this second entry came from, it must record a FAILED verification
    expect(second.verifierResult.valid).toBe(false);
    expect(second.promotionExecuted).toBe(false);
  });
});
