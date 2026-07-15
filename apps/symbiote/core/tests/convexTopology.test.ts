import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyBackend,
  enrichSnapshotWithTopology,
  TOPOLOGY,
  CANONICAL_MARKER_QUERY,
  DONOR_MARKER_QUERY,
} from '../src/convexTopology';
import type { ConvexLoopbackConfig } from '../src/convexBrainReadonly';
import { SIGNED_HEAD_V4_ALG, type CanonicalPin } from '../src/convexCanonicalPin';
import { buildConvexBrainSnapshot } from '../src/convexBrainSnapshot';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const LOOPBACK: ConvexLoopbackConfig = {
  url: 'http://127.0.0.1:3220',
  timeoutMs: 1000,
  advisoryOnly: true,
  grantsAuthority: false,
};

// GOLD vector from the kernel's own signer (see convexCanonicalPin.test.ts).
const VEC = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'canonical-head-vector.json'), 'utf-8'),
) as { head: { chainKey: string; chainLength: number; chainHeadHash: string; timestamp: number };
       merkleRoot: string; publicKey: string; sig: string; headSigAlg: string };

// The exact head value the canonical query returns for the gold vector (under {status,value}).
const GOLD_HEAD_VALUE = {
  exists: true,
  chainKey: VEC.head.chainKey,
  count: VEC.head.chainLength,
  lastChainHash: VEC.head.chainHeadHash,
  headSig: VEC.sig,
  headSigAlg: VEC.headSigAlg,
  headSignedAt: VEC.head.timestamp,
  receiptLogRoot: VEC.merkleRoot,
  updatedAt: VEC.head.timestamp,
};
const GOLD_PIN: CanonicalPin = {
  publicKeyHex: VEC.publicKey, expectedAlg: SIGNED_HEAD_V4_ALG, allowedChainKeys: null, source: 'explicit_config',
};

// A type-valid but UNSIGNED-by-pin head (the 24Y.6 spoof shape).
const SPOOF_HEAD_VALUE = {
  exists: true, chainKey: 'organism', count: 7, lastChainHash: 'a'.repeat(64),
  headSig: 'a'.repeat(6618), headSigAlg: SIGNED_HEAD_V4_ALG, headSignedAt: 1000, receiptLogRoot: 'b'.repeat(64), updatedAt: 1000,
};

function mockFetchByPath(handlers: {
  instanceName?: string | null;
  canonical?: unknown;
  donor?: unknown;
  networkDown?: boolean;
}) {
  return vi.fn(async (input: any, init?: any) => {
    if (handlers.networkDown) throw new Error('ECONNREFUSED');
    const url = String(input);
    if (url.endsWith('/instance_name')) {
      if (handlers.instanceName == null) return { ok: false } as any;
      return { ok: true, text: async () => handlers.instanceName } as any;
    }
    const body = JSON.parse(init.body);
    if (body.path === CANONICAL_MARKER_QUERY) {
      if (handlers.canonical === undefined) {
        return { ok: true, json: async () => ({ status: 'error', errorMessage: 'Could not find public function' }) } as any;
      }
      return { ok: true, json: async () => ({ status: 'success', value: handlers.canonical }) } as any;
    }
    if (body.path === DONOR_MARKER_QUERY) {
      if (handlers.donor === undefined) {
        return { ok: true, json: async () => ({ status: 'error', errorMessage: 'Could not find public function' }) } as any;
      }
      return { ok: true, json: async () => ({ status: 'success', value: handlers.donor }) } as any;
    }
    return { ok: true, json: async () => ({ status: 'error', errorMessage: 'unknown' }) } as any;
  });
}

describe('24Y.7: topology registry', () => {
  it('canonical kernel is node-template', () => {
    expect(TOPOLOGY.canonicalKernel.role).toBe('canonical_kernel');
    expect(TOPOLOGY.canonicalKernel.url).toBeNull();
  });
  it('organism lab is donor and NOT allowed for womb', () => {
    expect(TOPOLOGY.organismLab.role).toBe('donor_lab');
    expect(TOPOLOGY.organismLab.allowedForWomb).toBe(false);
  });
});

describe('24Y.7: classifyBackend — cryptographic pin gate', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('PIN + crypto-verified head → canonical_kernel (cryptographic_pin, not spoofable, allowedForWomb)', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const c = await classifyBackend(LOOPBACK, GOLD_PIN);
    expect(c.role).toBe('canonical_kernel');
    expect(c.cryptographicallyVerified).toBe(true);
    expect(c.canonicalityProof).toBe('cryptographic_pin');
    expect(c.spoofable).toBe(false);
    expect(c.allowedForWomb).toBe(true);
    expect(c.halt).toBe(false);
  });

  it('THE 24Y.6 SPOOF closed: PIN + name-marker head that FAILS the pin → NOT canonical, HALT', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: SPOOF_HEAD_VALUE }) as any;
    const c = await classifyBackend(LOOPBACK, GOLD_PIN);
    expect(c.role).not.toBe('canonical_kernel');
    expect(c.cryptographicallyVerified).toBe(false);
    expect(c.canonicalityProof).toBe('none');
    expect(c.halt).toBe(true);
    expect(c.allowedForWomb).toBe(false);
  });

  it('NO pin + name-marker head → NOT canonical, name_marker_only, spoofable (refuse to trust)', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const c = await classifyBackend(LOOPBACK, null);
    expect(c.role).not.toBe('canonical_kernel');
    expect(c.cryptographicallyVerified).toBe(false);
    expect(c.canonicalityProof).toBe('name_marker_only');
    expect(c.spoofable).toBe(true);
    expect(c.allowedForWomb).toBe(false);
  });

  it('organism backend (no canonical query) → donor_lab, not canonical, with or without pin', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'convex-self-hosted', donor: { ok: true } }) as any;
    const withPin = await classifyBackend(LOOPBACK, GOLD_PIN);
    expect(withPin.role).toBe('donor_lab');
    expect(withPin.cryptographicallyVerified).toBe(false);
    const noPin = await classifyBackend(LOOPBACK, null);
    expect(noPin.role).toBe('donor_lab');
  });

  it('dead backend → unavailable', async () => {
    globalThis.fetch = mockFetchByPath({ networkDown: true }) as any;
    const c = await classifyBackend(LOOPBACK, GOLD_PIN);
    expect(c.role).toBe('unavailable');
    expect(c.cryptographicallyVerified).toBe(false);
  });

  it('rejects non-loopback URL (throws)', async () => {
    globalThis.fetch = mockFetchByPath({ canonical: GOLD_HEAD_VALUE }) as any;
    await expect(classifyBackend({ ...LOOPBACK, url: 'https://foo.convex.cloud' }, GOLD_PIN)).rejects.toThrow('refuse_non_loopback');
  });

  it('grantsAuthority always false', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const c = await classifyBackend(LOOPBACK, GOLD_PIN);
    expect(c.grantsAuthority).toBe(false);
  });
});

describe('24Y.7: enrichSnapshotWithTopology — receiptHeadVisible requires crypto pin', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('PIN + verified FRESH head → receiptHeadVisible true, cryptographic_pin', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const prior = { chainKey: 'organism', maxCount: VEC.head.chainLength - 1, headHash: 'old', receiptLogRoot: 'old', headSignedAt: 1, recordedAt: 1 };
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN, prior);
    expect(r.canonicalBackendDetected).toBe(true);
    expect(r.receiptHeadVisible).toBe(true);
    expect(r.canonicalityProof).toBe('cryptographic_pin');
    expect(r.receiptHead!.count).toBe(VEC.head.chainLength);
    expect(r.degradedReason).toBeNull();
  });

  it('NO pin → never canonical, never receiptHeadVisible, spoofable surfaced', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', null);
    expect(r.canonicalBackendDetected).toBe(false);
    expect(r.receiptHeadVisible).toBe(false);
    expect(r.receiptHead).toBeNull();
    expect(r.canonicalityProof).toBe('name_marker_only');
    expect(r.spoofable).toBe(true);
  });

  it('PIN + spoof head → HALT, never receiptHeadVisible', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: SPOOF_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN);
    expect(r.receiptHeadVisible).toBe(false);
    expect(r.halt).toBe(true);
    expect(r.degradedReason).toContain('HALT');
  });

  it('donor backend → not canonical, no head', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'convex-self-hosted', donor: { ok: true } }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN);
    expect(r.backendRole).toBe('donor_lab');
    expect(r.receiptHeadVisible).toBe(false);
    expect(r.receiptHead).toBeNull();
  });

  it('dead backend → unavailable + static fallback, no canonical claim', async () => {
    globalThis.fetch = mockFetchByPath({ networkDown: true }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN);
    expect(r.backendRole).toBe('unavailable');
    expect(r.receiptHeadVisible).toBe(false);
    expect(r.liveDataKind).toBe('unavailable');
    expect(r.snapshot.bridgeMode).toBe('static_inventory');
  });

  it('exhaustive: no non-canonical / no-pin path ever yields receiptHeadVisible', async () => {
    const cases: Array<[any, CanonicalPin | null]> = [
      [{ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }, null],            // verified head but NO pin
      [{ instanceName: 'node-template', canonical: SPOOF_HEAD_VALUE }, GOLD_PIN],        // pin but forged head
      [{ instanceName: 'convex-self-hosted', donor: { ok: true } }, GOLD_PIN],          // donor
      [{ instanceName: 'mystery' }, GOLD_PIN],                                          // wrong
      [{ networkDown: true }, GOLD_PIN],                                                // dead
    ];
    for (const [handlers, pin] of cases) {
      globalThis.fetch = mockFetchByPath(handlers) as any;
      const snap = buildConvexBrainSnapshot(REPO_ROOT);
      const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', pin);
      expect(r.receiptHeadVisible).toBe(false);
      expect(r.snapshot.grantsAuthority).toBe(false);
    }
  });

  it('24Y.8: crypto-verified head with FRESH advance → receiptHeadVisible + freshnessVerified', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    // prior high-water BELOW the gold head's count (7) → advance is fresh
    const prior = { chainKey: 'organism', maxCount: 6, headHash: 'old', receiptLogRoot: 'oldroot', headSignedAt: 1, recordedAt: 1 };
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN, prior);
    expect(r.cryptographicallyVerified).toBe(true);
    expect(r.freshnessVerified).toBe(true);
    expect(r.receiptHeadVisible).toBe(true);
    expect(r.backendRole).toBe('canonical_kernel');
    expect(r.nextHighWater).toBeNull(); // no `now` supplied → not advanced to a record
  });

  it('24Y.8: crypto-verified head but ROLLBACK vs high-water → degraded, NOT visible', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    // prior high-water ABOVE the gold head's count (7) → rollback (severe)
    const prior = { chainKey: 'organism', maxCount: 99, headHash: 'newer', receiptLogRoot: 'newerroot', headSignedAt: 9, recordedAt: 9 };
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN, prior);
    expect(r.cryptographicallyVerified).toBe(true);   // crypto still valid
    expect(r.receiptHeadVisible).toBe(false);         // but a replayed/rolled-back head is NOT shown
    expect(r.backendRole).toBe('canonical_kernel_degraded');
    expect(r.replayRisk).toBe('severe');
    expect(r.degradedReason).toContain('REPLAY');
  });

  it('24Y.8: crypto-verified head, FORK at same count → degraded, NOT visible', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    // same count (7) but a different remembered hash → fork
    const prior = { chainKey: 'organism', maxCount: VEC.head.chainLength, headHash: 'DIFFERENT', receiptLogRoot: 'DIFFERENT', headSignedAt: 1, recordedAt: 1 };
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN, prior);
    expect(r.receiptHeadVisible).toBe(false);
    expect(r.backendRole).toBe('canonical_kernel_degraded');
    expect(r.freshness!.verdict).toBe('fork');
  });

  it('24Y.8: first observation (no high-water) → head shown but freshnessVerified false (no overclaim)', async () => {
    globalThis.fetch = mockFetchByPath({ instanceName: 'node-template', canonical: GOLD_HEAD_VALUE }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN, null);
    expect(r.receiptHeadVisible).toBe(true);
    expect(r.freshnessVerified).toBe(false);
    expect(r.freshness!.verdict).toBe('unknown_no_history');
  });

  it('TOCTOU guard: probe verifies but the head READ differs → discarded (re-verify on read)', async () => {
    // canonical probe returns GOLD (verifies); but the SECOND read returns a forged head.
    let canonicalCalls = 0;
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith('/instance_name')) return { ok: true, text: async () => 'node-template' } as any;
      const body = JSON.parse(init.body);
      if (body.path === CANONICAL_MARKER_QUERY) {
        canonicalCalls++;
        const value = canonicalCalls === 1 ? GOLD_HEAD_VALUE : SPOOF_HEAD_VALUE; // probe ok, read forged
        return { ok: true, json: async () => ({ status: 'success', value }) } as any;
      }
      if (body.path === DONOR_MARKER_QUERY) return { ok: true, json: async () => ({ status: 'error' }) } as any;
      return { ok: true, json: async () => ({ status: 'error' }) } as any;
    }) as any;
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const r = await enrichSnapshotWithTopology(snap, LOOPBACK, 'organism', GOLD_PIN);
    // classify saw a verified head (canonical), but the read head fails re-verify → NOT surfaced.
    expect(r.receiptHeadVisible).toBe(false);
    expect(r.receiptHead).toBeNull();
  });
});

describe('24Y.7: classifier source safety', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexTopology.ts'), 'utf-8');

  it('classifier never calls the mutation endpoint', () => {
    expect(src).not.toMatch(/\/api\/mutation/);
    expect(src).not.toMatch(/\/api\/action/);
  });

  it('classifier grantsAuthority is always false', () => {
    const matches = src.match(/grantsAuthority:\s*(true|false)/g) ?? [];
    for (const m of matches) expect(m).toContain('false');
  });

  it('canonical confirmation goes through cryptographic verification', () => {
    expect(src).toContain('verifyCanonicalReceiptHead');
    expect(src).toContain('cryptographicallyVerified');
  });

  it('classifier has no secrets / no signing', () => {
    expect(src).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(src).not.toContain('ml_dsa65.sign');
    expect(src).not.toContain('signingSeed');
  });
});
