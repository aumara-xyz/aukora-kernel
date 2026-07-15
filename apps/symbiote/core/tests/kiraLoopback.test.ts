import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLoopbackSurface, rejectMutation } from '../src/convexBrainReadonly';
import { createEmptyBrain, ingestMemory, saveBrainState } from '../src/kiraBrain';
import {
  createKiraLoopbackServer,
  getKiraHeadPublic,
  kiraLoopbackGrantsAuthority,
} from '../../receiver/kiraLoopback';

function listen(server: http.Server): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('no_port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe('Kira loopback Convex-style read surface', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  function stateFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kira-loopback-'));
    const file = path.join(dir, 'brain.json');
    let state = createEmptyBrain('2026-07-01T00:00:00.000Z');
    state = ingestMemory(state, {
      text: 'Kira recall flows through a Convex-style loopback query and remains advisory.',
      source: 'loopback',
      scope: 'convex',
      tags: ['mega', 'mind', 'readonly'],
      now: '2026-07-01T00:00:01.000Z',
    }).state;
    state = ingestMemory(state, {
      text: 'The glyph perceiver and topology perceiver combine through an interference score.',
      source: 'loopback',
      scope: 'perceiver',
      tags: ['glyph', 'topology', 'interference'],
      now: '2026-07-01T00:00:02.000Z',
    }).state;
    saveBrainState(file, state);
    return file;
  }

  it('serves a public head from the real persisted brain state', () => {
    const file = stateFile();
    const head = getKiraHeadPublic({ statePath: file });
    expect(head).toMatchObject({
      schema: 'AUKORA_KIRA_BRAIN_V1',
      receiptCount: 2,
      atomCount: 2,
      grantsAuthority: false,
      advisoryOnly: true,
    });
    expect(head.lastReceiptHash).not.toBe('genesis');
  });

  it('recalls through the existing Convex read-only receiver path', async () => {
    const file = stateFile();
    const server = createKiraLoopbackServer({ statePath: file });
    const live = await listen(server);
    closers.push(live.close);

    const result = await readLoopbackSurface(
      'kira:recall',
      { url: live.url, timeoutMs: 1000, advisoryOnly: true, grantsAuthority: false },
      { query: 'convex loopback readonly recall', limit: 2 },
    );

    expect(result.source).toBe('convex_loopback');
    expect(result.bridgeMode).toBe('local_loopback_readonly');
    expect(result.grantsAuthority).toBe(false);
    const hits = (result.data?.hits ?? []) as Array<Record<string, unknown>>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].scope).toBe('convex');
    expect(hits[0].grantsAuthority).toBe(false);
  });

  it('issue #8 fix: the wire response never carries verbatim content (supportQuote/evidence stripped, scores/citation kept)', async () => {
    const file = stateFile();
    const server = createKiraLoopbackServer({ statePath: file });
    const live = await listen(server);
    closers.push(live.close);

    const result = await readLoopbackSurface(
      'kira:recall',
      { url: live.url, timeoutMs: 1000, advisoryOnly: true, grantsAuthority: false },
      { query: 'convex loopback readonly recall', limit: 2 },
    );
    const hits = (result.data?.hits ?? []) as Array<Record<string, unknown>>;
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.supportQuote).toBeUndefined(); // verbatim ingested-text excerpt — must not cross the wire
      expect(hit.citation).toBeTypeOf('string'); // the bounded, safe field stays
      expect(typeof hit.interferenceScore).toBe('number');
      expect(typeof hit.consensus).toBe('number');
      const perceivers = hit.perceivers as Array<Record<string, unknown>>;
      expect(perceivers.length).toBeGreaterThan(0);
      for (const p of perceivers) {
        expect(p.evidence).toBeUndefined(); // per-perceiver evidence text — must not cross the wire
        expect(typeof p.score).toBe('number'); // the score itself stays
      }
    }
  });

  it('does not expose mutation authority', async () => {
    expect(kiraLoopbackGrantsAuthority()).toBe(false);
    expect(() => rejectMutation('kira:insert')).toThrow(/refuse_mutation/);

    const file = stateFile();
    const server = createKiraLoopbackServer({ statePath: file });
    const live = await listen(server);
    closers.push(live.close);

    const response = await fetch(`${live.url}/api/mutation`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(body.status).toBe('error');
  });
});
