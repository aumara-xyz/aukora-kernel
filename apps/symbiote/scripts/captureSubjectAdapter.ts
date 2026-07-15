// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Capture-subject ceremony adapter — mints and serves the dedicated `capture.door` write subject
 * for the live conversation shadow-capture lane (docs/CONVEX_SHADOW_WRITE_PLAN.md piece 2).
 *
 * This lives in scripts/ (not core/) for the same reason as scripts/memoryRecallAdapter.ts: it
 * imports the kernel's OWN head/signing machinery from convex/ so client signatures can never
 * drift from what the kernel verifies — and core/ is typechecked in isolation and must stay
 * convex-free. spatial/shadowCapture.ts loads this LAZILY on the first captured turn.
 *
 * Custody law (never weakened here):
 *   - admin key       ~/.aukora-symbiote/convex/admin-key.txt      (readAdminKeyStrict — 0600/0400)
 *   - owner root seed ~/.aukora-symbiote/convex/memory-root.seed   (readOwnerSeedStrict — 0600/0400)
 *   - operator seed   ~/.aukora-symbiote/convex/operator.seed      (same strict rules, local check)
 *   - capture SUBJECT seed: EPHEMERAL — generated per process, held in memory only, NEVER written
 *     to disk (the m4MigrateAtoms precedent). When the manifest expires the subject's authority is
 *     gone; only the owner root remains.
 *   Any custody violation is a TYPED refusal the door surfaces — capture refuses, chat proceeds.
 *   KNOWN HONEST LIMIT (2026-07-07, probed): on Windows, bun/node fabricate mode 0666 for every
 *   writable file, so the strict 0600 checks refuse BY CONSTRUCTION on Windows nodes. That is
 *   fail-closed (no write can happen), stated here rather than papered over. Windows custody
 *   parity is its own future brick — do not relax the checks to "make it work".
 *
 * The ceremony (runtime path, once per door process, resume-safe — copies scripts/m4MigrateAtoms.ts):
 *   1. loopback + admin-key custody + backend /version;
 *   2. popResolver:seedOperatorKey (idempotent, env-derived on the backend);
 *   3. aumlokRootRegistry:aumlokGenesisMint of the owner root — catching /exists|duplicate|already/i
 *      as "resume mode" (on a live brain the root exists; never re-genesis);
 *   4. aumlokManifests:aumlokMintManifest of a FRESH, tightly-bounded capture manifest
 *      (root → capture.door, memory.write on mem:{owner}, 12h window, 500 uses max);
 *   5. hand back a writer whose `nextUse` leases strictly-monotonic useSeqs and signs
 *      consumeHead(req) under `aumlokSubjectPop` with the in-memory subject seed.
 *
 * CLI (owner ceremonies, NOT called by the door):
 *   bun scripts/captureSubjectAdapter.ts provision   # fresh node: secrets + kernel deploy (needs npx)
 *   bun scripts/captureSubjectAdapter.ts status      # verify counts + chain head (read-only)
 *   bun scripts/captureSubjectAdapter.ts recall <key>          # owner-signed value read-back
 *   bun scripts/captureSubjectAdapter.ts erase <key> <reason>  # owner-signed receipted erase (stub remains)
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { readAdminKeyStrict, ADMIN_KEY_DIR, ADMIN_KEY_PATH, DEFAULT_BRAIN_URL } from '../core/src/memoryKernelTransport';
import { readOwnerSeedStrict } from '../core/src/memoryRecall';
import { verifyWindowsKeyFileCustody, WindowsCustodyError } from '../core/src/windowsKeyCustody';
import { isLoopbackUrl } from '../core/src/convexBrainReadonly';
import type { CaptureUseLease } from '../core/src/conversationShadowCapture';
// The kernel's OWN machinery — imported, never mirrored (client sigs can never drift from the kernel).
import { signChainHeadV3 } from '../convex/aukoraSignedHead';
import { consumeHead, manifestRootHead, manifestPopHead } from '../convex/aumlokManifests';
import { recallHead, eraseHead } from '../convex/aumlokMemory';
import { buildPoPEnvelope } from '../convex/popResolver';
import { mlDsa65PublicKeyFromSeed } from '../convex/aukoraPqcSigner';

export const OWNER_ROOT_ID = 'aumara.root';       // the owner's pseudonymous root (M4 constant)
export const CAPTURE_SUBJECT_ID = 'capture.door'; // honest attribution on every captured row
const NODE_ID = process.env.AUMA_NODE_ID ?? 'aukora-brain-local'; // must equal the BACKEND's env
const URL = process.env.AUKORA_CONVEX_URL ?? DEFAULT_BRAIN_URL;
const KEY_DIR = process.env.AUKORA_CONVEX_KEY_DIR ? path.resolve(process.env.AUKORA_CONVEX_KEY_DIR) : ADMIN_KEY_DIR;
const KEY_PATH = process.env.AUKORA_CONVEX_KEY_DIR ? path.join(KEY_DIR, 'admin-key.txt') : ADMIN_KEY_PATH;
const ROOT_SEED_PATH = path.join(KEY_DIR, 'memory-root.seed');
const OPERATOR_SEED_PATH = path.join(KEY_DIR, 'operator.seed');

/** Manifest bounds: generous for a chatting day, still hard-bounded. A spent/expired manifest
 *  refuses loudly and the door mints a fresh one on the NEXT turn (no retry loop). */
export const CAPTURE_MANIFEST_WINDOW_MS = 12 * 3_600_000;
export const CAPTURE_MANIFEST_MAX_USES = 500;

export type EnsureWriterResult =
  | { ok: true; writer: CaptureWriter }
  | { ok: false; refused: string };

export interface CaptureWriter {
  ownerRootId: string;
  deploymentUrl: string;
  manifestId: string;
  expiresAt: number;
  /** Lease the next manifest use. THROWS typed reasons on an exhausted/expired manifest — the
   *  caller treats that as a refusal and drops this writer so the next turn re-ceremonies. */
  nextUse: () => Promise<CaptureUseLease>;
}

/** Strict custody read for the operator seed (same per-platform law as readOwnerSeedStrict:
 *  POSIX mode bits on Mac/Linux, native ACL allowlist on Windows; local codes). */
function readOperatorSeedStrict(p: string = OPERATOR_SEED_PATH): string {
  let st;
  try { st = fs.lstatSync(p); } catch { throw new Error(`operator_seed_missing: no operator seed at ${p} — run: bun scripts/captureSubjectAdapter.ts provision`); }
  if (st.isSymbolicLink()) throw new Error(`operator_seed_symlink_refused: ${p}`);
  if (!st.isFile()) throw new Error(`operator_seed_not_regular_file: ${p}`);
  if (process.platform === 'win32') {
    try { verifyWindowsKeyFileCustody(p); } catch (e) { throw new Error(`operator_seed_${e instanceof WindowsCustodyError ? e.code : 'windows_custody_failed'}: ${e instanceof Error ? e.message : String(e)}`); }
  } else if ((st.mode & 0o077) !== 0) throw new Error(`operator_seed_permissions_open: ${p} (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it`);
  const raw = fs.readFileSync(p, 'utf-8').trim();
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error(`operator_seed_malformed: ${p} must hold a single 64-hex seed`);
  return raw.toLowerCase();
}

// Ceremony-scoped admin client (m4MigrateAtoms pattern): loopback + custody + EXACT allowlist.
// Memory WRITES never travel here — they go through memoryAppend + createGovernedHttpInvoke.
const CEREMONY_MUTATIONS = new Set([
  'popResolver:seedOperatorKey',
  'aumlokRootRegistry:aumlokGenesisMint',
  'aumlokManifests:aumlokMintManifest',
  'aumlokMemory:aumlokMemoryErase', // owner-signed cleanup ceremony (CLI only)
]);
const READ_QUERIES = new Set(['aumlokMemory:aumlokMemoryVerify', 'aumlokMemory:aumlokMemoryRecall', 'aukoraReceipts:getReceiptChainHeadPublic']);
async function adminCall(kind: 'mutation' | 'query', fnPath: string, args: unknown): Promise<any> {
  if (!isLoopbackUrl(URL)) throw new Error('capture_nonloopback_refused: the ceremony is local-only by law');
  if (kind === 'mutation' && !CEREMONY_MUTATIONS.has(fnPath)) throw new Error(`capture_ceremony_not_allowlisted: ${fnPath}`);
  if (kind === 'query' && !READ_QUERIES.has(fnPath)) throw new Error(`capture_query_not_allowlisted: ${fnPath}`);
  const adminKey = readAdminKeyStrict(KEY_PATH);
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ path: fnPath, args, format: 'json' }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.text();
  if (raw.length > 4_000_000) throw new Error(`capture_oversized_response: ${fnPath}`);
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`capture_malformed_response: ${fnPath}: ${raw.slice(0, 200)}`); }
  if (parsed.status === 'error') throw new Error(String(parsed.errorMessage ?? 'kernel error'));
  if (parsed.status !== 'success') throw new Error(`capture_unexpected_envelope: ${fnPath}: ${raw.slice(0, 200)}`);
  return parsed.value;
}

/**
 * Runtime ceremony: strict custody reads → operator key → owner root (resume-safe) → fresh capture
 * manifest → writer. Returns a typed refusal instead of throwing — the door surfaces it and chat
 * proceeds. Creates NOTHING on disk: a node without seeds refuses and names the provision command.
 */
export async function ensureCaptureWriter(): Promise<EnsureWriterResult> {
  const refuse = (reason: string): EnsureWriterResult => ({ ok: false, refused: reason });
  let rootSeed: string, operatorSeed: string;
  try {
    readAdminKeyStrict(KEY_PATH); // custody gate up front — the transport re-reads per write
    rootSeed = readOwnerSeedStrict(ROOT_SEED_PATH);
    operatorSeed = readOperatorSeedStrict();
  } catch (e) {
    return refuse(e instanceof Error ? e.message : String(e));
  }
  if (!isLoopbackUrl(URL)) return refuse('capture_nonloopback_refused');
  const version = await fetch(`${URL}/version`, { signal: AbortSignal.timeout(5_000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (!version) return refuse(`capture_backend_down: no backend at ${URL} — run: bun run brain`);

  try {
    await adminCall('mutation', 'popResolver:seedOperatorKey', {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/FunctionPathNotFound|couldn't find/i.test(msg)) {
      return refuse('capture_kernel_not_deployed: the governed kernel is not on this backend — run: bun scripts/captureSubjectAdapter.ts provision');
    }
    return refuse(`capture_operator_seed_failed: ${msg}`);
  }

  const now = Date.now();
  // owner root genesis — resume-safe, exactly the m4 pattern (never re-genesis a live root).
  try {
    const rootPub = await mlDsa65PublicKeyFromSeed(rootSeed);
    const FOUNDER = 'aukora.operator', FOUNDER_KEY = 'op-1';
    const cav = {
      v: 1, capId: `cap-capture-genesis-${now}`, founderUserId: FOUNDER, founderKeyId: FOUNDER_KEY,
      nodeId: NODE_ID, methods: ['aumlokGenesisMint'], ring: 'local-write', action: 'aumlok',
      resource: 'aumlok:root', principalId: FOUNDER, roles: ['operator'],
      notBefore: now - 1000, expiresAt: now + 110_000, maxUses: 1,
    };
    const gArgs = { rootId: OWNER_ROOT_ID, keyId: 'rk-1', publicKey: rootPub };
    const gEnv = await buildPoPEnvelope(operatorSeed, cav, { methodId: 'aumlokGenesisMint', actualArgs: gArgs, timestamp: Date.now(), nonce: `capture-g-${now}` });
    await adminCall('mutation', 'aumlokRootRegistry:aumlokGenesisMint', { env: gEnv, actualArgs: gArgs, nodeId: NODE_ID });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/exists|duplicate|already/i.test(msg)) return refuse(`capture_root_genesis_failed: ${msg}`);
    // root already exists — resume mode.
  }

  // fresh, tightly-bounded manifest; EPHEMERAL subject seed (memory only, never on disk).
  const subjectSeed = randomBytes(32).toString('hex');
  const manifestId = `mft-capture-${now}`;
  const expiresAt = now + CAPTURE_MANIFEST_WINDOW_MS;
  try {
    const subjectPub = await mlDsa65PublicKeyFromSeed(subjectSeed);
    const manifest = {
      v: 1, manifestId, rootId: OWNER_ROOT_ID, rootKeyId: 'rk-1', nodeId: NODE_ID,
      subjectId: CAPTURE_SUBJECT_ID, subjectKind: 'agent', subjectPubKey: subjectPub,
      permissions: [{ ring: 'local-write', action: 'memory.write', resource: `mem:${OWNER_ROOT_ID}` }],
      allowedIntentCodecs: ['json_action_v1'], notBefore: now - 1000, expiresAt,
      maxUses: CAPTURE_MANIFEST_MAX_USES, maxPerWindow: null, createdAt: now,
    };
    const rootSig = await signChainHeadV3(rootSeed, await manifestRootHead(manifest), 'aumlokManifest');
    const subjectPopSig = await signChainHeadV3(subjectSeed, await manifestPopHead(manifest), 'aumlokSubjectPop');
    await adminCall('mutation', 'aumlokManifests:aumlokMintManifest', { manifest, rootSig, subjectPopSig });
  } catch (e) {
    return refuse(`capture_manifest_mint_failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The writer: strictly-monotonic local seq starting at 0 (fresh manifest, usedCount 0);
  // advances ONLY on kernel-confirmed success (captureTurn calls lease.onSuccess).
  let useSeq = 0;
  const writer: CaptureWriter = {
    ownerRootId: OWNER_ROOT_ID,
    deploymentUrl: URL,
    manifestId,
    expiresAt,
    nextUse: async () => {
      if (Date.now() >= expiresAt) throw new Error('capture_manifest_expired');
      if (useSeq >= CAPTURE_MANIFEST_MAX_USES) throw new Error('capture_manifest_exhausted');
      const seq = useSeq;
      return {
        manifestId,
        subjectId: CAPTURE_SUBJECT_ID,
        useSeq: seq,
        signConsume: (req: Record<string, unknown>) => (async () => signChainHeadV3(subjectSeed, await consumeHead(req), 'aumlokSubjectPop'))(),
        onSuccess: () => { useSeq = seq + 1; },
      };
    },
  };
  return { ok: true, writer };
}

// ── owner ceremonies (CLI only; never called by the door) ──────────────────────────────────────

function loadOrCreateSecret(name: string, generate: () => string): string {
  const p = path.join(KEY_DIR, name);
  if (fs.existsSync(p)) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${p} exists but fails custody`);
    if (process.platform === 'win32') {
      try { verifyWindowsKeyFileCustody(p); } catch (e) { throw new Error(`${p} fails Windows ACL custody: ${e instanceof WindowsCustodyError ? e.message : String(e)}`); }
    } else if ((st.mode & 0o077) !== 0) throw new Error(`${p} exists but fails custody (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it`);
    const v = fs.readFileSync(p, 'utf8').trim();
    if (!v) throw new Error(`${p} is empty`);
    return v;
  }
  const v = generate();
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, v, { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  console.log(`generated ${name} (0600, custody dir)`);
  return v;
}

/** The convex CLI runner for owner ceremonies: prefers `npx` (node boxes — Peter's Mac), falls
 *  back to `bun x` (bun-only boxes — probed working on zeb-windows-node, convex 1.42.1). Both are
 *  ARGUMENT ARRAYS through execFileSync — no shell, no interpolation. */
function convexCliRunner(): { label: string; needsLocalModules: boolean; run: (args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => string } {
  const attempt = (cmd: string, prefix: string[]) => {
    try { execFileSync(cmd, [...prefix, '--version'], { stdio: 'pipe', timeout: 120_000 }); return true; } catch { return false; }
  };
  if (attempt('npx', ['convex'])) {
    // node boxes: the copied convex/node_modules make this work offline (m4 pattern).
    return { label: 'npx convex', needsLocalModules: true, run: (args, o) => execFileSync('npx', ['convex', ...args], { cwd: o.cwd, stdio: 'pipe', timeout: 300_000, env: o.env }).toString() };
  }
  if (attempt('bun', ['x', `convex@${CONVEX_CLI_PIN}`])) {
    // bun-only boxes: the PINNED CLI runs from bunx's cache (full dep tree incl. esbuild); the
    // app root gets its OWN `bun install` (deployKernel) so the functions bundle resolves the
    // kernel's real dependency tree. The version pin differing from the app-local package is what
    // keeps bunx on its cached CLI instead of the local bin (probed 2026-07-07).
    return { label: `bun x convex@${CONVEX_CLI_PIN}`, needsLocalModules: false, run: (args, o) => execFileSync('bun', ['x', `convex@${CONVEX_CLI_PIN}`, ...args], { cwd: o.cwd, stdio: 'pipe', timeout: 300_000, env: o.env }).toString() };
  }
  throw new Error('no convex CLI runner available (neither npx nor bun x can run convex) — install Node LTS or Bun');
}
/** The pinned convex CLI for the bunx path: 1.40.0 per the known-issues ledger in
 *  docs/NEBIUS_DEPLOY_PRACTICE.md (1.42.1's esbuild fails resolving convex/server; 1.40.0 deploys
 *  clean — keep the repro, unpin when upstream reproduces clean). Bump deliberately, ledger-first. */
const CONVEX_CLI_PIN = '1.40.0';

/** Deploy the MERGED kernel (this checkout's convex/) to the local backend — the safe repeatable
 *  path for scoring the R5b candidate and for any kernel update: temp app root, env preserved,
 *  deploy, then the zero-function footgun check. Secrets must already exist (use `provision` on a
 *  fresh node). Additive schema changes (e.g. the search index) backfill on deploy.
 *  EXPORTED so scripts/m4MigrateAtoms.ts reuses THIS runner (pin-ledger discipline) instead of
 *  carrying its own pre-pin copy that broke on the 1.42.1 esbuild issue. */
export async function deployKernel(opts: { withEnv?: { operatorSeed: string; tokenSecret: string; chainSeed: string } } = {}): Promise<void> {
  const adminKey = readAdminKeyStrict(KEY_PATH);
  const REPO = path.resolve(__dirname, '..');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-capture-app-'));
  fs.mkdirSync(path.join(app, 'convex'));
  for (const f of fs.readdirSync(path.join(REPO, 'convex'))) {
    if (f.endsWith('.ts')) fs.copyFileSync(path.join(REPO, 'convex', f), path.join(app, 'convex', f));
  }
  // the app root carries the KERNEL'S OWN dependency list (convex/package.json) so the functions
  // bundle resolves everything (@noble/post-quantum → @noble/curves etc.) exactly as the kernel
  // declares it — never a hand-maintained subset that drifts.
  const kernelPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'convex', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'aukora-capture-approot', private: true, dependencies: kernelPkg.dependencies ?? {} }, null, 2) + '\n');
  const runner = convexCliRunner();
  if (runner.needsLocalModules) {
    // npx/node boxes: the npm-layout copy works offline (m4 pattern). dereference: bun lays out
    // node_modules with junctions on Windows; copying links raises EPERM (probed 2026-07-07).
    fs.cpSync(path.join(REPO, 'convex', 'node_modules'), path.join(app, 'node_modules'), { recursive: true, dereference: true });
  } else {
    // bunx boxes: a real `bun install` in the app root builds a correct resolvable tree from
    // bun's cache — the copied bun-store layout does NOT survive relocation (probed: nested
    // @noble/curves became unresolvable to esbuild).
    execFileSync('bun', ['install'], { cwd: app, stdio: 'pipe', timeout: 300_000 });
  }
  console.log(`deploying with: ${runner.label}`);
  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: URL, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey, CI: '1' };
  const cli = (args: string[]) => runner.run(args, { cwd: app, env });
  try {
    if (opts.withEnv) {
      cli(['env', 'set', 'AUMA_NODE_ID', NODE_ID]);
      cli(['env', 'set', 'AUKORA_TOKEN_SECRET', opts.withEnv.tokenSecret]);
      cli(['env', 'set', 'AUKORA_CHAIN_SIGNING_SEED', opts.withEnv.chainSeed]);
      cli(['env', 'set', 'AUMA_OPERATOR_SEED', opts.withEnv.operatorSeed]);
    }
    cli(['deploy', '-y']);
    const spec = cli(['function-spec']);
    if (!/aumlokMemory/.test(spec)) throw new Error('governed functions NOT in deployed spec (zero-function footgun)');
    if (!/aumlokMemorySearch/.test(spec)) throw new Error('R5b search function NOT in deployed spec — is this checkout behind main?');
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
  console.log(`kernel deployed to ${URL} (function-spec verified: governed memory + R5b search present)`);
}

/** Fresh-node provision (m4 step 2): custody secrets + backend env + kernel deploy. */
async function provision(): Promise<void> {
  const operatorSeed = loadOrCreateSecret('operator.seed', () => randomBytes(32).toString('hex'));
  loadOrCreateSecret('memory-root.seed', () => randomBytes(32).toString('hex'));
  const tokenSecret = loadOrCreateSecret('token-secret.txt', () => randomBytes(32).toString('hex'));
  const chainSeed = loadOrCreateSecret('chain-signing.seed', () => randomBytes(32).toString('hex'));
  await deployKernel({ withEnv: { operatorSeed, tokenSecret, chainSeed } });
  console.log(`provisioned: custody secrets under ${KEY_DIR}, kernel live at ${URL} (node id ${NODE_ID})`);
}

async function cliStatus(): Promise<void> {
  const verify = await adminCall('query', 'aumlokMemory:aumlokMemoryVerify', { ownerRootId: OWNER_ROOT_ID });
  console.log(JSON.stringify({ backend: URL, verify }, null, 2));
}

async function cliRecall(key: string): Promise<void> {
  const rootSeed = readOwnerSeedStrict(ROOT_SEED_PATH);
  const r = { v: 1, ownerRootId: OWNER_ROOT_ID, key, readerPrincipalId: OWNER_ROOT_ID, timestamp: Date.now() };
  const readerSig = await signChainHeadV3(rootSeed, await recallHead(r), 'aumlokMemRecall');
  const res = await adminCall('query', 'aumlokMemory:aumlokMemoryRecall', { req: r, readerSig });
  console.log(JSON.stringify(res, null, 2));
  const head = await adminCall('query', 'aukoraReceipts:getReceiptChainHeadPublic', { chainKey: `mem:${OWNER_ROOT_ID}:${key}` });
  console.log('receipt chain head:', JSON.stringify(head, null, 2));
}

async function cliErase(key: string, reason: string): Promise<void> {
  const rootSeed = readOwnerSeedStrict(ROOT_SEED_PATH);
  const r = { v: 1, ownerRootId: OWNER_ROOT_ID, key, eraseReason: reason, timestamp: Date.now() };
  const ownerSig = await signChainHeadV3(rootSeed, await eraseHead(r), 'aumlokMemErase');
  const res = await adminCall('mutation', 'aumlokMemory:aumlokMemoryErase', { req: r, ownerSig });
  console.log(JSON.stringify(res, null, 2));
}

// CLI gate without import.meta (core's tsc module setting forbids it): only run when THIS file is
// the entry script. The door's runtime import of ensureCaptureWriter never trips this.
const RUN_AS_CLI = /captureSubjectAdapter\.(ts|js)$/.test(process.argv[1] ?? '');
if (RUN_AS_CLI) {
  const [cmd, a1, a2] = process.argv.slice(2);
  const run = async () => {
    if (cmd === 'provision') return provision();
    if (cmd === 'deploy') return deployKernel(); // existing node: push the merged kernel (secrets untouched)
    if (cmd === 'status') return cliStatus();
    if (cmd === 'recall' && a1) return cliRecall(a1);
    if (cmd === 'erase' && a1 && a2) return cliErase(a1, a2);
    console.log('usage: bun scripts/captureSubjectAdapter.ts provision|deploy|status|recall <key>|erase <key> <reason>');
  };
  run().catch((e) => { console.error(`refused: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
