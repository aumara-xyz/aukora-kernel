// Issue #61 (deterministic half): conversation-window assembly. Most-recent turns kept verbatim,
// oldest dropped first, elisions surfaced with a visible marker. No summarization (that's spend).
import { describe, it, expect } from 'vitest';
import { windowHistory, renderWindowStatus, type HistoryTurn } from '../../spatial/historyWindow';

function turns(n: number, size = 10): HistoryTurn[] {
  return Array.from({ length: n }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as HistoryTurn['role'], content: `t${i}`.padEnd(size, 'x') }));
}

describe('historyWindow: windowHistory', () => {
  it('keeps everything when under both bounds', () => {
    const r = windowHistory(turns(5), { maxChars: 1_000, maxCount: 40 });
    expect(r.shownCount).toBe(5);
    expect(r.elidedCount).toBe(0);
    expect(r.totalCount).toBe(5);
  });

  it('drops OLDEST first when over the count cap, keeping the most recent', () => {
    const all = turns(10);
    const r = windowHistory(all, { maxChars: 1_000_000, maxCount: 4 });
    expect(r.shownCount).toBe(4);
    expect(r.elidedCount).toBe(6);
    // the kept set is the last 4, in order
    expect(r.sent.map((t) => t.content)).toEqual(all.slice(-4).map((t) => t.content));
  });

  it('drops oldest first when over the CHAR budget', () => {
    // 10 turns × 100 chars = 1000; budget 350 keeps the newest 3 (300 ≤ 350, a 4th would exceed).
    const all = turns(10, 100);
    const r = windowHistory(all, { maxChars: 350, maxCount: 40 });
    expect(r.shownCount).toBe(3);
    expect(r.elidedCount).toBe(7);
    expect(r.sent.map((t) => t.content)).toEqual(all.slice(-3).map((t) => t.content));
  });

  it('always keeps at least the single most-recent turn, even if it alone exceeds the char budget', () => {
    const all = turns(5, 1_000);
    const r = windowHistory(all, { maxChars: 10, maxCount: 40 });
    expect(r.shownCount).toBe(1);
    expect(r.elidedCount).toBe(4);
    expect(r.sent[0].content).toBe(all[all.length - 1].content);
  });

  it('empty history → nothing sent, nothing elided', () => {
    const r = windowHistory([], { maxChars: 1_000, maxCount: 40 });
    expect(r).toEqual({ sent: [], shownCount: 0, elidedCount: 0, totalCount: 0 });
  });
});

describe('historyWindow: renderWindowStatus (visible elision marker)', () => {
  it('empty string when nothing was elided (absence means whole)', () => {
    expect(renderWindowStatus({ sent: [], shownCount: 5, elidedCount: 0, totalCount: 5 })).toBe('');
  });

  it('states shown/total/elided exactly, and tells her to quote it when asked', () => {
    const s = renderWindowStatus({ sent: [], shownCount: 3, elidedCount: 7, totalCount: 10 });
    expect(s).toContain('last 3 of 10');
    expect(s).toContain('7 older turn(s) were elided');
    expect(s).toContain('dropped oldest-first');
    expect(s).toContain('not summarized');
    expect(s).toContain('state this exactly');
  });
});
