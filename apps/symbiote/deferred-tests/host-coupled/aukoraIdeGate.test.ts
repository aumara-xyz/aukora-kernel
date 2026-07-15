import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// the first native Aukora gate (lives in the clean aukora-ide package; tested here under the installed runner)
import { aukoraGate } from '../../authority/gate/aukoraGate';
import { governedAsk, governedWrite, AukoraGateDenied } from '../../authority/gate/governedToolBoundary';
import { classifyRisk } from '../../authority/gate/risk';

/**
 * 24Z.64 — the first native governed tool path. A model/provider PROPOSES a tool call; the Aukora gate AUTHORIZES.
 * Low-risk write passes; sensitive/high-risk is blocked; the MCP wildcard cannot bypass; a locked AUMLOK session holds
 * write-capable tools; every decision emits a receipt with NO secret value.
 */
const UNLOCKED = { unlocked: true };
const LOCKED = { unlocked: false };
let work: string;
beforeAll(() => { work = mkdtempSync(join(tmpdir(), 'aukora-ide-gate-')); });
afterAll(() => { try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('native gate — low-risk write passes', () => {
  it('writes a normal file in an unlocked session + allow receipt', () => {
    const r = governedWrite('src/Hello.tsx', 'export const Hello = () => null;\n', UNLOCKED, { workdir: work });
    expect(r.written).toBe(true);
    expect(r.decision.effect).toBe('allow');
    expect(existsSync(join(work, 'src/Hello.tsx'))).toBe(true);
    expect(r.decision.receipt.kind).toBe('aukora_gate_decision_v0');
  });
});

describe('native gate — sensitive / high-risk is BLOCKED before any write', () => {
  it('blocks a write to a .env path (no file created)', () => {
    const r = governedWrite('.env', 'API_KEY=whatever\n', UNLOCKED, { workdir: work });
    expect(r.written).toBe(false);
    expect(r.decision.effect).toBe('deny');
    expect(r.decision.riskReasons.some((x) => /env file/i.test(x))).toBe(true);
    expect(existsSync(join(work, '.env'))).toBe(false);
  });
  it('blocks secret content even in a normally-named file', () => {
    const r = governedWrite('src/config.ts', 'const k = "sk-ABCDEF0123456789XYZ";\n', UNLOCKED, { workdir: work });
    expect(r.written).toBe(false);
    expect(r.decision.effect).toBe('deny');
    expect(r.decision.riskReasons.some((x) => /api key|sk-/i.test(x))).toBe(true);
    expect(existsSync(join(work, 'src/config.ts'))).toBe(false);
  });
  it('blocks a write to kernel/authority code (node-template/convex)', () => {
    const d = aukoraGate({ tool: 'edit', permission: 'edit', metadata: { filepath: 'node-template/convex/aukoraReceipts.ts', diff: '+// x' } }, UNLOCKED);
    expect(d.effect).toBe('deny');
  });
});

describe('native gate — AUMLOK holds write-capable tools when locked', () => {
  it('a locked session pauses a write (held, nothing written)', () => {
    const r = governedWrite('src/Locked.tsx', 'export const x = 1;\n', LOCKED, { workdir: work });
    expect(r.written).toBe(false);
    expect(r.decision.effect).toBe('pause');
    expect(existsSync(join(work, 'src/Locked.tsx'))).toBe(false);
  });
  it('talk-like (non-write) tools are allowed even when locked', () => {
    const d = aukoraGate({ tool: 'read', permission: 'read', metadata: { filepath: 'README.md' } }, LOCKED);
    expect(d.effect).toBe('allow');
  });
});

describe('native gate — the MCP wildcard cannot bypass', () => {
  it('always:["*"] does NOT skip the risk decision (high-risk still denied)', () => {
    const input = { tool: 'mcp:fs', permission: 'edit', patterns: ['*'], always: ['*'], metadata: { filepath: '.env', diff: '+SECRET=x' } };
    expect(aukoraGate(input, UNLOCKED).effect).toBe('deny');
    expect(() => governedAsk(input, UNLOCKED)).toThrow(AukoraGateDenied);
  });
  it('governedAsk throws on deny/pause so the side effect never runs', () => {
    expect(() => governedAsk({ tool: 'write', permission: 'edit', always: ['*'], metadata: { filepath: 'secrets/x', diff: '+y' } }, UNLOCKED)).toThrow(AukoraGateDenied);
    expect(() => governedAsk({ tool: 'write', permission: 'edit', metadata: { filepath: 'a.ts', diff: '+ok' } }, LOCKED)).toThrow(/AUMLOK locked/);
  });
});

describe('native gate — receipts never carry a secret value', () => {
  it('a blocked secret write leaves NO secret value in the receipt (hash + labels only)', () => {
    const receipts: unknown[] = [];
    governedWrite('src/leak.ts', 'const token = "sk-SUPERSECRET0000000000";\n', UNLOCKED, { workdir: work, onReceipt: (r) => receipts.push(r) });
    const json = JSON.stringify(receipts);
    expect(json).not.toMatch(/sk-SUPERSECRET/);     // the value never enters the receipt
    expect(json).not.toMatch(/SUPERSECRET0000/);
    expect(json).toMatch(/[0-9a-f]{64}/);            // only a sha256 argsHash reference
  });
});

describe('native gate — no private codename on the surface', () => {
  it('gate source carries no mythology/private codename in user-facing strings', () => {
    const read = (p: string) => readFileSync(join(__dirname, '../../../aukora-ide/gate', p), 'utf-8');
    const src = read('aukoraGate.ts') + read('governedToolBoundary.ts') + read('types.ts') + read('risk.ts');
    for (const bad of ['Vyomakira', 'Vyoma ', 'Kronos', 'Gaussian', 'black hole', 'singularity']) expect(src).not.toContain(bad);
  });
});

// 24Z.65 — SHARED risk fixture: the SAME vectors are asserted here (edge side) and in the live-OpenCode bun test, so the
// copy of risk.ts applied into OpenCode cannot drift from this canonical classifier.
describe('native gate — risk classifier matches the shared fixture (anti-drift)', () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../../authority/gate/risk-vectors.json'), 'utf-8')) as {
    vectors: Array<{ name: string; input: any; expectRisk: 'low' | 'high'; expectReason?: string }>;
  };
  for (const v of fixture.vectors) {
    it(`vector: ${v.name} → ${v.expectRisk}`, () => {
      const r = classifyRisk(v.input);
      expect(r.risk).toBe(v.expectRisk);
      if (v.expectReason) expect(r.reasons.some((x) => x.toLowerCase().includes(v.expectReason!.toLowerCase()))).toBe(true);
    });
  }
});

// 24Z.69 Step 2b — seal the event horizon: shell write-targets + MCP deny-by-default at the gate-decision level.
describe('native gate — Step 2b: shell + MCP horizon', () => {
  const unlocked = { unlocked: true };
  it('shell write to a gate file (rm) → DENY, even unlocked', () => {
    const d = aukoraGate({ tool: 'shell', permission: 'shell', metadata: { command: 'rm -f aukora-ide/gate/risk.ts' } }, unlocked);
    expect(d.effect).toBe('deny');
    expect(d.riskReasons.join(' ')).toMatch(/self-protected|shell write/i);
  });
  it('shell sed -i a gate file → DENY', () => {
    expect(aukoraGate({ tool: 'shell', permission: 'shell', metadata: { command: "sed -i s/deny/allow/ aukora-ide/gate/risk.ts" } }, unlocked).effect).toBe('deny');
  });
  it('shell case-dodge AUKORA-IDE → DENY', () => {
    expect(aukoraGate({ tool: 'shell', permission: 'shell', metadata: { command: 'rm AUKORA-IDE/gate/risk.ts' } }, unlocked).effect).toBe('deny');
  });
  it('shell fail-closed on unresolvable variable target → DENY', () => {
    expect(aukoraGate({ tool: 'shell', permission: 'shell', metadata: { command: 'rm -rf $TARGET' } }, unlocked).effect).toBe('deny');
  });
  it('read-only shell (ls / npm test) → ALLOW', () => {
    expect(aukoraGate({ tool: 'shell', permission: 'shell', metadata: { command: 'ls -la && npm test' } }, unlocked).effect).toBe('allow');
  });
  it('opaque MCP wildcard call (always:["*"], no metadata) → DENY by default', () => {
    expect(aukoraGate({ tool: 'mcp:fs', permission: 'fs_write', patterns: ['*'], always: ['*'], metadata: {} }, unlocked).effect).toBe('deny');
  });
  it('edit (always:["*"] WITH filepath) is NOT treated as opaque → classified normally (allow for a safe path)', () => {
    expect(aukoraGate({ tool: 'edit', permission: 'edit', always: ['*'], metadata: { filepath: 'src/Hello.tsx', diff: '+ok' } }, unlocked).effect).toBe('allow');
  });
  // 24Z.69 Step 2b-final — apply_patch move-target: a rename ONTO a gate file overwrites it (metadata.files[].movePath)
  it('apply_patch move whose movePath is a gate file → DENY', () => {
    const d = aukoraGate({ tool: 'apply_patch', permission: 'edit', always: ['*'], metadata: {
      filepath: 'src/a.ts, aukora-ide/gate/risk.ts', diff: '+x',
      files: [{ filePath: '/w/src/a.ts', type: 'update' }, { filePath: '/w/src/evil.ts', movePath: '/w/aukora-ide/gate/risk.ts', type: 'move' }],
    } }, unlocked);
    expect(d.effect).toBe('deny');
    expect(d.riskReasons.join(' ')).toMatch(/self-protected/i);
  });
  it('apply_patch update of only safe files → ALLOW', () => {
    expect(aukoraGate({ tool: 'apply_patch', permission: 'edit', always: ['*'], metadata: {
      cwd: '/w', filepath: 'src/a.ts, src/b.ts', diff: '+x', files: [{ filePath: '/w/src/a.ts', type: 'update' }, { filePath: '/w/src/b.ts', type: 'update' }], // 88f #4 — files inside the /w workspace (deny-by-default allows in-workspace writes)
    } }, unlocked).effect).toBe('allow');
  });
  it('88f-confirm #4 — DENY-BY-DEFAULT: the in-process write tool refuses a write OUTSIDE the workspace (symmetric with the kernel cage)', () => {
    const g = (filepath: string, cwd: string) => aukoraGate({ tool: 'write', permission: 'write', always: ['*'], metadata: { filepath, content: 'x', cwd } }, unlocked).effect;
    expect(g('/w/src/app.ts', '/w')).toBe('allow');        // in-workspace → allow
    expect(g('/Users/x/bin/poison', '/w')).toBe('deny');   // ~/bin-style on-PATH plant in NO named SENSITIVE pattern → deny-by-default
    expect(g('/Users/x/other-repo/Makefile', '/w')).toBe('deny'); // arbitrary outside-workspace write → deny
    expect(g('/tmp/scratch.txt', '/w')).toBe('allow');     // scratch root still writable
  });
  it('88f-confirm r2 #1/#2 — SYMLINK HONOR: the gate matches the realpath-RESOLVED vnode (like the kernel cage), not the lexical name', () => {
    const { symlinkSync, writeFileSync, mkdirSync } = require('fs');
    const ws = mkdtempSync(join(tmpdir(), 'auk-symlink-'));
    mkdirSync(join(ws, '.github/workflows'), { recursive: true });
    writeFileSync(join(ws, '.env'), 'SECRET=1'); writeFileSync(join(ws, '.github/workflows/ci.yml'), 'real');
    symlinkSync(join(ws, '.env'), join(ws, 'notes.txt'));            // innocent name → secret
    symlinkSync(join(ws, '.github/workflows/ci.yml'), join(ws, 'innocent.ts')); // innocent name → authority
    try {
      const rd = (p: string) => aukoraGate({ tool: 'read', permission: 'read', always: ['*'], patterns: [p], metadata: {} }, unlocked).effect;
      const wr = (p: string) => aukoraGate({ tool: 'write', permission: 'write', always: ['*'], metadata: { filepath: p, content: 'PWN', cwd: ws } }, unlocked).effect;
      expect(rd(join(ws, 'notes.txt'))).toBe('deny');     // symlink → .env (resolved-vnode read-deny)
      expect(wr(join(ws, 'innocent.ts'))).toBe('deny');   // symlink → workflow (resolved-vnode write-protect)
      expect(wr(join(ws, 'app.ts'))).toBe('allow');       // a real in-workspace file still writable (no over-block)
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });
});
