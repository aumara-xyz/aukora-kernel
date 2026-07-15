// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * CLI for the Fu round controller. The impure edge: reads the target file(s) and the provider key from
 * the environment ONLY, drives the controller, prints the canonical artifact + its digest. Never prints
 * or persists the key. Advisory-only; no signing/merging/applying.
 *
 *   bun tools/fu-round/run.ts --target <path> --mode live
 *   flags: --mode live|offline|replay|synthetic (default offline) --out <file> --commit <sha> --tree <sha>
 *          --problem "<q>" --claim "<c>" (repeatable) --repo <repoId>
 *
 * `--mode live` needs OPENROUTER_API_KEY in the environment; without it the run is honest offline
 * (providerContacted:false, all seats no-provider non-votes) — it never fabricates a live review.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SpendMeter } from '../../src/aukoraFuCouncil';
import { AukoraFuSpendLedger } from '../../src/aukoraFuSpendLedger';
import { runFuRound, newMeter } from './controller';
import { liveOpenRouterTransport, replayTransport, syntheticFixtureTransport } from './transport';
import { fuRoundDigest } from './artifact';
import { safeReadTargetFile } from './reader';
import type { FuRoundMode } from './artifact';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]!);
  return out;
}
function gitRev(spec: string, cwd: string): string | null {
  try { return execFileSync('git', ['rev-parse', spec], { cwd, encoding: 'utf8' }).trim(); } catch { return null; }
}

async function main(): Promise<void> {
  const target = arg('target');
  if (!target) { console.error('usage: run.ts --target <path> --mode live|offline|replay|synthetic'); process.exit(2); return; }
  const mode = (arg('mode') ?? 'offline') as FuRoundMode;
  const abs = path.resolve(target);
  const read = safeReadTargetFile(abs); // V3: refuses symlink/dir/oversize; never follows a link
  if (!read.ok) { console.error(`${read.code}: ${read.message}`); process.exit(1); return; }
  const content = read.content;
  const repoRoot = process.cwd();
  const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
  const reviewPath = rel && !rel.startsWith('..') ? rel : path.basename(abs);
  const commit = arg('commit') ?? gitRev('HEAD', repoRoot) ?? '0'.repeat(40);
  const tree = arg('tree') ?? gitRev('HEAD^{tree}', repoRoot) ?? '0'.repeat(40);
  const repoId = arg('repo') ?? 'aumara-xyz/aukora-fu';
  const problem = arg('problem') ?? `Fu review of ${reviewPath}: is the design sound, honest, and within scope?`;
  const claimList = args('claim');
  const claims = claimList.length ? claimList : ['The design is internally consistent and buildable', 'The claims made are defensible and not overclaimed'];

  const meter = newMeter();
  const key = process.env.OPENROUTER_API_KEY ?? null;
  let transport;
  if (mode === 'live' || mode === 'offline') transport = liveOpenRouterTransport(mode === 'live' ? key : null, meter);
  else if (mode === 'replay') transport = replayTransport(JSON.parse(fs.readFileSync(arg('replay')!, 'utf8')), meter);
  else transport = syntheticFixtureTransport(JSON.parse(fs.readFileSync(arg('fixtures')!, 'utf8')), meter);

  if (mode === 'live' && !key) console.error('NOTE: --mode live but OPENROUTER_API_KEY is unset → honest OFFLINE run (no provider contacted, no live claim).');

  // V8: persistent daily accounting. The per-pass spend meter is bounded by the DAILY remaining budget so
  // repeated rounds cannot cumulatively exceed the day cap (fail-closed via the council's reserve()).
  const ledgerDir = process.env.AUKORA_FU_LEDGER_DIR ?? path.join(os.homedir(), '.aukora-fu');
  fs.mkdirSync(ledgerDir, { recursive: true });
  const ledger = new AukoraFuSpendLedger(ledgerDir);
  const dailyCapUsd = Number(process.env.AUKORA_FU_DAILY_CAP_USD ?? '5');
  const remainingDailyUsd = Math.max(0, dailyCapUsd - ledger.todayTotalUsd());
  const spend = new SpendMeter({ perPassUsd: remainingDailyUsd, perDayUsd: dailyCapUsd });

  const result = await runFuRound({
    targetRepoId: repoId, targetCommit: commit, targetTree: tree, reviewPath,
    files: [{ path: reviewPath, content }], mode, problem, claims, transport, meter, spend,
    toolVersions: { 'fu-round': 'v1' },
  });

  if (!result.ok) { console.error(`REFUSED ${result.code}: ${result.message}`); process.exit(1); return; }
  const artifact = result.artifact;
  const digest = fuRoundDigest(artifact);
  // V8: record ACTUAL spend to the persistent daily ledger (0 for offline / no-key runs).
  ledger.append(artifact.actualCostMicroUsd / 1_000_000, `fu-round ${mode} ${digest}`);
  const out = { artifactDigest: digest, artifact };
  const outFile = arg('out');
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  console.error(`\nFU_ROUND ${mode}  digest=${digest}  votes=${artifact.votes}/${artifact.seats.length}  quorum=${artifact.quorum.met}  liveEligible=${artifact.liveEligible}  providerContacted=${artifact.providerContacted}  paidCalls=${artifact.paidCalls}  actualCostMicroUsd=${artifact.actualCostMicroUsd}`);
}

void main();
