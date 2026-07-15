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

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ── URL validation ──

describe('24Y.3: loopback URL validation', () => {
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

describe('24Y.3: query allowlist', () => {
  it('allows the vetted public head query', () => {
    expect(isAllowedQuery('aukoraReceipts:getReceiptChainHeadPublic')).toBe(true);
  });

  // 24Y.5 hardening: speculative/non-existent entries were removed from the allowlist.
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

describe('24Y.3: mutation rejection', () => {
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

// ── 24Y.6: scrubPayload DoS guard + envelope + parseReceiptHead ──

describe('24Y.6: scrubPayload bounded recursion (DoS guard)', () => {
  it('does not stack-overflow on a deeply nested object', () => {
    // Build ~10k-deep nesting — would overflow unbounded recursion.
    let deep: Record<string, unknown> = { exists: true, chainKey: 'organism', count: 1 };
    for (let i = 0; i < 10000; i++) deep = { nest: deep };
    expect(() => scrubPayload(deep)).not.toThrow();
  });

  it('drops subtrees past the depth cap (fails closed)', () => {
    let deep: Record<string, unknown> = { secretDepth: 'value' };
    for (let i = 0; i < 50; i++) deep = { nest: deep };
    const out = scrubPayload(deep) as any;
    // walk down; at some point the subtree becomes null (dropped), never throws
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

describe('24Y.6: unwrapConvexEnvelope', () => {
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

describe('24Y.3: readLoopbackSurface', () => {
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

describe('24Y.3: readWithFallback', () => {
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

  it('returns unavailable when no snapshot and loopback fails', async () => {
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

describe('24Y.3: enrichSnapshotWithLoopback', () => {
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

  it('keeps static_inventory on loopback failure', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { snapshot: enriched, loopbackResult, liveDataKind } = await enrichSnapshotWithLoopback(snapshot);
    expect(enriched.bridgeMode).toBe('static_inventory');
    expect(loopbackResult.source).toBe('static_inventory');
    expect(loopbackResult.fallbackReason).toBeDefined();
    expect(liveDataKind).toBe('server_alive_query_unavailable');
  });

  it('enriched snapshot passes validation', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ exists: false, chainKey: 'organism', count: 0 }),
    });

    const snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const { snapshot: enriched } = await enrichSnapshotWithLoopback(snapshot);
    expect(enriched.advisoryOnly).toBe(true);
    expect(enriched.grantsAuthority).toBe(false);
    expect(enriched.donorCount).toBeGreaterThan(0);
    expect(enriched.sourceRepos).toContain('AUMA-ONE-APP');
  });
});

// ── Structural safety ──

describe('24Y.3: bridge module structural safety', () => {
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
});

// ── 24Y.4: Runner source safety ──

describe('24Y.4: runner source safety', () => {
  it('smoke runner has no cloud Convex URLs', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    expect(src).not.toMatch(/https:\/\/.*convex\.(cloud|dev|site)/);
  });

  it('smoke runner has no AUMA-ONE runtime imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*(import|require)\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain('AUMA-ONE-APP');
    }
  });

  it('smoke runner never prints secrets or the raw response payload', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    // It prints only structured, scrubbed fields (role/booleans/counts) — never raw data or secrets.
    expect(src).not.toMatch(/console\.log.*apiKey/);
    expect(src).not.toMatch(/console\.log\([^)]*\.data\b/);
    expect(src).not.toMatch(/console\.log.*\b(seed|privateKey|password|token)\b/);
  });

  it('smoke runner does not call mutations', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    expect(src).not.toMatch(/mutation\s*\(/);
    expect(src).not.toMatch(/\.insert\s*\(/);
    expect(src).not.toMatch(/\.replace\s*\(/);
  });

  it('smoke runner does not import authority modules', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*(import|require)\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain('executor');
      expect(line).not.toContain('gate');
      expect(line).not.toContain('aumlok');
    }
  });

  it('artifact generator wires the topology-gated enrichment', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'generate-test-glyph-artifact.ts'), 'utf-8');
    expect(src).toContain('enrichSnapshotWithTopology');
    expect(src).toContain('current_convex_brain_snapshot');
    expect(src).toContain('bridgeMode');
    expect(src).toContain('backendRole');
    expect(src).toContain('canonicalBackendDetected');
  });

  it('artifact generator does not call mutations', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'generate-test-glyph-artifact.ts'), 'utf-8');
    expect(src).not.toMatch(/mutation\s*\(/);
    expect(src).not.toMatch(/ctx\.db\./);
  });

  it('artifact generator has no cloud Convex URLs', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'generate-test-glyph-artifact.ts'), 'utf-8');
    expect(src).not.toMatch(/https:\/\/.*convex\.(cloud|dev|site)/);
  });

  it('artifact generator has no secrets', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'generate-test-glyph-artifact.ts'), 'utf-8');
    expect(src).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(src).not.toMatch(/CONVEX_DEPLOY_KEY/);
  });

  it('runbook exists', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'evidence', '24y4-convex-loopback-runbook.md'))).toBe(true);
  });

  it('smoke runner reports receipt head fields', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    expect(src).toContain('receiptHeadExists');
    expect(src).toContain('receiptHeadCount');
    expect(src).toContain('hasSignedHead');
    expect(src).toContain('hasReceiptLogRoot');
    expect(src).toContain('liveDataKind');
  });

  it('artifact generator includes receiptChainHead', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'generate-test-glyph-artifact.ts'), 'utf-8');
    expect(src).toContain('receiptChainHead');
    expect(src).toContain('liveDataKind');
  });

  it('fusion key diagnostic uses resolveApiKey and never prints the key', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-fusion-key-source.ts'), 'utf-8');
    expect(src).toContain('resolveApiKey');
    // must NOT print the raw key value — but printing .key.length (the LENGTH) is allowed
    expect(src).not.toMatch(/console\.log\([^)]*\.key(?!\.length|Length)/);
    expect(src).not.toMatch(/console\.log\([^)]*resolution\.key(?!\.length|Length)/);
  });

  it('fusion key diagnostic does not check only process.env shallowly', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-fusion-key-source.ts'), 'utf-8');
    // the resolver call is the source of truth, present and primary
    const resolverIdx = src.indexOf('resolveApiKey()');
    expect(resolverIdx).toBeGreaterThan(-1);
  });
});

// ── 24Y.5: Receipt chain head public query ──

describe('24Y.5: receipt chain head public query', () => {
  it('getReceiptChainHeadPublic is in the allowlist', () => {
    expect(isAllowedQuery('aukoraReceipts:getReceiptChainHeadPublic')).toBe(true);
  });

  it('query function is read-only (no mutation/insert/patch/delete)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'node-template', 'convex', 'aukoraReceipts.ts'),
      'utf-8',
    );
    const funcStart = src.indexOf('export const getReceiptChainHeadPublic');
    expect(funcStart).toBeGreaterThan(-1);
    const funcBody = src.slice(funcStart);
    const closingIdx = funcBody.indexOf('});');
    const funcText = funcBody.slice(0, closingIdx + 3);

    expect(funcText).toContain('= query(');
    expect(funcText).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\(/);
    expect(funcText).not.toContain('mutation(');
    expect(funcText).not.toContain('internalMutation(');
  });

  it('query returns only public fields (headSig is public material; no secrets)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'node-template', 'convex', 'aukoraReceipts.ts'),
      'utf-8',
    );
    const funcStart = src.indexOf('export const getReceiptChainHeadPublic');
    const funcBody = src.slice(funcStart);
    const closingIdx = funcBody.indexOf('});');
    const funcText = funcBody.slice(0, closingIdx + 3);

    // 24Y.7: headSig (the ML-DSA signature) IS public verification material — intentionally returned.
    expect(funcText).toContain('headSig: head.headSig');
    // The signing SEED / private key / receipt payloads are NEVER returned.
    expect(funcText).not.toContain('seed');
    expect(funcText).not.toContain('privateKey');
    expect(funcText).not.toContain('secretKey');
    expect(funcText).not.toMatch(/\btoken\b/);
    expect(funcText).not.toContain('proofJson');
    expect(funcText).not.toContain('actionsJson');
    expect(funcText).not.toContain('password');
  });

  it('query takes chainKey arg', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'node-template', 'convex', 'aukoraReceipts.ts'),
      'utf-8',
    );
    const funcStart = src.indexOf('export const getReceiptChainHeadPublic');
    const funcBody = src.slice(funcStart);
    const closingIdx = funcBody.indexOf('});');
    const funcText = funcBody.slice(0, closingIdx + 3);

    expect(funcText).toContain('chainKey: v.string()');
  });
});

describe('24Y.5: receipt chain head classification', () => {
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

  // 24Y.5 HIGH fix (adversarial review): a response with the right field NAMES but WRONG TYPES
  // must FAIL CLOSED — never displayed as a real receipt head.
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
        lastChainHash: 12345,          // wrong type → null
        headSigAlg: { junk: true },    // wrong type → null
        receiptLogRoot: ['nope'],      // wrong type → null
        updatedAt: 'not-a-number',     // wrong type → null
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
