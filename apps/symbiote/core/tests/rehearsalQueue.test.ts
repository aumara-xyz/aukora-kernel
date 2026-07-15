// Rehearsal-queue PLANNER (rehearsalQueue.ts). The pure downstream of Auma's rehearse_intent enqueue tool:
// reads the on-disk queue (`{ ...GovernedWorkOrderV1, intentId }`), fail-closed per file, and plans which
// rehearsals to run — deterministically, riskiest-ring first — WITHOUT running or applying anything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRehearsalQueue, planRehearsals, type QueuedOrder } from '../src/rehearsalQueue';
import { buildWorkOrder, type Ring } from '../src/governedWorkOrder';

let dir: string;
const HEX = (n: number) => String(n).padStart(64, '0'); // deterministic 64-hex intent ids for tests
const NOW = '2026-07-06T00:00:00.000Z';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-rehearsal-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Build the EXACT on-disk shape the rehearse tool writes: a governed work order + an appended intentId,
// classified to a chosen ring via the ring override (avoids depending on the live repo's ring-table).
function writeOrder(opts: { goal: string; ring: Ring; intentId: string; now?: string }): string {
  const order = buildWorkOrder({
    goal: opts.goal,
    requestedBy: 'auma',
    targetPaths: ['docs/NOTE.md'],
    ring: opts.ring,
    now: opts.now ?? NOW,
  });
  const filePath = path.join(dir, `${order.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ ...order, intentId: opts.intentId }, null, 2));
  return filePath;
}

describe('readRehearsalQueue: reading the on-disk queue (fail-closed per file)', () => {
  it('a missing dir is an EMPTY queue, not an error', () => {
    const { orders, skipped } = readRehearsalQueue(path.join(dir, 'does-not-exist'));
    expect(orders).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('reads a well-formed order + its appended intentId (the exact rehearse-tool shape)', () => {
    writeOrder({ goal: 'rehearse docs note', ring: 3, intentId: HEX(1) });
    const { orders, skipped } = readRehearsalQueue(dir);
    expect(skipped).toEqual([]);
    expect(orders.length).toBe(1);
    expect(orders[0].intentId).toBe(HEX(1));
    expect(orders[0].ring).toBe(3);
    expect(orders[0].order.advisoryOnly).toBe(true);
    expect(orders[0].order.grantsAuthority).toBe(false);
    expect(orders[0].order.canApplyNow).toBe(false);
  });

  it('separates the writer-appended intentId from the core order — an order WITHOUT the extra key would fail validation, WITH it must still read', () => {
    // Regression guard: validateWorkOrder rejects unknown keys, so the reader MUST strip intentId before
    // validating. If it validated the whole parsed object, the appended intentId would sink every order.
    writeOrder({ goal: 'g', ring: 2, intentId: HEX(2) });
    const { orders, skipped } = readRehearsalQueue(dir);
    expect(skipped).toEqual([]);
    expect(orders.length).toBe(1);
  });

  it('skips invalid JSON, non-objects, and non-.json files without throwing or dropping the good ones', () => {
    writeOrder({ goal: 'good one', ring: 4, intentId: HEX(3) });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    fs.writeFileSync(path.join(dir, 'array.json'), '[1,2,3]');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored — not .json');
    const { orders, skipped } = readRehearsalQueue(dir);
    expect(orders.length).toBe(1);
    expect(orders[0].intentId).toBe(HEX(3));
    const skippedFiles = skipped.map((s) => s.file).sort();
    expect(skippedFiles).toEqual(['array.json', 'broken.json']);
    expect(skipped.find((s) => s.file === 'broken.json')!.reason).toContain('JSON');
  });

  it('skips a TAMPERED order (flipped grantsAuthority) — validateWorkOrder rejects it, it never becomes plannable', () => {
    const order = buildWorkOrder({ goal: 'tampered', requestedBy: 'auma', targetPaths: ['docs/NOTE.md'], ring: 3, now: NOW });
    const tampered = { ...order, grantsAuthority: true, intentId: HEX(4) };
    fs.writeFileSync(path.join(dir, `${order.id}.json`), JSON.stringify(tampered, null, 2));
    const { orders, skipped } = readRehearsalQueue(dir);
    expect(orders).toEqual([]);
    expect(skipped.length).toBe(1);
    expect(skipped[0].reason).toContain('invalid work order');
  });

  it('skips an order whose intentId is missing or not a 64-hex hash (no command could be built)', () => {
    const order = buildWorkOrder({ goal: 'no id', requestedBy: 'auma', targetPaths: ['docs/NOTE.md'], ring: 3, now: NOW });
    // A traversal string dressed up as an intent id must NEVER pass — the command is built from this value.
    fs.writeFileSync(path.join(dir, `${order.id}.json`), JSON.stringify({ ...order, intentId: '../../etc/passwd' }, null, 2));
    const order2 = buildWorkOrder({ goal: 'no id 2', requestedBy: 'auma', targetPaths: ['docs/NOTE.md'], ring: 3, now: '2026-07-06T01:00:00.000Z' });
    fs.writeFileSync(path.join(dir, `${order2.id}.json`), JSON.stringify(order2, null, 2)); // no intentId at all
    const { orders, skipped } = readRehearsalQueue(dir);
    expect(orders).toEqual([]);
    expect(skipped.length).toBe(2);
    expect(skipped.every((s) => s.reason.includes('intentId'))).toBe(true);
  });
});

describe('planRehearsals: pure deterministic planning (grants nothing, runs nothing)', () => {
  const mk = (id: string, ring: Ring, intentId: string): QueuedOrder => {
    const order = buildWorkOrder({ goal: `goal-${id}`, requestedBy: 'auma', targetPaths: ['docs/NOTE.md'], ring, now: NOW });
    return { file: `${order.id}.json`, order, intentId, ring };
  };

  it('the plan is advisory and grants nothing', () => {
    const plan = planRehearsals([mk('a', 3, HEX(1))], { maxPerRun: 5 });
    expect(plan.advisoryOnly).toBe(true);
    expect(plan.grantsAuthority).toBe(false);
  });

  it('each planned item carries the EXACT executor command built from its intentId', () => {
    const plan = planRehearsals([mk('a', 3, HEX(7))], { maxPerRun: 5 });
    expect(plan.planned.length).toBe(1);
    expect(plan.planned[0].command).toBe(`run: --from-proposal ${HEX(7)}`);
    expect(plan.planned[0].intentId).toBe(HEX(7));
  });

  it('selects riskiest (lowest ring) first, ties broken stably by order id — deterministic', () => {
    const orders = [mk('a', 4, HEX(1)), mk('b', 0, HEX(2)), mk('c', 2, HEX(3)), mk('d', 0, HEX(4))];
    const plan = planRehearsals(orders, { maxPerRun: 10 });
    const rings = plan.planned.map((p) => p.ring);
    expect(rings).toEqual([0, 0, 2, 4]); // ring 0 first, then 2, then 4
    // both ring-0 items come first, ordered stably by their (deterministic) order id
    const firstTwoIds = plan.planned.slice(0, 2).map((p) => p.orderId);
    expect(firstTwoIds).toEqual([...firstTwoIds].sort());
    // running it again yields the identical plan (no nondeterminism)
    const again = planRehearsals(orders, { maxPerRun: 10 });
    expect(again.planned.map((p) => p.orderId)).toEqual(plan.planned.map((p) => p.orderId));
  });

  it('caps at maxPerRun; the rest go to deferred (never dropped)', () => {
    const orders = [mk('a', 3, HEX(1)), mk('b', 3, HEX(2)), mk('c', 3, HEX(3))];
    const plan = planRehearsals(orders, { maxPerRun: 2 });
    expect(plan.planned.length).toBe(2);
    expect(plan.deferred.length).toBe(1);
    // every input order is accounted for — nothing vanishes
    const total = plan.planned.length + plan.deferred.length;
    expect(total).toBe(orders.length);
  });

  it('ringCeiling EXCLUDES riskier-than-ceiling orders (lower ring number = higher risk) — deferred, not planned', () => {
    const orders = [mk('a', 0, HEX(1)), mk('b', 1, HEX(2)), mk('c', 2, HEX(3)), mk('d', 3, HEX(4))];
    const plan = planRehearsals(orders, { maxPerRun: 10, ringCeiling: 2 });
    // ceiling 2 keeps ring >= 2; ring 0 and ring 1 (riskier) are deferred
    expect(plan.planned.map((p) => p.ring).sort()).toEqual([2, 3]);
    const deferredRings = plan.deferred.map((o) => o.ring).sort();
    expect(deferredRings).toEqual([0, 1]);
  });

  it('fail-closed: a non-finite / negative maxPerRun plans NOTHING (never "all")', () => {
    const orders = [mk('a', 3, HEX(1)), mk('b', 3, HEX(2))];
    expect(planRehearsals(orders, { maxPerRun: 0 }).planned.length).toBe(0);
    expect(planRehearsals(orders, { maxPerRun: -1 }).planned.length).toBe(0);
    expect(planRehearsals(orders, { maxPerRun: NaN }).planned.length).toBe(0);
    // deferred still holds all of them — nothing is dropped even when nothing is planned
    expect(planRehearsals(orders, { maxPerRun: 0 }).deferred.length).toBe(2);
  });

  it('an empty queue plans nothing and defers nothing', () => {
    const plan = planRehearsals([], { maxPerRun: 5 });
    expect(plan.planned).toEqual([]);
    expect(plan.deferred).toEqual([]);
  });
});

describe('rehearsalQueue: read → plan end-to-end (pure, no execution)', () => {
  it('reads the on-disk queue and plans it, producing runnable commands and NO authority', () => {
    writeOrder({ goal: 'ring 3 doc', ring: 3, intentId: HEX(11), now: NOW });
    writeOrder({ goal: 'ring 0 gate', ring: 0, intentId: HEX(12), now: '2026-07-06T02:00:00.000Z' });
    const { orders, skipped } = readRehearsalQueue(dir);
    expect(skipped).toEqual([]);
    expect(orders.length).toBe(2);
    const plan = planRehearsals(orders, { maxPerRun: 1 });
    // riskiest first: the ring-0 order is the one chosen when only one slot exists
    expect(plan.planned.length).toBe(1);
    expect(plan.planned[0].ring).toBe(0);
    expect(plan.planned[0].command).toBe(`run: --from-proposal ${HEX(12)}`);
    expect(plan.deferred.length).toBe(1);
    expect(plan.grantsAuthority).toBe(false);
  });
});

// ── Brick 3.2 (the seamless loop): the bounded retry ladder ─────────────────────────────────────
// A lineage may rehearse 3 attempts; attempt 4 locks and escalates. Locking is the planner REFUSING
// to plan — receipted, never silent, never authority. Without lineage data the ladder cannot bite.
import { DEFAULT_MAX_ATTEMPTS_PER_LINEAGE } from '../src/rehearsalQueue';

describe('bounded retry ladder (Brick 3.2)', () => {
  const mkQ = (id: string, ring: Ring, intentId: string): QueuedOrder => {
    const order = buildWorkOrder({ goal: `goal-${id}`, requestedBy: 'auma', targetPaths: ['docs/NOTE.md'], ring, now: NOW });
    return { file: `${order.id}.json`, order, intentId, ring };
  };
  const idA = 'a'.repeat(64);
  const idB = 'b'.repeat(64);

  it('the ladder default is 3 rungs', () => {
    expect(DEFAULT_MAX_ATTEMPTS_PER_LINEAGE).toBe(3);
  });

  it('attempt 3 still plans; attempt 4 locks with attempt count and a plain reason', () => {
    const orders = [mkQ('x', 3, idA), mkQ('y', 3, idB)];
    const attempts: Record<string, number> = { [idA]: 3, [idB]: 4 };
    const plan = planRehearsals(orders, { maxPerRun: 10, attemptOf: (id) => attempts[id] });
    expect(plan.planned.map((p) => p.intentId)).toEqual([idA]);
    expect(plan.locked).toHaveLength(1);
    expect(plan.locked[0].order.intentId).toBe(idB);
    expect(plan.locked[0].attempt).toBe(4);
    expect(plan.locked[0].reason).toContain('escalated to the owner');
    expect(plan.deferred).toHaveLength(0); // locked is its own surface — not deferral
  });

  it('no attemptOf resolver → legacy behavior, nothing locks', () => {
    const plan = planRehearsals([mkQ('x', 3, idA)], { maxPerRun: 10 });
    expect(plan.locked).toEqual([]);
    expect(plan.planned).toHaveLength(1);
  });

  it('a THROWING resolver locks that order fail-closed instead of planning it', () => {
    const plan = planRehearsals([mkQ('x', 3, idA)], {
      maxPerRun: 10,
      attemptOf: () => { throw new Error('archive unreadable'); },
    });
    expect(plan.planned).toHaveLength(0);
    expect(plan.locked).toHaveLength(1);
    expect(plan.locked[0].reason).toContain('fail-closed');
  });

  it('a custom ladder height is honored; a nonsensical one falls back to 3, never to unlimited', () => {
    const two = planRehearsals([mkQ('x', 3, idA)], { maxPerRun: 10, maxAttemptsPerLineage: 1, attemptOf: () => 2 });
    expect(two.locked).toHaveLength(1);
    const nonsense = planRehearsals([mkQ('x', 3, idA)], { maxPerRun: 10, maxAttemptsPerLineage: 0, attemptOf: () => 4 });
    expect(nonsense.locked).toHaveLength(1); // 0 → default 3 → attempt 4 locks
    const nonsense2 = planRehearsals([mkQ('x', 3, idA)], { maxPerRun: 10, maxAttemptsPerLineage: Number.NaN, attemptOf: () => 3 });
    expect(nonsense2.planned).toHaveLength(1); // NaN → default 3 → attempt 3 plans
  });

  it('a garbage attempt number (NaN, 0, negative) is treated as attempt 1 — a first draft, plannable', () => {
    const plan = planRehearsals([mkQ('x', 3, idA)], { maxPerRun: 10, attemptOf: () => Number.NaN });
    expect(plan.planned).toHaveLength(1);
    expect(plan.locked).toEqual([]);
  });

  it('ceiling-excluded orders defer without consulting the ladder (still never dropped)', () => {
    const plan = planRehearsals([mkQ('x', 0, idA)], { maxPerRun: 10, ringCeiling: 2, attemptOf: () => 99 });
    expect(plan.deferred).toHaveLength(1);
    expect(plan.locked).toEqual([]);
  });
});
