// COHESION INVARIANT RAIL — turns the manual audit rules into standing tests, so drift FAILS the gate
// automatically instead of relying on a reviewer to notice. Covers Tasks 1–8 of the cohesion round.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { _resetChain, evaluateIntent, getChain, PrincipalRegistry } from '../src/index';
import { getTestPublicKey, signPoP, hash, canonicalIntentSerialize, verifyChain, type Receipt } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { ADVISORY_ORGANS, VK_GATE_ADAPTER } from '../src/advisoryOrganRegistry';
import { SURFACE_VERSIONS } from '../src/surfaceVersionRegistry';

const SRC = join(__dirname, '..', 'src');
const REPO = join(__dirname, '..', '..');
const readSrc = (f: string) => readFileSync(join(SRC, f), 'utf-8');
const srcFiles = () => readdirSync(SRC).filter((f) => f.endsWith('.ts'));

const POP_SEED = '11'.repeat(32);
function goldenChain() {
  _resetChain();
  PrincipalRegistry.set('coh-admin', getTestPublicKey(POP_SEED));
  const raw = { action: 'read_file', resource: 'c.txt', ring: 'local' };
  const intent = normalizeProposal(raw);
  const pop = signPoP(POP_SEED, { principalId: 'coh-admin', methodId: 'evaluateIntent', argsHash: hash(canonicalIntentSerialize(intent)), nonce: 'coh-1' });
  evaluateIntent(raw as any, pop);
}

// ── Task 1 — deep-frozen, cloned receipt snapshot ──
describe('cohesion #1 — getChain() returns a DEEPLY-frozen, cloned snapshot', () => {
  it('mutating verdict / normalizedIntent / provenance throws and cannot reach the live ledger', () => {
    goldenChain();
    const snap = getChain();
    expect(snap[0].verdict).toBe('golden_success');
    expect(() => { (snap[0] as any).verdict = 'refused'; }).toThrow();
    expect(() => { (snap[0].normalizedIntent as any).resource = 'EVIL'; }).toThrow();
    expect(() => { (snap[0].provenance as any).nonceHash = 'EVIL'; }).toThrow();
    expect(getChain()[0].verdict).toBe('golden_success');         // live ledger untouched
    expect(getChain()[0].normalizedIntent.resource).toBe('c.txt');
  });
  it('each call returns an independent clone (not the same nested objects)', () => {
    goldenChain();
    expect(getChain()[0]).not.toBe(getChain()[0]);
    expect(getChain()[0].normalizedIntent).not.toBe(getChain()[0].normalizedIntent);
  });
  it('verifyChain still verifies the frozen snapshot', () => {
    goldenChain();
    expect(verifyChain(getChain() as Receipt[])).toBe(true);
  });
});

// ── Task 2 — test-reset boundary ──
describe('cohesion #2 — test-reset boundary (honest: NODE_ENV + no runtime caller)', () => {
  it('no RUNTIME (non-test) src module calls _resetChain — usage is test-only', () => {
    expect(srcFiles().filter((f) => f !== 'index.ts' && /_resetChain\s*\(/.test(readSrc(f)))).toEqual([]);
  });
  it('_resetChain is gated by NODE_ENV (the strongest available boundary in this flat-module bun/TS setup)', () => {
    expect(readSrc('index.ts')).toContain("process.env.NODE_ENV !== 'test'");
  });
});

// ── Task 3 — one crypto chokepoint ──
describe('cohesion #3 — one crypto chokepoint (no scattered post-quantum signing)', () => {
  const PQC_ALLOWLIST = ['convexCanonicalPin.ts', 'crypto.ts', 'mldsaSandboxSigner.ts'];
  it('only the allowlisted modules import @noble/post-quantum (new donor ML-DSA must go through crypto.ts)', () => {
    const importers = srcFiles().filter((f) => readSrc(f).includes('@noble/post-quantum')).sort();
    expect(importers).toEqual([...PQC_ALLOWLIST].sort());
  });
});

// ── Tasks 4 & 5 — strip neutrality + VK boundary ──
describe('cohesion #4/#5 — strip neutrality: evidence informs, never authorizes', () => {
  it('the GATE (index.ts) imports NO registered advisory/evidence organ', () => {
    const gate = readSrc('index.ts');
    expect(ADVISORY_ORGANS.filter((o) => new RegExp(`from ['"]\\./${o}['"]`).test(gate))).toEqual([]);
  });
  it('VK is touched ONLY via the single narrow adapter, DOWNSTREAM of the verdict', () => {
    const gate = readSrc('index.ts');
    expect((gate.match(/from ['"]\.\/vk['"]/g) || []).length).toBe(1);   // exactly one VK import
    expect(gate).toContain(VK_GATE_ADAPTER);
    expect(gate.indexOf('generateReceipt(')).toBeLessThan(gate.indexOf(VK_GATE_ADAPTER + '(')); // verdict before VK write
  });
  it('STRIP NEUTRALITY: the gate verdict is a pure function of (intent, pop) — unchanged across runs', () => {
    goldenChain(); const v1 = getChain()[0].verdict;
    goldenChain(); const v2 = getChain()[0].verdict;
    expect(v1).toBe(v2);
  });
});

// ── Task 6 — surface/version registry guard ──
describe('cohesion #6 — surface/version registry (code<->spec cannot silently diverge)', () => {
  it('every registered surface version actually exists in core/src', () => {
    const all = srcFiles().map(readSrc).join('\n');
    expect(SURFACE_VERSIONS.filter((v) => !all.includes(v))).toEqual([]);
  });
  it('the registry is frozen', () => {
    expect(Object.isFrozen(SURFACE_VERSIONS)).toBe(true);
  });
});

// ── Task 7 — honesty-string lint ──
describe('cohesion #7 — honesty lint (overclaim drift fails the gate)', () => {
  const honestyBlob = () => {
    const d = join(REPO, 'docs');
    const parts: string[] = readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(d, f), 'utf-8'));
    parts.push(readFileSync(join(REPO, 'scripts', 'status.sh'), 'utf-8'));
    return parts.join('\n').toLowerCase();
  };
  it('no doc/status claims live promotion / production authority root / live hive-channel-witness / solved entropy', () => {
    const blob = honestyBlob();
    const FORBIDDEN = [
      /promotion is (now |currently )?(live|unlocked|wired)/,
      /live (self-)?promotion (is )?(built|enabled|on)\b/,
      /(hive|channel|witness) is (now |currently )?live/,
      /production authority root (is )?(live|active|built)/,
      /aumlok (entropy )?is (solved|cryptographic|production)/,
      /post-quantum authority (promotion |root )?is live/,
    ];
    expect(FORBIDDEN.filter((re) => re.test(blob)).map(String)).toEqual([]);
  });
  it('the honesty anchors are present (LOCKED + dev-shim)', () => {
    const blob = honestyBlob();
    expect(blob).toContain('locked');
    expect(blob).toMatch(/dev-shim|dev_real/);
  });
});

// ── Task 8 — deferred-test debt freshness ──
describe('cohesion #8 — deferred-test debt stays mechanically fresh (not dead stubs)', () => {
  it('every deferred test is non-trivial (has real test structure) — parked debt, not dead mythology', () => {
    const dir = join(REPO, 'deferred-tests');
    const files: string[] = [];
    const walk = (p: string) => { for (const e of readdirSync(p, { withFileTypes: true })) { const c = join(p, e.name); if (e.isDirectory()) walk(c); else if (e.name.endsWith('.test.ts')) files.push(c); } };
    if (existsSync(dir)) walk(dir);
    expect(files.length).toBeGreaterThan(0);
    const stubs = files.filter((f) => { const s = readFileSync(f, 'utf-8'); return s.length < 100 || !/\b(describe|it)\s*\(/.test(s); });
    expect(stubs).toEqual([]);
  });
});
