// P5 — defense-in-depth: pin the heartbeat lane as sandbox-only + loopback-only. The heartbeat is a WATCHABLE
// observer (propose -> gate -> sandbox temp dir -> test -> receipt -> rollback); it must never apply live,
// promote, sign, mutate the repo/Convex/memory, call a model provider, or be reachable off-loopback.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSelfEditHeartbeat, demoHeartbeatProposal } from '../src/selfEditLoop';

describe('heartbeat lane #1 — runSelfEditHeartbeat is sandbox-only (behavioral)', () => {
  it('a tested-green heartbeat still applies NOTHING live and grants no authority', () => {
    const h = runSelfEditHeartbeat({ proposal: demoHeartbeatProposal() });
    expect(h.outcome).toBe('tested_green');
    expect(h.appliedLive).toBe(false);
    expect(h.liveRepoTouched).toBe(false);
    expect(h.convexWritten).toBe(false);
    expect(h.memoryAuthorityUsed).toBe(false);
    expect(h.promotionReady).toBe(false);   // sandbox-green != promotion-ready
    expect(h.grantsAuthority).toBe(false);
    expect(h.advisoryOnly).toBe(true);
    const sandbox = h.phases.find(p => p.phase === 'sandbox') as any;
    expect(sandbox.appliedLive).toBe(false);
    expect(sandbox.liveRepoUnchanged).toBe(true);
    const rollback = h.phases.find(p => p.phase === 'rollback') as any;
    expect(rollback.liveRepoTouched).toBe(false);
  });
});

describe('heartbeat lane #2 — scripts/heartbeat.sh runs only the sandbox loop, no powers', () => {
  const sh = () => readFileSync(join(__dirname, '..', '..', 'scripts', 'heartbeat.sh'), 'utf-8');
  it('invokes runSelfEditHeartbeat and never a live-apply / promote / signer', () => {
    const s = sh();
    expect(s).toContain('runSelfEditHeartbeat');
    expect(s).not.toMatch(/\b(applyLive|promoteLive|signPoP|signHead|signPromotion|unlockLivePromotion)\b/i);
  });
  it('makes no network / provider call', () => {
    const s = sh();
    expect(s).not.toMatch(/\b(curl|wget|nc|ssh)\b|https?:\/\//i);
    expect(s).not.toMatch(/OpenRouter|performExternalReview/i);
  });
});

describe('heartbeat lane #3 — dashboard/serve.ts heartbeat endpoint is loopback + sandbox-only', () => {
  const serve = () => readFileSync(join(__dirname, '..', '..', 'dashboard', 'serve.ts'), 'utf-8');
  it('binds loopback only (127.0.0.1), never all-interfaces', () => {
    const s = serve();
    expect(s).toMatch(/hostname:\s*["']127\.0\.0\.1["']/);
    expect(s).not.toMatch(/hostname:\s*["']0\.0\.0\.0["']/);
  });
  it('the /api/heartbeat path spawns the sandbox script and nothing authority-bearing', () => {
    const s = serve();
    expect(s).toContain('/api/heartbeat');
    expect(s).toContain('scripts/heartbeat.sh');
    // the console WATCHES the loop; it must never sign / promote / unlock or call a model provider
    expect(s).not.toMatch(/\b(signPoP|signHead|signPromotion|unlockLivePromotion|promoteLive|aumlokMemoryWrite)\b/);
    expect(s).not.toMatch(/OpenRouter|performExternalReview|api\.openrouter/i);
  });
});
