// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Brick M4 — the migration ceremony: the 77 JSON atoms come home to the Convex kernel.
 * Owner-approved 2026-07-05 ("ok next round, i approve what ya need" — the explicit M4 go the
 * crew required; recorded in docs/INBOX.md + GH #103).
 *
 * This is an OWNER-CEREMONY script (like brain.sh provision), not a runtime module. Nothing in
 * core/ or spatial/ imports it; memory rows still flow ONLY through core/src/memoryAppend.ts —
 * this script is a CLIENT of that one path. The identity bootstrap below (operator key → root
 * genesis → migration manifest) is a provisioning ceremony over the admin credential, the same
 * trust tier as `brain.sh provision`; it is NOT a new runtime write surface, and it is disclosed
 * in the commit + inbox rather than hidden behind the invariant test's scan scope.
 *
 * CEREMONY (every step fail-closed; re-runnable — each step skips work already done):
 *   0. preflight the SOURCE (core/src/migrationPreflight.ts — the independent verifier) with the
 *      REAL ownerRootId; ABORT WHOLESALE unless ok.
 *   1. the LOCAL backend must be up (brain.sh start) at loopback; assert /version.
 *   2. deploy the vendored kernel + deployment env (AUMA_NODE_ID, AUKORA_TOKEN_SECRET,
 *      AUKORA_CHAIN_SIGNING_SEED, AUMA_OPERATOR_SEED) — the live-proof recipe, persistent target.
 *      All secrets generated once into ~/.aukora-symbiote/convex/ at 0600 (custody dir, not repo).
 *   3. bootstrap identities: seedOperatorKey (idempotent, env-derived) → aumlokGenesisMint of the
 *      owner root (skip if the root already exists) → mint a FRESH migration manifest
 *      (root → m4.migrator, memory.write on mem:{owner}, maxUses = exactly what remains, 1h expiry;
 *      the subject seed is EPHEMERAL — held in memory, never written to disk; when the manifest
 *      expires the migrator's authority is gone and only the owner root remains).
 *   4. write the MIGRATION GENESIS row (m4.migration.genesis) — the on-chain, receipted record of
 *      the source file's sha256 + plan hash + the honest provenance limit (plan clause 2+3).
 *   5. write the 77 atoms IN PLAN ORDER via memoryAppend (HTTP transport): skip-if-present-and-
 *      byte-identical (owner-recall + sha256 vs the plan — safe resume), ABORT on any mismatch;
 *      assert the kernel's memoryHash === the preflight's plannedMemoryHash for every row.
 *   6. verify: aumlokMemoryVerify green (0 flagged, 0 quarantined) + owner-recall parity on
 *      first/middle/last atoms + re-run the source preflight (source must be byte-unchanged).
 *   7. freeze: chmod 0400 state/kira/brain.json + drop state/kira/README.md (frozen status,
 *      sha256, unlock note, STILL-LIVE-FOR-RECALL honesty: the JSON brain remains the serving
 *      store for the spatial lanes until R5 cutover — migrated ≠ retired).
 *   8. print + save the full ceremony report (hashes only) to docs/M4_MIGRATION_2026-07-05.md.
 *
 * ZERO-CLOUD: loopback URL only (the transports refuse anything else); keys only from the custody
 * dir; no network beyond 127.0.0.1.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { defaultKiraStatePath } from '../core/src/kiraBrain';
import { migrationPreflight, migrationValueV1, type MigrationPreflightReport } from '../core/src/migrationPreflight';
import { memoryAppend } from '../core/src/memoryAppend';
import { createGovernedHttpInvoke, readAdminKeyStrict, ADMIN_KEY_DIR, ADMIN_KEY_PATH } from '../core/src/memoryKernelTransport';
import { isLoopbackUrl } from '../core/src/convexBrainReadonly';
import type { KiraBrainState } from '../core/src/kiraBrain';
// The kernel's OWN head/signing machinery — imported, not mirrored, so client signatures can never
// drift from what the kernel verifies (proven importable under bun, 2026-07-05).
import { signChainHeadV3 } from '../convex/aukoraSignedHead';
import { consumeHead, manifestRootHead, manifestPopHead } from '../convex/aumlokManifests';
import { recallHead } from '../convex/aumlokMemory';
import { buildPoPEnvelope } from '../convex/popResolver';
import { mlDsa65PublicKeyFromSeed } from '../convex/aukoraPqcSigner';

// ── ceremony constants (naming decisions recorded in docs/M4_MIGRATION_2026-07-05.md + INBOX) ──
const URL = process.env.AUKORA_CONVEX_URL ?? 'http://127.0.0.1:3210';
const OWNER_ROOT_ID = 'aumara.root';        // the owner's pseudonymous root in the memory namespace
const NODE_ID = 'aukora-brain-local';       // this machine's brain node identity
const MIGRATOR_ID = 'm4.migrator';          // the ephemeral delegated writer (honest attribution on rows)
const GENESIS_KEY = 'm4.migration.genesis'; // the receipted migration record row
const REPO = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(REPO, 'docs', 'M4_MIGRATION_2026-07-05.md');
// Custody dir override mirrors brain.sh (AUKORA_CONVEX_KEY_DIR) so the DRESS REHEARSAL against a
// throwaway backend uses throwaway custody — the real run uses the fixed default with no overrides.
const KEY_DIR = process.env.AUKORA_CONVEX_KEY_DIR ? path.resolve(process.env.AUKORA_CONVEX_KEY_DIR) : ADMIN_KEY_DIR;
const KEY_PATH = process.env.AUKORA_CONVEX_KEY_DIR ? path.join(KEY_DIR, 'admin-key.txt') : ADMIN_KEY_PATH;
// --rehearsal: full ceremony against a throwaway backend, but NOTHING outside the throwaway is
// touched — no source freeze, no state README, report goes to the scratch dir instead of docs/.
const REHEARSAL = process.argv.includes('--rehearsal');

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const fail = (msg: string): never => { console.error(`✗ ABORT: ${msg}`); process.exit(1); };
const ok = (msg: string) => console.log(`✓ ${msg}`);

// ── custody: load-or-create a 0600 secret in the custody dir (never the repo) ──────────────────
function loadOrCreateSecret(name: string, generate: () => string): string {
  const p = path.join(KEY_DIR, name);
  if (fs.existsSync(p)) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o077) !== 0) fail(`${p} exists but fails custody (regular file, 0600, no symlink)`);
    const v = fs.readFileSync(p, 'utf8').trim();
    if (!v) fail(`${p} is empty`);
    return v;
  }
  const v = generate();
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, v, { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  ok(`generated ${name} (0600, custody dir)`);
  return v;
}

// ── ceremony-scoped admin HTTP client (loopback + custody + allowlist; NOT a runtime module) ────
// Memory WRITES do not go through this — they go through memoryAppend + createGovernedHttpInvoke.
// This client exists for the provisioning ceremony (identity bootstrap) and for READ-ONLY
// verification queries, each against an EXACT function allowlist.
const CEREMONY_MUTATIONS = new Set(['popResolver:seedOperatorKey', 'aumlokRootRegistry:aumlokGenesisMint', 'aumlokManifests:aumlokMintManifest']);
const READ_QUERIES = new Set(['aumlokMemory:aumlokMemoryVerify', 'aumlokMemory:aumlokMemoryRecall']);
async function adminCall(kind: 'mutation' | 'query', fnPath: string, args: unknown): Promise<any> {
  if (!isLoopbackUrl(URL)) fail('non-loopback URL — the ceremony is local-only by law');
  if (kind === 'mutation' && !CEREMONY_MUTATIONS.has(fnPath)) fail(`ceremony mutation not allowlisted: ${fnPath}`);
  if (kind === 'query' && !READ_QUERIES.has(fnPath)) fail(`read query not allowlisted: ${fnPath}`);
  const adminKey = readAdminKeyStrict(KEY_PATH);
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ path: fnPath, args, format: 'json' }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.text();
  if (raw.length > 4_000_000) fail(`oversized backend response for ${fnPath}`);
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { fail(`malformed backend response for ${fnPath}: ${raw.slice(0, 200)}`); }
  if (parsed.status === 'error') throw new Error(String(parsed.errorMessage ?? 'kernel error'));
  if (parsed.status !== 'success') fail(`unexpected envelope for ${fnPath}: ${raw.slice(0, 200)}`);
  return parsed.value;
}

async function main() {
  console.log('── M4 migration ceremony ─────────────────────────────────────');

  // 0) SOURCE preflight with the REAL owner root id — the independent verifier, wholesale abort.
  const brainPath = defaultKiraStatePath();
  const sourceBytes = fs.readFileSync(brainPath);
  const sourceSha = sha256(sourceBytes);
  const state = JSON.parse(sourceBytes.toString('utf8')) as KiraBrainState;
  const plan: MigrationPreflightReport = migrationPreflight(state, OWNER_ROOT_ID);
  if (!plan.ok) fail(`source preflight RED — nothing migrates: ${plan.errors.slice(0, 5).join('; ')}`);
  const planHash = sha256(JSON.stringify(plan.entries.map((e) => [e.key, e.inputHash, e.valueSha256, e.plannedMemoryHash])));
  ok(`source preflight green: ${plan.liveAtoms} live atoms, ${plan.erasedExcluded} erased (excluded+counted), source sha256=${sourceSha.slice(0, 16)}…, plan=${planHash.slice(0, 16)}…`);

  // 1) backend up?
  const version = await fetch(`${URL}/version`, { signal: AbortSignal.timeout(5_000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (!version) fail(`backend not answering at ${URL} — run: AUKORA_CONVEX_BACKEND_BIN=<pinned> bash scripts/brain.sh start`);
  ok(`backend healthy at ${URL} (version ${version.trim().slice(0, 40)})`);

  // 2) deployment env + kernel deploy (live-proof recipe; idempotent — deploy is content-addressed).
  const adminKey = readAdminKeyStrict(KEY_PATH);
  const operatorSeed = loadOrCreateSecret('operator.seed', () => randomBytes(32).toString('hex'));
  const rootSeed = loadOrCreateSecret('memory-root.seed', () => randomBytes(32).toString('hex'));
  const tokenSecret = loadOrCreateSecret('token-secret.txt', () => randomBytes(32).toString('hex'));
  const chainSeed = loadOrCreateSecret('chain-signing.seed', () => randomBytes(32).toString('hex'));

  // Deploy via the ONE proven runner (captureSubjectAdapter.deployKernel): pin-ledger CLI
  // discipline (bun x convex@1.40.0 fallback when npx convex is absent/broken; the 1.42.1
  // esbuild issue is the founding row of docs/NEBIUS_DEPLOY_PRACTICE.md's known-issues ledger),
  // plus the zero-function and R5b-search footgun checks. This replaced m4's own pre-pin copy.
  const { deployKernel } = await import('./captureSubjectAdapter');
  await deployKernel({ withEnv: { operatorSeed, tokenSecret, chainSeed } });
  ok('kernel deployed to the REAL backend; deployment env set (node id, token secret, chain seed, operator seed)');

  // 3) identity bootstrap: operator key (idempotent) → owner root genesis (skip-if-exists) → manifest.
  await adminCall('mutation', 'popResolver:seedOperatorKey', {});
  ok('operator key pinned (env-derived, idempotent)');

  const rootPub = await mlDsa65PublicKeyFromSeed(rootSeed);
  const FOUNDER = 'aukora.operator', FOUNDER_KEY = 'op-1';
  const now = Date.now();
  const cav = (capId: string, methods: string[]) => ({
    v: 1, capId, founderUserId: FOUNDER, founderKeyId: FOUNDER_KEY, nodeId: NODE_ID, methods,
    ring: 'local-write', action: 'aumlok', resource: 'aumlok:root', principalId: FOUNDER,
    roles: ['operator'], notBefore: now - 1000, expiresAt: now + 110_000, maxUses: 1,
  });
  const gArgs = { rootId: OWNER_ROOT_ID, keyId: 'rk-1', publicKey: rootPub };
  try {
    const gEnv = await buildPoPEnvelope(operatorSeed, cav(`cap-m4-genesis-${now}`, ['aumlokGenesisMint']), { methodId: 'aumlokGenesisMint', actualArgs: gArgs, timestamp: Date.now(), nonce: `m4-g-${now}` });
    const g = await adminCall('mutation', 'aumlokRootRegistry:aumlokGenesisMint', { env: gEnv, actualArgs: gArgs, nodeId: NODE_ID });
    ok(`owner root GENESIS: ${OWNER_ROOT_ID} (fingerprint ${String(g.fingerprint).slice(0, 16)}…)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/exists|duplicate|already/i.test(msg)) ok(`owner root already exists (${OWNER_ROOT_ID}) — resume mode`);
    else throw e;
  }

  // fresh, tightly-budgeted manifest per run; EPHEMERAL subject seed (memory only, never on disk).
  const subjectSeed = randomBytes(32).toString('hex');
  const subjectPub = await mlDsa65PublicKeyFromSeed(subjectSeed);
  const manifestId = `mft-m4-${now}`;
  const pendingBudget = plan.liveAtoms + 1; // genesis row + atoms (skips still consume nothing)
  const manifest = {
    v: 1, manifestId, rootId: OWNER_ROOT_ID, rootKeyId: 'rk-1', nodeId: NODE_ID,
    subjectId: MIGRATOR_ID, subjectKind: 'agent', subjectPubKey: subjectPub,
    permissions: [{ ring: 'local-write', action: 'memory.write', resource: `mem:${OWNER_ROOT_ID}` }],
    allowedIntentCodecs: ['json_action_v1'], notBefore: now - 1000, expiresAt: now + 3_600_000,
    maxUses: pendingBudget, maxPerWindow: null, createdAt: now,
  };
  const rootSig = await signChainHeadV3(rootSeed, await manifestRootHead(manifest), 'aumlokManifest');
  const subjectPopSig = await signChainHeadV3(subjectSeed, await manifestPopHead(manifest), 'aumlokSubjectPop');
  await adminCall('mutation', 'aumlokManifests:aumlokMintManifest', { manifest, rootSig, subjectPopSig });
  ok(`migration manifest minted: ${manifestId} (root → ${MIGRATOR_ID}, maxUses ${pendingBudget}, 1h expiry, subject seed ephemeral)`);

  // ── the ONE governed write path, exactly as the law requires ──
  const invoke = createGovernedHttpInvoke({ url: URL, adminKeyPath: KEY_PATH });
  let useSeq = 0;
  const writeOne = async (key: string, value: string, plannedMemoryHash: string) => {
    const req = {
      action: 'memory.write' as const, ring: 'local-write' as const, key,
      ownerRootId: OWNER_ROOT_ID, resource: `mem:${OWNER_ROOT_ID}`,
      v: 1, manifestId, subjectId: MIGRATOR_ID, intentCodec: 'json_action_v1',
      useSeq, timestamp: Date.now(),
    };
    const subjectSig = await signChainHeadV3(subjectSeed, await consumeHead(req), 'aumlokSubjectPop');
    const r = await memoryAppend({ req, subjectSig, value }, { deploymentUrl: URL, invoke });
    if (!r.ok) fail(`memoryAppend refused for ${key}: ${(r as any).refused}`);
    if ((r as any).memoryHash !== plannedMemoryHash) fail(`DRIFT for ${key}: kernel bound ${(r as any).memoryHash.slice(0, 16)}… but the plan pinned ${plannedMemoryHash.slice(0, 16)}…`);
    useSeq++;
    return r as { ok: true; receiptHash: string; memoryHash: string };
  };
  const ownerRecall = async (key: string): Promise<{ found: boolean; value?: string; reason?: string }> => {
    const r = { v: 1, ownerRootId: OWNER_ROOT_ID, key, readerPrincipalId: OWNER_ROOT_ID, timestamp: Date.now() };
    const readerSig = await signChainHeadV3(rootSeed, await recallHead(r), 'aumlokMemRecall');
    const res = await adminCall('query', 'aumlokMemory:aumlokMemoryRecall', { req: r, readerSig });
    return res.ok ? { found: true, value: res.value } : { found: false, reason: res.reason };
  };

  // 4) migration genesis row — the receipted record of exactly what this ceremony moved.
  const genesisValue = JSON.stringify({
    schema: 'AUKORA_M4_MIGRATION_GENESIS_V1',
    sourceFile: 'state/kira/brain.json', sourceSha256: sourceSha, planHash,
    liveAtoms: plan.liveAtoms, erasedExcluded: plan.erasedExcluded, receiptCount: plan.receiptCount,
    honestLimit: 'The source JSON chain binds links+content only as far as its own unsigned sha256 ledger can attest; this migration re-derived every atom content hash independently (core/src/migrationPreflight.ts) and aborts wholesale on mismatch. It cannot retroactively prove old content against a sophisticated pre-migration re-hash of the whole source chain — stated, not hidden.',
    migratedAt: new Date().toISOString(), nodeId: NODE_ID, migrator: MIGRATOR_ID,
  });
  const g = await ownerRecall(GENESIS_KEY);
  if (g.found) {
    ok('migration genesis row already present — resume mode (leaving the original record untouched)');
  } else {
    const gr = await writeOne(GENESIS_KEY, genesisValue, sha256(`${OWNER_ROOT_ID}:${GENESIS_KEY}:${genesisValue}`));
    ok(`migration genesis row written (receipt ${gr.receiptHash.slice(0, 16)}…)`);
  }

  // 5) the 77 atoms, in plan order — skip-if-identical, abort-on-anything-else.
  let written = 0, skipped = 0;
  for (const entry of plan.entries) {
    const existing = await ownerRecall(entry.key);
    if (existing.found) {
      if (sha256(existing.value ?? '') !== entry.valueSha256) fail(`row ${entry.key} EXISTS with DIFFERENT bytes than the plan — refusing to continue (duplicate keys are unreachable via recall)`);
      skipped++;
      continue;
    }
    const atom = state.atoms.find((a) => a.id === entry.key)!;
    const ingest = state.receipts.find((rc) => rc.id === atom.receiptId)!;
    const value = migrationValueV1(atom, ingest);
    if (sha256(value) !== entry.valueSha256) fail(`value re-derivation drifted for ${entry.key} between preflight and write — aborting`);
    await writeOne(entry.key, value, entry.plannedMemoryHash);
    written++;
    if (written % 20 === 0) ok(`…${written}/${plan.liveAtoms} atoms written`);
  }
  ok(`atoms: ${written} written, ${skipped} already present (byte-identical)`);

  // 6) verify — the store's own report must be green, and served bytes must equal planned bytes.
  const verify = await adminCall('query', 'aumlokMemory:aumlokMemoryVerify', { ownerRootId: OWNER_ROOT_ID });
  if (!verify.ok || verify.flagged.length > 0 || verify.quarantinedCount > 0) fail(`post-migration verify NOT clean: ${JSON.stringify(verify).slice(0, 300)}`);
  if (verify.checked !== plan.liveAtoms + 1) fail(`post-migration count mismatch: checked=${verify.checked}, expected ${plan.liveAtoms + 1} (genesis + atoms)`);
  const spots = [plan.entries[0], plan.entries[Math.floor(plan.entries.length / 2)], plan.entries[plan.entries.length - 1]];
  for (const s of spots) {
    const rec = await ownerRecall(s.key);
    if (!rec.found || sha256(rec.value ?? '') !== s.valueSha256) fail(`recall parity FAILED for ${s.key}`);
  }
  const after = sha256(fs.readFileSync(brainPath));
  if (after !== sourceSha) fail(`SOURCE CHANGED during migration (sha ${after.slice(0, 16)}… vs ${sourceSha.slice(0, 16)}…) — treat the whole run as suspect`);
  ok(`verify green: ${verify.checked} rows checked, 0 flagged, 0 quarantined; recall parity 3/3; source byte-unchanged`);

  // 7) freeze the source (plan clause 3) — read-only + honest status note. NOT retirement: the JSON
  // brain remains the LIVE recall surface for the spatial lanes until R5 cutover.
  if (REHEARSAL) {
    const scratchReport = path.join(os.tmpdir(), `aukora-m4-rehearsal-report-${Date.now()}.md`);
    fs.writeFileSync(scratchReport, `# M4 REHEARSAL — all live steps green\nsource sha256 ${sourceSha}\nplan ${planHash}\nwritten ${written}, skipped ${skipped}, verify checked ${verify.checked}\n`);
    ok(`REHEARSAL COMPLETE — no freeze, no docs write (scratch report: ${scratchReport})`);
    console.log('\nM4 REHEARSAL GREEN — the ceremony is proven end-to-end on a throwaway. Run without --rehearsal for the real thing.');
    return;
  }
  fs.chmodSync(brainPath, 0o400);
  fs.writeFileSync(path.join(path.dirname(brainPath), 'README.md'), [
    '# state/kira — migration status (M4, 2026-07-05)',
    '',
    `- \`brain.json\` is FROZEN read-only (0400) as of the M4 migration. sha256: \`${sourceSha}\`.`,
    `- Its ${plan.liveAtoms} live atoms are migrated to the local Convex kernel (owner root \`${OWNER_ROOT_ID}\`,`,
    `  keys = atom ids, value schema AUKORA_KIRA_ATOM_MIGRATION_V1, migration genesis row \`${GENESIS_KEY}\`).`,
    '- NOT RETIRED: this file is still the live recall surface for the spatial lanes until the R5 cutover.',
    '- Owner writes (kiraCli ingest/forget) now require a deliberate unlock: `chmod 600 brain.json`, edit via',
    '  the governed CLI only, re-freeze with `chmod 400`, and note that post-freeze JSON-side changes are NOT',
    '  auto-migrated (re-run scripts/m4MigrateAtoms.ts to sync new atoms — it skips byte-identical rows).',
    '',
    'This README is generated by scripts/m4MigrateAtoms.ts (state/ is gitignored; the canonical record',
    'lives in docs/M4_MIGRATION_2026-07-05.md).',
  ].join('\n') + '\n');
  ok('source frozen 0400 + status README dropped (honest: frozen ≠ retired)');

  // 8) ceremony report (hashes only — safe to commit).
  const report = [
    '# M4 Migration Report — 2026-07-05',
    '',
    'Owner-approved M4 go ("i approve what ya need", 2026-07-05 — see INBOX + GH #103).',
    '',
    `- Source: \`state/kira/brain.json\` sha256 \`${sourceSha}\` (frozen 0400 after migration)`,
    `- Plan hash: \`${planHash}\` (per-atom [key, inputHash, valueSha256, plannedMemoryHash])`,
    `- Owner root: \`${OWNER_ROOT_ID}\` (genesis on node \`${NODE_ID}\`) — root seed custody \`~/.aukora-symbiote/convex/memory-root.seed\` (0600)`,
    `- Migrator: \`${MIGRATOR_ID}\` under manifest \`${manifestId}\` (maxUses ${pendingBudget}, 1h expiry, subject seed ephemeral — discarded with this process)`,
    `- Rows: ${plan.liveAtoms} atoms + 1 migration-genesis row (\`${GENESIS_KEY}\`); ${plan.erasedExcluded} erased atoms excluded and counted`,
    `- This run: ${written} written, ${skipped} skipped (already present, byte-identical)`,
    `- Post-verify: aumlokMemoryVerify ok=${verify.ok}, checked=${verify.checked}, flagged=0, quarantined=0; owner-recall parity 3/3; source byte-unchanged through the ceremony`,
    '- Honest limits: the migration proves CURRENT source integrity (independent re-derivation), not retroactive history beyond what the unsigned source ledger can attest; the JSON brain stays the live recall surface until R5.',
    '',
    '_Generated by scripts/m4MigrateAtoms.ts._',
  ].join('\n') + '\n';
  fs.writeFileSync(REPORT_PATH, report);
  ok(`ceremony report written: ${path.relative(REPO, REPORT_PATH)}`);
  console.log('\nM4 COMPLETE — the 77 atoms are home, verified green, source frozen.');
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
