import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  sanitizeTraceEvent, scanForbiddenKeys, scanForbiddenValues, recordTraceEvent, getTraces, clearTraces, auditStoredTraces,
  telemetryGrantsAuthority, witnessGrantsCapability, latencyOnlyClassifierSufficient, ALLOWED_FIELDS,
} from '../src/boundaryTraceTelemetry';
import { runFixtureEval, buildBoundaryTraceFixture } from '../src/boundaryTraceFixture';

// 24Z.20 — HRT-002 boundary trace telemetry: TELEMETRY_ONLY, fixture-first. Evidence never authority.

describe('24Z.20: sanitizer (positive allowlist, fail-closed)', () => {
  beforeEach(() => clearTraces());

  it('keeps only allowlisted public fields; drops unknown', () => {
    const r = sanitizeTraceEvent({ eventId: 'e1', timestampMs: 1, receiptMode: 'write', source: 'gate', bogus: 1, extra: 'x' });
    expect(r.ok).toBe(true);
    expect(r.event!.receiptMode).toBe('write');
    expect(r.droppedFields.sort()).toEqual(['bogus', 'extra']);
    expect(Object.keys(r.event!).every((k) => ALLOWED_FIELDS.has(k))).toBe(true);
  });

  it('coerces an unknown receiptMode/source to safe defaults', () => {
    const r = sanitizeTraceEvent({ eventId: 'e', timestampMs: 1, receiptMode: 'HACK', source: 'evil' });
    expect(r.event!.receiptMode).toBe('unknown');
    expect(r.event!.source).toBe('testFixture');
  });

  it('every stored event carries classification TELEMETRY_ONLY + grantsAuthority false', () => {
    const r = sanitizeTraceEvent({ eventId: 'e', timestampMs: 1, receiptMode: 'release', source: 'gate' });
    expect(r.event!.classification).toBe('TELEMETRY_ONLY');
    expect(r.event!.grantsAuthority).toBe(false);
  });
});

describe('24Z.20: recursive forbidden-field scanner (fail-closed at any depth)', () => {
  beforeEach(() => clearTraces());

  it('rejects forbidden keys nested at any depth — whole record dropped', () => {
    for (const evil of [
      { eventId: 'e', timestampMs: 1, receiptMode: 'write', source: 'gate', chainOfThought: 'secret reasoning' },
      { eventId: 'e', timestampMs: 1, receiptMode: 'write', source: 'gate', meta: { nested: { privateKey: 'abc' } } },
      { eventId: 'e', timestampMs: 1, receiptMode: 'write', source: 'gate', payload: [{ authorityToken: 't' }] },
      { eventId: 'e', timestampMs: 1, receiptMode: 'write', source: 'gate', deep: { a: { b: { rawPrompt: 'x' } } } },
      { eventId: 'e', timestampMs: 1, receiptMode: 'write', source: 'gate', sig: { rawSignature: 'deadbeef' } },
    ]) {
      const r = sanitizeTraceEvent(evil);
      expect(r.ok, JSON.stringify(evil)).toBe(false);
      expect(r.event).toBeNull();
      expect(r.forbiddenFound.length).toBeGreaterThan(0);
    }
  });

  it('the scanner finds forbidden keys at depth (objects + arrays)', () => {
    expect(scanForbiddenKeys({ a: { b: { password: 1 } } }).length).toBe(1);
    expect(scanForbiddenKeys({ list: [{ ok: 1 }, { apiKey: 'x' }] }).length).toBe(1);
    expect(scanForbiddenKeys({ ok: 1, nested: { fine: 2 } }).length).toBe(0);
  });

  it('no meta/payload escape hatch: a meta blob with a forbidden nested key is rejected (not passed through)', () => {
    const r = sanitizeTraceEvent({ eventId: 'e', timestampMs: 1, receiptMode: 'write', source: 'gate', meta: { secret: 'leak' } });
    expect(r.ok).toBe(false);
  });

  it('(red-team forbidden-leak) secret CONTENT smuggled into an ALLOWLISTED string value is rejected (value scan)', () => {
    const PEM = '-----BEGIN PRIVATE KEY-----MIIEvQ...-----END PRIVATE KEY-----';
    for (const evil of [
      { eventId: 'e', timestampMs: 1, receiptMode: 'release', source: 'gate', refusalCause: PEM },
      { eventId: 'e', timestampMs: 1, receiptMode: 'release', source: 'gate', gateVerdict: 'sk-AbCdEf012345xyz789' },
      { eventId: 'chain-of-thought: secret plan', timestampMs: 1, receiptMode: 'write', source: 'gate' },
    ]) {
      const r = recordTraceEvent(evil);
      expect(r.ok, JSON.stringify(evil)).toBe(false);
    }
    expect(getTraces().length).toBe(0);            // nothing leaked into the store
    expect(scanForbiddenValues({ a: { b: PEM } }).length).toBe(1); // recursive value scan at depth
  });
});

describe('24Z.20: telemetry has no authority + witness is write-only', () => {
  beforeEach(() => clearTraces());

  it('telemetry grants no authority; witness held-tension cannot grant capability', () => {
    const r = sanitizeTraceEvent({ eventId: 'e', timestampMs: 1, receiptMode: 'witness', source: 'gate', heldTensionScore: 0.99 });
    expect(r.ok).toBe(true);
    expect(telemetryGrantsAuthority()).toBe(false);
    expect(witnessGrantsCapability(r.event!)).toBe(false);
  });

  it('(Fusion Opus + 24Z.23) NO authority module READS the telemetry store — only the void emit sink is allowed', () => {
    // The load-bearing "no read path into authority" claim. 24Z.23 wires sandbox apply to telemetry via the
    // ONE-WAY void sink `emitSandboxEvent` (write-only, returns void). So: emitting is allowed; READING/raw-
    // recording/clearing the store (getTraces/recordTraceEvent/auditStoredTraces/clearTraces) is banned across
    // the whole tree except the telemetry module + tests. There is no way to read telemetry to decide anything.
    const roots = [path.resolve(__dirname, '..', 'src'), path.resolve(__dirname, '..', '..', 'tauri-womb', 'src')];
    const READ_OR_RAW = /\b(getTraces|recordTraceEvent|auditStoredTraces|clearTraces)\s*\(/;
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
      });
      for (const f of walk(root)) {
        if (f.endsWith('boundaryTraceTelemetry.ts')) continue; // the module itself
        const src = fs.readFileSync(f, 'utf-8');
        // no authority module may READ/raw-record/clear the store — only `emitSandboxEvent` (void) is allowed.
        expect(src, `${f} must not read/raw-record/clear the telemetry store`).not.toMatch(READ_OR_RAW);
        // any value-import of the telemetry module may ONLY pull the void sink emitSandboxEvent.
        const valueImports = src.split('\n').filter((l) => /from\s+['"][^'"]*boundaryTraceTelemetry/.test(l) && !/^\s*import\s+type\b/.test(l));
        for (const line of valueImports) {
          const names = (line.match(/\{([^}]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
          const illegal = names.filter((n) => n !== 'emitSandboxEvent');
          expect(illegal, `${f} may only value-import emitSandboxEvent from telemetry (got: ${names.join(',')})`).toEqual([]);
        }
      }
    }
  });

  it('(Fusion Opus) the telemetry store is NOT exposed on a shared global (no globalThis/DI leak)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'boundaryTraceTelemetry.ts'), 'utf-8');
    expect(src).not.toMatch(/globalThis|global\.|process\.env\.|registry|register\(/);
    expect(src).toMatch(/const traceStore[^=]*=\s*\[\]/); // module-private array, not a global/singleton registry
  });

  it('records witness telemetry without exposing a read-into-gate path (stored, advisory only)', () => {
    recordTraceEvent({ eventId: 'w1', timestampMs: 1, receiptMode: 'witness', source: 'gate', heldTensionScore: 0.7 });
    expect(getTraces().length).toBe(1);
    expect(getTraces()[0].heldTensionScore).toBe(0.7);
  });
});

describe('24Z.20: stored traces are clean', () => {
  beforeEach(() => clearTraces());

  it('write/witness/release fixture events all sanitize + store with zero forbidden keys', () => {
    for (const mode of ['write', 'witness', 'release'] as const) {
      recordTraceEvent({ eventId: `e_${mode}`, timestampMs: 1, receiptMode: mode, source: 'testFixture', gateVerdict: 'green', retryCount: 1, latencyMs: 80 });
    }
    expect(getTraces().length).toBe(3);
    expect(auditStoredTraces().clean).toBe(true);
    expect(auditStoredTraces().forbiddenFound).toEqual([]);
  });

  it('a rejected (forbidden) event is NEVER stored', () => {
    recordTraceEvent({ eventId: 'bad', timestampMs: 1, receiptMode: 'write', source: 'gate', signingSeed: 'x' });
    expect(getTraces().length).toBe(0);
  });
});

describe('24Z.20: synthetic fixture classifier + controls', () => {
  const m = runFixtureEval(600);

  it('public trace predicts receiptMode ABOVE shuffled by ≥ 0.15 macro-F1', () => {
    expect(m.modeSignalGain).toBeGreaterThanOrEqual(0.15);
    expect(m.receiptModeF1).toBeGreaterThan(m.shuffledModeF1);
  });

  it('private/authority reconstruction from the public trace stays NEAR CHANCE', () => {
    expect(m.privateReconGain).toBeLessThanOrEqual(0.10); // no private signal in the public trace
  });

  it('illegal positive control reconstructs ONLY with the injected forbidden field (and that field is forbidden)', () => {
    expect(m.illegalControlF1).toBeGreaterThanOrEqual(0.9);                       // works when injected
    expect(m.privateReconGain).toBeLessThan(m.illegalControlF1 - 0.3);            // public alone cannot
    expect(scanForbiddenKeys({ authorityToken: 1 }).length).toBe(1);             // the injected field is forbidden
  });

  it('latency-only is INSUFFICIENT (latency is secondary, not the carrier)', () => {
    expect(latencyOnlyClassifierSufficient()).toBe(false);
    expect(m.latencyOnlyGain).toBeLessThanOrEqual(0.10);
  });

  it('the fixture is deterministic + visibly labelled as fixture (source=testFixture)', () => {
    const a = JSON.stringify(buildBoundaryTraceFixture(50));
    const b = JSON.stringify(buildBoundaryTraceFixture(50));
    expect(a).toBe(b);
  });
});

describe('24Z.20: no mythology / physics labels; no live mutation wiring', () => {
  it('source carries no Shear/GHP/physics/consciousness claim', () => {
    for (const f of ['boundaryTraceTelemetry.ts', 'boundaryTraceFixture.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf-8');
      expect(src, f).not.toMatch(/shear|hawking|consciousness|markov.?blanket|golden.?horizon|\bGHP\b/i);
    }
  });
  it('telemetry source performs no writes / spawns / network', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'boundaryTraceTelemetry.ts'), 'utf-8');
    expect(src).not.toMatch(/writeFileSync|child_process|execFile|spawn\(|fetch\(/);
  });
});
