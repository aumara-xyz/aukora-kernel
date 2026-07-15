// Issue #54: capability flight recorder. Append-only JSONL witness; redaction + size caps; fail-closed
// return contract (a promoted capability that can't be logged must not run — the recorder reports, the
// caller enforces). The lockdown wiring (chat-serve.ts) is source-asserted below.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordCapabilityEvent, readFlightLog, listFlightFiles, flightFilePath, verifyFlightChain, GENESIS_PREV_HASH } from '../src/flightRecorder';

let dir: string;
const NOW = '2026-07-02T23:30:00.000Z';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-flight-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('flightRecorder: append-only writing', () => {
  it('a capability call writes exactly one parseable JSONL event', () => {
    const r = recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'owner lockdown → advisory-only' }, NOW);
    expect(r.ok).toBe(true);
    const log = readFlightLog(dir, NOW);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('mode_change');
    expect(log[0].at).toBe(NOW);
    expect(log[0].schema).toBe('aukora-flight-event-v2'); // v2 = hash-chained (#60)
    expect(log[0].eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(log[0].prevHash).toBe(GENESIS_PREV_HASH); // first event of the day anchors to genesis
  });

  it('two events append (append-only — the first is never overwritten)', () => {
    recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'first' }, NOW);
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'second' }, NOW);
    const log = readFlightLog(dir, NOW);
    expect(log.length).toBe(2);
    expect(log.map((e) => e.detail)).toEqual(['first', 'second']);
  });

  it('events on different days land in separate daily files', () => {
    recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'day1' }, '2026-07-02T10:00:00.000Z');
    recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'day2' }, '2026-07-03T10:00:00.000Z');
    expect(listFlightFiles(dir)).toEqual(['flight-2026-07-02.jsonl', 'flight-2026-07-03.jsonl']);
  });
});

describe('flightRecorder: redaction + size caps (no secrets or huge content ever persist)', () => {
  it('a 40+ hex run in detail is truncated to a 16-char prefix, never stored whole', () => {
    const secretish = 'a'.repeat(64); // sha256-shaped
    const r = recordCapabilityEvent(dir, { kind: 'tool_call', detail: `read file with hash ${secretish}` }, NOW);
    expect(r.ok).toBe(true);
    const raw = fs.readFileSync(flightFilePath(dir, NOW), 'utf8');
    expect(raw).not.toContain(secretish); // the full 64-hex run must NOT be on disk
    expect(readFlightLog(dir, NOW)[0].detail).toContain('a'.repeat(16) + '…');
  });

  it('detail is capped at 500 chars and string meta values at 200', () => {
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'x'.repeat(2000), meta: { note: 'y'.repeat(2000) } }, NOW);
    const e = readFlightLog(dir, NOW)[0];
    expect(e.detail.length).toBeLessThanOrEqual(500);
    expect(String(e.meta.note).length).toBeLessThanOrEqual(200);
  });

  it('hex runs inside meta string values are also truncated', () => {
    const secretish = 'f'.repeat(50);
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'ok', meta: { arg: secretish } }, NOW);
    const raw = fs.readFileSync(flightFilePath(dir, NOW), 'utf8');
    expect(raw).not.toContain(secretish);
  });
});

describe('flightRecorder: fail-closed contract', () => {
  it('an unwritable directory path returns ok:false with an honest error, and does not throw', () => {
    // Point the "dir" at a path whose parent is a FILE, so mkdir/append cannot succeed.
    const fileNotDir = path.join(dir, 'a-file');
    fs.writeFileSync(fileNotDir, 'x');
    const r = recordCapabilityEvent(path.join(fileNotDir, 'nested'), { kind: 'tool_call', detail: 'boom' }, NOW);
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    // A promoted capability seeing ok:false is contractually required to refuse — this is the signal.
  });

  it('reading a missing log returns [] (not an error)', () => {
    expect(readFlightLog(dir, NOW)).toEqual([]);
    expect(listFlightFiles(dir)).toEqual([]);
  });
});

describe('flightRecorder: hash-chained integrity (issue #60)', () => {
  it('each event links to the previous one (prevHash === previous eventHash), first anchors to genesis', () => {
    recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'first' }, NOW);
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'second' }, NOW);
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'third' }, NOW);
    const log = readFlightLog(dir, NOW);
    expect(log[0].prevHash).toBe(GENESIS_PREV_HASH);
    expect(log[1].prevHash).toBe(log[0].eventHash);
    expect(log[2].prevHash).toBe(log[1].eventHash);
  });

  it('an intact chain verifies ok; an empty/missing log is a valid empty chain', () => {
    expect(verifyFlightChain(dir, NOW)).toEqual({ ok: true, length: 0, brokenAt: null, reason: null });
    recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'a' }, NOW);
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'b' }, NOW);
    const v = verifyFlightChain(dir, NOW);
    expect(v.ok).toBe(true);
    expect(v.length).toBe(2);
    expect(v.brokenAt).toBeNull();
  });

  it('tampering with an event body is detected (eventHash no longer matches its contents)', () => {
    recordCapabilityEvent(dir, { kind: 'mode_change', detail: 'a' }, NOW);
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'b' }, NOW);
    // rewrite event 0's detail in place, keeping its stored eventHash — a classic after-the-fact edit.
    const p = flightFilePath(dir, NOW);
    const lines = fs.readFileSync(p, 'utf8').trimEnd().split('\n');
    const ev0 = JSON.parse(lines[0]);
    ev0.detail = 'TAMPERED — this is not what happened';
    lines[0] = JSON.stringify(ev0);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    const v = verifyFlightChain(dir, NOW);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
    expect(v.reason).toMatch(/tampered/);
  });

  it('deleting a middle event breaks the linkage (prevHash mismatch)', () => {
    recordCapabilityEvent(dir, { kind: 'a', detail: '1' }, NOW);
    recordCapabilityEvent(dir, { kind: 'b', detail: '2' }, NOW);
    recordCapabilityEvent(dir, { kind: 'c', detail: '3' }, NOW);
    const p = flightFilePath(dir, NOW);
    const lines = fs.readFileSync(p, 'utf8').trimEnd().split('\n');
    fs.writeFileSync(p, [lines[0], lines[2]].join('\n') + '\n'); // drop the middle event
    const v = verifyFlightChain(dir, NOW);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1); // the survivor whose prevHash points at the deleted event
    expect(v.reason).toMatch(/prevHash|reorder|insert|delete/i);
  });
});

describe('flightRecorder: secret-shaped content is redacted, never written verbatim (#54/#60)', () => {
  it('an sk-or-* key in detail is redacted (not just hex-collapsed) and the chain still verifies', () => {
    const key = 'sk-or-v1-deadbeefdeadbeefdeadbeefdeadbeef';
    const r = recordCapabilityEvent(dir, { kind: 'tool_call', detail: `calling model with ${key}` }, NOW);
    expect(r.ok).toBe(true);
    const raw = fs.readFileSync(flightFilePath(dir, NOW), 'utf8');
    expect(raw).not.toContain(key);
    expect(readFlightLog(dir, NOW)[0].detail).toContain('[redacted:');
    expect(verifyFlightChain(dir, NOW).ok).toBe(true); // redaction happens before hashing — chain intact
  });

  it('a secret-shaped meta value is redacted too', () => {
    const key = 'sk-or-v1-cafebabecafebabecafebabecafebabe';
    recordCapabilityEvent(dir, { kind: 'tool_call', detail: 'ok', meta: { arg: key } }, NOW);
    const raw = fs.readFileSync(flightFilePath(dir, NOW), 'utf8');
    expect(raw).not.toContain(key);
  });
});

describe('flightRecorder: lockdown is its first wired customer (source assertion)', () => {
  const DOOR_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'chat-serve.ts'), 'utf-8');
  it('the lockdown intercept records a mode_change flight event', () => {
    const block = DOOR_SRC.slice(DOOR_SRC.indexOf('isLockdownCommand(ownerText)'), DOOR_SRC.indexOf('return json(req, { entries: lockdownConfirmationEntries'));
    expect(block).toContain("recordCapabilityEvent(flightRecorderDir()");
    expect(block).toContain("kind: 'mode_change'");
  });
});
