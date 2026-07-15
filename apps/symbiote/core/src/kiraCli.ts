#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import {
  createEmptyBrain,
  eraseMemory,
  ingestMemory,
  ingestSelfMap,
  loadBrainState,
  recall,
  saveBrainState,
  summarizeBrain,
  verifyBrainState,
} from './kiraBrain';

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function defaultStatePath(): string {
  return process.env.AUKORA_KIRA_STATE ?? path.join(repoRoot(), 'state', 'kira', 'brain.json');
}

function legacyStatePath(): string {
  return process.env.AUKORA_KIRA_LEGACY_STATE ?? path.join(repoRoot(), 'state', 'mega-mind', 'brain.json');
}

// Issue #21 (rename fallout): the Mega Mind -> Kira rename moved the state path and made the loader
// hard-reject the old schema, but a pre-existing persisted brain at the OLD path was never migrated.
// loadBrainState() silently returns an empty brain when the new path is missing — so every command
// below would quietly start a brand-new genesis chain and mask that 75 real receipts/atoms still sit
// unmigrated at the legacy path. Refuse loudly instead; `migrate` is the only way past this.
function refuseIfOrphanedLegacyBrain(): void {
  if (fs.existsSync(defaultStatePath())) return;
  if (!fs.existsSync(legacyStatePath())) return;
  process.stderr.write(
    `REFUSING TO START A NEW MEMORY CHAIN:\n` +
    `  ${defaultStatePath()} does not exist, but a legacy (pre-rename) brain state file was found at\n` +
    `  ${legacyStatePath()}.\n` +
    `  Run the one-time migration first: kira.sh migrate\n`,
  );
  process.exit(1);
}

function arg(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function tags(): string[] {
  const raw = arg('tags', arg('tag', ''));
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function load() {
  return loadBrainState(defaultStatePath());
}

function save(state: ReturnType<typeof createEmptyBrain>) {
  saveBrainState(defaultStatePath(), state);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'status';
  if (cmd !== 'migrate') refuseIfOrphanedLegacyBrain();
  if (cmd === 'migrate') {
    const legacy = legacyStatePath();
    if (!fs.existsSync(legacy)) {
      print({ ok: false, error: `no legacy brain state found at ${legacy} — nothing to migrate` });
      process.exit(1);
    }
    if (fs.existsSync(defaultStatePath())) {
      print({ ok: false, error: `refusing to overwrite existing state at ${defaultStatePath()}` });
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    const migrated = { ...raw, schema: 'AUKORA_KIRA_BRAIN_V1' as const };
    const verification = verifyBrainState(migrated);
    if (!verification.ok) {
      print({ ok: false, error: 'migrated state failed verification — not writing anything', verification });
      process.exit(1);
    }
    saveBrainState(defaultStatePath(), migrated);
    const legacyDir = path.dirname(legacy);
    const archiveDir = `${legacyDir}.archived`;
    fs.renameSync(legacyDir, archiveDir);
    print({
      ok: true,
      migratedFrom: legacy,
      migratedTo: defaultStatePath(),
      archivedDirTo: archiveDir,
      verify: verification,
    });
    return;
  }
  if (cmd === 'status') {
    const state = load();
    print({ statePath: defaultStatePath(), summary: summarizeBrain(state), verify: verifyBrainState(state) });
    return;
  }
  if (cmd === 'init') {
    const state = createEmptyBrain();
    save(state);
    print({ ok: true, statePath: defaultStatePath(), verify: verifyBrainState(state) });
    return;
  }
  if (cmd === 'ingest') {
    const text = arg('text');
    if (!text) throw new Error('usage: kiraCli ingest --text "..." [--source x] [--scope y] [--tags a,b]');
    const result = ingestMemory(load(), {
      text,
      kind: (arg('kind', 'experience') as any),
      source: arg('source', 'manual'),
      scope: arg('scope', 'default'),
      tags: tags(),
    });
    save(result.state);
    print({ ok: true, atom: result.atom.id, receipt: result.receipt.id, verify: verifyBrainState(result.state) });
    return;
  }
  if (cmd === 'recall') {
    const query = arg('query');
    if (!query) throw new Error('usage: kiraCli recall --query "..."');
    print(recall(load(), query, Number(arg('limit', '8'))));
    return;
  }
  if (cmd === 'self-map') {
    const root = path.resolve(arg('root', repoRoot()));
    const result = ingestSelfMap(load(), root, { maxFiles: Number(arg('max', '80')) });
    save(result.state);
    print({ ok: true, ingested: result.ingested, skipped: result.skipped, verify: verifyBrainState(result.state) });
    return;
  }
  if (cmd === 'verify') {
    const result = verifyBrainState(load());
    print(result);
    if (!result.ok) process.exit(1);
    return;
  }
  if (cmd === 'forget') {
    // Brick 0a — THE typed owner erasure surface. This CLI is the only lawful caller of
    // eraseMemory: content + every derived field scrubbed, erasure receipt appended, chain still
    // proves the forget happened. Never exposed to the voice/presence lanes or any model tool.
    const atomId = arg('atom');
    if (!atomId) throw new Error('usage: kiraCli forget --atom <atomId> [--reason label]');
    const result = eraseMemory(load(), atomId, { reason: arg('reason') });
    save(result.state);
    print({ ok: true, erased: result.atom.id, erasureReceipt: result.receipt.id, verify: verifyBrainState(result.state) });
    return;
  }
  if (cmd === 'backup') {
    // Issue #25 follow-up (Fable QA A5): the brain is a single unbacked file — cheap insurance before it
    // grows further. Refuse to back up a brain that doesn't verify first: a backup of corruption is
    // worse than no backup at all (it would look like a safety net and silently not be one). In
    // practice load() (shared by every command) already throws kira_state_invalid for a corrupt-on-disk
    // state before this ever runs — this check is defense-in-depth for any future path that could hand
    // `backup` an in-memory state without going through load()'s own guard.
    const state = load();
    const verification = verifyBrainState(state);
    if (!verification.ok) {
      print({ ok: false, error: 'refusing to back up a brain that fails verification', verify: verification });
      process.exit(1);
    }
    const backupsDir = path.join(path.dirname(defaultStatePath()), 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/:/g, '-');
    const backupPath = path.join(backupsDir, `brain-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(state, null, 2) + '\n');
    // Re-verify the WRITTEN copy, not the in-memory state — proves the file on disk is actually readable
    // and intact, not just that the write call didn't throw.
    const reread = loadBrainState(backupPath);
    const reverify = verifyBrainState(reread);
    if (!reverify.ok) {
      print({ ok: false, error: 'backup written but failed re-verification on read-back — treat this backup as untrustworthy', backupPath, verify: reverify });
      process.exit(1);
    }
    print({ ok: true, backupPath, atoms: reread.atoms.length, receipts: reread.receipts.length, verify: reverify });
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
