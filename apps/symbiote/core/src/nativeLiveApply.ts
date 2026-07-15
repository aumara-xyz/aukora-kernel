// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Signed per-proposal live apply — the FIRST capability in this project's history where Aukora's own
 * code can write to the LIVE repository and make a real git commit. This is a permanent capability
 * class, not a rehearsal, so every rule below is load-bearing and was shaped by an adversarial review
 * before this file existed (see docs/BUILT_STATE.md and the round history for the full findings).
 *
 * Deliberately SEPARATE from ideToolContract.ts / nativeIdeDispatcher.ts: every one of the round-1
 * dispatcher's 10 tools is pinned `advisoryOnly:true` — a tool that actually mutates the live repo is
 * not advisory, and bolting it into that same envelope would either lie or weaken a tested invariant.
 * This module has its own result type and its own entrypoint; the 10-tool contract is untouched.
 *
 * Hard gate, ALL of which must pass before a single byte is written to the live repo:
 *   1. the exact proposal content (goal + files) re-hashes to MATCH the signed authorization's
 *      proposalHash/draftHash — a signature can only ever authorize the BYTE-IDENTICAL content it was
 *      signed over, never a substituted payload.
 *   2. the signature verifies against the PINNED public authority root (real Ed25519, "dev_real") —
 *      not revoked, not expired, keyId/algorithm match.
 *   3. this exact proposalHash has never been applied before (durable, disk-persisted, consume-once
 *      ledger) — closes a real replay/downgrade vulnerability the review found: the AUMLOK verifier
 *      itself has no nonce-replay check, so an old signed receipt could otherwise be replayed to
 *      silently overwrite newer legitimate work.
 *   4. EVERY target file passes the exact same sacred-path + path-traversal + symlink/realpath escape
 *      guard the sandbox writer uses — a valid signature can NEVER override a sacred-path refusal.
 * Only if all four hold: write the files, `git add -- <exact paths>` (never `-A`/`.`, so unrelated
 * concurrent dirty files in the tree are never swept into this commit), commit under a DISTINCT git
 * identity (so `git log` itself honestly distinguishes "Claude edited this externally" history from
 * "owner-signed native live-apply" commits), and record a receipt. `git revert <sha>` is the rollback.
 *
 * Subprocess note: git via `execFileSync` argv arrays ONLY, `shell` never true, never string
 * interpolation into a command line — the second module in this codebase (after sandboxTestRunner.ts)
 * to spawn a subprocess at all, and the first to ever mutate the live repo.
 *
 * `isLivePromotionUnlocked()` (aumlokAuthorityRoot.ts) stays untouched, still literal `false` — there is
 * still no STANDING/blanket unlock. This is narrower: one signature authorizes one exact reviewed
 * change, never conflated with "promotion unlocked."
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { computeProposalHash, type ProposalFile } from './proposalHash';
import { consumeProposalOnce, isProposalAlreadyApplied } from './appliedProposalLedger';
import { buildKernelActionTable, classifyDraftAction } from './kernelActionClassifier';
import { isSafeRelPath } from './sandboxApply';
import { parseRootManifest, verifyPromotionReceipt, type SignedPromotionReceipt, type AuthorityRoot } from './aumlokAuthorityRoot';
// #361 Brick 3 step 2 — mandatory post-quantum hybrid on a v2-bound node.
import { verifyPromotionV2, SIGNED_PROMOTION_V2_KEYS, AUMLOK_SUITE_V2, AUMLOK_MODE_V2, type SignedPromotionV2 } from './aumlokAuthorityV2';
import { loadHybridCustody, hybridV2StatePresent } from './aumlokBindV2';
import { captureSnapshot } from './promotionRollback';
import * as os from 'os';
import { symbioteHome } from '../../authority/symbiotePaths';
import { SIGNED_PROMOTION_RECEIPT_KEYS } from './aumlokAuthorityRoot';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * ── Self-referential Ring-0 fence ────────────────────────────────────────────────────────────────
 * (Opus audit 2026-07-04: "one-signature gate self-unlock", HIGH.)
 *
 * This live-apply gate is enforced by THIS module plus the small closure of sibling modules it imports for
 * the decision (hash match, replay ledger, path guard, signature verify, sacred classify). If a signed
 * proposal were allowed to REWRITE any of that machinery, a single owner signature could neuter every check
 * below — and because the launchers run `bun` straight from `core/src/*.ts` with NO build step, the neutered
 * gate would take effect on the very NEXT apply, through which even a forged/unsigned proposal would pass.
 *
 * `classifyDraftAction`'s sacred keyword-net (secrets/auth/founder/kill-switch) is BLIND to the gate
 * machinery's own filenames, so the gate cannot lean on it to protect itself — and that classifier is itself
 * one of the files a self-edit could neuter. The fence is therefore hardcoded HERE, in the file it protects,
 * and checked BEFORE any signature/hash/replay logic: no signature, valid or forged, may write these paths.
 * It has no consume-gap — it depends on no other module remembering to load a table (that dependency IS the
 * exploit the audit found).
 *
 * The set is the live-apply ENFORCEMENT CLOSURE: nativeLiveApply's own decision-path imports plus the Ring-0
 * authority / identity / policy-ring roots. Extensions beyond the audit's named 6 files, disclosed:
 *   - `core/src/sandboxApply.ts` — supplies `isSafeRelPath`, the path-traversal guard THIS module imports and
 *     calls in validateAllFilesOrRefuse; a rewrite to `return true` guts it exactly like neutering the gate.
 *     (Note: the ratified ring-table currently classifies it Ring 1, not Ring 0 — a table gap; the fence is
 *     deliberately stricter than the table here, and the round report requests the Ring-0 amendment.)
 *   - the whole `authority/`, `identity/` roots — every file under them is Ring-0/sacred; fencing the roots is
 *     stricter than, and independent of, the neuterable keyword net that only partially covers them today.
 */
const GATE_MACHINERY_FILES: readonly string[] = [
  'core/src/nativeLiveApply.ts',
  'core/src/kernelActionClassifier.ts',
  'core/src/appliedProposalLedger.ts',
  'core/src/policyKernel.ts',
  'core/src/proposalHash.ts',
  'core/src/aumlokAuthorityRoot.ts',
  'core/src/sandboxApply.ts',
];
const GATE_MACHINERY_DIRS: readonly string[] = ['authority', 'identity', 'docs/policy-rings'];

/** All fenced paths (files + directory roots), exported so the classifier + drift test share one source. */
export const GATE_MACHINERY_RING0_PATHS: readonly string[] = [...GATE_MACHINERY_FILES, ...GATE_MACHINERY_DIRS];

/**
 * Canonicalize a repo-relative target for the fence compare WITHOUT touching disk: fold `./`, `a/../b`,
 * duplicate + backslash separators and a trailing slash, then case-fold (the live tree is APFS/case-insensitive,
 * so `Core/SRC/NativeLiveApply.TS` names the same inode). Returns null for a malformed input (non-string / NUL /
 * empty / bare `.`), which the caller treats as "refuse" (fail-closed).
 */
export function canonicalizeFenceTarget(relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) return null;
  const slashed = relPath.replace(/\\/g, '/');
  const normalized = path.posix.normalize(slashed).replace(/\/+$/, '');
  const stripped = normalized.replace(/^(\.\/)+/, '');
  if (stripped.length === 0 || stripped === '.') return null;
  return stripped.toLowerCase();
}

/**
 * True iff `relPath` names gate machinery that NO signature may ever rewrite (self-referential Ring-0).
 * Fail-closed: a target that cannot be canonicalized is treated as fenced. Exported so the classifier and
 * tests reuse the exact same set — one source of truth.
 */
export function isGateMachineryTarget(relPath: string): boolean {
  const canon = canonicalizeFenceTarget(relPath);
  if (canon === null) return true;
  for (const f of GATE_MACHINERY_FILES) if (canon === f.toLowerCase()) return true;
  for (const d of GATE_MACHINERY_DIRS) {
    const dl = d.toLowerCase();
    if (canon === dl || canon.startsWith(dl + '/')) return true;
  }
  return false;
}

/**
 * State/brain + env protection (2026-07-04). #97 fenced the gate MACHINERY; this fences the ORGANISM'S STATE
 * and its SECRETS against the same one-signature apply-poisoning class. The live-apply writer writes each file
 * to disk BEFORE the git commit (see the write loop in applyCore). A `.env` / `state/**` path is gitignored, so
 * the commit would FAIL at `git add` of an ignored path — but the malicious bytes are ALREADY on disk by then,
 * and the running organism reads its env/brain FROM DISK, not from the commit. So the only safe stop is a
 * PRE-WRITE deny, exactly like the gate fence: refuse before a byte is written.
 *
 * Four categories, all never-applyable Ring-0 at the live-apply chokepoint:
 *   (A) Live brain/state DATA — `state/**` (state/kira/brain.json + backups): the brain-poisoning target.
 *   (B) Env & secret files by BASENAME — `.env` / `.env.<x>` (except the documented non-secret shapes
 *       example|sample|template|dist|defaults, which are legitimately edited), plus *.key, *.pem, auth.json,
 *       aumlok-dev.json (the .gitignore secret list). Planting one on disk redirects model-routing / egress / auth.
 *   (C) Disclosed ratified-Ring-0 gaps the #97 fence did NOT cover (docs/policy-rings/ring-table.json marks these
 *       Ring 0): core/src/pinnedPublicKey.ts (the PINNED public key — a rewrite is straight authority
 *       substitution, strictly WORSE than brain poisoning), core/src/nodeIdentity.ts, scripts/aumlok-authority.sh,
 *       scripts/scan-secrets.sh (the leak scanner). Closed here because this brick IS the apply-deny-set
 *       expansion round; shipping it while leaving the pinned-key file apply-writable would be indefensible.
 *   (D) CI config — `.github/**` (#99 owner decision Q1, ratified never-applyable). A signed edit to a workflow
 *       could weaken the CI secret-scan or exfiltrate repo secrets on every push; two Fusion Council voices
 *       (opus, grok) flagged it and the owner ratified `.github/**` to Ring 0. The ring-table marks it Ring 0 to
 *       match this fence — CI config is changed by human git, never by a signed self-apply.
 */
const PROTECTED_STATE_DIRS: readonly string[] = ['state'];
// (D) ratified Q1: CI workflow config is never-applyable through the signed-apply path (human-git only).
const PROTECTED_RING0_DIRS: readonly string[] = ['.github'];
const PROTECTED_RING0_GAP_FILES: readonly string[] = [
  'core/src/pinnedPublicKey.ts',
  'core/src/nodeIdentity.ts',
  'scripts/aumlok-authority.sh',
  'scripts/scan-secrets.sh',
  // scan-secrets.sh is a 5-line `exec` wrapper; ALL the TIER-1 leak logic lives in verify-public-readiness.sh
  // (also ratified Ring 0, and tracked/not-gitignored so it commits cleanly). Fencing the wrapper without the
  // delegate would let one signature rewrite the delegate to `exit 0` and neuter the scanner that this brick's
  // own CI runs — so the delegate is fenced too. (Ring-0 review, boundary lens.)
  'scripts/verify-public-readiness.sh',
];
// Non-secret env shapes that are legitimately committed and edited — never denied (avoids a false-positive that
// would break a routine signed edit to a documentation template, the mirror of #97's policyKernel-helper.ts lesson).
const ENV_TEMPLATE_SUFFIXES: readonly string[] = ['example', 'sample', 'template', 'dist', 'defaults'];

/** Basename-level env/secret test on an already-canonicalized (lowercased, posix-normalized) path. */
function isSecretOrEnvBasename(canon: string): boolean {
  const base = canon.slice(canon.lastIndexOf('/') + 1);
  if (base === '.env' || base === '.envrc') return true;
  if (base.startsWith('.env.')) return !ENV_TEMPLATE_SUFFIXES.includes(base.slice('.env.'.length));
  if (base.endsWith('.key') || base.endsWith('.pem')) return true;
  if (base === 'auth.json' || base === 'aumlok-dev.json') return true;
  // Memory-organ root credentials (Brick W3b, owner-ratified 2026-07-05): the self-hosted Convex
  // admin key and instance secret are AUMLOK-tier custody (~/.aukora-symbiote/convex/). No signed
  // proposal may write a file named like one, wherever it appears — defense in depth beside the
  // read-side secret scan.
  if (base === 'admin-key.txt' || base === 'admin-key') return true;
  if (base === 'instance-secret.txt' || base === 'instance-secret') return true;
  return false;
}

/**
 * True iff `relPath` names organism STATE, a SECRET/env file, or a ratified-Ring-0 authority path the #97 gate
 * fence missed — none of which any signature may write through the live-apply path. Fail-closed on malformed
 * input, sharing canonicalizeFenceTarget with the gate fence so both use one normalization.
 */
export function isProtectedStateEnvTarget(relPath: string): boolean {
  const canon = canonicalizeFenceTarget(relPath);
  if (canon === null) return true; // fail-closed
  for (const d of PROTECTED_STATE_DIRS) if (canon === d || canon.startsWith(d + '/')) return true;
  for (const d of PROTECTED_RING0_DIRS) if (canon === d || canon.startsWith(d + '/')) return true;
  for (const f of PROTECTED_RING0_GAP_FILES) if (canon === f.toLowerCase()) return true;
  return isSecretOrEnvBasename(canon);
}

/** The unified live-apply Ring-0 deny: gate machinery (#97) ∪ state/brain/env/secrets. No signed proposal may
 *  write ANY of these; checked before signature/hash/replay and re-checked against the resolved real path. */
export function isRing0ApplyTarget(relPath: string): boolean {
  return isGateMachineryTarget(relPath) || isProtectedStateEnvTarget(relPath);
}

// Issue #76: a signed receipt may only be read from a trusted location. A signed receipt is a few KB;
// 64 KiB is a generous ceiling enforced BEFORE any parse. Exported (#361 Cycle C) so the size-evidence
// tests assert real dual-receipt artifacts against THE cap, not a copied number that could drift.
export const MAX_SIGNED_RECEIPT_BYTES = 64 * 1024;
// The `> ${tmp}/signed-<hash>.json` file the sign→apply flow (workbenchCommandLoop.ts) instructs the owner
// to produce. Only this exact basename shape is trusted directly under a temp root.
const TMP_SIGNED_BASENAME = /^signed-[A-Za-z0-9._-]+\.json$/;

const GIT_IDENTITY = { name: 'Aukora Symbiote', email: 'aukora@local-dev-shim' };

export interface AumlokLiveApplyReceiptV1 {
  schema: 'aumlok-live-apply-receipt-v1';
  version: 1;
  task: string;
  targetFiles: string[];
  proposalHash: string;
  signerKeyId: string;
  preImageSnapshotHash: string; // sha256 of a pure content-hash manifest of the files BEFORE this write
  commitSha: string;
  rollbackCommand: string;
  appliedLive: true;
  promotionReady: false;
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
  receiptHash: string;
}

function receiptIntegrity(r: Omit<AumlokLiveApplyReceiptV1, 'receiptHash'>): string {
  return sha256(JSON.stringify({
    schema: r.schema, version: r.version, task: r.task, targetFiles: r.targetFiles, proposalHash: r.proposalHash,
    signerKeyId: r.signerKeyId, preImageSnapshotHash: r.preImageSnapshotHash, commitSha: r.commitSha,
    rollbackCommand: r.rollbackCommand, appliedLive: r.appliedLive, promotionReady: r.promotionReady,
    advisoryOnly: r.advisoryOnly, grantsAuthority: r.grantsAuthority, createdAt: r.createdAt,
  }));
}

const RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'schema', 'version', 'task', 'targetFiles', 'proposalHash', 'signerKeyId', 'preImageSnapshotHash',
  'commitSha', 'rollbackCommand', 'appliedLive', 'promotionReady', 'advisoryOnly', 'grantsAuthority',
  'createdAt', 'receiptHash',
]);

function hasOnlyKeys(obj: any, allowed: ReadonlySet<string>): boolean {
  return !!obj && typeof obj === 'object' && Object.keys(obj).every((k) => allowed.has(k));
}

/** Fail-closed shape + integrity check for a stored live-apply receipt. */
export function validateLiveApplyReceipt(a: any): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  if (a.schema !== 'aumlok-live-apply-receipt-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(a, RECEIPT_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (a.version !== 1) return { valid: false, reason: 'unsupported version' };
  if (a.appliedLive !== true) return { valid: false, reason: 'appliedLive must be true for a live-apply receipt' };
  if (a.promotionReady !== false) return { valid: false, reason: 'promotionReady must be false' };
  if (a.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (a.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  const { receiptHash, ...rest } = a;
  if (receiptHash !== receiptIntegrity(rest)) return { valid: false, reason: 'integrity mismatch (receipt tampered)' };
  return { valid: true };
}

export interface SignedLiveApplyInput {
  goal: string;
  proposalHash: string;
  files: ProposalFile[];
  signedReceipt: SignedPromotionReceipt | SignedPromotionV2;
}

export interface LiveApplyResult {
  schema: 'live-apply-result-v1';
  ok: boolean;
  reason?: string;
  receipt: AumlokLiveApplyReceiptV1 | null;
  appliedLive: boolean;
}

function refuse(reason: string): LiveApplyResult {
  return { schema: 'live-apply-result-v1', ok: false, reason, receipt: null, appliedLive: false };
}

/** Every target file must pass sacred-path + traversal + symlink/realpath-escape guard — identical in
 *  spirit to sandboxApply.ts's writer, applied here against the LIVE repo root (a richer attack surface
 *  than a fresh temp dir, since the live tree could already contain a symlink). Sacred wins regardless
 *  of signature validity. Pure validation only — no write happens in this function. */
function validateAllFilesOrRefuse(repoRootReal: string, files: ProposalFile[]): { ok: true; abs: string[] } | { ok: false; reason: string } {
  const table = buildKernelActionTable();
  const abs: string[] = [];
  for (const f of files) {
    if (!isSafeRelPath(f.relPath)) return { ok: false, reason: `unsafe path: ${f.relPath}` };
    // Defense-in-depth restatement of the pre-signature fence in applyCore — this validator is also called
    // in-repo against the LIVE tree, so it re-refuses Ring-0 apply targets independently of any classifier.
    if (isRing0ApplyTarget(f.relPath)) {
      return { ok: false, reason: `Ring-0 protected target refused: ${f.relPath} (gate machinery / organism state / env-secret / ratified Ring-0 path — never applyable by any signed proposal)` };
    }
    if (classifyDraftAction(`write ${f.relPath}`, table).class === 'sacred') {
      return { ok: false, reason: `sacred/Ring-0 path refused: ${f.relPath} (never applyable, even with a valid signature)` };
    }
    if (f.content.length > 100_000) return { ok: false, reason: `content too large: ${f.relPath}` };
    const target = path.join(repoRootReal, f.relPath);
    const rel = path.relative(repoRootReal, target);
    // rel === '' means the relPath resolved to the repo root itself (e.g. relPath === '.') — isSafeRelPath
    // alone does not catch this (a bare "." is a syntactically safe, non-traversal relative path). Writing
    // to a directory target throws EISDIR uncaught if this slips through; refuse it explicitly instead.
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, reason: `unsafe or empty resolved path: ${f.relPath}` };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const parentReal = fs.realpathSync(path.dirname(target));
    if (parentReal !== repoRootReal && !parentReal.startsWith(repoRootReal + path.sep)) {
      return { ok: false, reason: `path escapes repo via symlink/realpath: ${f.relPath}` };
    }
    // #97 residual + state/env brick: RE-FENCE on the RESOLVED real path, not just the name-string. A
    // pre-existing intra-repo symlink (e.g. `link -> authority/` or `link -> state/`) resolves INSIDE the repo
    // (so it passes the escape check above) yet the string fence saw only the benign link name — this catches
    // it by re-running the Ring-0 deny against where the write would REALLY land.
    const realRel = path.relative(repoRootReal, path.join(parentReal, path.basename(f.relPath)));
    if (isRing0ApplyTarget(realRel)) {
      return { ok: false, reason: `Ring-0 protected target via resolved real path refused: ${f.relPath} -> ${realRel} (symlink/realpath re-fence)` };
    }
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      return { ok: false, reason: `symlink write target refused: ${f.relPath}` };
    }
    abs.push(target);
  }
  return { ok: true, abs };
}

function gitCommitExactFiles(repoRoot: string, relPaths: string[], message: string): { ok: true; commitSha: string } | { ok: false; reason: string } {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: GIT_IDENTITY.name, GIT_AUTHOR_EMAIL: GIT_IDENTITY.email,
    GIT_COMMITTER_NAME: GIT_IDENTITY.name, GIT_COMMITTER_EMAIL: GIT_IDENTITY.email,
  };
  try {
    execFileSync('git', ['add', '--', ...relPaths], { cwd: repoRoot, encoding: 'utf-8' });
  } catch (e) {
    return { ok: false, reason: `git add failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    execFileSync('git', ['commit', '-m', message], { cwd: repoRoot, encoding: 'utf-8', env });
  } catch (e) {
    try { execFileSync('git', ['reset', '--', ...relPaths], { cwd: repoRoot, encoding: 'utf-8' }); } catch { /* best effort */ }
    return { ok: false, reason: `git commit failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' }).trim();
  return { ok: true, commitSha };
}

export interface ApplyOptions {
  repoRoot?: string;   // TEST-ONLY — never a tool-call argument; the public entrypoint always uses the real REPO_ROOT
  homeDir?: string;    // TEST-ONLY — where the pinned authority manifest + applied-ledger live
  now?: string;
}

/** Core logic, parameterized for tests. Not exported directly — see dispatchSignedLiveApply /
 *  dispatchSignedLiveApplyForTests below, which is the ONLY place repoRoot/homeDir overrides exist. */
function applyCore(opts: ApplyOptions, input: SignedLiveApplyInput): LiveApplyResult {
  const now = opts.now ?? new Date().toISOString();
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const homeDir = opts.homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');

  if (!input.goal || !input.files?.length || !input.proposalHash || !input.signedReceipt) {
    return refuse('goal, files, proposalHash, and signedReceipt are all required');
  }

  // 0. RING-0 APPLY FENCE — before any signature/hash/replay logic. No signature, valid or forged, may rewrite
  // (a) the gate machinery that enforces every check below (#97 self-referential fence — lives in the file it
  // protects, so unlike a table another module must consume it has no wiring gap), or (b) organism state/brain,
  // env/secret files, or the ratified-Ring-0 authority paths (state/brain + env protection brick). The write
  // loop below hits disk BEFORE the git commit, so a gitignored `.env`/`state/**` would be poisoned on disk even
  // though the commit fails — refusing here, pre-write, is the only safe stop.
  for (const f of input.files) {
    if (isRing0ApplyTarget(f.relPath)) {
      return refuse(`Ring-0 protected target refused: ${f.relPath} — gate machinery / organism state / env-secret / ratified Ring-0 path cannot be rewritten by any signed proposal (checked before signature verification).`);
    }
  }

  // 1. the exact content must re-hash to match what was actually signed — never trust a caller-supplied hash alone.
  const recomputed = computeProposalHash(input.goal, input.files);
  if (recomputed !== input.proposalHash) return refuse('proposalHash does not match the recomputed hash of goal+files');
  if (input.signedReceipt.authorization.proposalHash !== recomputed) return refuse('signed authorization.proposalHash does not match this exact proposal content');
  if (input.signedReceipt.authorization.draftHash !== recomputed) return refuse('signed authorization.draftHash does not match this exact proposal content');

  // 2. verify the signature against the PINNED authority root. #361 Brick 3 step 2: a v2-bound node REQUIRES
  //    a dual Ed25519+ML-DSA-65 authorization — there is NO Ed25519-only path once hybrid custody exists, and
  //    an incoherent v2 bundle FAILS CLOSED (never silently falls back to the legacy v1 manifest). The hash
  //    binding above (authorization.proposalHash/draftHash === recomputed) already covers both receipt shapes.
  let signerKeyId: string;
  if (hybridV2StatePresent(homeDir)) {
    const custody = loadHybridCustody(homeDir);
    if (!custody.ok) return refuse(`v2 custody incoherent — fail closed, no v1 fallback: ${custody.reason}`);
    const r = input.signedReceipt as SignedPromotionV2;
    if (r?.schema !== 'aumlok-signed-promotion-v2') return refuse('this node is post-quantum (v2) bound — a v1/Ed25519-only receipt cannot authorize; a dual Ed25519 + ML-DSA-65 receipt is required');
    const verified = verifyPromotionV2(r, custody.root, now);
    if (!verified.valid) return refuse(`v2 signature verification failed: ${verified.reason}`);
    signerKeyId = custody.root.rootId.slice(0, 16); // display id from the FULL v2 root id
  } else {
    // legacy v1 node — historical Ed25519 path (a v2-bound node never reaches here; grants no v2 action).
    let manifestJson: string;
    try { manifestJson = fs.readFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), 'utf-8'); }
    catch { return refuse('no pinned authority root manifest — run scripts/aumlok-authority.sh keygen first'); }
    const parsed = parseRootManifest(manifestJson);
    if (!parsed.ok) return refuse(`authority root manifest invalid: ${parsed.reason}`);
    const root: AuthorityRoot = parsed.root;
    const verified = verifyPromotionReceipt(input.signedReceipt as SignedPromotionReceipt, root, now);
    if (!verified.valid) return refuse(`signature verification failed: ${verified.reason}`);
    signerKeyId = root.keyId;
  }

  // 3. replay guard — a fast read-only pre-check (the durable, enforcing consume happens after the commit).
  const already = isProposalAlreadyApplied(input.proposalHash, { homeDir });
  if (already) return refuse(`already applied at ${already.appliedAt} as commit ${already.commitSha} — refusing to reapply`);

  // 4. sacred-path + traversal + symlink guard for EVERY file — sacred wins regardless of signature validity.
  const repoRootReal = fs.realpathSync(repoRoot);
  const validated = validateAllFilesOrRefuse(repoRootReal, input.files);
  if (!validated.ok) return refuse(validated.reason);

  // pre-image snapshot (pure, read-only) — audit artifact in the receipt; git revert is the real rollback.
  const preImageFiles = input.files.map((f) => {
    const abs = path.join(repoRootReal, f.relPath);
    let content = '';
    try { content = fs.readFileSync(abs, 'utf-8'); } catch { /* file does not exist yet — empty pre-image */ }
    return { path: f.relPath, content };
  });
  const snapshot = captureSnapshot(preImageFiles, now);
  const preImageSnapshotHash = sha256(JSON.stringify(snapshot));

  // write — only now, after every check has passed. Defensive: any unforeseen write failure (e.g. an
  // edge case validateAllFilesOrRefuse didn't anticipate) must produce a clean refusal, never an
  // uncaught exception — no git command has run yet at this point, so refusing here is always safe.
  try {
    for (const f of input.files) {
      fs.writeFileSync(path.join(repoRootReal, f.relPath), f.content, 'utf-8');
    }
  } catch (e) {
    return refuse(`write failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const commitMessage = [
    `Aukora native live-apply: ${input.goal}`,
    '',
    `proposalHash: ${input.proposalHash}`,
    `signerKeyId: ${signerKeyId}`,
    `signedAt: ${input.signedReceipt.authorization.issuedAt}`,
  ].join('\n');
  const committed = gitCommitExactFiles(repoRootReal, input.files.map((f) => f.relPath), commitMessage);
  if (!committed.ok) return refuse(committed.reason);

  // durable, enforcing consume — AFTER the commit so the ledger records the real commitSha.
  const consumed = consumeProposalOnce(input.proposalHash, committed.commitSha, now, { homeDir });
  if (!consumed.ok) {
    // an extremely rare race: another process committed the same proposal between our pre-check and
    // our commit. The commit we just made is real and cannot be un-made here; surface it honestly.
    if ('corrupt' in consumed) return refuse(`live apply SUCCEEDED (commit ${committed.commitSha}) but the applied-ledger is corrupt and could not record it: ${consumed.reason} — fix the ledger before applying again`);
    return refuse(`live apply SUCCEEDED (commit ${committed.commitSha}) but a concurrent apply already recorded this proposalHash as commit ${consumed.existing.commitSha} — investigate before trusting either commit`);
  }

  const base = {
    schema: 'aumlok-live-apply-receipt-v1' as const,
    version: 1 as const,
    task: input.goal,
    targetFiles: input.files.map((f) => f.relPath),
    proposalHash: input.proposalHash,
    signerKeyId: signerKeyId,
    preImageSnapshotHash,
    commitSha: committed.commitSha,
    rollbackCommand: `git revert ${committed.commitSha}`,
    appliedLive: true as const,
    promotionReady: false as const,
    advisoryOnly: true as const,
    grantsAuthority: false as const,
    createdAt: now,
  };
  const receipt: AumlokLiveApplyReceiptV1 = { ...base, receiptHash: receiptIntegrity(base) };
  return { schema: 'live-apply-result-v1', ok: true, receipt, appliedLive: true };
}

/** The ONLY public, dispatcher-facing entrypoint. Always uses the real, fixed REPO_ROOT and the real
 *  ${AUKORA_SYMBIOTE_HOME} — no caller can redirect this to any other location. */
export function dispatchSignedLiveApply(input: SignedLiveApplyInput, now?: string): LiveApplyResult {
  return applyCore({ now }, input);
}

/** TEST-ONLY. Never imported by the dispatcher or any tool-call surface — repoRoot/homeDir overrides
 *  here would be a live-write redirection vector if they were ever reachable from a tool-call argument. */
export function dispatchSignedLiveApplyForTests(opts: ApplyOptions, input: SignedLiveApplyInput): LiveApplyResult {
  return applyCore(opts, input);
}

/** A live-apply result never grants standing authority — one signature authorizes one exact change. */
export function liveApplyGrantsAuthority(_r: LiveApplyResult): false { return false; }

function realpathOrNull(p: string): string | null {
  try { return fs.realpathSync(p); } catch { return null; }
}

/**
 * Issue #76: confine a caller-supplied receipt path to a TRUSTED location before a byte is read. The path
 * is realpath'd (which resolves any symlink to its real target), and the real target's PARENT must equal —
 * exactly, with the separator boundary implied by an exact directory match, so no `/dir-evil` sibling-prefix
 * slips through — one of:
 *   - <home>/aumlok/receipts            (persisted receipts)
 *   - <home>/aumlok/pending-proposals   (proposal artifacts; the schema check still gates content)
 *   - a temp root (os.tmpdir() or /tmp), and ONLY for a `signed-<...>.json` basename — the exact file the
 *     sign→apply flow writes. A symlink placed inside a trusted dir but pointing OUTSIDE realpath's away
 *     to its true parent, which then fails the match → symlink escape refused.
 * homeDir/extraTmpRoots are overridable for tests only; production reads the real ${AUKORA_SYMBIOTE_HOME}.
 */
export function resolveTrustedReceiptPath(
  filePath: string,
  opts?: { homeDir?: string; extraTmpRoots?: string[] },
): { ok: true; realPath: string } | { ok: false; reason: string } {
  if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, reason: 'no receipt path given' };
  const real = realpathOrNull(filePath);
  if (!real) return { ok: false, reason: `cannot resolve receipt path (missing file or broken symlink): ${filePath}` };
  const parent = realpathOrNull(path.dirname(real)) ?? path.dirname(real);

  const home = opts?.homeDir ?? symbioteHome();
  const flatDirs = [path.join(home, 'aumlok', 'receipts'), path.join(home, 'aumlok', 'pending-proposals')];
  for (const d of flatDirs) {
    const rd = realpathOrNull(d);
    if (rd && parent === rd) return { ok: true, realPath: real };
  }
  if (TMP_SIGNED_BASENAME.test(path.basename(real))) {
    const tmpRoots = [os.tmpdir(), '/tmp', ...(opts?.extraTmpRoots ?? [])];
    for (const t of tmpRoots) {
      const rt = realpathOrNull(t);
      if (rt && parent === rt) return { ok: true, realPath: real };
    }
  }
  return { ok: false, reason: `receipt path is outside the trusted receipt/proposal locations: ${filePath}` };
}

/** Read a signed-promotion-receipt JSON file from disk (the file the owner's terminal produced via
 *  `scripts/aumlok-authority.sh sign`). The REAL cryptographic verification happens inside applyCore's
 *  verifyPromotionReceipt call; this reader's job (issue #76) is to confine the filesystem read to a
 *  trusted location (realpath/symlink-escape/trusted-dir), cap the size before parse, and fail closed on
 *  a bad schema or any unknown top-level key (the SAME allow-list the crypto envelope enforces — one list,
 *  reused). Kept here (not in workbenchCommandLoop.ts) so that module never needs its own direct fs import.
 *
 *  This reader is CONFINEMENT ONLY, never authorization: an ok:true means "a well-shaped receipt was read
 *  from a trusted path", NOT "this receipt authorizes anything". Every caller MUST still pass the result
 *  through dispatchSignedLiveApply → verifyPromotionReceipt (Ed25519 over the pinned root + hash-match +
 *  replay ledger) before a single byte is written. Consuming this output without that downstream gate
 *  would be a hole. */
export function readSignedPromotionReceiptFromFile(
  filePath: string,
  opts?: { homeDir?: string; extraTmpRoots?: string[] },
): { ok: true; signedReceipt: SignedPromotionReceipt | SignedPromotionV2 } | { ok: false; reason: string } {
  const resolved = resolveTrustedReceiptPath(filePath, opts);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const real = resolved.realPath;

  // size cap BEFORE parse — never read/parse an oversized blob into memory
  let size: number;
  try { size = fs.statSync(real).size; } catch (e) { return { ok: false, reason: `cannot stat ${filePath}: ${e instanceof Error ? e.message : String(e)}` }; }
  if (size > MAX_SIGNED_RECEIPT_BYTES) return { ok: false, reason: `signed receipt too large: ${size} bytes > ${MAX_SIGNED_RECEIPT_BYTES} cap (refused before parse)` };

  let raw: string;
  try { raw = fs.readFileSync(real, 'utf-8'); } catch (e) { return { ok: false, reason: `cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}` }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: `invalid JSON in ${filePath}` }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: `not a JSON object: ${filePath}` };
  // schema dispatch — v1 (legacy Ed25519) OR v2 (hybrid Ed25519+ML-DSA). Each enforces the SAME closed
  // top-level allow-list the crypto envelope does (reused, never a drifting copy); an unknown schema, an
  // unknown field, or a wrong v2 suite/mode fails closed HERE, before dispatch. Confinement only — the real
  // authorization is still applyCore's verifyPromotionReceipt / verifyPromotionV2.
  const schema = (parsed as any).schema;
  if (schema === 'aumlok-signed-promotion-v1') {
    if (!Object.keys(parsed).every((k) => SIGNED_PROMOTION_RECEIPT_KEYS.has(k))) return { ok: false, reason: `signed-promotion-receipt has unknown top-level field(s): ${filePath}` };
    return { ok: true, signedReceipt: parsed as SignedPromotionReceipt };
  }
  if (schema === 'aumlok-signed-promotion-v2') {
    if (!Object.keys(parsed).every((k) => SIGNED_PROMOTION_V2_KEYS.has(k))) return { ok: false, reason: `v2 signed-promotion-receipt has unknown top-level field(s): ${filePath}` };
    if ((parsed as any).suite !== AUMLOK_SUITE_V2) return { ok: false, reason: `v2 signed-promotion-receipt has an unknown/downgraded suite: ${filePath}` };
    if ((parsed as any).mode !== AUMLOK_MODE_V2) return { ok: false, reason: `v2 signed-promotion-receipt has a wrong mode: ${filePath}` };
    return { ok: true, signedReceipt: parsed as SignedPromotionV2 };
  }
  return { ok: false, reason: `not a valid signed-promotion-receipt file (schema): ${filePath}` };
}
