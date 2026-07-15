// M4 — the visible self-edit heartbeat. Proves the loop is observable AND safe: it runs propose -> gate ->
// sandbox apply (temp only) -> test -> receipt -> rollback, NEVER touches the live repo / Convex / memory
// authority, refuses unsafe + secret-bearing proposals, proves restoration, and never implies promotion.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  runSelfEditHeartbeat, demoHeartbeatProposal, unsafeHeartbeatProposal, heartbeatGrantsAuthority,
  type SelfEditProposal, type SelfEditHeartbeat,
} from '../src/selfEditLoop';

const SEED = join(__dirname, '..', '..');
const names = (h: SelfEditHeartbeat) => h.phases.map((p) => p.phase);
const phase = (h: SelfEditHeartbeat, n: string) => h.phases.find((p) => p.phase === n) as any;

describe('M4 self-edit heartbeat — sandbox-only, observable, authorizes nothing', () => {
  it('green path: propose -> gate -> sandbox -> test -> receipt -> rollback (all phases, in order)', () => {
    const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal(), now: '2026-06-30T00:00:00.000Z' });
    expect(h.outcome).toBe('tested_green');
    expect(names(h)).toEqual(['proposal', 'gate', 'sandbox', 'test', 'receipt', 'rollback']);
  });

  it('the live repo is NEVER touched (appliedLive=false; no demo file in the live tree)', () => {
    const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal() });
    expect(h.appliedLive).toBe(false);
    expect(h.liveRepoTouched).toBe(false);
    const sb = phase(h, 'sandbox');
    expect(sb.appliedLive).toBe(false);
    expect(sb.sandboxReceipt.appliedLive).toBe(false);
    expect(sb.sandboxReceipt.liveRepoUnchanged).toBe(true);
    expect(existsSync(join(SEED, 'demo', 'seed-heartbeat.txt'))).toBe(false); // never created live
  });

  it('rollback proves restoration: the sandbox is removed and the live witness is byte-unchanged', () => {
    const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal() });
    const rb = phase(h, 'rollback');
    expect(rb.sandboxRemoved).toBe(true);
    expect(rb.restored).toBe(true);
    expect(rb.liveRepoTouched).toBe(false);
  });

  it('the receipt distinguishes proposal/sandbox/test/rollback with a verdict', () => {
    const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal() });
    const r = phase(h, 'receipt');
    expect(r.verdict).toBe('tested_green');
    expect(typeof r.receiptHash).toBe('string');
    expect(new Set(names(h)).size).toBe(6); // distinct, ordered phases = legible loop
  });

  it('GATE refuses an unsafe (authority-path) proposal — no permit, no sandbox apply', () => {
    const h = runSelfEditHeartbeat({ proposal: unsafeHeartbeatProposal() });
    expect(h.outcome).toBe('refused');
    expect(phase(h, 'gate').admitted).toBe(false);
    expect(phase(h, 'sandbox').appliedSandbox).toBe(false);
    expect(h.liveRepoTouched).toBe(false);
  });

  it('GATE refuses a proposal carrying a secret (HIGH risk)', () => {
    const withSecret: SelfEditProposal = {
      proposalId: 'secret_v0', goal: 'sneak a secret', codec: 'json_action_v1',
      files: [{ relPath: 'demo/x.txt', content: 'const k = "sk-ABCDEF0123456789QRSTUV";\n' }],
    };
    const h = runSelfEditHeartbeat({ proposal: withSecret });
    expect(h.outcome).toBe('refused');
    expect(phase(h, 'gate').risk).toBe('high');
  });

  it('promotion is NEVER implied — promotionReady hard-false even on tested_green; grants no authority', () => {
    const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal() });
    expect(h.outcome).toBe('tested_green');
    expect(h.promotionReady).toBe(false);   // sandbox-green != promotion-ready
    expect(h.grantsAuthority).toBe(false);
    expect(h.convexWritten).toBe(false);
    expect(h.memoryAuthorityUsed).toBe(false);
    expect(heartbeatGrantsAuthority(h)).toBe(false);
  });
});
