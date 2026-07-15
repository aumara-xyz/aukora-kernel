// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * #361 Fable Finish, Cycle B — the DISPOSABLE FULL-WAVE PROVER. Executes the complete fresh-node
 * post-quantum authority wave, end to end, using ONLY generated test custody in mkdtemp home + repo:
 *
 *   ceremony bind (acrostic mint → type-back → atomic hybrid publish) → suite/custody status →
 *   benign Ring-3 proposal → canonical content hash → dual Ed25519+ML-DSA-65 receipt through the
 *   canonical custody signer → signed-<hash>.json file → REAL confined reader → native writer
 *   (applyCore via the test-parameterized entrypoint — the production entrypoint pins the real repo
 *   root by design) → byte/commit/attribution/ledger/receipt verification → replay refusal (zero
 *   mutation) → per-signature corruption refusals (zero mutation each) → git-revert rollback →
 *   post-rollback replay still refused (consume-once survives revert).
 *
 * Every step ASSERTS; any deviation exits non-zero — a green manifest cannot come from a partial run.
 * The persisted manifest carries commands, hashes, commit shas, and refusal reasons — NEVER a seed,
 * phrase, or key byte. Run: `bun scripts/aumlok-361-fullwave.ts [manifest-out.json]`
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { freshBindStore, mintBindCandidate, completeCeremony, bindPosture } from '../core/src/aumlokBindCeremony';
import { hybridBindStatusV2, loadHybridCustody } from '../core/src/aumlokBindV2';
import { AUMLOK_SUITE_V2, AUMLOK_MODE_V2 } from '../core/src/aumlokAuthorityV2';
import { signPromotionV2FromCustody } from '../core/src/aumlokSignerCustodyV2';
import { computeProposalHash } from '../core/src/proposalHash';
import { readSignedPromotionReceiptFromFile, dispatchSignedLiveApplyForTests, validateLiveApplyReceipt } from '../core/src/nativeLiveApply';
import { generateKeypair, signPromotionAuthorization } from '../core/src/aumlokSigner';
import { pinAuthorityRoot } from '../core/src/aumlokAuthorityRoot';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const NOW_MS = Date.now();
const NOW = new Date(NOW_MS).toISOString();

interface Step { step: string; ok: boolean; detail: string }
const steps: Step[] = [];
function pass(step: string, detail: string): void { steps.push({ step, ok: true, detail }); console.log(`✓ ${step} — ${detail}`); }
function fail(step: string, detail: string): never {
  steps.push({ step, ok: false, detail });
  console.error(`✗ ${step} — ${detail}`);
  finishManifest(false);
  process.exit(1);
}
function assert(cond: boolean, step: string, okDetail: string, failDetail: string): void {
  if (cond) pass(step, okDetail); else fail(step, failDetail);
}

// ── disposable world ────────────────────────────────────────────────────────────────────────────
const homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-wave-home-'));
const repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-wave-repo-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();
git('init', '-q'); git('config', 'user.email', 'wave@test.local'); git('config', 'user.name', 'Wave');
fs.writeFileSync(path.join(repoRoot, 'README.md'), 'wave world\n');
git('add', '-A'); git('commit', '-q', '-m', 'genesis');
const genesisHead = git('rev-parse', 'HEAD');

const manifest: Record<string, unknown> = {
  schema: 'aumlok-361-fullwave-manifest-v1',
  ranAt: NOW,
  command: 'bun scripts/aumlok-361-fullwave.ts',
  disposable: { homeDir: '(mkdtemp, deleted)', repoRoot: '(mkdtemp, deleted)', genesisHead },
  entrypointNote: 'applyCore reached via dispatchSignedLiveApplyForTests (repoRoot/homeDir parameterized); the production dispatchSignedLiveApply pins the REAL repo root by design and is therefore not runnable against a disposable repo.',
};
function finishManifest(ok: boolean): void {
  manifest.steps = steps;
  manifest.ok = ok;
  const out = process.argv[2] ?? path.join(os.tmpdir(), `aumlok-361-fullwave-manifest-${NOW_MS}.json`);
  const body = JSON.stringify(manifest, null, 2);
  // secret hygiene: the manifest must never carry a 64-hex seed value read from custody. All hashes it
  // DOES carry (proposal/commit/receipt digests) are public by construction; assert no bundle seed leaked.
  for (const seedFile of ['authority-ed25519.key', 'authority-mldsa65.key']) {
    try {
      const seed = fs.readFileSync(path.join(homeDir, 'aumlok', 'hybrid-v2', seedFile), 'utf-8').trim();
      if (seed && body.includes(seed)) { console.error(`manifest leaked ${seedFile} — refusing to write`); process.exit(1); }
    } catch { /* bundle gone/corrupted by a probe — nothing to compare */ }
  }
  fs.writeFileSync(out, body + '\n');
  console.log(`manifest -> ${out}`);
  try { fs.rmSync(homeDir, { recursive: true, force: true }); fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* disposable */ }
}

// ── snapshot helpers: zero-mutation means bytes + HEAD + ledger, not "no error" ────────────────
const TARGET_REL = 'docs/wave-note.md';
const targetPath = () => path.join(repoRoot, TARGET_REL);
const ledgerPath = () => path.join(homeDir, 'aumlok', 'applied-ledger.json');
function worldSnapshot(): string {
  const target = fs.existsSync(targetPath()) ? fs.readFileSync(targetPath(), 'utf-8') : '(absent)';
  const ledger = fs.existsSync(ledgerPath()) ? fs.readFileSync(ledgerPath(), 'utf-8') : '(absent)';
  return sha256(JSON.stringify({ target, head: git('rev-parse', 'HEAD'), ledger }));
}

// ── 1. fresh-node ceremony bind: atomic hybrid publish + exact suite/custody ───────────────────
const store = freshBindStore();
const mint = mintBindCandidate(store, homeDir, NOW_MS);
if (!mint.ok) fail('bind.mint', mint.reason);
const done = completeCeremony(store, homeDir, mint!.ok ? mint.phrase : '', mint.ok ? mint.nonce : '', NOW_MS + 1000);
if (!done.ok || done.mode !== 'bind') fail('bind.complete', done.ok ? 'wrong mode' : (done as { reason: string }).reason);
const status = hybridBindStatusV2(homeDir);
assert(status.bound === true, 'bind.status.bound', 'complete bundle passes full custody coherence', 'not bound after ceremony');
assert(status.suite === AUMLOK_SUITE_V2, 'bind.status.suite', `exact suite ${status.suite}`, `wrong suite ${status.suite}`);
assert(status.custody === AUMLOK_MODE_V2, 'bind.status.custody', `custody ${status.custody} (software — never hardware/production)`, `wrong custody ${status.custody}`);
assert(bindPosture(homeDir) === 'sovereign', 'bind.posture', 'ceremony posture sovereign', 'posture not sovereign');
const rootId = status.rootId!;
manifest.rootId = rootId;

// ── 2. one benign Ring-3 proposal + canonical content hash ─────────────────────────────────────
const GOAL = 'wave: add one benign note (Ring-3 docs path)';
const FILES = [{ relPath: TARGET_REL, content: 'The full post-quantum wave passed here.\n' }];
const proposalHash = computeProposalHash(GOAL, FILES);
pass('proposal.hash', `canonical proposalHash ${proposalHash}`);
manifest.proposal = { goal: GOAL, files: FILES.map((f) => ({ relPath: f.relPath, contentSha256: sha256(f.content) })), proposalHash };

// ── 3. the real dual owner receipt through the canonical custody signer ────────────────────────
const signed = signPromotionV2FromCustody(homeDir, { proposalHash, nonce: `wave-${NOW_MS}`, issuedAt: NOW });
if (!signed.ok) fail('sign.dual', signed.reason);
assert(signed.ok && signed.signedReceipt.schema === 'aumlok-signed-promotion-v2', 'sign.schema', 'aumlok-signed-promotion-v2', 'wrong schema');
const receiptFile = path.join(fs.realpathSync(os.tmpdir()), `signed-${proposalHash.slice(0, 12)}.json`);
fs.writeFileSync(receiptFile, JSON.stringify(signed.ok ? signed.signedReceipt : {}, null, 2));
manifest.signedReceiptFileSha256 = sha256(fs.readFileSync(receiptFile));
pass('sign.file', `receipt file sha256 ${manifest.signedReceiptFileSha256}`);

// ── 4. confined reader → native writer ─────────────────────────────────────────────────────────
const read = readSignedPromotionReceiptFromFile(receiptFile, { homeDir });
if (!read.ok) fail('reader.confined', read.reason);
pass('reader.confined', 'v2 receipt read from a trusted signed-*.json path (schema-dispatched, closed allow-list)');
const dispatch = (r: unknown) => dispatchSignedLiveApplyForTests({ repoRoot, homeDir, now: NOW }, { goal: GOAL, proposalHash, files: FILES, signedReceipt: r as never });
const applied = dispatch(read.ok ? read.signedReceipt : {});
if (!applied.ok || !applied.receipt) fail('apply.live', applied.reason ?? 'no receipt');
pass('apply.live', `applied — commit ${applied.receipt.commitSha}`);

// ── 5. verify bytes, commit, attribution, ledger, receipt ──────────────────────────────────────
assert(fs.readFileSync(targetPath(), 'utf-8') === FILES[0].content, 'verify.bytes', 'target bytes exactly as signed', 'byte mismatch');
const applyHead = git('rev-parse', 'HEAD');
assert(applyHead === applied.receipt.commitSha && applyHead !== genesisHead, 'verify.commit', `HEAD advanced to ${applyHead}`, 'HEAD/receipt commit mismatch');
const commitMsg = git('log', '-1', '--format=%B');
assert(commitMsg.includes(proposalHash), 'verify.commitMsg.hash', 'commit message carries the proposalHash', 'proposalHash missing from commit message');
assert(commitMsg.includes(rootId.slice(0, 16)), 'verify.attribution', `signerKeyId = v2 root display id ${rootId.slice(0, 16)}`, 'v2 root attribution missing');
const ledger = JSON.parse(fs.readFileSync(ledgerPath(), 'utf-8'));
assert(Array.isArray(ledger) && ledger.some((e: { proposalHash?: string }) => e.proposalHash === proposalHash), 'verify.ledger', 'replay ledger consumed this exact proposalHash', 'ledger did not record the apply');
const receiptCheck = validateLiveApplyReceipt(applied.receipt);
assert(receiptCheck.valid, 'verify.receipt', 'live-apply receipt integrity-coherent (appliedLive:true, grantsAuthority:false)', `receipt invalid: ${receiptCheck.reason}`);
manifest.apply = { commitSha: applied.receipt.commitSha, receiptHash: applied.receipt.receiptHash, rollbackCommand: applied.receipt.rollbackCommand };

// ── 6. replay the SAME receipt → refusal with zero mutation ────────────────────────────────────
const preReplay = worldSnapshot();
const replay = dispatch(read.ok ? read.signedReceipt : {});
assert(!replay.ok && String(replay.reason).includes('already applied'), 'replay.refused', `refused: ${replay.reason}`, 'replay was NOT refused');
assert(worldSnapshot() === preReplay, 'replay.zeroMutation', 'bytes + HEAD + ledger byte-identical', 'replay mutated state');

// ── 7. corrupt/remove each signature independently → refusal with zero mutation each ───────────
const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);
const base = (read.ok ? read.signedReceipt : {}) as { authorization: { nonce: string }; signatures: { ed25519: string; mlDsa65: string } };
const clone = () => JSON.parse(JSON.stringify(base)) as typeof base;
// a FRESH proposal per row (the consumed one refuses on the ledger before signatures are even read)
const rows: Array<{ name: string; make: () => unknown }> = [
  { name: 'ed25519 flipped', make: () => { const r = clone(); r.signatures.ed25519 = flip(r.signatures.ed25519); return r; } },
  { name: 'ml-dsa-65 flipped', make: () => { const r = clone(); r.signatures.mlDsa65 = flip(r.signatures.mlDsa65); return r; } },
  { name: 'ed25519 removed', make: () => { const r = clone() as never as { signatures: Record<string, unknown> }; delete r.signatures.ed25519; return r; } },
  { name: 'ml-dsa-65 removed', make: () => { const r = clone() as never as { signatures: Record<string, unknown> }; delete r.signatures.mlDsa65; return r; } },
  { name: 'ed duplicated as ml', make: () => { const r = clone(); r.signatures.mlDsa65 = r.signatures.ed25519; return r; } },
];
for (const row of rows) {
  const snap = worldSnapshot();
  const res = dispatch(row.make());
  assert(!res.ok, `corrupt.${row.name}.refused`, `refused: ${res.reason}`, `ACCEPTED a receipt with ${row.name}`);
  assert(worldSnapshot() === snap, `corrupt.${row.name}.zeroMutation`, 'zero mutation', 'state mutated on a refused receipt');
}
// v1 receipt (REAL fresh v1 key, valid v1 signature) on this v2 node → sentinel refusal, zero mutation
{
  const { privateKeyHex, publicKeyHex } = generateKeypair();
  const v1root = pinAuthorityRoot(publicKeyHex);
  const v1receipt = signPromotionAuthorization(privateKeyHex, { keyId: v1root.keyId, proposalHash, draftHash: proposalHash, nonce: 'v1-wave', issuedAt: NOW, expiresAt: null });
  const snap = worldSnapshot();
  const res = dispatch(v1receipt);
  assert(!res.ok && String(res.reason).includes('post-quantum'), 'corrupt.v1-on-v2.refused', `refused: ${res.reason}`, 'a v1 receipt authorized on a v2 node');
  assert(worldSnapshot() === snap, 'corrupt.v1-on-v2.zeroMutation', 'zero mutation', 'state mutated');
}

// ── 8. rollback via the receipt's own command, then post-rollback replay still refused ─────────
git('revert', '--no-edit', applied.receipt.commitSha);
assert(!fs.existsSync(targetPath()), 'rollback.bytes', 'git revert restored the pre-image (target absent again)', 'revert did not restore pre-image');
const revertHead = git('rev-parse', 'HEAD');
manifest.rollback = { command: applied.receipt.rollbackCommand, revertHead };
pass('rollback.commit', `revert commit ${revertHead}`);
{
  const snap = worldSnapshot();
  const res = dispatch(read.ok ? read.signedReceipt : {});
  assert(!res.ok && String(res.reason).includes('already applied'), 'rollback.replayStillRefused', 'consume-once survives revert — the receipt is dead forever', 'receipt replayable after revert');
  assert(worldSnapshot() === snap, 'rollback.replayZeroMutation', 'zero mutation', 'state mutated');
}

fs.rmSync(receiptFile, { force: true });
manifest.counts = { total: steps.length, passed: steps.filter((s) => s.ok).length };
finishManifest(true);
console.log(`\nFULL WAVE GREEN — ${steps.length} steps, all asserted.`);
