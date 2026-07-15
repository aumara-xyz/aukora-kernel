// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Hermetic tests for the working-focus register (issue #178 round 1): bounded validated values,
// forbidden content refused (never sanitized-and-kept), one governed invoke per set, refusals
// never throw, pointer file is content-free + defensive + 0600, reads are honest typed absences,
// an erased row clears its stale pointer, and every envelope carries the no-authority stamps.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  buildFocusValue,
  makeFocusKey,
  setFocus,
  parseFocusValue,
  writeFocusPointer,
  readFocusPointerSafe,
  clearFocusPointer,
  readCurrentFocus,
  focusRegisterGrantsAuthority,
  FOCUS_SCHEMA,
  MAX_FOCUS_WHAT_CHARS,
  MAX_FOCUS_WHY_CHARS,
  type SetFocusDeps,
} from '../src/focusRegister';
import type { CaptureUseLease } from '../src/conversationShadowCapture';
import { MEM_KEY_RE, REGISTERED_GOVERNED_MUTATION } from '../src/memoryAppend';

const OWNER = 'aumara.root';
const AT = '2026-07-08T03:30:00.000Z';

const goodInput = (over: Record<string, unknown> = {}) => ({
  what: 'Great Merge round 1: land the governed focus row',
  why: 'MAIN assigned it; the benchmark-won brain needs a persistent working thread',
  who: 'owner-typed',
  at: AT,
  ...over,
});

function fakeKernel() {
  const calls: Array<{ name: string; payload: { req: Record<string, unknown>; subjectSig: string; value: string } }> = [];
  const invoke = async (name: string, payload: { req: Record<string, unknown>; subjectSig: string; value: string }) => {
    calls.push({ name, payload });
    const req = payload.req as { ownerRootId: string; key: string };
    const memoryHash = createHash('sha256').update(`${req.ownerRootId}:${req.key}:${payload.value}`, 'utf8').digest('hex');
    return { ok: true, receiptHash: 'r'.repeat(16), memoryHash };
  };
  return { calls, invoke };
}

function lease(seq = 0, onSuccess?: () => void): CaptureUseLease {
  return { manifestId: 'mft-focus-test', subjectId: 'capture.door', useSeq: seq, signConsume: async () => 'sig-test', onSuccess };
}

function deps(overrides: Partial<SetFocusDeps> = {}): SetFocusDeps {
  const k = fakeKernel();
  return { ownerRootId: OWNER, deploymentUrl: 'http://127.0.0.1:3210', invoke: k.invoke, nextUse: async () => lease(), ...overrides };
}

describe('buildFocusValue — bounded, validated, advisory, forbidden content refused', () => {
  it('builds a focus-v1 with the no-authority stamps and trims what/who', () => {
    const r = buildFocusValue(goodInput({ what: '  land the focus row  ', who: ' owner-typed ' }) as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.schema).toBe(FOCUS_SCHEMA);
    expect(r.value.what).toBe('land the focus row');
    expect(r.value.who).toBe('owner-typed');
    expect(r.value.advisoryOnly).toBe(true);
    expect(r.value.grantsAuthority).toBe(false);
  });

  it('refuses empty what, oversize what/why, and bad who — typed, never thrown', () => {
    expect(buildFocusValue(goodInput({ what: '   ' }) as never)).toMatchObject({ ok: false, refused: 'focus_what_empty' });
    expect(buildFocusValue(goodInput({ what: 'x'.repeat(MAX_FOCUS_WHAT_CHARS + 1) }) as never)).toMatchObject({ ok: false, refused: 'focus_what_too_long' });
    expect(buildFocusValue(goodInput({ why: 'y'.repeat(MAX_FOCUS_WHY_CHARS + 1) }) as never)).toMatchObject({ ok: false, refused: 'focus_why_too_long' });
    expect(buildFocusValue(goodInput({ who: '' }) as never)).toMatchObject({ ok: false, refused: 'focus_who_invalid' });
    expect(buildFocusValue(null as never)).toMatchObject({ ok: false, refused: 'focus_input_invalid' });
  });

  it('a secret-shaped candidate is REFUSED (dropped), never sanitized-and-kept', () => {
    const r = buildFocusValue(goodInput({ why: 'use key sk-abcdefghijklmnop to deploy' }) as never);
    expect(r).toMatchObject({ ok: false, refused: 'focus_forbidden_content:why', advisoryOnly: true, grantsAuthority: false });
  });
});

describe('makeFocusKey — MEM_KEY_RE-safe append-only history keys', () => {
  it('shapes focus.<compact-ts>.<seq> and always passes the kernel key law', () => {
    const k = makeFocusKey(AT, 7);
    expect(k.startsWith('focus.')).toBe(true);
    expect(k.endsWith('.7')).toBe(true);
    expect(MEM_KEY_RE.test(k)).toBe(true);
  });
});

describe('setFocus — one governed invoke, refusals never throw', () => {
  it('a valid set calls the injected invoke exactly once with the governed path + scoped req', async () => {
    const k = fakeKernel();
    let advanced = 0;
    const r = await setFocus(goodInput() as never, deps({ invoke: k.invoke, nextUse: async () => lease(3, () => { advanced += 1; }) }));
    expect(r.ok).toBe(true);
    expect(k.calls.length).toBe(1);
    expect(k.calls[0].name).toBe(REGISTERED_GOVERNED_MUTATION);
    const req = k.calls[0].payload.req as Record<string, unknown>;
    expect(req.resource).toBe(`mem:${OWNER}`);
    expect(String(req.key).startsWith('focus.')).toBe(true);
    expect(req.useSeq).toBe(3);
    expect(advanced).toBe(1);
  });

  it('a forbidden input never leases and never invokes (zero valid content, zero writes)', async () => {
    let leased = 0;
    const k = fakeKernel();
    const r = await setFocus(goodInput({ what: 'sk-abcdefghijklmnop' }) as never, deps({ invoke: k.invoke, nextUse: async () => { leased += 1; return lease(); } }));
    expect(r.ok).toBe(false);
    expect(leased).toBe(0);
    expect(k.calls.length).toBe(0);
  });

  it('lease/sign/invoke failures are typed refusals with the advisory stamps, never throws', async () => {
    expect(await setFocus(goodInput() as never, deps({ nextUse: async () => { throw new Error('manifest exhausted'); } })))
      .toMatchObject({ ok: false, advisoryOnly: true, grantsAuthority: false });
    expect(await setFocus(goodInput() as never, deps({ nextUse: async () => ({ ...lease(), signConsume: async () => { throw new Error('no pen'); } }) })))
      .toMatchObject({ ok: false, refused: expect.stringContaining('focus_sign_failed') });
    expect(await setFocus(goodInput() as never, deps({ invoke: async () => { throw new Error('backend gone'); } })))
      .toMatchObject({ ok: false, advisoryOnly: true, grantsAuthority: false });
  });
});

describe('pointer file — content-free, defensive, 0600', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-focusptr-'));
    file = path.join(dir, 'focus-pointer.json');
  });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  it('round-trips a pointer at 0600 and clears cleanly', () => {
    const key = makeFocusKey(AT, 0);
    expect(writeFocusPointer({ key, at: AT, setAt: AT }, file)).toBe(true);
    expect((fs.statSync(file).mode & 0o777)).toBe(0o600);
    expect(readFocusPointerSafe(file)).toMatchObject({ key });
    expect(clearFocusPointer(file)).toBe(true);
    expect(readFocusPointerSafe(file)).toBeNull();
  });

  it('refuses to write a non-key and reads anything malformed as null', () => {
    expect(writeFocusPointer({ key: '../../etc/passwd', at: AT, setAt: AT }, file)).toBe(false);
    fs.writeFileSync(file, 'not json');
    expect(readFocusPointerSafe(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ key: 'focus.ok.0' })); // missing fields
    expect(readFocusPointerSafe(file)).toBeNull();
    expect(readFocusPointerSafe(path.join(dir, 'missing.json'))).toBeNull();
  });
});

describe('parseFocusValue — strict, stamp-checked', () => {
  const good = () => ({ schema: FOCUS_SCHEMA, at: AT, what: 'w', why: '', who: 'owner-typed', advisoryOnly: true, grantsAuthority: false });
  it('accepts a well-formed value and refuses wrong schema / missing stamps / oversize', () => {
    expect(parseFocusValue(JSON.stringify(good()))).toMatchObject({ what: 'w' });
    expect(parseFocusValue(JSON.stringify({ ...good(), schema: 'turn-summary-v1' }))).toBeNull();
    expect(parseFocusValue(JSON.stringify({ ...good(), grantsAuthority: true }))).toBeNull();
    expect(parseFocusValue(JSON.stringify({ ...good(), what: 'x'.repeat(MAX_FOCUS_WHAT_CHARS + 1) }))).toBeNull();
    expect(parseFocusValue('not json')).toBeNull();
  });
});

describe('readCurrentFocus — honest typed absences; an erased row clears its stale pointer', () => {
  let dir: string;
  let file: string;
  const key = makeFocusKey(AT, 0);
  const value = JSON.stringify({ schema: FOCUS_SCHEMA, at: AT, what: 'the merge', why: 'assigned', who: 'owner-typed', advisoryOnly: true, grantsAuthority: false });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-focusread-'));
    file = path.join(dir, 'focus-pointer.json');
    writeFocusPointer({ key, at: AT, setAt: AT }, file);
  });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };

  it('serves a present focus from a found row', async () => {
    const r = await readCurrentFocus({ recallByKey: async (k) => ({ ok: true, found: true, key: k, value, ...advisory }) }, file);
    expect(r).toMatchObject({ present: true, key, focus: { what: 'the merge' } });
  });

  it('no pointer → no_pointer; refused read → read_refused; throw → read_failed; bad value → value_malformed', async () => {
    clearFocusPointer(file);
    expect(await readCurrentFocus({ recallByKey: async () => { throw new Error('unreachable'); } }, file)).toMatchObject({ present: false, reason: 'no_pointer' });
    writeFocusPointer({ key, at: AT, setAt: AT }, file);
    expect(await readCurrentFocus({ recallByKey: async (k) => ({ ok: false, key: k, error: 'owner_seed_missing', ...advisory }) }, file)).toMatchObject({ present: false, reason: expect.stringContaining('read_refused') });
    expect(await readCurrentFocus({ recallByKey: async () => { throw new Error('net down'); } }, file)).toMatchObject({ present: false, reason: expect.stringContaining('read_failed') });
    expect(await readCurrentFocus({ recallByKey: async (k) => ({ ok: true, found: true, key: k, value: 'not json', ...advisory }) }, file)).toMatchObject({ present: false, reason: 'value_malformed' });
  });

  it('an ERASED row reads as absent AND drops the stale pointer (erasure is respected everywhere)', async () => {
    const r = await readCurrentFocus({ recallByKey: async (k) => ({ ok: true, found: false, key: k, reason: 'erased', ...advisory }) }, file);
    expect(r).toMatchObject({ present: false, reason: 'row_erased' });
    expect(readFocusPointerSafe(file)).toBeNull(); // pointer gone — the erased register cannot resurrect
  });
});

describe('no authority, ever', () => {
  it('the register grants nothing', () => {
    expect(focusRegisterGrantsAuthority()).toBe(false);
  });
});
