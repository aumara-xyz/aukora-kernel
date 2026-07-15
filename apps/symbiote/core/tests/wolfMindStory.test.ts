// THE STORYTELLER — mind-run receipts rendered as a session story
// (spatial/app/wolf/wolf-mind-story.js). Pins: only PAPER+BACKTEST receipts
// are accepted (a live-trading claim is refused, not prettified), unfinished
// runs are refused, plan stretches fold into rides with their guard breaks,
// harness numbers survive verbatim, and the verdict line always names the
// buy-and-hold benchmark.
import { describe, expect, it } from 'vitest';
import { parseMindReceipts, storyVerdict, parseEpisodicMemory, STORY_SCHEMA } from '../../spatial/app/wolf/wolf-mind-story.js';
import { createWolfMindEnv, WOLF_MODE_LABEL } from '../../spatial/app/wolf/wolf-mind-env.js';

const MODE = WOLF_MODE_LABEL;

function receiptsFor(actions: string[], opts: { mode?: string; withSummary?: boolean } = {}) {
  // Real receipts from the real env — the fixture IS the machinery.
  const mode = opts.mode ?? MODE;
  const env = createWolfMindEnv({ seed: 11, symbol: 'LUM', ticks: 30 });
  let snap = env.reset();
  const lines: string[] = [JSON.stringify({ kind: 'start', runId: 'LUM-s11-test', mode, symbol: 'LUM', seed: 11, ticks: 30, mind: 'test-mind' })];
  let move = 0;
  for (const a of actions) {
    const planned = a.startsWith('plan:');
    snap = env.act(planned ? a.slice(5) : a);
    move++;
    if (planned) {
      lines.push(JSON.stringify({ kind: 'plan_move', move, tick: snap.sessionTick, action: a.slice(5), expect: 'any', ok: true, note: 'any', close: snap.close, equity: snap.equity, state: snap.state }));
    } else {
      lines.push(JSON.stringify({
        kind: 'move', move, mode, tick: snap.sessionTick, action: a, state: snap.state,
        close: snap.close, cash: snap.cash, equity: snap.equity, pnlPct: snap.pnlPct,
        fill: snap.lastFill, whatISee: 'w', delta: 'd', hypothesis: 'h', reason: 'r', prediction: 'p', memo: 'm',
      }));
    }
  }
  if (opts.withSummary !== false) {
    const s = env.close();
    lines.push(JSON.stringify({
      kind: 'summary', runId: 'LUM-s11-test', mode, symbol: 'LUM', seed: 11, state: s.state === 'RUNNING' ? 'SESSION_END' : s.state,
      sessionTicks: s.sessionTicks, moves: move, planMoves: actions.filter((a) => a.startsWith('plan:')).length,
      resets: 0, finalEquity: s.finalEquity, pnlPct: s.pnlPct, maxDrawdownPct: s.maxDrawdownPct,
      trades: s.trades, feesPaid: s.feesPaid, buyHoldPct: s.buyHoldPct, promptTokens: 0, completionTokens: 0,
    }));
  }
  return lines.join('\n');
}

describe('honesty gate — what the storyteller refuses', () => {
  it('refuses receipts that do not declare PAPER + BACKTEST', () => {
    const r = parseMindReceipts(receiptsFor(['ACTION1'], { mode: 'LIVE TRADING · real brokerage' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('REFUSED');
  });

  it('refuses an unfinished run (no summary line)', () => {
    const r = parseMindReceipts(receiptsFor(['ACTION1', 'ACTION2'], { withSummary: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('did not finish');
  });

  it('refuses non-JSONL, empty input, and receipts without moves', () => {
    expect(parseMindReceipts('this is not json').ok).toBe(false);
    expect(parseMindReceipts('').ok).toBe(false);
    const startOnly = JSON.stringify({ kind: 'start', mode: MODE }) + '\n' + JSON.stringify({ kind: 'summary', mode: MODE });
    expect(parseMindReceipts(startOnly).ok).toBe(false);
  });
});

describe('the story — harness numbers verbatim, beats in order', () => {
  it('parses a real run: turns, folded rides, summary numbers', () => {
    const r = parseMindReceipts(receiptsFor(['ACTION1', 'plan:ACTION1', 'plan:ACTION1', 'plan:ACTION1', 'ACTION2', 'plan:ACTION1', 'ACTION5']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.story;
    expect(s.schema).toBe(STORY_SCHEMA);
    expect(s.symbol).toBe('LUM');
    expect(s.modelTurns).toBe(3);
    expect(s.planMoves).toBe(4);
    // beats: turn, ride(3), turn(buy), ride(1), turn(close)
    expect(s.beats.map((b: any) => b.kind)).toEqual(['turn', 'ride', 'turn', 'ride', 'turn']);
    expect((s.beats[1] as any).steps).toBe(3);
    // the buy turn carries its fill with the fee — harness truth rides along
    const buy = s.beats[2] as any;
    expect(buy.action).toBe('ACTION2');
    expect(buy.fill.kind).toBe('buy');
    expect(buy.fill.fee).toBeGreaterThan(0);
    // equity series covers every executed move
    expect(s.equitySeries.length).toBe(7);
  });

  it('a broken guard is preserved on the ride', () => {
    const env = createWolfMindEnv({ seed: 11, symbol: 'LUM', ticks: 10 });
    let snap = env.reset();
    snap = env.act('ACTION1');
    const lines = [
      JSON.stringify({ kind: 'start', runId: 'x', mode: MODE, mind: 'm' }),
      JSON.stringify({ kind: 'move', move: 1, mode: MODE, tick: 1, action: 'ACTION1', state: 'RUNNING', close: snap.close, equity: snap.equity, pnlPct: 0, whatISee: '', delta: '', hypothesis: '', reason: '', prediction: '', memo: '' }),
      JSON.stringify({ kind: 'plan_move', move: 2, tick: 2, action: 'ACTION1', expect: 'price>9999', ok: false, note: 'wanted price>9999, close 32.1', close: 32.1, equity: snap.equity, state: 'RUNNING' }),
      JSON.stringify({ kind: 'summary', runId: 'x', mode: MODE, symbol: 'LUM', seed: 11, state: 'SESSION_END', sessionTicks: 2, moves: 2, planMoves: 1, resets: 0, finalEquity: 10000, pnlPct: 0, maxDrawdownPct: 0, trades: 0, feesPaid: 0, buyHoldPct: 1, promptTokens: 0, completionTokens: 0 }),
    ].join('\n');
    const r = parseMindReceipts(lines);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ride = r.story.beats.find((b: any) => b.kind === 'ride') as any;
    expect(ride.broken).not.toBeNull();
    expect(ride.broken.expect).toBe('price>9999');
  });

  it('the verdict always names the benchmark and never brags', () => {
    const r = parseMindReceipts(receiptsFor(['ACTION1', 'ACTION1']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = storyVerdict(r.story);
    expect(v).toContain('buy-and-hold');
    expect(v).toMatch(/ahead of|behind/);
    expect(v).toContain('drawdown');
    expect(v).toContain('fees');
  });

  it('the mind\'s words are carried as words — capped, never re-derived into claims', () => {
    const r = parseMindReceipts(receiptsFor(['ACTION2']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const turn = r.story.beats[0] as any;
    expect(turn.hypothesis).toBe('h');
    expect(turn.prediction).toBe('p');
    // no derived "accuracy" or "win-rate of predictions" fields exist —
    // free-text predictions cannot be machine-graded, so the story must not
    // pretend to grade them
    expect('predictionAccuracy' in r.story).toBe(false);
    expect('winRate' in r.story).toBe(false);
  });
});

describe('the learning curve — memorization flagged, never blended with generalization', () => {
  const entry = (seed: number, pnl: number, extra: object = {}) => ({
    at: '2026-07-10T12:00:00.000Z', runId: `LUM-s${seed}-x`, seed, ticks: 40,
    state: 'SESSION_END', pnlPct: pnl, maxDrawdownPct: 1, trades: 3,
    memo: 'BACKTEST/SIM lesson', mode: MODE, ...extra,
  });

  it('a repeated seed is flagged SAME TAPE; a fresh seed is not', () => {
    const r = parseEpisodicMemory(JSON.stringify({ symbol: 'LUM', entries: [entry(11, -0.49), entry(11, 1.2), entry(12, 0.3)] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.curve.sessions.map((s: any) => s.sameTape)).toEqual([false, true, false]);
  });

  it('refuses entries that do not declare PAPER + BACKTEST', () => {
    const r = parseEpisodicMemory(JSON.stringify({ symbol: 'LUM', entries: [entry(11, 0, { mode: 'LIVE' })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('REFUSED');
  });

  it('refuses non-files and empty files', () => {
    expect(parseEpisodicMemory('[]').ok).toBe(false);
    expect(parseEpisodicMemory('{"entries": []}').ok).toBe(false);
    expect(parseEpisodicMemory('not json').ok).toBe(false);
  });

  it('run receipts (JSONL) are NOT mistaken for an episodic file', () => {
    const r = parseEpisodicMemory(receiptsFor(['ACTION1']));
    expect(r.ok).toBe(false);
  });
});
