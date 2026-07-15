// Issue #21 (rename fallout): the Mega Mind -> Kira rename left a real, persisted brain orphaned at
// the OLD path/schema while every consumer now reads the NEW path and hard-rejects the old schema.
// This proves the fix end-to-end against the REAL CLI script (never the developer's real repo state):
// a fixture legacy brain migrates cleanly, the guard refuses to silently start a new genesis chain
// when migration hasn't happened yet, and `migrate` is the only way past that refusal.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { createEmptyBrain, ingestMemory, verifyBrainState } from '../src/kiraBrain';

const REPO = join(__dirname, '..', '..');

function run(args: string[], env: Record<string, string>) {
  return execFileSync('bun', [join(REPO, 'core', 'src', 'kiraCli.ts'), ...args], {
    cwd: join(REPO, 'core'),
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function runExpectFail(args: string[], env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync('bun', [join(REPO, 'core', 'src', 'kiraCli.ts'), ...args], {
      cwd: join(REPO, 'core'),
      env: { ...process.env, ...env },
      encoding: 'utf-8',
    });
    return { status: 0, output };
  } catch (err: any) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('kiraCli migrate — real script, throwaway fixture dirs (issue #21)', () => {
  let dir: string;
  let legacyPath: string;
  let newPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kira-cli-migrate-test-'));
    legacyPath = join(dir, 'legacy', 'brain.json');
    newPath = join(dir, 'kira', 'brain.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeLegacyFixture(atomCount: number): void {
    let state = createEmptyBrain('2026-06-01T00:00:00.000Z');
    for (let i = 0; i < atomCount; i++) {
      state = ingestMemory(state, {
        text: `fixture memory ${i}`,
        source: 'fixture',
        scope: 'test',
        tags: ['fixture'],
        now: `2026-06-01T00:00:0${i % 9}.000Z`,
      }).state;
    }
    // Simulate the REAL orphaned condition: real data, OLD schema string, at the OLD path.
    const legacyShaped = { ...state, schema: 'AUKORA_MEGA_MIND_BRAIN_V1' };
    mkdirSync(join(dir, 'legacy'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(legacyShaped, null, 2) + '\n');
  }

  it('refuses to run status/ingest/recall/init/backup and silently start a new genesis chain when an unmigrated legacy brain exists', () => {
    writeLegacyFixture(3);
    for (const args of [['status'], ['recall', '--query', 'fixture'], ['init'], ['self-map'], ['backup']]) {
      const result = runExpectFail(args, { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/REFUSING TO START|migrate/i);
    }
    expect(existsSync(newPath)).toBe(false); // never silently created
  });

  it('migrates a real fixture brain (5 atoms/5 receipts) cleanly: schema rewritten, counts preserved, verify ok, old dir archived', () => {
    writeLegacyFixture(5);
    const out = run(['migrate'], { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
    const result = JSON.parse(out);

    expect(result.ok).toBe(true);
    expect(result.verify.ok).toBe(true);
    expect(result.verify.receiptCount).toBe(5);
    expect(result.verify.atomCount).toBe(5);
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false); // archived away, not left in place

    const migrated = JSON.parse(readFileSync(newPath, 'utf-8'));
    expect(migrated.schema).toBe('AUKORA_KIRA_BRAIN_V1');
    expect(migrated.receipts.length).toBe(5);
    expect(migrated.atoms.length).toBe(5);
    expect(verifyBrainState(migrated).ok).toBe(true);
  });

  it('after a successful migration, status reports the real migrated counts (no guard refusal)', () => {
    writeLegacyFixture(2);
    run(['migrate'], { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
    const statusOut = run(['status'], { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
    const status = JSON.parse(statusOut);
    expect(status.summary).toBeTruthy();
    expect(status.verify.ok).toBe(true);
    expect(status.verify.receiptCount).toBe(2);
  });

  it('migrate refuses to overwrite an existing new-path state (never clobbers)', () => {
    writeLegacyFixture(1);
    mkdirSync(join(dir, 'kira'), { recursive: true });
    writeFileSync(newPath, JSON.stringify(createEmptyBrain('2026-06-02T00:00:00.000Z'), null, 2));
    const result = runExpectFail(['migrate'], { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/refus/i);
    expect(existsSync(legacyPath)).toBe(true); // untouched — refusal must not destroy the source either
  });

  it('migrate with no legacy file present fails cleanly rather than fabricating an empty brain', () => {
    const result = runExpectFail(['migrate'], { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/no legacy brain state found/i);
  });

  it('normal operation is unaffected when there is no legacy brain at all (fresh install)', () => {
    const out = run(['init'], { AUKORA_KIRA_STATE: newPath, AUKORA_KIRA_LEGACY_STATE: legacyPath });
    const result = JSON.parse(out);
    expect(result.ok).toBe(true);
    expect(existsSync(newPath)).toBe(true);
  });
});

// Issue #25 follow-up (Fable QA A5): the brain is still a single unbacked file. `backup` copies it to a
// timestamped file under its own backups/ dir, never the real ~/.aukora-symbiote or the developer's
// real state/kira/brain.json (matches the AUKORA_KIRA_STATE-override discipline every other test here
// already uses).
describe('kiraCli backup — real script, throwaway fixture dirs (issue #25 follow-up)', () => {
  let dir: string;
  let newPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kira-cli-backup-test-'));
    newPath = join(dir, 'kira', 'brain.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('backs up a real, verified brain to state/kira/backups/brain-<ISO8601>.json — path, counts, and re-verification all correct', () => {
    run(['init'], { AUKORA_KIRA_STATE: newPath });
    run(['ingest', '--text', 'fixture memory one', '--source', 'fixture', '--scope', 'test'], { AUKORA_KIRA_STATE: newPath });
    run(['ingest', '--text', 'fixture memory two', '--source', 'fixture', '--scope', 'test'], { AUKORA_KIRA_STATE: newPath });

    const out = run(['backup'], { AUKORA_KIRA_STATE: newPath });
    const result = JSON.parse(out);

    expect(result.ok).toBe(true);
    expect(result.atoms).toBe(2);
    expect(result.receipts).toBe(2);
    expect(result.verify.ok).toBe(true);
    expect(existsSync(result.backupPath)).toBe(true);
    // repo-relative convention: <state dir>/backups/brain-<ISO8601, colons replaced>.json
    expect(result.backupPath).toBe(join(dir, 'kira', 'backups', basename(result.backupPath)));
    expect(basename(result.backupPath)).toMatch(/^brain-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/);

    const written = JSON.parse(readFileSync(result.backupPath, 'utf-8'));
    expect(written.atoms.length).toBe(2);
    expect(written.receipts.length).toBe(2);
    expect(verifyBrainState(written).ok).toBe(true);

    // never touched the real live state file this test isn't using
    expect(existsSync(newPath)).toBe(true);
    const live = JSON.parse(readFileSync(newPath, 'utf-8'));
    expect(live.atoms.length).toBe(2); // backup is a COPY — the live brain is unaffected either way
  });

  it('two backups taken in the same run never collide (distinct timestamps)', () => {
    run(['init'], { AUKORA_KIRA_STATE: newPath });
    const first = JSON.parse(run(['backup'], { AUKORA_KIRA_STATE: newPath }));
    const second = JSON.parse(run(['backup'], { AUKORA_KIRA_STATE: newPath }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.backupPath).not.toBe(second.backupPath);
    expect(existsSync(first.backupPath)).toBe(true);
    expect(existsSync(second.backupPath)).toBe(true);
  });

  it('refuses to back up a brain that fails verification — a backup of corruption is worse than none', () => {
    mkdirSync(join(dir, 'kira'), { recursive: true });
    let state = createEmptyBrain('2026-06-01T00:00:00.000Z');
    state = ingestMemory(state, { text: 'tamper target', source: 'fixture', scope: 'test', now: '2026-06-01T00:00:01.000Z' }).state;
    const tampered = JSON.parse(JSON.stringify(state));
    tampered.receipts[0].previousHash = 'evil'; // same tamper shape as kiraBrain.test.ts's own chain-tamper test
    writeFileSync(newPath, JSON.stringify(tampered, null, 2));

    const result = runExpectFail(['backup'], { AUKORA_KIRA_STATE: newPath });
    expect(result.status).not.toBe(0);
    // load() (shared by every command, including backup) already throws kira_state_invalid before
    // backup's own explicit verifyBrainState() refusal is ever reached — the exact same pre-existing
    // behavior every other command in this file has for a corrupt-on-disk state. Either way: no backup.
    expect(result.output).toMatch(/kira_state_invalid|refus.*verif/i);
    expect(existsSync(join(dir, 'kira', 'backups'))).toBe(false); // never even attempted the write
  });

  it('state/kira/backups/ is gitignored — a real backup file is never accidentally committable', () => {
    // git check-ignore exits 0 (and, with -q, prints nothing) when the path IS ignored — a non-zero exit
    // (execFileSync throwing) is what would indicate a real gap; reaching the assertion below is the pass.
    const out = execFileSync('git', ['check-ignore', '-q', 'state/kira/backups/brain-test.json'], { cwd: REPO, encoding: 'utf-8' });
    expect(out).toBe('');
  });
});
