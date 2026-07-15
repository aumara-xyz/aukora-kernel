// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R5c EMBEDDING BACKFILL — owner ceremony (never called by any lane or door).
 *
 *   bun scripts/embedBackfill.ts --state <path/to/brain.json> [--url http://127.0.0.1:3210]
 *
 * For every LIVE atom of the given Kira corpus (row key == atom id, the M4 invariant), embed the
 * atom text on-box via the LOCAL embedder daemon and attach the vector to the governed row through
 * `aumlokMemoryEmbedBackfill` — owner-root signed per row under the DEDICATED aumlokMemEmbed
 * domain, absent-only, idempotent, content-untouched (memoryHash law: embeddings live outside the
 * integrity chain). Keys come from the corpus file, not from any new kernel listing surface.
 *
 * Loud on every outcome (counts printed; each refusal named). Zero egress: the embedder is the
 * vendored local model; the backend is loopback-only by the transport's own law.
 */
import * as fs from 'fs';
import { loadBrainState, defaultKiraStatePath } from '../core/src/kiraBrain';
import { readOwnerSeedStrict } from '../core/src/memoryRecall';
import { readAdminKeyStrict, DEFAULT_BRAIN_URL } from '../core/src/memoryKernelTransport';
import { isLoopbackUrl } from '../core/src/convexBrainReadonly';
import { embedText, embedderHealth } from './embedClient';
import { embedHead, vectorHashHex } from '../convex/aumlokMemory';
import { signChainHeadV3 } from '../convex/aukoraSignedHead';

const OWNER_ROOT_ID = 'aumara.root';
const URL = process.env.AUKORA_CONVEX_URL ?? DEFAULT_BRAIN_URL;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function adminMutation(adminKey: string, path: string, args: unknown): Promise<any> {
  const res = await fetch(`${URL}/api/mutation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ path, args, format: 'json' }),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = JSON.parse(await res.text()) as { status?: string; value?: unknown; errorMessage?: unknown };
  if (parsed.status === 'error') throw new Error(String(parsed.errorMessage ?? 'kernel error'));
  if (parsed.status !== 'success') throw new Error('unexpected envelope');
  return parsed.value;
}

async function main(): Promise<void> {
  if (!isLoopbackUrl(URL)) { console.error(`refused: non-loopback backend URL ${URL} (local-only by law)`); process.exit(1); }
  const statePath = arg('--state') ?? defaultKiraStatePath();
  if (!fs.existsSync(statePath)) { console.error(`refused: no corpus at ${statePath} — pass --state <brain.json>`); process.exit(1); }

  const health = await embedderHealth();
  if (!health.ok) { console.error(`refused: local embedder not available (${health.detail})`); process.exit(1); }
  console.log(`embedder: ${health.detail}`);

  const rootSeed = readOwnerSeedStrict();
  const adminKey = readAdminKeyStrict();
  const state = loadBrainState(statePath);
  const atoms = state.atoms.filter((a: any) => !a.erased && !a.quarantined);
  console.log(`corpus: ${atoms.length} live atoms from ${statePath}`);

  let done = 0, already = 0, refused = 0;
  for (const atom of atoms) {
    const embedded = await embedText(atom.text);
    if (!embedded.ok) { refused += 1; console.error(`  refuse ${atom.id}: ${embedded.refused}`); continue; }
    const req = { v: 1, ownerRootId: OWNER_ROOT_ID, key: atom.id, embeddingHash: await vectorHashHex(embedded.vector), timestamp: Date.now() };
    const ownerSig = await signChainHeadV3(rootSeed, await embedHead(req), 'aumlokMemEmbed');
    try {
      const r = await adminMutation(adminKey, 'aumlokMemory:aumlokMemoryEmbedBackfill', { req, ownerSig, embedding: embedded.vector });
      if (r?.ok && r.already) already += 1;
      else if (r?.ok) done += 1;
      else { refused += 1; console.error(`  refuse ${atom.id}: ${r?.reason ?? 'unknown'}`); }
    } catch (e) {
      refused += 1;
      console.error(`  refuse ${atom.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`DONE — backfill complete: ${done} embedded, ${already} already had identical vectors, ${refused} refused (each named above).`);
  if (refused > 0) process.exit(1);
}

main().catch((e) => { console.error(`refused: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
