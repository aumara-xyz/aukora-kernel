// R5 read-side foundation — the keyed recall client. Hermetic: an injected fetch stands in for the live
// backend, and a temp 0600 seed stands in for the owner root. Pins custody discipline, loopback-only,
// envelope handling (found / not-found / erased / quarantined / error), and the no-authority stamp.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recallMemoryByKey, readOwnerSeedStrict, MemoryRecallError } from '../src/memoryRecall';

let dir: string;
let seedPath: string;
const SEED = '11'.repeat(32);
const OWNER = 'aumara.root';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-recall-'));
  seedPath = path.join(dir, 'memory-root.seed');
  fs.writeFileSync(seedPath, SEED, { mode: 0o600 });
  fs.chmodSync(seedPath, 0o600);
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

// A fake backend that returns a scripted envelope and captures the request for assertions.
function fakeFetch(envelope: unknown, capture?: (body: any) => void) {
  return async (_url: string, init: any) => {
    if (capture) capture(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify(envelope) };
  };
}
// A trivial injected signer — the real one (kernel recallHead + signChainHeadV3) is built at the edge,
// which CAN import convex; core-scoped code stays convex-free (so the sandbox core typecheck passes).
const fakeSigner = async (req: any) => `sig-for-${req.ownerRootId}-${req.key}-${req.timestamp}`;
const base = () => ({ url: 'http://127.0.0.1:3210', ownerRootId: OWNER, adminKeyProvider: () => 'admin-key-x', signRecall: fakeSigner });

describe('readOwnerSeedStrict — custody discipline', () => {
  it('accepts a 0600 64-hex seed; refuses missing / open-perms / non-hex / symlink', () => {
    expect(readOwnerSeedStrict(seedPath)).toBe(SEED);
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof MemoryRecallError) return e.code; throw e; } throw new Error('expected throw'); };
    expect(code(() => readOwnerSeedStrict(path.join(dir, 'nope')))).toBe('owner_seed_missing');
    const open = path.join(dir, 'open.seed'); fs.writeFileSync(open, SEED, { mode: 0o644 }); fs.chmodSync(open, 0o644);
    expect(code(() => readOwnerSeedStrict(open))).toBe('owner_seed_permissions_open');
    const bad = path.join(dir, 'bad.seed'); fs.writeFileSync(bad, 'not-hex', { mode: 0o600 }); fs.chmodSync(bad, 0o600);
    expect(code(() => readOwnerSeedStrict(bad))).toBe('owner_seed_malformed');
    const link = path.join(dir, 'link.seed'); fs.symlinkSync(seedPath, link);
    expect(code(() => readOwnerSeedStrict(link))).toBe('owner_seed_symlink_refused');
  });
});

describe('recallMemoryByKey — loopback, envelopes, no authority', () => {
  it('a successful keyed read returns the value, advisory-only, no authority; signs under aumlokMemRecall', async () => {
    let sentReq: any = null;
    const r = await recallMemoryByKey('atom_0_abc', { ...base(), fetchImpl: fakeFetch({ status: 'success', value: { ok: true, value: 'the remembered text' } }, (b) => { sentReq = b; }) });
    expect(r).toMatchObject({ ok: true, found: true, key: 'atom_0_abc', value: 'the remembered text', advisoryOnly: true, grantsAuthority: false });
    // the request carried a real reader signature over the recall query path
    expect(sentReq.path).toBe('aumlokMemory:aumlokMemoryRecall');
    expect(typeof sentReq.args.readerSig).toBe('string');
    expect(sentReq.args.readerSig).toContain('atom_0_abc'); // the injected signer signed THIS req
    expect(sentReq.args.req.ownerRootId).toBe(OWNER);
  });

  it('erased / quarantined / not_found come back as honest found:false, never a thrown error, never a served value', async () => {
    for (const reason of ['erased', 'quarantined', 'not_found', 'integrity_failed']) {
      const r = await recallMemoryByKey('k', { ...base(), fetchImpl: fakeFetch({ status: 'success', value: { ok: false, reason } }) });
      expect(r).toMatchObject({ ok: true, found: false, reason, grantsAuthority: false });
      expect((r as any).value).toBeUndefined();
    }
  });

  it('a kernel error envelope is surfaced as ok:false (caller decides fallback), not a fake memory', async () => {
    const r = await recallMemoryByKey('k', { ...base(), fetchImpl: fakeFetch({ status: 'error', errorMessage: 'aumlok_mem_signature_missing' }) });
    expect(r).toMatchObject({ ok: false, error: 'aumlok_mem_signature_missing', grantsAuthority: false });
  });

  it('refuses a non-loopback URL before signing or fetching', async () => {
    let called = false;
    const r = await recallMemoryByKey('k', { ...base(), url: 'http://evil.example.com', fetchImpl: async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; } });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('a transport failure returns ok:false so the caller can fall back to JSON recall (never invents a memory)', async () => {
    const r = await recallMemoryByKey('k', { ...base(), fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain('transport failed');
  });
});
