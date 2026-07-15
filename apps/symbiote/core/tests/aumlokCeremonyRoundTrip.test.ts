// Issue #24 follow-up: the AUMLOK ceremony (authority/aumlok/ceremony.ts, the session/keyfile WRITER)
// and the gate bridge (authority/gate/opencodeAskBridge.ts, the READER) used to resolve their state
// paths independently — Round 4 moved the reader to ${AUKORA_SYMBIOTE_HOME:-~/.aukora-symbiote} but
// left the writer defaulting to the old shared ~/.aukora/, so an owner unlock silently wrote a
// session the gate never read. Both now import authority/symbiotePaths.ts. This is the missing
// end-to-end proof: the REAL ceremony CLI (a real subprocess, never mocked) writes a session, and the
// REAL gate bridge reads that exact file and unlocks — never a throwaway/simulated session object.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { readAukoraSession, aukoraGovernAsk } from '../../authority/gate/opencodeAskBridge';
import { aumlokSessionPath, aumlokKeyfilePath } from '../../authority/symbiotePaths';

const REPO = join(__dirname, '..', '..');
const CEREMONY = join(REPO, 'authority', 'aumlok', 'ceremony.ts');

// Fable QA (issue #25 follow-up): this file's own static top-level import of opencodeAskBridge (above)
// is EXACTLY what exposed the bug — SESSION_FILE/RECEIPT_FILE used to be module-level `const`s, resolved
// at import time, before the FIRST beforeEach below ever runs. Running this file appended 2 real
// gate-decision lines to the owner's REAL ~/.aukora-symbiote/aukora-ide-receipts.jsonl (17 -> 19). Both
// are now resolved lazily at call time (see the fix in opencodeAskBridge.ts) — this guards the regression
// by watching the REAL file's line count across the whole suite, not a temp one.
const REAL_RECEIPTS_FILE = join(homedir(), '.aukora-symbiote', 'aukora-ide-receipts.jsonl');
function realReceiptsLineCount(): number {
  try { return readFileSync(REAL_RECEIPTS_FILE, 'utf-8').split('\n').filter(Boolean).length; } catch { return 0; }
}
let realReceiptsCountBefore: number;
beforeAll(() => { realReceiptsCountBefore = realReceiptsLineCount(); });
afterAll(() => {
  expect(realReceiptsLineCount(), 'this whole test file must NEVER grow the owner\'s real receipts file').toBe(realReceiptsCountBefore);
});

// A 7-distinct-word phrase, each word >=4 chars, well above the 30-bit refusal floor and with no
// acrostic structural correlation — chosen so `set` never refuses it.
const TEST_PHRASE = 'correct horse battery staple mountain river forest';

function runCeremony(args: string[], env: Record<string, string>, stdin?: string): { status: number; output: string } {
  try {
    const output = execFileSync('bun', [CEREMONY, ...args], {
      cwd: REPO,
      env: { ...process.env, ...env },
      input: stdin,
      encoding: 'utf-8',
      timeout: 15000,
    });
    return { status: 0, output };
  } catch (err: any) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('AUMLOK ceremony writer -> gate bridge reader round-trip (issue #24 follow-up)', () => {
  let home: string;
  let noSuchLegacyPath: string;
  let prevSymbioteHome: string | undefined;
  let prevKeyfile: string | undefined;
  let prevSession: string | undefined;
  let prevSigner: string | undefined;
  let prevLegacy: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aukora-aumlok-roundtrip-'));
    // A real orphaned key genuinely exists at ~/.aukora/aumlok-dev.json on at least one real dev
    // machine (confirmed while building this fix) — tests must never depend on that real path being
    // empty, so point the legacy-detection at a definitely-nonexistent path for the "clean" tests.
    noSuchLegacyPath = join(home, 'no-such-legacy-keyfile-here.json');
    prevSymbioteHome = process.env.AUKORA_SYMBIOTE_HOME;
    prevKeyfile = process.env.AUKORA_AUMLOK_KEYFILE;
    prevSession = process.env.AUKORA_IDE_SESSION_FILE;
    prevSigner = process.env.AUKORA_SIGNER_SOCK;
    prevLegacy = process.env.AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE;
    // clear the per-file overrides so both writer and reader fall through to the shared resolver's
    // AUKORA_SYMBIOTE_HOME default — that fallthrough IS the thing under test.
    delete process.env.AUKORA_AUMLOK_KEYFILE;
    delete process.env.AUKORA_IDE_SESSION_FILE;
    delete process.env.AUKORA_SIGNER_SOCK;
    process.env.AUKORA_SYMBIOTE_HOME = home;
    process.env.AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE = noSuchLegacyPath;
  });
  afterEach(() => {
    if (prevSymbioteHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = prevSymbioteHome;
    if (prevKeyfile === undefined) delete process.env.AUKORA_AUMLOK_KEYFILE; else process.env.AUKORA_AUMLOK_KEYFILE = prevKeyfile;
    if (prevSession === undefined) delete process.env.AUKORA_IDE_SESSION_FILE; else process.env.AUKORA_IDE_SESSION_FILE = prevSession;
    if (prevSigner === undefined) delete process.env.AUKORA_SIGNER_SOCK; else process.env.AUKORA_SIGNER_SOCK = prevSigner;
    if (prevLegacy === undefined) delete process.env.AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE; else process.env.AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE = prevLegacy;
    rmSync(home, { recursive: true, force: true });
  });

  it('writer (ceremony.ts) and reader (opencodeAskBridge.ts) resolve the IDENTICAL session path from the shared resolver', () => {
    // The writer resolves its own path only by running (it's a CLI); the shared resolver itself, under
    // the SAME env, is what both files call — assert it's stable and matches what the reader uses.
    expect(aumlokSessionPath()).toBe(join(home, 'aukora-ide-session.json'));
  });

  it('a real ceremony `set` + `verify` writes a session the real gate bridge reads and unlocks from', () => {
    const setResult = runCeremony(['set'], {}, TEST_PHRASE + '\n');
    expect(setResult.status).toBe(0);
    expect(existsSync(aumlokKeyfilePath())).toBe(true);

    const verifyResult = runCeremony(['verify'], {}, TEST_PHRASE + '\n');
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.output).toMatch(/unlocked/i);

    // The REAL session file, at the REAL resolved path — not a fixture, not a mock.
    const sessionPath = aumlokSessionPath();
    expect(existsSync(sessionPath)).toBe(true);
    const raw = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    expect(raw.unlocked).toBe(true);

    // The REAL reader, reading that REAL file.
    const session = readAukoraSession(sessionPath);
    expect(session.unlocked).toBe(true);
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    // The full gate: a low-risk memory ask must now ALLOW, not PAUSE (locked).
    const decision = aukoraGovernAsk({ permission: 'memory', metadata: { diff: 'hello' } }, session);
    expect(decision.effect).not.toBe('pause');

    // Fable QA (issue #25 follow-up): the gate receipt this call just recorded must land under the
    // TEMP home, never the real one — proves RECEIPT_FILE resolves lazily now, not at import time.
    // Fail-before: with the old module-level const, this file would not exist (the receipt landed in
    // the REAL ~/.aukora-symbiote instead, silently, since this test file statically imports
    // opencodeAskBridge above, before this describe block's beforeEach ever runs).
    expect(existsSync(join(home, 'aukora-ide-receipts.jsonl'))).toBe(true);
  }, 20000);

  it('a wrong phrase never unlocks (session stays unwritten / locked) — the round-trip fails closed, not open', () => {
    const setResult = runCeremony(['set'], {}, TEST_PHRASE + '\n');
    expect(setResult.status).toBe(0);

    const verifyResult = runCeremony(['verify'], {}, 'definitely the wrong phrase entirely\n');
    expect(verifyResult.status).not.toBe(0);

    const session = readAukoraSession(aumlokSessionPath());
    expect(session.unlocked).toBe(false);
    const decision = aukoraGovernAsk({ permission: 'memory', metadata: { diff: 'hello' } }, session);
    expect(decision.effect).toBe('pause');
  }, 20000);

  it('refuses to generate a fresh key when orphaned key material exists at the legacy path — never auto-moves it', () => {
    const legacyPath = join(home, 'simulated-legacy', 'aumlok-dev.json');
    mkdirSync(join(home, 'simulated-legacy'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ approvalKeyHash: 'deadbeef', mode: 'own', v: 'aumlok-ceremony-v1' }));
    process.env.AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE = legacyPath;

    const result = runCeremony(['set'], {}, TEST_PHRASE + '\n');
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/REFUSING TO GENERATE A NEW KEY/);
    expect(result.output).toContain(`mv ${legacyPath}`);
    // never auto-moved, never silently generated a fresh one in its place
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(aumlokKeyfilePath())).toBe(false);
  }, 20000);
});
