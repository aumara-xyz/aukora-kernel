import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { issueSandboxApplyPermit, verifySandboxApplyPermit, type SandboxApplyPermit } from '../src/sandboxApplyPermit';
import { applySandboxPatch, validateSandboxApplyReceipt } from '../src/sandboxApply';
import { emitSandboxEvent, getTraces, clearTraces, auditStoredTraces } from '../src/boundaryTraceTelemetry';

// 24Z.18 — AUMLOK-signed sandbox apply V0. Permit = simulated_local. Apply = TEMP ONLY. Live repo untouched.

const DRAFT_HASH = crypto.createHash('sha256').update('a draft').digest('hex');
const NOW = '2026-06-22T12:00:00.000Z';

function freshPermit(over: Partial<Parameters<typeof issueSandboxApplyPermit>[0]> = {}) {
  const r = issueSandboxApplyPermit({ draftHash: DRAFT_HASH, actionClass: 'write_gated', nonce: 'n1', issuedAt: NOW, ...over });
  if (!r.ok) throw new Error('expected permit: ' + r.reason);
  return r.permit;
}

describe('24Z.18: sandbox apply permit (sandbox_only, write_gated, fails closed)', () => {
  it('issues a sandbox-only permit for a write_gated draft', () => {
    const p = freshPermit();
    expect(p.scope).toBe('sandbox_only');
    expect(p.actionClass).toBe('write_gated');
    expect(p.canApplyLive).toBe(false);
    expect(p.canApplySandbox).toBe(true);
    expect(p.mode).toBe('simulated_local');
    expect(p.grantsAuthority).toBe(false);
  });

  it('REFUSES a permit for sacred/Ring-0, executable, read_only, unknown', () => {
    for (const c of ['sacred', 'executable', 'read_only', 'unknown'] as const) {
      const r = issueSandboxApplyPermit({ draftHash: DRAFT_HASH, actionClass: c, nonce: 'n', issuedAt: NOW });
      expect(r.ok, c).toBe(false);
    }
  });

  it('verify passes for a fresh permit; fails for wrong draft hash', () => {
    const p = freshPermit();
    expect(verifySandboxApplyPermit(p, { draftHash: DRAFT_HASH, now: NOW }).valid).toBe(true);
    expect(verifySandboxApplyPermit(p, { draftHash: 'different', now: NOW }).valid).toBe(false);
  });

  it('rejects an EXPIRED permit', () => {
    const p = freshPermit({ ttlMs: 1000 });
    const later = new Date(new Date(NOW).getTime() + 5000).toISOString();
    expect(verifySandboxApplyPermit(p, { draftHash: DRAFT_HASH, now: later }).valid).toBe(false);
  });

  it('rejects a TAMPERED permit (scope escalation / canApplyLive flip / hash mismatch)', () => {
    const p = freshPermit();
    expect(verifySandboxApplyPermit({ ...p, scope: 'live' as unknown as 'sandbox_only' }, { draftHash: DRAFT_HASH, now: NOW }).valid).toBe(false);
    expect(verifySandboxApplyPermit({ ...p, canApplyLive: true as unknown as false }, { draftHash: DRAFT_HASH, now: NOW }).valid).toBe(false);
    expect(verifySandboxApplyPermit({ ...p, draftHash: 'x', permitHash: p.permitHash }, { draftHash: 'x', now: NOW }).valid).toBe(false); // hash recompute fails
  });
});

describe('24Z.18: sandbox apply mutates a TEMP copy only — live repo untouched', () => {
  it('applies a tiny patch to a temp workspace; receipt proves appliedLive:false', () => {
    const p = freshPermit();
    const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'src/hello.ts', content: 'export const hi = 1;\n' }], now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.appliedSandbox).toBe(true);
    expect(res.receipt.appliedLive).toBe(false);
    expect(res.receipt.liveRepoUnchanged).toBe(true);
    expect(res.receipt.filesChanged[0].relPath).toBe('src/hello.ts');
    expect(res.receipt.filesChanged[0].beforeHash).not.toBe(res.receipt.filesChanged[0].afterHash);
    expect(validateSandboxApplyReceipt(res.receipt).valid).toBe(true);
  });

  it('actually writes to the temp dir (keepSandbox) and NOT to the live repo', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-base-'));
    try {
      const p = freshPermit();
      const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'note.txt', content: 'sandbox content' }], now: NOW, tmpBase, keepSandbox: true });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // the temp file exists with the content
      const written = fs.readFileSync(path.join(res.receipt.sandboxPath, 'note.txt'), 'utf-8');
      expect(written).toBe('sandbox content');
      // the sandbox path is under the temp base, NOT under the live repo
      expect(res.receipt.sandboxPath.startsWith(tmpBase)).toBe(true);
      expect(res.receipt.sandboxPath.includes('/aukora-os/internal')).toBe(false);
      fs.rmSync(res.receipt.sandboxPath, { recursive: true, force: true });
    } finally { fs.rmSync(tmpBase, { recursive: true, force: true }); }
  });

  it('the LIVE repo is provably unchanged: this file (sandboxApply.ts) keeps its hash across an apply', () => {
    const live = path.resolve(__dirname, '..', 'src', 'sandboxApply.ts');
    const before = crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
    const p = freshPermit();
    applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'src/sandboxApply.ts', content: 'HIJACK' }], now: NOW });
    const after = crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
    expect(after).toBe(before); // a same-named relPath wrote into TEMP, never the live file
  });

  it('REFUSES path traversal, absolute paths, and sacred/Ring-0 file paths', () => {
    const p = freshPermit();
    for (const bad of ['../escape.ts', '/etc/passwd', 'a/../../b.ts', 'src/aukora_config.ts', 'convex/aumlokMemory.ts', 'src/auth/login.ts']) {
      const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: bad, content: 'x' }], now: NOW });
      expect(res.ok, bad).toBe(false);
      if (!res.ok) { expect(res.appliedLive).toBe(false); expect(res.liveRepoUnchanged).toBe(true); }
    }
  });

  it('(Fusion fold-in) realpath containment: a symlinked tmpBase stays contained; an outside victim is never written', () => {
    // tmpBase is itself a symlink (mirrors /tmp -> /private/tmp). Writes must resolve INSIDE the sandbox
    // realpath and never reach a sibling "outside" victim file.
    const realOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-realout-'));
    const victim = path.join(realOutside, 'victim.txt');
    fs.writeFileSync(victim, 'original', 'utf-8');
    const linkedBase = path.join(os.tmpdir(), `aukora-linkbase-${process.pid}-${Math.abs(crypto.createHash('sha1').update(NOW).digest()[0])}`);
    fs.symlinkSync(realOutside, linkedBase, 'dir');
    try {
      const p = freshPermit();
      const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'ok/file.ts', content: 'x' }], now: NOW, tmpBase: linkedBase, keepSandbox: true });
      expect(res.ok).toBe(true);
      if (res.ok) {
        const written = fs.realpathSync(path.join(res.receipt.sandboxPath, 'ok/file.ts'));
        expect(written.startsWith(fs.realpathSync(res.receipt.sandboxPath))).toBe(true); // contained
        expect(fs.readFileSync(victim, 'utf-8')).toBe('original');                       // victim untouched
        fs.rmSync(res.receipt.sandboxPath, { recursive: true, force: true });
      }
    } finally {
      fs.unlinkSync(linkedBase);
      fs.rmSync(realOutside, { recursive: true, force: true });
    }
  });

  it('REFUSES apply with an invalid/expired/wrong-hash permit (fails closed, writes nothing)', () => {
    const p = freshPermit({ ttlMs: 1 });
    const later = new Date(new Date(NOW).getTime() + 60_000).toISOString();
    const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'x.ts', content: 'y' }], now: later });
    expect(res.ok).toBe(false);
  });

  it('receipt validator rejects a lie (appliedLive:true / liveRepoUnchanged:false)', () => {
    const p = freshPermit();
    const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'a.ts', content: 'b' }], now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateSandboxApplyReceipt({ ...res.receipt, appliedLive: true as unknown as false }).valid).toBe(false);
    expect(validateSandboxApplyReceipt({ ...res.receipt, liveRepoUnchanged: false as unknown as true }).valid).toBe(false);
  });

  it('(red-team escape 1) a REPO-ROOTED tmpBase is refused — nothing is written into the live repo', () => {
    const p = freshPermit();
    const repoBase = path.resolve(__dirname, '..'); // internal/edge-node — inside the live repo
    const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'PWNED.txt', content: 'x' }], now: NOW, tmpBase: repoBase });
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.appliedLive).toBe(false); expect(res.liveRepoUnchanged).toBe(true); }
    // no stray sandbox dir left inside the repo
    expect(fs.readdirSync(repoBase).some((f) => f.startsWith('aukora-apply-'))).toBe(false);
  });

  it('(red-team escape 2a) receipt validator rejects a sacred relPath and a non-temp sandboxPath', () => {
    const p = freshPermit();
    const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'a.ts', content: 'b' }], now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // a forged receipt claiming a sacred file change → rejected
    expect(validateSandboxApplyReceipt({ ...res.receipt, filesChanged: [{ relPath: 'convex/aukora_kill_switch.ts', beforeHash: 'a', afterHash: 'b' }] }).valid).toBe(false);
    // a forged receipt claiming the live repo as the sandbox path → rejected
    expect(validateSandboxApplyReceipt({ ...res.receipt, sandboxPath: '/work/aukora-os' }).valid).toBe(false);
  });

  it('source never references the live repo path and never spawns/execs', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'sandboxApply.ts'), 'utf-8');
    expect(src).not.toMatch(/child_process|execFile|execSync|spawn\(|\/Users\/[^/]+\/aukora/);
  });

  // ── 24Z.23: HRT live wiring to sandbox-apply events (telemetry-only, one-way void sink) ──
  it('a successful apply EMITS sanitized sandbox telemetry (attempt + applied); store stays clean', () => {
    clearTraces();
    const p = freshPermit();
    const res = applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'drafts/x.md', content: 'hi' }], now: NOW, onEvent: emitSandboxEvent });
    expect(res.ok).toBe(true);
    const traces = getTraces();
    expect(traces.length).toBeGreaterThanOrEqual(2);                 // attempt + applied
    expect(traces.every((t) => t.source === 'sandboxApply')).toBe(true);
    expect(traces.some((t) => t.gateVerdict === 'applied')).toBe(true);
    expect(auditStoredTraces().clean).toBe(true);                    // zero forbidden keys/values
    clearTraces();
  });
  it('a refused apply EMITS a SAFE category refusal trace (no raw path/secret leaks)', () => {
    clearTraces();
    const p = freshPermit();
    // a sacred relPath → refused; telemetry records only the category 'sacred_refused', never the path
    applySandboxPatch({ permit: p, draftHash: DRAFT_HASH, files: [{ relPath: 'convex/aukora_kill_switch.ts', content: 'x' }], now: NOW, onEvent: emitSandboxEvent });
    const refused = getTraces().find((t) => t.gateVerdict === 'refused');
    expect(refused?.refusalCause).toBe('sacred_refused');
    expect(JSON.stringify(getTraces())).not.toContain('kill_switch'); // the raw path never reaches telemetry
    expect(auditStoredTraces().clean).toBe(true);
    clearTraces();
  });
  it('telemetry CANNOT change the apply outcome (same result with and without the sink)', () => {
    clearTraces();
    const a = applySandboxPatch({ permit: freshPermit(), draftHash: DRAFT_HASH, files: [{ relPath: 'a.ts', content: 'b' }], now: NOW });
    const b = applySandboxPatch({ permit: freshPermit(), draftHash: DRAFT_HASH, files: [{ relPath: 'a.ts', content: 'b' }], now: NOW, onEvent: emitSandboxEvent });
    expect(a.ok).toBe(b.ok); // the void sink is observational only — it cannot alter the result
    clearTraces();
  });
  it('the emit sink returns void (no store handle / result escapes to the caller)', () => {
    expect(emitSandboxEvent({ phase: 'attempt' })).toBeUndefined();
    clearTraces();
  });
});
