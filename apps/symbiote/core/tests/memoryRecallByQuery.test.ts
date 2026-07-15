// R5b step 2 — recall BY QUERY (search keys → integrity-checked point reads). Hermetic: injected
// fetch + trivial signers (the real ones are built at the edge from the kernel's own head machinery).
// Pins: loopback-only, limit clamping, query-inside-signed-request, keys-only search envelope,
// honest skip of found:false rows, fail-closed propagation of every transport/custody refusal,
// and the no-authority stamp on every shape this module can return.
import { describe, it, expect } from 'vitest';
import { searchMemoryKeys, recallMemoriesByQuery } from '../src/memoryRecall';

const OWNER = 'aumara.root';
const respond = (envelope: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(envelope) });

const fakeSearchSigner = async (req: any) => `searchsig:${req.query}:${req.limit}`;
const fakeRecallSigner = async (req: any) => `recallsig:${req.key}`;
const base = () => ({
  url: 'http://127.0.0.1:3210',
  ownerRootId: OWNER,
  adminKeyProvider: () => 'admin-key-x',
  signSearch: fakeSearchSigner,
});

describe('searchMemoryKeys — loopback, envelope, clamping, no authority', () => {
  it('returns ranked keys from a successful search; the query and clamp ride INSIDE the signed request', async () => {
    let sent: any = null;
    const r = await searchMemoryKeys('what did we decide about the door', 50, {
      ...base(),
      fetchImpl: async (_url: string, init: any) => { sent = JSON.parse(init.body); return respond({ status: 'success', value: { ok: true, hits: [{ key: 'k1' }, { key: 'k2' }] } }); },
    });
    expect(r).toMatchObject({ ok: true, keys: ['k1', 'k2'], advisoryOnly: true, grantsAuthority: false });
    expect(sent.path).toBe('aumlokMemory:aumlokMemorySearch');
    expect(sent.args.req.query).toBe('what did we decide about the door');
    expect(sent.args.req.limit).toBe(20); // kernel bound: 50 clamps to 20
    expect(sent.args.readerSig).toBe('searchsig:what did we decide about the door:20'); // signer saw THIS req
  });

  it('clamps a zero/negative limit up to 1', async () => {
    let sent: any = null;
    await searchMemoryKeys('q', 0, { ...base(), fetchImpl: async (_u: string, init: any) => { sent = JSON.parse(init.body); return respond({ status: 'success', value: { ok: true, hits: [] } }); } });
    expect(sent.args.req.limit).toBe(1);
  });

  it('refuses a non-loopback backend URL outright (never sends)', async () => {
    let sent = false;
    const r = await searchMemoryKeys('q', 3, { ...base(), url: 'http://10.0.0.5:3210', fetchImpl: async () => { sent = true; return respond({}); } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-loopback/);
    expect(sent).toBe(false);
  });

  it('a kernel refusal is a typed ok:false with the kernel reason, never a throw', async () => {
    const r = await searchMemoryKeys('q', 3, { ...base(), fetchImpl: async () => respond({ status: 'success', value: { ok: false, reason: 'reader_pop_invalid' } }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('reader_pop_invalid');
  });

  it('a transport failure is a typed ok:false (the CALLER decides fallback)', async () => {
    const r = await searchMemoryKeys('q', 3, { ...base(), fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/search transport failed.*ECONNREFUSED/);
  });

  it('a custody refusal from the admin key provider is ok:false, never a throw', async () => {
    const r = await searchMemoryKeys('q', 3, { ...base(), adminKeyProvider: () => { throw new Error('admin_key_permissions_open: chmod 600 it'); }, fetchImpl: async () => respond({}) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('admin_key_permissions_open');
  });
});

// One injected fetch serving BOTH kernel paths, scripted per key.
function dualFetch(searchEnvelope: unknown, recallByKey: Record<string, unknown>, log?: string[]) {
  return async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (body.path === 'aumlokMemory:aumlokMemorySearch') { log?.push('search'); return respond(searchEnvelope); }
    if (body.path === 'aumlokMemory:aumlokMemoryRecall') {
      const key = body.args.req.key as string;
      log?.push(`recall:${key}`);
      const scripted = recallByKey[key];
      if (scripted === undefined) throw new Error(`unscripted key ${key}`);
      return respond(scripted);
    }
    throw new Error(`unexpected path ${body.path}`);
  };
}
const found = (value: string) => ({ status: 'success', value: { ok: true, value } });
const notFound = (reason: string) => ({ status: 'success', value: { ok: true, reason } });

describe('recallMemoriesByQuery — search then point reads, honest skips, fail-closed', () => {
  it('reads each searched key back and cites the governed row; a found:false row is SKIPPED, never faked', async () => {
    const log: string[] = [];
    const r = await recallMemoriesByQuery('door decision', 3, {
      ...base(),
      signRecall: fakeRecallSigner,
      fetchImpl: dualFetch(
        { status: 'success', value: { ok: true, hits: [{ key: 'k1' }, { key: 'k-erased' }, { key: 'k3' }] } },
        { k1: found('first memory'), 'k-erased': notFound('erased'), k3: found('third memory') },
        log,
      ),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hits.map((h) => h.key)).toEqual(['k1', 'k3']);
      expect(r.hits[0]).toMatchObject({ value: 'first memory', citation: `convex:mem:${OWNER}:k1`, advisoryOnly: true, grantsAuthority: false });
      // why-traces are display-only: rank reports the kernel's original relevance position and a
      // skipped row PRESERVES later ranks (k3 stays #3) — selection and order are unchanged, so
      // the benchmark verdict that earned the cutover is untouched by construction.
      expect(r.hits.map((h) => h.rank)).toEqual([1, 3]);
    }
    expect(log).toEqual(['search', 'recall:k1', 'recall:k-erased', 'recall:k3']);
  });

  it('a search refusal fails the whole recall (ok:false) and attempts no point reads', async () => {
    const log: string[] = [];
    const r = await recallMemoriesByQuery('q', 3, {
      ...base(), signRecall: fakeRecallSigner,
      fetchImpl: dualFetch({ status: 'success', value: { ok: false, reason: 'stale' } }, {}, log),
    });
    expect(r.ok).toBe(false);
    expect(log).toEqual(['search']);
  });

  it('a point-read transport failure fails the whole recall so the caller can fall back', async () => {
    const r = await recallMemoriesByQuery('q', 2, {
      ...base(), signRecall: fakeRecallSigner,
      fetchImpl: async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.path === 'aumlokMemory:aumlokMemorySearch') return respond({ status: 'success', value: { ok: true, hits: [{ key: 'k1' }] } });
        throw new Error('backend went away mid-read');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/point read failed at k1/);
  });

  it('malformed search hits (non-string keys) are dropped rather than passed to the point read', async () => {
    const r = await recallMemoriesByQuery('q', 3, {
      ...base(), signRecall: fakeRecallSigner,
      fetchImpl: dualFetch(
        { status: 'success', value: { ok: true, hits: [{ key: 'good' }, { key: 42 }, {}] } },
        { good: found('ok') },
      ),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hits.map((h) => h.key)).toEqual(['good']);
  });
});
