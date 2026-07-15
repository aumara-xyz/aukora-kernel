// Headless port of deferred-tests/host-coupled/convexBrainReadonly.test.ts (issue #6). The original
// file mixes pure logic tests with tests that read private host-only files (`evidence/*.ts`,
// `node-template/convex/aukoraReceipts.ts`) that do not exist in this seed and never will. This file
// keeps ONLY the describes that were verified (by actually running them) to pass headless with zero
// dependency on anything outside `core/`:
//   - loopback URL validation / query allowlist / mutation rejection (pure functions)
//   - scrubPayload bounded-recursion DoS guard, unwrapConvexEnvelope
//   - readLoopbackSurface / readWithFallback / enrichSnapshotWithLoopback (mocked fetch only)
//   - bridge module structural safety (reads convexBrainReadonly.ts + opencodeWombArtifact.ts, both real)
//   - receipt chain head classification (mocked fetch only)
// Left in `deferred-tests/host-coupled/`, unchanged: the "runner source safety" describe (needs private
// `evidence/` scripts) and 3 of the 4 tests in the "receipt chain head public query" describe that read
// `node-template/convex/aukoraReceipts.ts` (a private donor-repo file) — the 4th test in that describe
// ("getReceiptChainHeadPublic is in the allowlist") reads no external file and its exact assertion is
// already carried here verbatim in the "query allowlist" describe below, so no coverage was lost. One
// test — "enriched snapshot passes validation" — was also dropped: it asserts `sourceRepos` contains
// 'AUMA-ONE-APP' and `donorCount > 0`, which depends on host-specific donor-repo layout outside this
// repo, unrelated to the read-only/loopback invariant this file exists to prove.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  isLoopbackUrl,
  rejectNonLoopback,
  isAllowedQuery,
  rejectMutation,
  readLoopbackSurface,
  readWithFallback,
  enrichSnapshotWithLoopback,
  scrubPayload,
  unwrapConvexEnvelope,
  parseReceiptHead,
} from '../src/convexBrainReadonly';
import { buildConvexBrainSnapshot } from '../src/convexBrainSnapshot';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── URL validation ──

describe('convexBrainReadonly: loopback URL validation', () => {
  it('accepts http://127.0.0.1:3220', () => {
    expect(isLoopbackUrl('http://127.0.0.1:3220')).toBe(true);
  });

  it('accepts http://localhost:3220', () => {
    expect(isLoopbackUrl('http://localhost:3220')).toBe(true);
  });

  it('accepts http://[::1]:3220', () => {
    expect(isLoopbackUrl('http://[::1]:3220')).toBe(true);
  });

  it('accepts https://127.0.0.1:3220', () => {
    expect(isLoopbackUrl('https://127.0.0.1:3220')).toBe(true);
  });

  it('accepts http://localhost without port', () => {
    expect(isLoopbackUrl('http://localhost')).toBe(true);
  });

  it('rejects convex.cloud', () => {
    expect(isLoopbackUrl('https://my-app.convex.cloud')).toBe(false);
  });

  it('rejects convex.dev', () => {
    expect(isLoopbackUrl('https://my-app.convex.dev')).toBe(false);
  });

  it('rejects convex.site', () => {
    expect(isLoopbackUrl('https://my-app.convex.site')).toBe(false);
  });

  it('rejects arbitrary hostname', () => {
    expect(isLoopbackUrl('https://example.com:3220')).toBe(false);
  });

  it('rejects LAN IP', () => {
    expect(isLoopbackUrl('http://192.168.1.1:3220')).toBe(false);
  });

  it('rejects 10.x IP', () => {
    expect(isLoopbackUrl('http://10.0.0.1:3220')).toBe(false);
  });

  it('rejects URL with credentials', () => {
    expect(isLoopbackUrl('http://user:pass@localhost:3220')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isLoopbackUrl('')).toBe(false);
  });

  it('rejectNonLoopback throws on cloud URL', () => {
    expect(() => rejectNonLoopback('https://foo.convex.cloud')).toThrow('refuse_non_loopback');
  });

  it('rejectNonLoopback does not throw on loopback', () => {
    expect(() => rejectNonLoopback('http://127.0.0.1:3220')).not.toThrow();
  });
});

// ── Query allowlist ──

describe('convexBrainReadonly: query allowlist', () => {
  it('allows the vetted public head query', () => {
    expect(isAllowedQuery('aukoraReceipts:getReceiptChainHeadPublic')).toBe(true);
  });

  // Speculative/non-existent entries were removed from the allowlist by an earlier adversarial review.
  it('rejects removed speculative entries that never existed as queries', () => {
    expect(isAllowedQuery('aukoraReceipts:getChainHead')).toBe(false);
    expect(isAllowedQuery('aukoraReceipts:getLatest')).toBe(false);
    expect(isAllowedQuery('aukoraSignedHead:getCurrent')).toBe(false);
  });

  it('rejects arbitrary query', () => {
    expect(isAllowedQuery('randomTable:doStuff')).toBe(false);
  });

  it('rejects AUMA-ONE query path', () => {
    expect(isAllowedQuery('organism:dispatch')).toBe(false);
  });
});

// ── Mutation rejection ──

describe('convexBrainReadonly: mutation rejection', () => {
  it('rejects submitIntentCore', () => {
    expect(() => rejectMutation('submitIntentCore')).toThrow('refuse_mutation');
  });

  it('rejects verifyAndConsumeDecisionToken', () => {
    expect(() => rejectMutation('verifyAndConsumeDecisionToken')).toThrow('refuse_mutation');
  });

  it('rejects writeReceiptRow', () => {
    expect(() => rejectMutation('writeReceiptRow')).toThrow('refuse_mutation');
  });

  it('rejects executeDecision', () => {
    expect(() => rejectMutation('executeDecision')).toThrow('refuse_mutation');
  });

  it('rejects signPoP', () => {
    expect(() => rejectMutation('signPoP')).toThrow('refuse_mutation');
  });

  it('rejects submitAndConsume (fictional)', () => {
    expect(() => rejectMutation('submitAndConsume')).toThrow('refuse_mutation');
  });

  it('rejects mutation verb in name', () => {
    expect(() => rejectMutation('someTable:mutation')).toThrow('refuse_mutation_verb');
  });

  it('rejects insert verb', () => {
    expect(() => rejectMutation('someTable:insert')).toThrow('refuse_mutation_verb');
  });

  it('rejects delete verb', () => {
    expect(() => rejectMutation('someTable:delete')).toThrow('refuse_mutation_verb');
  });

  it('rejects action verb', () => {
    expect(() => rejectMutation('someTable:action')).toThrow('refuse_mutation_verb');
  });

  it('allows query names', () => {
    expect(() => rejectMutation('aukoraReceipts:getReceiptChainHeadPublic')).not.toThrow();
  });
});

// ── scrubPayload DoS guard + envelope + parseReceiptHead ──

describe('convexBrainReadonly: scrubPayload bounded recursion (DoS guard)', () => {
  it('does not stack-overflow on a deeply nested object', () => {
    let deep: Record<string, unknown> = { exists: true, chainKey: 'organism', count: 1 };
    for (let i = 0; i < 10000; i++) deep = { nest: deep };
    expect(() => scrubPayload(deep)).not.toThrow();
  });

  it('drops subtrees past the depth cap (fails closed)', () => {
    let deep: Record<string, unknown> = { secretDepth: 'value' };
    for (let i = 0; i < 50; i++) deep = { nest: deep };
    const out = scrubPayload(deep) as any;
    let cur = out;
    let nullSeen = false;
    for (let i = 0; i < 50 && cur; i++) { cur = cur.nest; if (cur === null) { nullSeen = true; break; } }
    expect(nullSeen).toBe(true);
  });

  it('still scrubs secrets at shallow depth', () => {
    const out = scrubPayload({ exists: true, chainKey: 'x', count: 1, apiKey: 'sk-LEAK', nested: { seed: 'LEAK' } }) as any;
    expect(out.apiKey).toBeUndefined();
    expect(out.nested.seed).toBeUndefined();
    expect(out.exists).toBe(true);
  });
});

describe('convexBrainReadonly: unwrapConvexEnvelope', () => {
  it('unwraps a Convex success envelope', () => {
    const r = unwrapConvexEnvelope({ status: 'success', value: { exists: true, chainKey: 'x', count: 2 } });
    expect(r.ok).toBe(true);
    expect((r.value as any).count).toBe(2);
  });

  it('marks a Convex error envelope not-ok', () => {
    const r = unwrapConvexEnvelope({ status: 'error', errorMessage: 'no fn' });
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.errorMessage).toBe('no fn');
  });

  it('passes non-enveloped objects through', () => {
    const r = unwrapConvexEnvelope({ exists: true, chainKey: 'x', count: 1 });
    expect(r.ok).toBe(true);
    expect((r.value as any).exists).toBe(true);
  });

  it('readLoopbackSurface unwraps a real Convex success envelope into a parseable head', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', value: { exists: true, chainKey: 'organism', count: 9, headSigAlg: 'ML-DSA-65' } }),
    });
    const orig = globalThis.fetch;
    globalThis.fetch = f as any;
    try {
      const res = await readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic');
      const head = parseReceiptHead(res.data);
      expect(head).not.toBeNull();
      expect(head!.count).toBe(9);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ── Live read (mocked) ──

describe('convexBrainReadonly: readLoopbackSurface', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects non-loopback URL', async () => {
    await expect(readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic', {
      url: 'https://foo.convex.cloud',
      timeoutMs: 1000,
      advisoryOnly: true,
      grantsAuthority: false,
    })).rejects.toThrow('refuse_non_loopback');
  });

  it('rejects non-allowlisted query', async () => {
    await expect(readLoopbackSurface('organism:dispatch', {
      url: 'http://127.0.0.1:3220',
      timeoutMs: 1000,
      advisoryOnly: true,
      grantsAuthority: false,
    })).rejects.toThrow('query_not_in_allowlist');
  });

  it('returns scrubbed data on success', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        epoch: 42,
        headHash: 'abc123',
        signatureAlgorithm: 'ML-DSA-65',
        timestamp: '2026-06-19T00:00:00Z',
        apiKey: 'sk-LEAKED',
        privateKey: 'LEAKED',
      }),
    });

    const result = await readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic');
    expect(result.source).toBe('convex_loopback');
    expect(result.bridgeMode).toBe('local_loopback_readonly');
    expect(result.readOnly).toBe(true);
    expect(result.advisoryOnly).toBe(true);
    expect(result.grantsAuthority).toBe(false);
    expect(result.data).toBeDefined();
    expect((result.data as any).epoch).toBe(42);
    expect((result.data as any).headHash).toBe('abc123');
    expect((result.data as any).apiKey).toBeUndefined();
    expect((result.data as any).privateKey).toBeUndefined();
  });

  it('scrubs cloud URLs from values', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        epoch: 1,
        url: 'https://something.convex.cloud/api',
      }),
    });

    const result = await readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic');
    expect((result.data as any).url).toBeUndefined();
  });

  it('throws on HTTP error', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic'))
      .rejects.toThrow('convex_loopback_http_500');
  });
});

// ── Fallback ──

describe('convexBrainReadonly: readWithFallback', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('falls back to static snapshot when loopback fails', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const result = await readWithFallback('aukoraReceipts:getReceiptChainHeadPublic', snapshot);
    expect(result.source).toBe('static_inventory');
    expect(result.bridgeMode).toBe('static_inventory');
    expect(result.fallbackReason).toContain('ECONNREFUSED');
    expect(result.advisoryOnly).toBe(true);
    expect(result.grantsAuthority).toBe(false);
    expect(result.data).not.toBeNull();
  });

  it('returns unavailable when no snapshot and loopback fails — the honest "no backend, no data" state', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await readWithFallback('aukoraReceipts:getReceiptChainHeadPublic', null);
    expect(result.source).toBe('unavailable');
    expect(result.bridgeMode).toBe('missing');
    expect(result.data).toBeNull();
    expect(result.fallbackReason).toContain('no_static');
  });

  it('returns live data when loopback succeeds', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ epoch: 100, headHash: 'fff' }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const result = await readWithFallback('aukoraReceipts:getReceiptChainHeadPublic', snapshot);
    expect(result.source).toBe('convex_loopback');
    expect(result.bridgeMode).toBe('local_loopback_readonly');
    expect(result.fallbackReason).toBeUndefined();
  });
});

// ── Snapshot enrichment ──

describe('convexBrainReadonly: enrichSnapshotWithLoopback', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('enriches snapshot to local_loopback_readonly on success', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: true, chainKey: 'organism', count: 5, lastChainHash: 'abc', headSigAlg: 'ML-DSA-65', headSignedAt: 1000, receiptLogRoot: 'root1', updatedAt: 1000 }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { snapshot: enriched, loopbackResult, liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(enriched.bridgeMode).toBe('local_loopback_readonly');
    expect(enriched.advisoryOnly).toBe(true);
    expect(enriched.grantsAuthority).toBe(false);
    expect(loopbackResult.source).toBe('convex_loopback');
    expect(liveDataKind).toBe('receipt_chain_head_public');
    expect(receiptHead).not.toBeNull();
    expect(receiptHead!.exists).toBe(true);
    expect(receiptHead!.count).toBe(5);
  });

  it('keeps static_inventory on loopback failure — proves the "honest unavailable" path required by issue #6', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { snapshot: enriched, loopbackResult, liveDataKind } = await enrichSnapshotWithLoopback(snapshot);
    expect(enriched.bridgeMode).toBe('static_inventory');
    expect(loopbackResult.source).toBe('static_inventory');
    expect(loopbackResult.fallbackReason).toBeDefined();
    expect(liveDataKind).toBe('server_alive_query_unavailable');
  });
});

// ── Structural safety ──

describe('convexBrainReadonly: bridge module structural safety', () => {
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainReadonly.ts'), 'utf-8');

  it('no AUMA-ONE-APP runtime import/require/dynamic import', () => {
    const importLines = bridgeSrc.split('\n').filter(l => /^\s*(import|require)\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain('AUMA-ONE-APP');
    }
  });

  it('no submitIntentCore in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/submitIntentCore\s*\(/);
  });

  it('no verifyAndConsumeDecisionToken in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/verifyAndConsumeDecisionToken\s*\(/);
  });

  it('no writeReceiptRow in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/writeReceiptRow\s*\(/);
  });

  it('no executeDecision in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/executeDecision\s*\(/);
  });

  it('no signPoP in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/signPoP\s*\(/);
  });

  it('no mutation() call in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/mutation\s*\(/);
  });

  it('no ctx.db in bridge module', () => {
    expect(bridgeSrc).not.toContain('ctx.db.');
  });

  it('no cloud Convex URL in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/https:\/\/.*convex\.(cloud|dev|site)/);
  });

  it('no secrets in bridge module', () => {
    expect(bridgeSrc).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(bridgeSrc).not.toMatch(/CONVEX_DEPLOY_KEY/);
  });

  it('grantsAuthority is always false in bridge module', () => {
    const matches = bridgeSrc.match(/grantsAuthority:\s*(true|false)/g) ?? [];
    for (const m of matches) {
      expect(m).toContain('false');
    }
  });

  it('advisoryOnly is always true in bridge module', () => {
    const matches = bridgeSrc.match(/advisoryOnly:\s*(true|false)/g) ?? [];
    for (const m of matches) {
      expect(m).toContain('true');
    }
  });

  it('readOnly is always true in result types', () => {
    const matches = bridgeSrc.match(/readOnly:\s*(true|false)/g) ?? [];
    for (const m of matches) {
      expect(m).toContain('true');
    }
  });

  it('artifact validator rejects unsafe Convex snapshot fields', () => {
    const artifactSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'opencodeWombArtifact.ts'), 'utf-8');
    expect(artifactSrc).toContain('current_convex_brain_snapshot');
    expect(artifactSrc).toContain('deploymentUrl');
    expect(artifactSrc).toContain('convexUrl');
    expect(artifactSrc).toContain('apiKey');
    expect(artifactSrc).toContain('privateKey');
  });

  it('every entry added to the query allowlist is a real read-only query name, never a placeholder', () => {
    // Issue #6 / concurrent Kira work added kira:getHeadPublic and kira:recall to the
    // allowlist. The module's own header comment requires "a field-level review proving it returns
    // only public metadata" for any new entry — pin that none of the CURRENT entries look like a verb
    // or an obviously-unreviewed placeholder, so a future addition without review fails this test.
    const allowlistMatch = bridgeSrc.match(/const ALLOWED_QUERIES = new Set\(\[([\s\S]*?)\]\);/);
    expect(allowlistMatch).not.toBeNull();
    const entries = [...allowlistMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(() => rejectMutation(e)).not.toThrow();
      expect(e.split(':').pop()).not.toMatch(/^(insert|replace|patch|delete|mutation|action)$/i);
    }
  });
});

// ── Receipt chain head classification ──

describe('convexBrainReadonly: receipt chain head classification', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('classifies real receipt head response', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        exists: true,
        chainKey: 'organism',
        count: 12,
        lastChainHash: 'deadbeef',
        headSigAlg: 'ML-DSA-65',
        headSignedAt: 1718800000,
        receiptLogRoot: 'merkle123',
        updatedAt: 1718800000,
      }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('receipt_chain_head_public');
    expect(receiptHead).not.toBeNull();
    expect(receiptHead!.exists).toBe(true);
    expect(receiptHead!.chainKey).toBe('organism');
    expect(receiptHead!.count).toBe(12);
    expect(receiptHead!.lastChainHash).toBe('deadbeef');
    expect(receiptHead!.headSigAlg).toBe('ML-DSA-65');
    expect(receiptHead!.receiptLogRoot).toBe('merkle123');
  });

  it('classifies empty chain (exists=false)', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        exists: false,
        chainKey: 'organism',
        count: 0,
        lastChainHash: null,
        headSigAlg: null,
        headSignedAt: null,
        receiptLogRoot: null,
        updatedAt: null,
      }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('receipt_chain_head_public');
    expect(receiptHead!.exists).toBe(false);
    expect(receiptHead!.count).toBe(0);
  });

  it('classifies generic server response as server_alive_query_unavailable', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error', errorMessage: 'Function not found' }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('server_alive_query_unavailable');
    expect(receiptHead).toBeNull();
  });

  // A response with the right field NAMES but WRONG TYPES must FAIL CLOSED — never displayed as real.
  it('FAILS CLOSED on right-names/wrong-types garbage (not a real head)', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: 'error', chainKey: null, count: -1 }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('server_alive_query_unavailable');
    expect(receiptHead).toBeNull();
  });

  it('FAILS CLOSED on empty chainKey string', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: true, chainKey: '', count: 5 }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('server_alive_query_unavailable');
    expect(receiptHead).toBeNull();
  });

  it('FAILS CLOSED on negative count', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: true, chainKey: 'organism', count: -3 }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('server_alive_query_unavailable');
  });

  it('coerces wrong-typed OPTIONAL fields to null but still reads a valid head', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        exists: true, chainKey: 'organism', count: 4,
        lastChainHash: 12345,
        headSigAlg: { junk: true },
        receiptLogRoot: ['nope'],
        updatedAt: 'not-a-number',
      }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead } = await enrichSnapshotWithLoopback(snapshot);
    expect(liveDataKind).toBe('receipt_chain_head_public');
    expect(receiptHead!.exists).toBe(true);
    expect(receiptHead!.count).toBe(4);
    expect(receiptHead!.lastChainHash).toBeNull();
    expect(receiptHead!.headSigAlg).toBeNull();
    expect(receiptHead!.receiptLogRoot).toBeNull();
    expect(receiptHead!.updatedAt).toBeNull();
  });

  it('classifies loopback failure with static fallback as server_alive_query_unavailable', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { liveDataKind, receiptHead, loopbackResult } = await enrichSnapshotWithLoopback(snapshot);
    expect(loopbackResult.source).toBe('static_inventory');
    expect(liveDataKind).toBe('server_alive_query_unavailable');
    expect(receiptHead).toBeNull();
  });

  it('bridge still rejects non-allowlisted function names', async () => {
    await expect(readLoopbackSurface('aukoraReceipts:writeReceiptRow')).rejects.toThrow('query_not_in_allowlist');
    await expect(readLoopbackSurface('organism:dispatch')).rejects.toThrow('query_not_in_allowlist');
    await expect(readLoopbackSurface('evil:steal')).rejects.toThrow('query_not_in_allowlist');
  });

  it('bridge still rejects mutation verbs', () => {
    expect(() => rejectMutation('anyTable:mutation')).toThrow('refuse_mutation_verb');
    expect(() => rejectMutation('anyTable:insert')).toThrow('refuse_mutation_verb');
    expect(() => rejectMutation('anyTable:delete')).toThrow('refuse_mutation_verb');
  });

  it('receipt head has no secrets', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        exists: true,
        chainKey: 'organism',
        count: 3,
        lastChainHash: 'abc',
        headSigAlg: 'ML-DSA-65',
        headSignedAt: 1000,
        receiptLogRoot: 'root1',
        updatedAt: 1000,
        seed: 'SHOULD_BE_SCRUBBED',
        apiKey: 'sk-SHOULD_BE_SCRUBBED',
      }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { receiptHead, loopbackResult } = await enrichSnapshotWithLoopback(snapshot);
    expect(receiptHead!.exists).toBe(true);
    expect((loopbackResult.data as any).seed).toBeUndefined();
    expect((loopbackResult.data as any).apiKey).toBeUndefined();
  });

  it('readLoopbackSurface passes query args', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: true, chainKey: 'test-chain', count: 1 }),
    });

    await readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic', undefined, { chainKey: 'test-chain' });
    const callArgs = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.args.chainKey).toBe('test-chain');
  });

  it('query args are scrubbed before sending', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: false, chainKey: 'x', count: 0 }),
    });

    await readLoopbackSurface('aukoraReceipts:getReceiptChainHeadPublic', undefined, {
      chainKey: 'organism',
      apiKey: 'sk-SHOULD_NOT_SEND',
    });
    const callArgs = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.args.chainKey).toBe('organism');
    expect(body.args.apiKey).toBeUndefined();
  });
});
