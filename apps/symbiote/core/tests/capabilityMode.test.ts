// Issue #55: owner lockdown / capability mode. The pure module is tested here against real temp
// files; the door wiring (chat-serve.ts) is source-asserted to place the lockdown intercept BEFORE
// ensureLoop — the load-bearing security property (else `voice: lockdown` reaches a billed model call).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isLockdownCommand,
  readCapabilityMode,
  engageLockdown,
  lockdownConfirmationEntries,
} from '../../spatial/capabilityMode';

let dir: string;
const modePath = () => path.join(dir, 'capability-mode.json');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-capmode-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('capabilityMode: isLockdownCommand', () => {
  it('matches the exact command, tolerant of casing and surrounding whitespace', () => {
    expect(isLockdownCommand('voice: lockdown')).toBe(true);
    expect(isLockdownCommand('  voice: lockdown  ')).toBe(true);
    expect(isLockdownCommand('VOICE: LOCKDOWN')).toBe(true);
  });

  it('does NOT trigger on prose that merely mentions lockdown (no incidental kill switch)', () => {
    expect(isLockdownCommand('what does voice: lockdown do?')).toBe(false);
    expect(isLockdownCommand('please voice: lockdown')).toBe(false);
    expect(isLockdownCommand('lockdown')).toBe(false);
    expect(isLockdownCommand('tell me about lockdown mode')).toBe(false);
  });
});

describe('capabilityMode: read/engage persistence', () => {
  it('absent file → advisory (the safe default)', () => {
    expect(readCapabilityMode(modePath())).toBe('advisory');
  });

  it('engageLockdown persists to disk and reads back as lockdown (survives a restart)', () => {
    const rec = engageLockdown(modePath(), '2026-07-02T23:00:00.000Z');
    expect(rec.mode).toBe('lockdown');
    expect(fs.existsSync(modePath())).toBe(true);
    // A fresh read (simulating a door restart reading the same file) still sees lockdown.
    expect(readCapabilityMode(modePath())).toBe('lockdown');
  });

  it('malformed mode file → advisory (a corrupt file must not brick chat, and cannot fake a lockdown)', () => {
    fs.writeFileSync(modePath(), 'not json at all');
    expect(readCapabilityMode(modePath())).toBe('advisory');
    fs.writeFileSync(modePath(), JSON.stringify({ mode: 'something-else' }));
    expect(readCapabilityMode(modePath())).toBe('advisory');
  });

  it('only an explicit {mode:"lockdown"} locks — no other value does', () => {
    fs.writeFileSync(modePath(), JSON.stringify({ mode: 'advisory' }));
    expect(readCapabilityMode(modePath())).toBe('advisory');
    fs.writeFileSync(modePath(), JSON.stringify({ mode: 'lockdown' }));
    expect(readCapabilityMode(modePath())).toBe('lockdown');
  });
});

describe('capabilityMode: honest confirmation', () => {
  it('states advisory-only, that nothing is revoked yet, and that clearing is an owner-terminal action', () => {
    const entries = lockdownConfirmationEntries('2026-07-02T23:00:00.000Z');
    const joined = entries.map((e) => e.text).join(' ');
    expect(joined).toContain('advisory-only');
    expect(joined).toContain('revokes nothing'); // Stage-0 honesty: nothing promoted yet
    expect(joined).toMatch(/terminal/i); // clearing is deliberate, not a chat command
    expect(joined).toContain('no model call'); // parsed by the door
  });
});

describe('capabilityMode: door wiring (source assertion — the security-critical placement)', () => {
  const DOOR_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'chat-serve.ts'), 'utf-8');

  it('the lockdown intercept is placed BEFORE ensureLoop() (never falls through to a billed model call)', () => {
    const interceptIdx = DOOR_SRC.indexOf('isLockdownCommand(ownerText)');
    const ensureLoopIdx = DOOR_SRC.indexOf('await ensureLoop()');
    expect(interceptIdx).toBeGreaterThan(-1);
    expect(ensureLoopIdx).toBeGreaterThan(-1);
    expect(interceptIdx).toBeLessThan(ensureLoopIdx);
  });

  it('the intercept returns directly (does not continue into the grammar/voice path)', () => {
    const block = DOOR_SRC.slice(DOOR_SRC.indexOf('isLockdownCommand(ownerText)'), DOOR_SRC.indexOf('await ensureLoop()'));
    expect(block).toContain('engageLockdown(capabilityModePath()');
    expect(block).toContain('return json(req, { entries: lockdownConfirmationEntries');
  });
});
