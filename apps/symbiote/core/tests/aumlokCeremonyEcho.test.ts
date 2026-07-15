// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aumlok-ceremony-echo-v1 (#288) — the pins the approved contract names, testable as written:
// closed-field smuggling sweep, packet determinism, single-use receipt, failure-path renders nothing,
// provenance carries no person-derived number, and the state renders as the WORD `silver`, never a
// value. The echo is display/evidence only: one-way door→display, never authority, never proof of
// humanity — and no phrase material of any kind can enter it (each prohibited field refuses by name).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  CEREMONY_ECHO_SCHEMA, validateCeremonyEchoPacket, buildCeremonyEchoPacket, deriveReceiptRef,
  echoEnvelopeParams, ceremonyEchoProvenanceLine,
} from '../src/aumlokCeremonyEcho';

const GOOD = () => ({
  schema: 'aumlok-ceremony-echo-v1',
  event: 'bind',
  rootId: 'b926fd124e810e24',
  receiptRef: 'a1b2c3d4e5f60718293a4b5c',
  at: '2026-07-10T12:00:00.000Z',
});
const fresh = () => new Set<string>();

describe('acceptance matrix — verbatim (contract §6)', () => {
  it('a well-formed packet validates and canonicalizes `at`', () => {
    const v = validateCeremonyEchoPacket({ ...GOOD(), at: '2026-07-10T12:00:00+00:00' }, fresh());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.packet.at).toBe('2026-07-10T12:00:00.000Z');
  });

  it.each([
    ['packet_not_an_object', null],
    ['packet_not_an_object', 'a string'],
    ['packet_not_an_object', [1, 2]],
    ['packet_wrong_schema', { ...GOOD(), schema: 'aumlok-ceremony-echo-v2' }],
    ['packet_bad_event', { ...GOOD(), event: 'unbind' }],
    ['packet_root_invalid', { ...GOOD(), rootId: 'UPPER-Case' }],
    ['packet_root_invalid', { ...GOOD(), rootId: 'x'.repeat(65) }],
    ['packet_receipt_ref_invalid', { ...GOOD(), receiptRef: 'has space' }],
    ['packet_at_invalid', { ...GOOD(), at: 'not-a-time' }],
    ['packet_drand_invalid', { ...GOOD(), drand: { round: 0 } }],
    ['packet_drand_invalid', { ...GOOD(), drand: { round: 2.5 } }],
    ['packet_drand_invalid', { ...GOOD(), drand: { round: 5, extra: 1 } }],
    ['packet_drand_invalid', { ...GOOD(), drand: 42 }],
    ['packet_unknown_field', { ...GOOD(), anything: true }],
  ] as const)('%s refuses', (code, input) => {
    const v = validateCeremonyEchoPacket(input as never, fresh());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refused).toBe(code);
  });

  it('refusal reasons are categorical — offending contents are never echoed', () => {
    const v = validateCeremonyEchoPacket({ ...GOOD(), phrase: 'SECRET-WORDS-HERE' }, fresh());
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).not.toContain('SECRET-WORDS-HERE');
  });
});

describe('prohibited by name — the smuggling sweep (each named field refuses the WHOLE packet)', () => {
  const PROHIBITED = [
    'phrase', 'words', 'normalizedPhrase', 'fingerprint', 'phraseFingerprintSha256', 'kdf', 'kdfOutput',
    'salt', 'saltHex', 'phraseHash', 'typing', 'keystrokes', 'timings', 'durations', 'attempts',
    'attemptCount', 'entropy', 'strength', 'key', 'privateKey', 'signature', 'audio',
    'score', 'rank', 'level', 'aura', 'auraScore',
  ];
  it.each(PROHIBITED.map((f) => [f]))('extra field "%s" → packet_unknown_field', (field) => {
    const v = validateCeremonyEchoPacket({ ...GOOD(), [field]: 'x' }, fresh());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refused).toBe('packet_unknown_field');
  });
});

describe('single-use receipt — the ripple can never become a signaling channel', () => {
  it('a repeated receiptRef refuses (packet_replayed), even across otherwise-different packets', () => {
    const seen = fresh();
    expect(validateCeremonyEchoPacket(GOOD(), seen).ok).toBe(true);
    const again = validateCeremonyEchoPacket({ ...GOOD(), event: 'rotate' }, seen);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.refused).toBe('packet_replayed');
  });
});

describe('determinism (the #290 property holds for the echo)', () => {
  it('identical packet → byte-identical envelope params; drand seeds phase, never the envelope', () => {
    const v = validateCeremonyEchoPacket({ ...GOOD(), drand: { round: 30226057 } }, fresh());
    if (!v.ok) throw new Error('validate failed');
    const a = echoEnvelopeParams(v.packet);
    const b = echoEnvelopeParams(v.packet);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // fixed envelope, always (rise → sustain → settle, ~10s)
    expect([a.riseMs, a.sustainMs, a.settleMs]).toEqual([2400, 1800, 6000]);
    // phase offsets are bounded [0,1) and drand-sensitive (public randomness only)
    for (const p of a.phase) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(1); }
    const v2 = validateCeremonyEchoPacket({ ...GOOD(), receiptRef: 'b'.repeat(24), drand: { round: 30226058 } }, fresh());
    if (!v2.ok) throw new Error('validate failed');
    expect(JSON.stringify(echoEnvelopeParams(v2.packet).phase)).not.toBe(JSON.stringify(a.phase));
  });

  it('the state renders as the WORD silver — a named qualitative state, never a value', () => {
    const v = validateCeremonyEchoPacket(GOOD(), fresh());
    if (!v.ok) throw new Error('validate failed');
    expect(echoEnvelopeParams(v.packet).state).toBe('silver');
  });
});

describe('provenance line — recorded fact, no person-derived number', () => {
  it('bind and rotate shapes match the exact template; drand appears ONLY when present', () => {
    const TEMPLATE = /^(bound|rotated) locally · receipt [a-z0-9._-]{1,12}( · drand [1-9][0-9]*)?$/;
    const noDrand = validateCeremonyEchoPacket(GOOD(), fresh());
    const withDrand = validateCeremonyEchoPacket({ ...GOOD(), receiptRef: 'c'.repeat(24), event: 'rotate', drand: { round: 30226057 } }, fresh());
    if (!noDrand.ok || !withDrand.ok) throw new Error('validate failed');
    const l1 = ceremonyEchoProvenanceLine(noDrand.packet);
    const l2 = ceremonyEchoProvenanceLine(withDrand.packet);
    expect(l1).toMatch(TEMPLATE);
    expect(l2).toMatch(TEMPLATE);
    expect(l1).toContain('bound locally');
    expect(l1).not.toContain('drand'); // never invented
    expect(l2).toContain('rotated locally · receipt cccccccccccc · drand 30226057');
  });
});

describe('deriveReceiptRef — content-free by construction', () => {
  it('derives only from public inputs, is grammar-valid, and changes when any public input changes', () => {
    const base = { keyId: 'b926fd124e810e24', boundAt: '2026-07-07T10:21:11.765Z', event: 'bind' as const, atIso: '2026-07-10T12:00:00.000Z' };
    const r1 = deriveReceiptRef(base);
    expect(r1).toMatch(/^[a-z0-9._-]{1,64}$/);
    expect(deriveReceiptRef(base)).toBe(r1); // deterministic
    expect(deriveReceiptRef({ ...base, event: 'rotate' })).not.toBe(r1);
    expect(deriveReceiptRef({ ...base, atIso: '2026-07-10T12:00:01.000Z' })).not.toBe(r1);
  });
});

describe('the door wiring — structural pins (one construction site; failure path renders nothing)', () => {
  const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');

  it('the echo is constructed ONLY after the success verdict — the failure return precedes it', () => {
    const failIdx = door.indexOf('if (!v.ok) return json(v, 403); // failed/abandoned ceremony');
    const echoIdx = door.indexOf('buildEchoForSuccess(v.mode');
    expect(failIdx).toBeGreaterThan(0);
    expect(echoIdx).toBeGreaterThan(failIdx); // failure exits BEFORE any packet can exist
  });

  it('construction consumes only the three contract inputs — no phrase-adjacent identifier is passed', () => {
    const fn = door.slice(door.indexOf('function buildEchoForSuccess'), door.indexOf('Bun.serve'));
    for (const banned of ['phrase', 'typed', 'fingerprint', 'salt', 'kdf', 'candidate', 'privPath', 'authority-ed25519.key']) {
      expect(fn.toLowerCase()).not.toContain(banned);
    }
    expect(fn).toContain('resolveGenesisBindingFacts'); // one fail-closed v1/v2 public-facts bridge
  });

  it('the page renders the echo only when a validated packet arrived, and shows the named silver state path', () => {
    expect(door).toContain('v.echo && v.echo.packet && v.echo.envelope && v.echo.envelope.state==="silver"');
    expect(door).toContain('.echo-prov'); // the provenance line exists
    // reduced-motion renders no ripple — display stays honest for everyone
    expect(door).toContain('@media (prefers-reduced-motion: reduce){.echo-ripple{animation:none');
  });

  it('one-way valve: the renderer exposes no readback — no echo-related fetch/endpoint exists on the door', () => {
    expect(door).not.toContain('/api/bind/echo'); // no query API for the echo, by contract
  });
});
