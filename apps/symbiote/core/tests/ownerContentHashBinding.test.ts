// RAIL: owner-content-hash-binding — the owner's Ed25519 signature and the device-local approval
// phrase are BOTH bound to the full proposal content hash (sha256 over {goal, [{relPath, sha256(content)}]}).
// Any post-signing mutation, cross-proposal substitution, or partial-field agreement must REFUSE, and the
// approval phrase is single-use AND proposal-bound.
//
// These tests pin behaviors the existing suite only covers by implication (see each describe block's note):
//   1. computeProposalHash's canonical sensitivity has NO direct unit test anywhere — every existing test
//      uses it only as an oracle, so a weakening that ignores relPath/order would keep the suite green.
//   2. The challenge tests only ever hold ONE proposal hash, so "proposal-bound" is unpinned.
//   3. nativeLiveApply's draftHash equality (line ~386) can be deleted today with the suite still green:
//      the existing tests flip proposalHash+draftHash together, never draftHash alone.
//   4. Goal-only / relPath-only tamper of a stored pending artifact is unpinned (only content tamper is).
//   5. The door's phrase-verify-before-ceremony ordering and never-leak-the-nonce mint response are pinned
//      only as "function names exist somewhere in the file".
//
// HERMETIC: throwaway keys via generateKeypair() only, mkdtemp homes/repos only, injected challenge store +
// injected nowMs, dispatchSignedLiveApplyForTests only (never the public entrypoint). The door
// (spatial/aumlok-approve-serve.ts) is pinned via fs.readFileSync source assertions ONLY — importing it
// would start Bun.serve and read the real SYMBIOTE_HOME (precedent: aumlokCanonicalCeremony.test.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { computeProposalHash, type ProposalFile } from '../src/proposalHash';
import {
  mintChallenge, verifyAndConsumeChallenge, sweepExpiredChallenges,
  type ChallengeStore,
} from '../src/aumlokApproveChallenge';
import {
  buildSelfEditProposalArtifact, writeSelfEditProposalArtifact, readPendingProposalByHash,
} from '../src/selfEditProposalArtifact';
import { dispatchSignedLiveApplyForTests } from '../src/nativeLiveApply';
import { generateKeypair, signPromotionAuthorization } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest, type SignedPromotionReceipt } from '../src/aumlokAuthorityRoot';
// #383 ROUND 1 — the hybrid dual-signature path (#380) that REPLACED the ceremony's inline Ed25519-only
// signing. Section 8 exercises the real binding BEHAVIORALLY through the same pure functions the custody
// signer (signPromotionV2FromCustody) and the organism verifier use — not a source literal.
import { deriveHybridPublicKeys, signPromotionV2 } from '../src/aumlokSignerV2';
import {
  pinAuthorityRootV2, verifyPromotionV2, AUMLOK_SUITE_V2,
  type PromotionAuthorizationV2, type SignedPromotionV2,
} from '../src/aumlokAuthorityV2';

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 1. computeProposalHash canonical sensitivity — the ONE hash function every side (proposer,
//    artifact layer, sign CLI, ceremony, apply gate) shares. If it ever stops folding in the goal,
//    a relPath, a content byte, or the file ORDER, the owner's signature stops binding WHERE bytes
//    land — and no other test in the suite would notice.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('computeProposalHash: canonical sensitivity (no direct unit test existed before this)', () => {
  const goal = 'add a docs note';
  const files: ProposalFile[] = [
    { relPath: 'docs/NOTE.md', content: 'alpha content\n' },
    { relPath: 'docs/OTHER.md', content: 'beta content\n' },
  ];

  it('is deterministic for identical input and yields a bare lowercase 64-hex string', () => {
    const a = computeProposalHash(goal, files);
    const b = computeProposalHash(goal, files.map((f) => ({ ...f }))); // fresh objects, same values
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the goal changes (same files) — the signed INTENT is part of the hash', () => {
    const a = computeProposalHash(goal, files);
    const b = computeProposalHash(goal + ' (but actually something else)', files);
    expect(b).not.toBe(a);
  });

  it('changes when a relPath changes with IDENTICAL bytes — a signature never authorizes the same content at a different destination', () => {
    const a = computeProposalHash(goal, files);
    const relocated = [{ relPath: 'core/src/elsewhere.ts', content: files[0].content }, files[1]];
    const b = computeProposalHash(goal, relocated);
    expect(b).not.toBe(a);
  });

  it('changes when a single byte of one file changes', () => {
    const a = computeProposalHash(goal, files);
    const oneByte = [{ relPath: files[0].relPath, content: 'Alpha content\n' }, files[1]];
    const b = computeProposalHash(goal, oneByte);
    expect(b).not.toBe(a);
  });

  it('changes when file ORDER changes — the hash is order-stable, not a set hash', () => {
    const a = computeProposalHash(goal, files);
    const b = computeProposalHash(goal, [files[1], files[0]]);
    expect(b).not.toBe(a);
  });

  it('changes when contents are SWAPPED between two relPaths (same path set, same content set)', () => {
    const a = computeProposalHash(goal, files);
    const swapped = [
      { relPath: files[0].relPath, content: files[1].content },
      { relPath: files[1].relPath, content: files[0].content },
    ];
    const b = computeProposalHash(goal, swapped);
    expect(b).not.toBe(a);
  });

  it('changes when a file is added — a subset never hashes like the full proposal', () => {
    const a = computeProposalHash(goal, files);
    const b = computeProposalHash(goal, [files[0]]);
    expect(b).not.toBe(a);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 2. Cross-proposal phrase binding — the existing challenge test file uses a single HASH constant
//    throughout, so nothing today fails if verifyAndConsumeChallenge started matching "any live
//    phrase in the store" (the confused-deputy the rail forbids: a benign proposal's phrase
//    approving a different pending proposal).
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('challenge phrase is proposal-BOUND, not merely single-use (two live hashes in one store)', () => {
  const HASH_A = 'a1'.repeat(32);
  const HASH_B = 'b2'.repeat(32);
  const NOW = 1_000_000;

  it("hash A's phrase can never consume hash B's challenge; each proposal still approves only with its OWN phrase", () => {
    const store: ChallengeStore = new Map();
    const a = mintChallenge(store, HASH_A, NOW);
    let b = mintChallenge(store, HASH_B, NOW);
    // astronomically unlikely, but a random phrase collision would make this test vacuous — re-mint B
    for (let i = 0; b.phrase === a.phrase && i < 5; i++) b = mintChallenge(store, HASH_B, NOW);
    expect(b.phrase).not.toBe(a.phrase);
    expect(b.nonce).not.toBe(a.nonce);

    // the attack: present A's (legitimately minted) phrase against proposal B
    const cross = verifyAndConsumeChallenge(store, HASH_B, a.phrase, NOW + 1);
    expect(cross).toEqual({ ok: false, reason: 'phrase_mismatch' });

    // the failed cross-attempt consumed NOTHING: B's own phrase still verifies, with B's nonce
    const bOk = verifyAndConsumeChallenge(store, HASH_B, b.phrase, NOW + 2);
    expect(bOk).toEqual({ ok: true, nonce: b.nonce });

    // and A's challenge is untouched too — its phrase still works against A, with A's nonce
    const aOk = verifyAndConsumeChallenge(store, HASH_A, a.phrase, NOW + 3);
    expect(aOk).toEqual({ ok: true, nonce: a.nonce });
  });

  it('a valid phrase presented against a hash with NO live challenge refuses no_challenge (never falls back to another record)', () => {
    const store: ChallengeStore = new Map();
    const a = mintChallenge(store, HASH_A, NOW);
    const HASH_C = 'c3'.repeat(32);
    const v = verifyAndConsumeChallenge(store, HASH_C, a.phrase, NOW + 1);
    expect(v).toEqual({ ok: false, reason: 'no_challenge' });
    // A untouched
    expect(verifyAndConsumeChallenge(store, HASH_A, a.phrase, NOW + 2)).toEqual({ ok: true, nonce: a.nonce });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 3. Exact-full-string phrase comparison — the guard's own comment ("we still compare full strings,
//    never a prefix") is currently enforced by nothing: the existing wrong-phrase test uses a fully
//    different string, which even a startsWith/trim/== drift would still reject.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('phrase verification is exact-full-string only, fail-closed on non-strings', () => {
  const HASH = 'd4'.repeat(32);
  const NOW = 2_000_000;
  let store: ChallengeStore;
  let phrase: string;

  beforeEach(() => {
    store = new Map();
    phrase = mintChallenge(store, HASH, NOW).phrase;
  });

  function expectRefusedWithoutConsuming(candidate: unknown) {
    const v = verifyAndConsumeChallenge(store, HASH, candidate as string, NOW + 1);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('phrase_mismatch');
    // nothing consumed: the true phrase still verifies afterwards
    const real = verifyAndConsumeChallenge(store, HASH, phrase, NOW + 2);
    expect(real.ok).toBe(true);
  }

  it('a correct PREFIX of the live phrase refuses without consuming', () => {
    expectRefusedWithoutConsuming(phrase.slice(0, -1));
  });

  it('the phrase with trailing whitespace refuses without consuming', () => {
    expectRefusedWithoutConsuming(phrase + ' ');
  });

  it('the phrase with a trailing newline refuses without consuming', () => {
    expectRefusedWithoutConsuming(phrase + '\n');
  });

  it('the phrase with leading whitespace refuses without consuming', () => {
    expectRefusedWithoutConsuming(' ' + phrase);
  });

  it('a case-folded variant of the phrase refuses without consuming', () => {
    expectRefusedWithoutConsuming(phrase.toUpperCase());
  });

  it('non-string phrases (null / undefined / number / object / array) all refuse without consuming', () => {
    for (const bad of [null, undefined, 42, { phrase }, [phrase]]) {
      const v = verifyAndConsumeChallenge(store, HASH, bad as unknown as string, NOW + 1);
      expect(v.ok, `non-string ${String(bad)} must refuse`).toBe(false);
      expect(v.ok === false && v.reason).toBe('phrase_mismatch');
    }
    // after ALL of those, the true phrase still verifies exactly once
    expect(verifyAndConsumeChallenge(store, HASH, phrase, NOW + 2).ok).toBe(true);
    const again = verifyAndConsumeChallenge(store, HASH, phrase, NOW + 3);
    expect(again).toEqual({ ok: false, reason: 'already_used' });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 4. Expiry boundary semantics — the check is strictly nowMs > expiresAt, and an expired challenge
//    is ERASED (a later attempt reports no_challenge, never already_used) so expiry leaves no
//    residue that could be mistaken for a consumed approval.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('challenge expiry boundary', () => {
  const HASH = 'e5'.repeat(32);
  const NOW = 3_000_000;

  it('the phrase still verifies at EXACTLY expiresAt (strict >, not >=)', () => {
    const store: ChallengeStore = new Map();
    const c = mintChallenge(store, HASH, NOW);
    const v = verifyAndConsumeChallenge(store, HASH, c.phrase, c.expiresAt);
    expect(v).toEqual({ ok: true, nonce: c.nonce });
  });

  it('one ms past expiresAt refuses "expired" AND erases the record — the next attempt says no_challenge', () => {
    const store: ChallengeStore = new Map();
    const c = mintChallenge(store, HASH, NOW);
    const late = verifyAndConsumeChallenge(store, HASH, c.phrase, c.expiresAt + 1);
    expect(late).toEqual({ ok: false, reason: 'expired' });
    expect(store.has(HASH)).toBe(false);
    const after = verifyAndConsumeChallenge(store, HASH, c.phrase, c.expiresAt + 2);
    expect(after).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('sweepExpiredChallenges uses the same strict boundary: kept at expiresAt, dropped one ms later', () => {
    const store: ChallengeStore = new Map();
    const c = mintChallenge(store, HASH, NOW);
    sweepExpiredChallenges(store, c.expiresAt);
    expect(store.has(HASH)).toBe(true);
    sweepExpiredChallenges(store, c.expiresAt + 1);
    expect(store.has(HASH)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 5. Stored pending artifact tamper at the governed loader — the existing ceremony test tampers only
//    files[0].content. Goal-only tamper (rewriting the human-readable INTENT the owner reads at sign
//    time) and relPath-only tamper (relocating signed bytes) must refuse at readPendingProposalByHash
//    via the hash re-derivation. Plus the uppercase-hash-id APFS case-alias fence.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('readPendingProposalByHash: goal/relPath tamper + hash-id spelling discipline', () => {
  let home: string;
  const goal = 'tighten the recall filter';
  const files: ProposalFile[] = [{ relPath: 'docs/PLAN.md', content: 'step one\nstep two\n' }];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-hashbind-home-'));
  });
  afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function writePending(): { hash: string; filePath: string } {
    const artifact = buildSelfEditProposalArtifact(goal, files);
    const filePath = writeSelfEditProposalArtifact(artifact, home);
    return { hash: artifact.proposalHash, filePath };
  }

  it('control: the untampered artifact loads cleanly by its hash', () => {
    const { hash } = writePending();
    const r = readPendingProposalByHash(hash, home);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.artifact.goal).toBe(goal);
      expect(r.artifact.proposalHash).toBe(hash);
    }
  });

  it('GOAL-only tamper refuses: the re-derivation covers intent, not just file bytes', () => {
    const { hash, filePath } = writePending();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    parsed.goal = 'a completely benign housekeeping change'; // files + stored proposalHash untouched
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));
    const r = readPendingProposalByHash(hash, home);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/recomputed hash|tampered/i);
  });

  it('relPath-only tamper refuses: identical bytes redirected to a different destination break the hash', () => {
    const { hash, filePath } = writePending();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    parsed.files[0].relPath = 'core/src/somewhereElse.ts'; // content + stored proposalHash untouched
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));
    const r = readPendingProposalByHash(hash, home);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/recomputed hash|tampered/i);
  });

  it('an UPPERCASE hash id refuses at the bare-lowercase-64-hex shape check even though the artifact exists (APFS case-alias fence)', () => {
    const { hash } = writePending();
    const upper = hash.toUpperCase();
    expect(upper).not.toBe(hash); // sha256 hex of this fixed proposal deterministically contains letters
    const r = readPendingProposalByHash(upper, home);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/bare 64-hex/);
    // the canonical lowercase spelling still loads — the fence rejects the SPELLING, not the proposal
    expect(readPendingProposalByHash(hash, home).ok).toBe(true);
  });

  it('a MIXED-case hash id refuses the same way (one hash, one spelling)', () => {
    const { hash } = writePending();
    const mixed = hash.slice(0, 32) + hash.slice(32).toUpperCase();
    expect(mixed).not.toBe(hash);
    const r = readPendingProposalByHash(mixed, home);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/bare 64-hex/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 6. The apply gate's per-field binding matrix — nativeLiveApply.ts recomputes the content hash and
//    requires it to equal input.proposalHash, authorization.proposalHash AND authorization.draftHash.
//    The existing suite never isolates draftHash: it flips both authorization fields together. If the
//    draftHash equality (line ~386) were deleted, the whole suite would stay green today.
//    Temp git repo + temp home + throwaway keypair; dispatchSignedLiveApplyForTests only.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('apply gate: each hash-binding field refuses ALONE (temp repo, throwaway keys)', () => {
  let repoRoot: string;
  let homeDir: string;
  let priv: string;
  let pub: string;

  function git(args: string[]) {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
  }

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-hashbind-repo-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);

    homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-hashbind-home2-'));
    const kp = generateKeypair(); // throwaway, in-test only — never a real key
    priv = kp.privateKeyHex; pub = kp.publicKeyHex;
    fs.mkdirSync(path.join(homeDir, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(pub)));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function signFor(goal: string, f: ProposalFile[], overrides: Partial<{ proposalHash: string; draftHash: string }> = {}): SignedPromotionReceipt {
    const hash = computeProposalHash(goal, f);
    return signPromotionAuthorization(priv, {
      keyId: pinAuthorityRoot(pub).keyId,
      proposalHash: overrides.proposalHash ?? hash,
      draftHash: overrides.draftHash ?? hash,
      nonce: 'test-nonce-hashbind',
      issuedAt: new Date().toISOString(),
      expiresAt: null,
    });
  }

  const goal = 'add a docs note';
  const files: ProposalFile[] = [{ relPath: 'docs/NOTE.md', content: 'bound content\n' }];

  it('control: a fully consistent signed receipt applies (proves this harness is not refusing for setup reasons)', () => {
    const proposalHash = computeProposalHash(goal, files);
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt: signFor(goal, files) });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, 'docs/NOTE.md'), 'utf-8')).toBe(files[0].content);
  });

  it('refuses a VALIDLY-SIGNED receipt whose draftHash ALONE mismatches — proposalHash agreement is not enough', () => {
    const proposalHash = computeProposalHash(goal, files);
    const otherHash = computeProposalHash('a different draft entirely', files);
    // the signature over {proposalHash: correct, draftHash: other} is REAL — only the field disagrees
    const signedReceipt = signFor(goal, files, { draftHash: otherHash });
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/draftHash does not match/);
    expect(fs.existsSync(path.join(repoRoot, 'docs/NOTE.md'))).toBe(false);
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(headBefore);
  });

  it('refuses a VALIDLY-SIGNED receipt whose authorization.proposalHash ALONE mismatches (draftHash correct)', () => {
    const proposalHash = computeProposalHash(goal, files);
    const otherHash = computeProposalHash('a different proposal entirely', files);
    const signedReceipt = signFor(goal, files, { proposalHash: otherHash });
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash, files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/authorization\.proposalHash does not match/);
    expect(fs.existsSync(path.join(repoRoot, 'docs/NOTE.md'))).toBe(false);
  });

  it('refuses when the CALLER-claimed input.proposalHash alone mismatches the recomputed content hash', () => {
    const wrongClaim = computeProposalHash('some other goal', files);
    const signedReceipt = signFor(goal, files); // authorization fields are self-consistent
    const result = dispatchSignedLiveApplyForTests({ repoRoot, homeDir }, { goal, proposalHash: wrongClaim, files, signedReceipt });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match the recomputed hash/);
    expect(fs.existsSync(path.join(repoRoot, 'docs/NOTE.md'))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 7. Door + ceremony STRUCTURAL pins (read-only source assertions — the door runs Bun.serve at
//    import and reads the real SYMBIOTE_HOME, so it is never imported; precedent:
//    aumlokCanonicalCeremony.test.ts, selfModOutcome.test.ts). These pin the ORDERING and the NONCE
//    PROVENANCE that the existing canonical-ceremony test leaves unpinned (it only asserts the two
//    function names exist somewhere in the file).
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('approve door binds gesture to signature (structural source pins)', () => {
  const DOOR = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-approve-serve.ts'), 'utf-8');
  const CEREMONY = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokApproveCeremony.ts'), 'utf-8');

  function approveRegion(): string {
    const start = DOOR.indexOf("p === '/api/approve'");
    expect(start, 'the /api/approve route must exist').toBeGreaterThan(-1);
    return DOOR.slice(start);
  }

  function challengeRegion(): string {
    const start = DOOR.indexOf("p === '/api/challenge'");
    const end = DOOR.indexOf("p === '/api/approve'");
    expect(start, 'the /api/challenge route must exist').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return DOOR.slice(start, end);
  }

  it('in /api/approve, verifyAndConsumeChallenge runs BEFORE approveAndApplyProposal (phrase gates the ceremony)', () => {
    const region = approveRegion();
    const verifyIdx = region.indexOf('verifyAndConsumeChallenge(');
    const applyIdx = region.indexOf('approveAndApplyProposal(');
    expect(verifyIdx, 'approve handler must verify the phrase').toBeGreaterThan(-1);
    expect(applyIdx, 'approve handler must invoke the ceremony').toBeGreaterThan(-1);
    expect(verifyIdx, 'phrase verification must precede the sign+apply ceremony').toBeLessThan(applyIdx);
  });

  it('the ceremony receives the CONSUMED challenge nonce (verdict.nonce) — never a request-body nonce', () => {
    expect(approveRegion()).toContain('approveAndApplyProposal(hash, verdict.nonce');
    expect(DOOR).not.toContain('body.nonce');
  });

  it('the /api/challenge mint response returns the phrase but NEVER the binding nonce', () => {
    const region = challengeRegion();
    expect(region).toContain('mintChallenge(');
    expect(region).toContain('phrase: c.phrase');
    // no nonce key in any response literal, and no read of the minted nonce at all
    expect(region).not.toContain('nonce:');
    expect(region).not.toContain('c.nonce');
  });

  it('the ceremony routes a v2-bound node to the hybrid DUAL signer (proposalHash + consumed nonce), never an Ed25519-only signature', () => {
    // #380 moved the binding OUT of the ceremony's inline literal INTO signPromotionV2FromCustody (the
    // dual Ed25519 + ML-DSA-65 custody signer). The old literal pin is obsolete; this pins the ROUTING —
    // a v2 node MUST reach the dual signer with the exact proposalHash + the CONSUMED nonce — and the
    // BEHAVIORAL binding proof (both suites, tamper rejection, mutation proof) lives in section 8 below.
    expect(CEREMONY).toContain('hybridV2StatePresent(homeDir)');
    expect(CEREMONY).toMatch(/signPromotionV2FromCustody\(homeDir,\s*\{\s*proposalHash,\s*nonce\s*\}\)/);
    // the v2 gate PRECEDES the legacy Ed-only signer, so a v2 node can never fall through to classical-only.
    const v2Idx = CEREMONY.indexOf('hybridV2StatePresent(homeDir)');
    const edOnlyIdx = CEREMONY.indexOf('signPromotionAuthorization(');
    expect(v2Idx).toBeGreaterThan(-1);
    if (edOnlyIdx > -1) expect(v2Idx).toBeLessThan(edOnlyIdx);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 8. RAIL (behavioral) — the hybrid promotion receipt binds the EXACT proposalHash + nonce into the
//    payload signed by BOTH Ed25519 AND ML-DSA-65, and BOTH signatures are load-bearing. This is the
//    behavioral successor to the source-literal pin that #380 obsoleted: it drives the SAME pure
//    functions the custody signer (signPromotionV2FromCustody, used by aumlokApproveCeremony.ts) and
//    the organism verifier (verifyPromotionV2) use, with deterministic throwaway seeds. Hermetic — no
//    fs, no bundle, no network. It never reopens an Ed25519-only path; on the contrary it PROVES the
//    classical half alone can never authorize.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('hybrid dual-signature binds proposalHash + nonce into BOTH Ed25519 and ML-DSA-65 (behavioral rail)', () => {
  const ED_SEED = 'a1'.repeat(32); // 32-byte throwaway seeds (independent CSPRNG material in production)
  const ML_SEED = 'b2'.repeat(32);
  const PROPOSAL = 'c'.repeat(64);
  const NONCE = 'consumed-approval-nonce-7f3a';
  const ISSUED = '2026-07-13T00:00:00.000Z';

  // Flip the last hex char: preserves the exact length + lowercase shape isValidSignatures requires, so a
  // corrupted-but-well-formed signature reaches the CRYPTO check (proving crypto rejection, not a shape reject).
  const flipHex = (h: string) => h.slice(0, -1) + (h[h.length - 1] === '0' ? '1' : '0');

  function signOver(overrides: Partial<PromotionAuthorizationV2> = {}) {
    const root = pinAuthorityRootV2(deriveHybridPublicKeys(ED_SEED, ML_SEED));
    const authorization: PromotionAuthorizationV2 = {
      rootId: root.rootId, proposalHash: PROPOSAL, draftHash: PROPOSAL,
      nonce: NONCE, issuedAt: ISSUED, expiresAt: null, ...overrides,
    };
    return { root, authorization, signed: signPromotionV2(ED_SEED, ML_SEED, authorization) };
  }

  it('a correctly dual-signed receipt over {proposalHash, nonce} verifies, carries BOTH suites distinctly, and pins draftHash=proposalHash', () => {
    const { root, signed } = signOver();
    expect(verifyPromotionV2(signed, root, ISSUED).valid).toBe(true);
    expect(signed.suite).toBe(AUMLOK_SUITE_V2); // the hybrid suite tag — never a classical-only suite
    // both algorithm halves present, correct length, and DISTINCT (a dual sig is never one artifact twice)
    expect(signed.signatures.ed25519.length).toBe(128);      // Ed25519 = 64 bytes
    expect(signed.signatures.mlDsa65.length).toBe(3309 * 2); // ML-DSA-65 = 3309 bytes
    expect(signed.signatures.ed25519).not.toBe(signed.signatures.mlDsa65);
    // draftHash is pinned equal to proposalHash INSIDE the signed payload (the binding the old literal named)
    expect(signed.authorization.draftHash).toBe(signed.authorization.proposalHash);
  });

  it('the EXACT proposalHash is inside the signed payload of BOTH suites — mutating it after signing breaks verification at the crypto layer', () => {
    const { root, signed } = signOver();
    const tampered: SignedPromotionV2 = { ...signed, authorization: { ...signed.authorization, proposalHash: 'd'.repeat(64), draftHash: 'd'.repeat(64) } };
    const v = verifyPromotionV2(tampered, root, ISSUED);
    expect(v.valid).toBe(false);
    // the payload no longer matches EITHER signature; the verifier reports the first crypto failure — proof
    // the exact hash is inside the preimage both suites signed.
    expect(v.reason).toBe('ed25519 signature invalid');
  });

  it('the EXACT nonce is inside the signed payload — mutating it (proposalHash unchanged) breaks verification', () => {
    const { root, signed } = signOver();
    const tampered: SignedPromotionV2 = { ...signed, authorization: { ...signed.authorization, nonce: 'a-different-approval-nonce' } };
    expect(verifyPromotionV2(tampered, root, ISSUED).valid).toBe(false);
  });

  it('MUTATION PROOF — a VALID Ed25519 signature with a corrupted ML-DSA-65 signature is REJECTED (the post-quantum half is not optional; an Ed25519-only receipt never authorizes)', () => {
    const { root, signed } = signOver();
    const forged: SignedPromotionV2 = { ...signed, signatures: { ed25519: signed.signatures.ed25519, mlDsa65: flipHex(signed.signatures.mlDsa65) } };
    const v = verifyPromotionV2(forged, root, ISSUED);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('ml-dsa-65 signature invalid');
    // If the verifier were ever weakened to accept an Ed25519-only receipt (dropping the ML-DSA check),
    // THIS assertion would fail. It is the standing guard against silently reopening a classical-only path.
  });

  it('a VALID ML-DSA-65 signature with a corrupted Ed25519 signature is REJECTED (the classical half is not optional either)', () => {
    const { root, signed } = signOver();
    const forged: SignedPromotionV2 = { ...signed, signatures: { ed25519: flipHex(signed.signatures.ed25519), mlDsa65: signed.signatures.mlDsa65 } };
    const v = verifyPromotionV2(forged, root, ISSUED);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('ed25519 signature invalid');
  });

  it('signatures from a DIFFERENT proposalHash cannot be grafted onto this authorization (cross-payload signature reuse fails on both halves)', () => {
    const a = signOver();
    const b = signOver({ proposalHash: 'e'.repeat(64), draftHash: 'e'.repeat(64) });
    const grafted: SignedPromotionV2 = { ...a.signed, signatures: b.signed.signatures };
    expect(verifyPromotionV2(grafted, a.root, ISSUED).valid).toBe(false);
  });

  it('missing / malformed / duplicated signature material is rejected, never treated as valid', () => {
    const { root, signed } = signOver();
    // empty ed25519 half
    expect(verifyPromotionV2({ ...signed, signatures: { ed25519: '', mlDsa65: signed.signatures.mlDsa65 } } as unknown as SignedPromotionV2, root, ISSUED).valid).toBe(false);
    // ml-dsa key absent
    expect(verifyPromotionV2({ ...signed, signatures: { ed25519: signed.signatures.ed25519 } } as unknown as SignedPromotionV2, root, ISSUED).valid).toBe(false);
    // signatures object entirely absent
    expect(verifyPromotionV2({ ...signed, signatures: undefined } as unknown as SignedPromotionV2, root, ISSUED).valid).toBe(false);
    // the same artifact used for BOTH halves is refused — a duplicated signature is never a real dual signature
    expect(verifyPromotionV2({ ...signed, signatures: { ed25519: signed.signatures.ed25519, mlDsa65: signed.signatures.ed25519 } } as unknown as SignedPromotionV2, root, ISSUED).valid).toBe(false);
  });
});
