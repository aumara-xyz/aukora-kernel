import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { dispatchSignedLiveApply, dispatchSignedLiveApplyForTests, validateLiveApplyReceipt, liveApplyGrantsAuthority, isGateMachineryTarget, canonicalizeFenceTarget, GATE_MACHINERY_RING0_PATHS, isProtectedStateEnvTarget, isRing0ApplyTarget } from '../src/nativeLiveApply';
import { computeProposalHash } from '../src/proposalHash';
import { generateKeypair, signPromotionAuthorization } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest, revokeAuthorityRoot, type SignedPromotionReceipt } from '../src/aumlokAuthorityRoot';
import { isProposalAlreadyApplied } from '../src/appliedProposalLedger';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'nativeLiveApply.ts'), 'utf-8');

let repoRoot: string;
let homeDir: string;
let priv: string;
let pub: string;

function git(args: string[], cwd = repoRoot) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initRepo() {
  repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-liveapply-repo-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
}

function initHome() {
  homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-liveapply-home-'));
  const kp = generateKeypair();
  priv = kp.privateKeyHex; pub = kp.publicKeyHex;
  const root = pinAuthorityRoot(pub);
  fs.mkdirSync(path.join(homeDir, 'aumlok'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), serializeRootManifest(root));
}

beforeEach(() => { initRepo(); initHome(); });
afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function signFor(goal: string, files: { relPath: string; content: string }[], overrides: Partial<{ proposalHash: string; draftHash: string; expiresAt: string | null; nonce: string }> = {}): SignedPromotionReceipt {
  const hash = overrides.proposalHash ?? computeProposalHash(goal, files);
  const root = pinAuthorityRoot(pub);
  return signPromotionAuthorization(priv, {
    keyId: root.keyId,
    proposalHash: hash,
    draftHash: overrides.draftHash ?? hash,
    nonce: overrides.nonce ?? 'test-nonce-1',
    issuedAt: new Date().toISOString(),
    expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : null,
  });
}

describe('nativeLiveApply: structural safety', () => {
  it('is a separate module from the round-1 dispatcher — never imported by it', () => {
    const dispatcherSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'nativeIdeDispatcher.ts'), 'utf-8');
    expect(dispatcherSrc).not.toMatch(/nativeLiveApply/);
  });

  it('never uses shell:true and only spawns via execFileSync', () => {
    expect(SRC).not.toMatch(/shell:\s*true/);
    expect(SRC).toMatch(/execFileSync/);
    expect(SRC).not.toMatch(/\bexecSync\s*\(/);
  });

  it('repoRoot/homeDir overrides exist ONLY on the test-only function, never on the public entrypoint\'s type', () => {
    // dispatchSignedLiveApply's own signature takes (input, now?) — no repoRoot/homeDir parameter at all.
    expect(SRC).toMatch(/export function dispatchSignedLiveApply\(input: SignedLiveApplyInput, now\?: string\)/);
  });

  it('liveApplyGrantsAuthority is always false', () => {
    expect(liveApplyGrantsAuthority({ schema: 'live-apply-result-v1', ok: true, receipt: null, appliedLive: true })).toBe(false);
  });
});

describe('nativeLiveApply: the full happy path (temp repo, throwaway key)', () => {
  it('proposes, signs, applies live, commits for real, and git revert restores the prior content', () => {
    const goal = 'add a docs note';
    const files = [{ relPath: 'docs/NOTE.md', content: 'hello from a signed live apply\n' }];
    const proposalHash = computeProposalHash(goal, files);
    const signedReceipt = signFor(goal, files);

    const before = fs.existsSync(path.join(repoRoot, 'docs/NOTE.md'));
    expect(before).toBe(false);

    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(result.ok).toBe(true);
    expect(result.receipt).not.toBeNull();
    expect(result.receipt!.appliedLive).toBe(true);
    expect(result.receipt!.grantsAuthority).toBe(false);
    expect(validateLiveApplyReceipt(result.receipt).valid).toBe(true);

    // the file is really there, really committed
    expect(fs.readFileSync(path.join(repoRoot, 'docs/NOTE.md'), 'utf-8')).toBe(files[0].content);
    const log = git(['log', '--format=%H %an <%ae> %s', '-1']);
    expect(log).toContain('Aukora Symbiote <aukora@local-dev-shim>');
    expect(log.trim().split(' ')[0]).toBe(result.receipt!.commitSha);

    // ledger recorded it
    const applied = isProposalAlreadyApplied(proposalHash, { homeDir });
    expect(applied?.commitSha).toBe(result.receipt!.commitSha);

    // git revert genuinely restores the prior state
    git(['revert', '--no-edit', result.receipt!.commitSha]);
    expect(fs.existsSync(path.join(repoRoot, 'docs/NOTE.md'))).toBe(false);
  });
});

describe('nativeLiveApply: adversarial refusals', () => {
  it('refuses when the file content does not match what was signed (hash substitution)', () => {
    const goal = 'add a docs note';
    const signedFiles = [{ relPath: 'docs/NOTE.md', content: 'the reviewed content\n' }];
    const signedReceipt = signFor(goal, signedFiles);
    const proposalHash = computeProposalHash(goal, signedFiles);
    // attacker substitutes different content but reuses the same claimed proposalHash string
    const substituted = [{ relPath: 'docs/NOTE.md', content: 'a DIFFERENT payload entirely\n' }];
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files: substituted, signedReceipt });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'docs/NOTE.md'))).toBe(false);
  });

  it('refuses a signature whose authorization.proposalHash does not match the recomputed hash', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const wrongHash = computeProposalHash('a different goal', files);
    const signedReceipt = signFor(goal, files, { proposalHash: wrongHash, draftHash: wrongHash });
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
  });

  it('refuses an expired authorization', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const signedReceipt = signFor(goal, files, { expiresAt: new Date(Date.now() - 1000 * 60).toISOString() });
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'docs/A.md'))).toBe(false);
  });

  it('refuses when the authority root is revoked', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const signedReceipt = signFor(goal, files);
    const root = pinAuthorityRoot(pub);
    fs.writeFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), serializeRootManifest(revokeAuthorityRoot(root)));
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
  });

  it('refuses a signature from a DIFFERENT keypair than the pinned root', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const impostor = generateKeypair();
    const hash = computeProposalHash(goal, files);
    const forgedRoot = pinAuthorityRoot(impostor.publicKeyHex); // signed as if this were the pinned root's keyId
    const signedReceipt = signPromotionAuthorization(impostor.privateKeyHex, {
      keyId: forgedRoot.keyId, proposalHash: hash, draftHash: hash, nonce: 'n', issuedAt: new Date().toISOString(), expiresAt: null,
    });
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: hash, files, signedReceipt });
    expect(result.ok).toBe(false);
  });

  it('refuses relPath "." cleanly (regression: this used to reach fs.writeFileSync and throw EISDIR uncaught)', () => {
    const goal = 'g'; const files = [{ relPath: '.', content: 'x' }];
    const signedReceipt = signFor(goal, files);
    expect(() => {
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it('refuses a keyword-sacred target (via the classifier, not the fence) even with a fully valid signature', () => {
    // A path the sacred CLASSIFIER catches but the self-referential fence does not — keeps distinct coverage
    // of validateAllFilesOrRefuse's sacred branch. (authority/** is now fence-caught first, tested separately.)
    const goal = 'sneaky'; const files = [{ relPath: 'docs/founder_secret_notes.md', content: 'export const HACKED = true;' }];
    const signedReceipt = signFor(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sacred/i);
    expect(fs.existsSync(path.join(repoRoot, 'docs/founder_secret_notes.md'))).toBe(false);
  });

  it('refuses a path-traversal filename even with a valid signature', () => {
    const goal = 'g'; const files = [{ relPath: '../../etc/passwd', content: 'x' }];
    const signedReceipt = signFor(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
  });

  it('refuses a symlink escape: a symlinked directory in the live tree must not redirect the write outside the repo', () => {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-liveapply-outside-'));
    fs.symlinkSync(outside, path.join(repoRoot, 'linked'));
    const goal = 'g'; const files = [{ relPath: 'linked/escape.md', content: 'x' }];
    const signedReceipt = signFor(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(outside, 'escape.md'))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('refuses replay of an already-applied proposalHash, citing the prior commit', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const signedReceipt = signFor(goal, files);
    const proposalHash = computeProposalHash(goal, files);
    const first = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(first.ok).toBe(true);

    const second = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(second.ok).toBe(false);
    expect(second.reason).toContain(first.receipt!.commitSha);
  });

  it('replaying the SAME proposalHash after a legitimate NEWER change must still refuse (no downgrade)', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'first content\n' }];
    const signedReceipt = signFor(goal, files);
    const proposalHash = computeProposalHash(goal, files);
    const first = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(first.ok).toBe(true);

    // a legitimate, unrelated newer edit lands directly (simulating further real work after the apply)
    fs.writeFileSync(path.join(repoRoot, 'docs/A.md'), 'newer legitimate content\n');
    git(['add', '-A']); git(['commit', '-q', '-m', 'newer legitimate edit']);

    const replay = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(replay.ok).toBe(false);
    // the newer content must NOT have been silently overwritten by the replay
    expect(fs.readFileSync(path.join(repoRoot, 'docs/A.md'), 'utf-8')).toBe('newer legitimate content\n');
  });

  it('a failed git commit leaves the index clean (no dangling staged files)', () => {
    const goal = 'g'; const files = [{ relPath: 'docs/A.md', content: 'x' }];
    const signedReceipt = signFor(goal, files);
    // force a commit failure: pre-stage a conflicting state isn't easy to fake, so instead corrupt the
    // repo's ability to commit by removing the git user config (commit requires an identity — but we
    // ALWAYS pass GIT_AUTHOR_*/GIT_COMMITTER_* env, so that alone won't fail it). Simulate failure via
    // an unwritable .git/index temporarily.
    const idx = path.join(repoRoot, '.git', 'index.lock');
    fs.writeFileSync(idx, ''); // a stale lock file makes git refuse to operate
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
    fs.rmSync(idx, { force: true });
    // git add itself failed (the lock blocked it), so nothing was ever staged — no line may show a
    // staged status (A/M/D in the index column); an untracked new dir from path validation is fine.
    const status = git(['status', '--porcelain']);
    expect(status.split('\n').every((l) => l === '' || l.startsWith('??'))).toBe(true);
  });
});

describe('nativeLiveApply: self-referential Ring-0 fence (one-signature gate self-unlock)', () => {
  // The load-bearing fix: no signed proposal — however valid its signature — may rewrite the gate machinery.
  const GATE_FILES = [
    'core/src/nativeLiveApply.ts',
    'core/src/kernelActionClassifier.ts',
    'core/src/appliedProposalLedger.ts',
    'core/src/policyKernel.ts',
    'core/src/proposalHash.ts',
    'core/src/aumlokAuthorityRoot.ts',
    'core/src/sandboxApply.ts',
  ];

  it('refuses EVERY gate-machinery file even with a fully valid owner signature — nothing written, nothing committed', () => {
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    for (const relPath of GATE_FILES) {
      const goal = `neuter the gate via ${relPath}`;
      const files = [{ relPath, content: '// gate disabled\n' }];
      const signedReceipt = signFor(goal, files); // a REAL, valid signature over this exact content
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok, `${relPath} must be refused`).toBe(false);
      expect(result.reason).toMatch(/Ring-0 protected|gate machinery|self-referential fence/i);
      expect(fs.existsSync(path.join(repoRoot, relPath))).toBe(false);
    }
    // no commit happened for any of them
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(headBefore);
  });

  it('refuses the fence BEFORE signature verification — an UNSIGNED/forged receipt targeting the gate still refuses', () => {
    const goal = 'forge'; const files = [{ relPath: 'core/src/nativeLiveApply.ts', content: 'x' }];
    // deliberately mismatched hash + garbage signature: if the fence runs first, we never reach sig checks
    const forged = signFor(goal, files, { proposalHash: 'deadbeef'.repeat(8) });
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt: forged });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Ring-0 protected|gate machinery|self-referential fence/i);
  });

  it('refuses case-folded and path-normalized aliases of a gate file (APFS is case-insensitive)', () => {
    const aliases = [
      'core/src/NativeLiveApply.ts',
      'CORE/SRC/NATIVELIVEAPPLY.TS',
      './core/src/nativeLiveApply.ts',
      'core/src/../src/nativeLiveApply.ts',
      'core//src//nativeLiveApply.ts',
      'core\\src\\nativeLiveApply.ts',
    ];
    for (const relPath of aliases) {
      const goal = 'alias'; const files = [{ relPath, content: 'x' }];
      const signedReceipt = signFor(goal, files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok, `${relPath} must be refused`).toBe(false);
    }
  });

  it('refuses any target under the fenced authority/ , identity/ and docs/policy-rings/ roots', () => {
    for (const relPath of ['authority/gate/aukoraGate.ts', 'authority/symbiotePaths.ts', 'identity/founder.json', 'docs/policy-rings/ring-table.json']) {
      const goal = 'root'; const files = [{ relPath, content: 'x' }];
      const signedReceipt = signFor(goal, files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok, `${relPath} must be refused`).toBe(false);
      expect(result.reason).toMatch(/Ring-0 protected|gate machinery|self-referential fence|sacred/i);
    }
  });

  it('refuses a MIXED proposal where one benign file rides alongside a gate-machinery file (all-or-nothing)', () => {
    const goal = 'smuggle'; const files = [
      { relPath: 'docs/OK.md', content: 'harmless\n' },
      { relPath: 'core/src/proposalHash.ts', content: '// neutered\n' },
    ];
    const signedReceipt = signFor(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
    // the benign file must NOT have been written either — the whole proposal is refused before any write
    expect(fs.existsSync(path.join(repoRoot, 'docs/OK.md'))).toBe(false);
  });

  it('does NOT false-positive on an adjacent, non-gate core/src file (a normal signed apply still works)', () => {
    const goal = 'ordinary'; const files = [{ relPath: 'core/src/someFeature.ts', content: 'export const x = 1;\n' }];
    const signedReceipt = signFor(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, 'core/src/someFeature.ts'), 'utf-8')).toBe(files[0].content);
  });

  it('isGateMachineryTarget: positive/negative + fail-closed on malformed input', () => {
    for (const p of GATE_FILES) expect(isGateMachineryTarget(p)).toBe(true);
    expect(isGateMachineryTarget('authority/anything.ts')).toBe(true);
    expect(isGateMachineryTarget('identity/x')).toBe(true);
    expect(isGateMachineryTarget('docs/policy-rings/x.json')).toBe(true);
    // negatives — ordinary paths and sibling-prefix look-alikes
    expect(isGateMachineryTarget('docs/NOTE.md')).toBe(false);
    expect(isGateMachineryTarget('core/src/someFeature.ts')).toBe(false);
    expect(isGateMachineryTarget('authority-notes.md')).toBe(false);   // 'authority' not followed by '/'
    expect(isGateMachineryTarget('docs/policy-notes.md')).toBe(false);
    // fail-closed on malformed
    expect(isGateMachineryTarget('')).toBe(true);
    expect(isGateMachineryTarget('.')).toBe(true);
    expect(isGateMachineryTarget('a\0b')).toBe(true);
    expect(canonicalizeFenceTarget('CORE/SRC/x.TS')).toBe('core/src/x.ts');
    expect(canonicalizeFenceTarget('')).toBeNull();
  });

  it('DRIFT: every fenced path is Ring-0 in the ratified ring-table (sandboxApply.ts is the disclosed Ring-1 fence-ahead)', () => {
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'policy-rings', 'ring-table.json'), 'utf-8'));
    const ringOf = (glob: string): number | undefined => table.rules.find((r: any) => r.glob === glob)?.ring;
    // the 6 audit-named files: exact Ring-0 rules must still exist (catches a law downgrade)
    for (const f of ['core/src/nativeLiveApply.ts', 'core/src/kernelActionClassifier.ts', 'core/src/appliedProposalLedger.ts', 'core/src/policyKernel.ts', 'core/src/proposalHash.ts', 'core/src/aumlokAuthorityRoot.ts']) {
      expect(ringOf(f), `${f} must be Ring 0 in the table`).toBe(0);
    }
    // fenced directory roots must be Ring-0 globs
    for (const d of ['authority/**', 'identity/**', 'docs/policy-rings/**']) {
      expect(ringOf(d), `${d} must be Ring 0`).toBe(0);
    }
    // disclosed: sandboxApply.ts is fenced ahead of the table (currently Ring 1). If it is ever amended to
    // Ring 0 that is fine (still gated); assert only that the table does NOT downgrade it below Ring 1.
    expect((ringOf('core/src/sandboxApply.ts') ?? 99)).toBeLessThanOrEqual(1);
    // sanity: the exported set is exactly what the tests exercise
    expect([...GATE_MACHINERY_RING0_PATHS].sort()).toEqual([...GATE_FILES, 'authority', 'identity', 'docs/policy-rings'].sort());
  });
});

describe('nativeLiveApply: state/brain + env protection fence', () => {
  // Same never-applyable Ring-0 treatment as the gate machinery, extended to the organism's state/secrets.
  const STATE_ENV_TARGETS = [
    'state/kira/brain.json',              // live brain data (poisoning target)
    'state/kira/backups/2026.json',       // brain backups
    'state/mega-mind.archived/brain.json',
    '.env',                               // root secret env
    '.env.local',
    '.env.production',
    'dashboard/fu/.env',                  // nested env
    'signing.key',                        // key material
    'authority/gate/x.pem',              // (also gate-fenced, but the basename rule holds anywhere)
    'secrets/service.key',
    '.envrc',                             // direnv secret file (not caught by .gitignore's .env.* either)
    'auth.json',
    'aumlok-dev.json',
    'admin-key.txt',                      // Convex memory-organ admin key (Brick W3b, ratified 2026-07-05)
    'config/admin-key',                   // basename rule holds anywhere
    'instance-secret.txt',                // Convex instance secret
    'instance-secret',
    'core/src/pinnedPublicKey.ts',        // ratified-Ring-0 gap the #97 fence missed (pinned key = authority)
    'core/src/nodeIdentity.ts',
    'scripts/aumlok-authority.sh',
    'scripts/scan-secrets.sh',
    'scripts/verify-public-readiness.sh', // the leak scanner's REAL logic (scan-secrets.sh only exec-wraps it)
  ];

  it('refuses EVERY state/env/secret/ratified-Ring-0 target under a fully valid owner signature — nothing written, nothing committed', () => {
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    for (const relPath of STATE_ENV_TARGETS) {
      const goal = `poison via ${relPath}`;
      const files = [{ relPath, content: 'malicious\n' }];
      const signedReceipt = signFor(goal, files); // a REAL, valid signature
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok, `${relPath} must be refused`).toBe(false);
      expect(result.reason, `${relPath} reason`).toMatch(/Ring-0 protected/i);
      expect(fs.existsSync(path.join(repoRoot, relPath)), `${relPath} must not be written`).toBe(false);
    }
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(headBefore);
  });

  it('refuses the state/env fence BEFORE signature verification (forged receipt targeting .env still refuses)', () => {
    const goal = 'forge env'; const files = [{ relPath: '.env', content: 'OPENAI_KEY=stolen\n' }];
    const forged = signFor(goal, files, { proposalHash: 'deadbeef'.repeat(8) });
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt: forged });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Ring-0 protected/i);
  });

  it('does NOT false-positive on non-secret env TEMPLATES — .env.example / .sample / .template still apply', () => {
    for (const relPath of ['.env.example', '.env.sample', '.env.template', 'dashboard/fu/.env.example']) {
      const goal = 'doc template'; const files = [{ relPath, content: 'OPENAI_KEY=your-key-here\n' }];
      const signedReceipt = signFor(goal, files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok, `${relPath} should be a normal apply`).toBe(true);
      expect(fs.readFileSync(path.join(repoRoot, relPath), 'utf-8')).toBe(files[0].content);
      // clean up the committed template so the next loop iteration starts from a clean tree
      fs.rmSync(path.join(repoRoot, relPath), { force: true });
      git(['add', '-A']); git(['commit', '-q', '-m', `cleanup ${relPath}`]);
    }
  });

  it('does NOT false-positive on ordinary files whose names merely resemble secrets', () => {
    // `config.env.ts`, `keyboard.ts`, `states.js` must NOT be caught — the basename rules are anchored.
    expect(isProtectedStateEnvTarget('spatial/app/ui/states.js')).toBe(false);   // 'states' != 'state/'
    expect(isProtectedStateEnvTarget('core/src/keyMappings.ts')).toBe(false);    // not *.key
    expect(isProtectedStateEnvTarget('docs/config.env.ts')).toBe(false);         // basename not .env*
    expect(isProtectedStateEnvTarget('core/src/nodeIdentityHelper.ts')).toBe(false); // sibling of a fenced file
    // Brick W3b admin-key/instance-secret basenames are fenced; lookalikes are not.
    expect(isProtectedStateEnvTarget('a/b/admin-key.txt')).toBe(true);
    expect(isProtectedStateEnvTarget('instance-secret')).toBe(true);
    expect(isProtectedStateEnvTarget('core/src/adminKeyResolver.ts')).toBe(false); // not the credential basename
    expect(isProtectedStateEnvTarget('docs/instance-secret.md')).toBe(false);      // different basename
  });

  it('RESIDUAL CLOSED — a symlink cannot route a write into a protected dir (resolved-realpath re-fence)', () => {
    // Prepare real target dirs so the symlinks resolve, then link benign names at them. The relPaths use CLEAN
    // basenames (no `brain.json`/`.env`/keyword) so the STRING fence and the classifier both pass — isolating
    // the resolved-realpath re-fence as the ONLY layer that can catch the symlink routing.
    fs.mkdirSync(path.join(repoRoot, 'state', 'kira'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'authority'), { recursive: true });
    fs.symlinkSync('state', path.join(repoRoot, 'brainlink'));       // brainlink -> state (new set)
    fs.symlinkSync('authority', path.join(repoRoot, 'authlink'));    // authlink -> authority (gate machinery)

    for (const relPath of ['brainlink/notes.md', 'authlink/feature.ts']) {
      const goal = `symlink route via ${relPath}`;
      const files = [{ relPath, content: 'x\n' }];
      const signedReceipt = signFor(goal, files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
      expect(result.ok, `${relPath} must be refused via realpath`).toBe(false);
      expect(result.reason, `${relPath} reason`).toMatch(/resolved real path|escapes repo|symlink/i);
      // the write must NOT have landed at the real protected location
      expect(fs.existsSync(path.join(repoRoot, 'state', 'notes.md'))).toBe(false);
      expect(fs.existsSync(path.join(repoRoot, 'authority', 'feature.ts'))).toBe(false);
    }
  });

  it('COUNCIL #99 (Opus): a symlink into a fenced dir routing to a GAP file, and a final-component symlink to a GAP file, are both refused', () => {
    // Opus flagged the realpath re-fence uses join(parentReal, originalBasename): prove BOTH vectors are closed.
    fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'core', 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'core', 'src', 'pinnedPublicKey.ts'), 'export const K = 1;\n');

    // (1) PARENT symlink into scripts/, write a GAP-file basename through it -> realpath re-fence catches it.
    fs.symlinkSync('scripts', path.join(repoRoot, 'slink'));
    {
      const relPath = 'slink/scan-secrets.sh';
      const files = [{ relPath, content: '#!/bin/sh\nexit 0\n' }];
      const signedReceipt = signFor('route to gap via parent symlink', files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal: 'g', proposalHash: computeProposalHash('route to gap via parent symlink', files), files, signedReceipt });
      expect(result.ok, 'parent-symlink route to scan-secrets.sh must be refused').toBe(false);
      expect(fs.existsSync(path.join(repoRoot, 'scripts', 'scan-secrets.sh'))).toBe(false);
    }

    // (2) FINAL-COMPONENT symlink whose benign name resolves to a real GAP file -> the symlink-target guard catches it.
    fs.symlinkSync('pinnedPublicKey.ts', path.join(repoRoot, 'core', 'src', 'decoy.ts'));
    {
      const relPath = 'core/src/decoy.ts';
      const files = [{ relPath, content: '// neutered\n' }];
      const signedReceipt = signFor('overwrite pinned key via final-component symlink', files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal: 'g', proposalHash: computeProposalHash('overwrite pinned key via final-component symlink', files), files, signedReceipt });
      expect(result.ok, 'final-component symlink to pinnedPublicKey.ts must be refused').toBe(false);
      // the real GAP file must be untouched
      expect(fs.readFileSync(path.join(repoRoot, 'core', 'src', 'pinnedPublicKey.ts'), 'utf-8')).toBe('export const K = 1;\n');
    }
  });

  it('OWNER Q1 (#99 ratified): .github/** CI config is never-applyable through the signed-apply path', () => {
    // A signed workflow edit could weaken the CI secret-scan / exfiltrate secrets; owner ratified Ring 0.
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    for (const relPath of ['.github/workflows/gate.yml', '.github/workflows/evil.yml', '.github/actions/x/action.yml', '.github/dependabot.yml']) {
      const files = [{ relPath, content: 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n' }];
      const signedReceipt = signFor(`edit CI via ${relPath}`, files);
      const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal: 'g', proposalHash: computeProposalHash(`edit CI via ${relPath}`, files), files, signedReceipt });
      expect(result.ok, `${relPath} must be refused`).toBe(false);
      expect(result.reason).toMatch(/Ring-0 protected/i);
      expect(fs.existsSync(path.join(repoRoot, relPath))).toBe(false);
    }
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    // unit-level: fenced, and a sibling-prefix dir is NOT caught
    expect(isProtectedStateEnvTarget('.github/workflows/gate.yml')).toBe(true);
    expect(isRing0ApplyTarget('.github/workflows/gate.yml')).toBe(true);
    expect(isProtectedStateEnvTarget('.githubby/notes.md')).toBe(false); // sibling-prefix, not fenced
    // COUNCIL confirm (Opus caveat): case-fold + ./-prefix aliases canonicalize onto the fence (APFS)
    expect(isProtectedStateEnvTarget('.GitHub/workflows/gate.yml')).toBe(true);
    expect(isProtectedStateEnvTarget('./.github/workflows/gate.yml')).toBe(true);
    expect(isProtectedStateEnvTarget('.github')).toBe(true); // the bare dir too
  });

  it('COUNCIL #99 (DeepSeek): a symlink whose target contains `..` but resolves into state/ is still refused (realpath canonicalizes)', () => {
    // DeepSeek asked for a `..`-based symlink-into-state case: realpathSync resolves the whole chain, so the
    // parent still resolves to state/ and the resolved-realpath re-fence catches it.
    fs.mkdirSync(path.join(repoRoot, 'state', 'kira'), { recursive: true });
    fs.symlinkSync('state/../state/kira', path.join(repoRoot, 'weird')); // resolves to state/kira
    const relPath = 'weird/config.json'; // benign basename; not caught by the string fence
    const files = [{ relPath, content: 'poison\n' }];
    const signedReceipt = signFor('dotdot symlink into state', files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal: 'g', proposalHash: computeProposalHash('dotdot symlink into state', files), files, signedReceipt });
    expect(result.ok, '`..`-symlink resolving into state/ must be refused').toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'state', 'kira', 'config.json'))).toBe(false);
  });

  it('COUNCIL #99 (Opus): multi-dot env names are handled by exact-suffix match, not startsWith — no template false-negative', () => {
    // Opus worried `.env.example.real` might slip as a template. The fence uses EXACT-suffix match, so it does NOT.
    expect(isProtectedStateEnvTarget('.env.example.real')).toBe(true);   // suffix 'example.real' != a template
    expect(isProtectedStateEnvTarget('.env.local.bak')).toBe(true);
    expect(isProtectedStateEnvTarget('.env.production')).toBe(true);
    // genuine templates still allowed (no dev-breakage)
    expect(isProtectedStateEnvTarget('.env.example')).toBe(false);
    expect(isProtectedStateEnvTarget('.env.sample')).toBe(false);
    expect(isProtectedStateEnvTarget('.env.template')).toBe(false);
  });

  it('a mixed proposal (benign + a state/env target) is refused whole — no partial write', () => {
    const goal = 'smuggle env'; const files = [
      { relPath: 'docs/OK.md', content: 'harmless\n' },
      { relPath: '.env', content: 'STOLEN=1\n' },
    ];
    const signedReceipt = signFor(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: computeProposalHash(goal, files), files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'docs/OK.md'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.env'))).toBe(false);
  });

  it('isProtectedStateEnvTarget / isRing0ApplyTarget: positives, negatives, fail-closed, case-fold', () => {
    for (const p of STATE_ENV_TARGETS) expect(isProtectedStateEnvTarget(p), `${p} positive`).toBe(true);
    // case-fold + normalize aliases fold onto the set (APFS)
    expect(isProtectedStateEnvTarget('STATE/Kira/Brain.JSON')).toBe(true);
    expect(isProtectedStateEnvTarget('./.env')).toBe(true);
    expect(isProtectedStateEnvTarget('a/../.env.local')).toBe(true);
    // negatives
    expect(isProtectedStateEnvTarget('docs/NOTE.md')).toBe(false);
    expect(isProtectedStateEnvTarget('.env.example')).toBe(false);
    expect(isProtectedStateEnvTarget('states/x.ts')).toBe(false);       // 'states' not the 'state' root
    // fail-closed
    expect(isProtectedStateEnvTarget('')).toBe(true);
    expect(isProtectedStateEnvTarget('a\0b')).toBe(true);
    // unified deny is the union of both fences
    expect(isRing0ApplyTarget('core/src/nativeLiveApply.ts')).toBe(true); // gate machinery
    expect(isRing0ApplyTarget('.env')).toBe(true);                        // state/env
    expect(isRing0ApplyTarget('core/src/someFeature.ts')).toBe(false);   // neither
  });

  it('DRIFT: the disclosed ratified-Ring-0 gap files are actually Ring-0 in the ring-table', () => {
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'policy-rings', 'ring-table.json'), 'utf-8'));
    const ringOf = (glob: string): number | undefined => table.rules.find((r: any) => r.glob === glob)?.ring;
    for (const f of ['core/src/pinnedPublicKey.ts', 'core/src/nodeIdentity.ts', 'scripts/aumlok-authority.sh', 'scripts/scan-secrets.sh', 'scripts/verify-public-readiness.sh']) {
      expect(ringOf(f), `${f} must be Ring 0 in the table (this fence relies on that)`).toBe(0);
    }
  });
});
