import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applySandboxPatch, applySignedSandboxPatch, type SandboxPatchFile, type SandboxApplyResult, type SandboxApplyEvent } from '../src/sandboxApply';
import { issueSandboxApplyPermit } from '../src/sandboxApplyPermit';
import { signSandboxPermit, generateLabSandboxKey } from '../src/mldsaSandboxSigner';
import * as crypto from 'crypto';

// 24Z.32 — closes the standing emit() YELLOW: a throwing telemetry sink can NEVER break apply. The outcome must
// be IDENTICAL with no sink, a normal sink, and a throwing sink. The outcome never reads the sink's return value.

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const files: SandboxPatchFile[] = [{ relPath: 'drafts/emit-h.md', content: '# hi\n' }];
const draftHash = sha('emit-hardening-draft');
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-h-'));
const NOW = '2026-06-23T12:00:00.000Z';

function stripVolatile(r: SandboxApplyResult): unknown {
  // every apply writes a distinct sandbox path/timestamp — compare the OUTCOME, not the cosmetic path.
  const anyR = r as Record<string, unknown>;
  const base = { ok: r.ok, appliedSandbox: anyR.appliedSandbox, appliedLive: anyR.appliedLive, liveRepoUnchanged: anyR.liveRepoUnchanged };
  if (!r.ok) return { ...base, refused: anyR.refused, reason: anyR.reason };
  const receipt = (r as unknown as { receipt: Record<string, unknown> }).receipt;
  const { sandboxPath, generatedAt, ...rest } = receipt;
  void sandboxPath; void generatedAt;
  return { ...base, receipt: { ...rest, filesChanged: receipt.filesChanged } };
}

describe('24Z.32 emit() hardening: applySandboxPatch (simulated_local) is identical under any sink behavior', () => {
  const permit = issueSandboxApplyPermit({ draftHash, actionClass: 'write_gated', nonce: sha(draftHash).slice(0, 12), issuedAt: NOW });
  expect(permit.ok).toBe(true);
  const base = { permit: permit.ok ? permit.permit : (() => { throw new Error('permit'); })(), draftHash, files, now: NOW, tmpBase };
  it('outcome IDENTICAL across no-sink, normal-sink, throwing-sink', () => {
    const noSink = applySandboxPatch({ ...base });
    const events: SandboxApplyEvent[] = [];
    const normalSink = applySandboxPatch({ ...base, onEvent: (e) => events.push(e) });
    const throwingSink = applySandboxPatch({ ...base, onEvent: () => { throw new Error('telemetry boom'); } });
    expect(stripVolatile(noSink)).toEqual(stripVolatile(normalSink));
    expect(stripVolatile(noSink)).toEqual(stripVolatile(throwingSink));
    expect(throwingSink.ok).toBe(true);                  // apply still succeeded despite the throw
    expect(events.some((e) => e.phase === 'applied')).toBe(true);  // the normal sink recorded the apply
  });
});

describe('24Z.32 emit() hardening: applySignedSandboxPatch (lab ML-DSA) is identical under any sink behavior', () => {
  const key = generateLabSandboxKey('a'.repeat(64));
  const signed = signSandboxPermit({ draftHash, nonce: 'n32', key, issuedAt: NOW });
  const base = { signedPermit: signed, draftHash, files, now: NOW, tmpBase };
  it('outcome IDENTICAL across no-sink, normal-sink, throwing-sink', () => {
    const noSink = applySignedSandboxPatch({ ...base });
    const normalSink = applySignedSandboxPatch({ ...base, onEvent: () => { /* swallow */ } });
    const throwingSink = applySignedSandboxPatch({ ...base, onEvent: () => { throw new Error('telemetry boom'); } });
    expect(stripVolatile(noSink)).toEqual(stripVolatile(normalSink));
    expect(stripVolatile(noSink)).toEqual(stripVolatile(throwingSink));
    expect(throwingSink.ok).toBe(true);                  // hardening preserves apply success
  });
  it('a throwing sink during REFUSE phase still returns the refuse outcome (no propagation)', () => {
    // wrong draft hash → permit verification refuses; the refused emit must not throw.
    const r = applySignedSandboxPatch({ ...base, draftHash: sha('different draft'), onEvent: () => { throw new Error('boom'); } });
    const anyR = r as Record<string, unknown>;
    expect(r.ok).toBe(false);
    expect(anyR.refused).toBe(true);
    expect(anyR.liveRepoUnchanged).toBe(true);
  });
});
