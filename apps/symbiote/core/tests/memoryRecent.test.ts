// Recent-memory observability: newest-first owner-root metadata read → integrity-checked point reads.
// This is the seat's bounded "show me the last N governed rows" road. Pins: loopback-only, limit
// clamping, dedicated signed request, honest skip of found:false rows, fail-closed propagation, and
// the no-authority stamp on every result.
import { describe, it, expect } from 'vitest';
import { recentMemoryKeys, peekRecentMemories } from '../src/memoryRecall';

const OWNER = 'aumara.root';
const respond = (envelope: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(envelope) });

const fakeRecentSigner = async (req: any) => `recentsig:${req.limit}`;
const fakeRecallSigner = async (req: any) => `recallsig:${req.key}`;
const base = () => ({
  url: 'http://127.0.0.1:3210',
  ownerRootId: OWNER,
  adminKeyProvider: () => 'admin-key-x',
  signRecent: fakeRecentSigner,
});

describe('recentMemoryKeys — loopback, envelope, clamping, no authority', () => {
  it('returns newest-first keys from a successful recent query; the clamp rides INSIDE the signed request', async () => {
    let sent: any = null;
    const r = await recentMemoryKeys(99, {
      ...base(),
      fetchImpl: async (_url: string, init: any) => {
        sent = JSON.parse(init.body);
        return respond({ status: 'success', value: { ok: true, hits: [{ key: 'k2', createdAt: 200 }, { key: 'k1', createdAt: 100 }] } });
      },
    });
    expect(r).toMatchObject({ ok: true, advisoryOnly: true, grantsAuthority: false });
    if (r.ok) expect(r.hits).toEqual([{ key: 'k2', createdAt: 200 }, { key: 'k1', createdAt: 100 }]);
    expect(sent.path).toBe('aumlokMemory:aumlokMemoryRecent');
    expect(sent.args.req.limit).toBe(8);
    expect(sent.args.readerSig).toBe('recentsig:8');
  });

  it('refuses a non-loopback backend URL outright (never sends)', async () => {
    let sent = false;
    const r = await recentMemoryKeys(3, {
      ...base(),
      url: 'http://10.0.0.5:3210',
      fetchImpl: async () => { sent = true; return respond({}); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-loopback/);
    expect(sent).toBe(false);
  });
});

function dualFetch(recentEnvelope: unknown, recallByKey: Record<string, unknown>, log?: string[]) {
  return async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (body.path === 'aumlokMemory:aumlokMemoryRecent') { log?.push('recent'); return respond(recentEnvelope); }
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

describe('peekRecentMemories — recent metadata then point reads, honest skips, fail-closed', () => {
  it('reads each recent key back, cites the governed row, and skips found:false rows honestly', async () => {
    const log: string[] = [];
    const r = await peekRecentMemories(3, {
      ...base(),
      signRecall: fakeRecallSigner,
      fetchImpl: dualFetch(
        { status: 'success', value: { ok: true, hits: [{ key: 'k3', createdAt: 300 }, { key: 'k2', createdAt: 200 }, { key: 'k1', createdAt: 100 }] } },
        { k3: found('third'), k2: notFound('erased'), k1: found('first') },
        log,
      ),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hits.map((h) => h.key)).toEqual(['k3', 'k1']);
      expect(r.hits.map((h) => h.rank)).toEqual([1, 3]);
      expect(r.hits[0]).toMatchObject({ citation: `convex:mem:${OWNER}:k3`, createdAt: 300, advisoryOnly: true, grantsAuthority: false });
    }
    expect(log).toEqual(['recent', 'recall:k3', 'recall:k2', 'recall:k1']);
  });

  it('a recent-query refusal fails the whole peek (ok:false) and attempts no point reads', async () => {
    const log: string[] = [];
    const r = await peekRecentMemories(2, {
      ...base(),
      signRecall: fakeRecallSigner,
      fetchImpl: dualFetch({ status: 'success', value: { ok: false, reason: 'reader_pop_invalid' } }, {}, log),
    });
    expect(r.ok).toBe(false);
    expect(log).toEqual(['recent']);
  });
});
