import { describe, expect, it } from 'vitest';
import {
  distillConversation,
  distillGrantsAuthority,
  type ConversationTurn,
  type DistillResult,
} from '../src/conversationDistiller';

// Narrow the tagged union to the ok:true branch for the happy-path assertions.
function ok(r: DistillResult) {
  if (!r.ok) throw new Error(`expected ok result, got refusal: ${r.reason}`);
  return r;
}

describe('conversationDistiller: advisory flags (never grants authority)', () => {
  it('every result and every atom is advisoryOnly:true / grantsAuthority:false', () => {
    const r = distillConversation([
      { role: 'owner', text: 'We decided to ship the read-path resolver on Thursday.' },
    ]);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
    const good = ok(r);
    expect(good.atoms.length).toBe(1);
    for (const a of good.atoms) {
      expect(a.advisoryOnly).toBe(true);
      expect(a.grantsAuthority).toBe(false);
    }
    expect(distillGrantsAuthority(r)).toBe(false);
    // a refusal carries the flags too
    const bad = distillConversation(null as unknown as ConversationTurn[]);
    expect(bad.advisoryOnly).toBe(true);
    expect(bad.grantsAuthority).toBe(false);
  });
});

describe('conversationDistiller: law 1 — hedge preservation (never launder uncertainty)', () => {
  const hedgedPhrasings = [
    'maybe we should move the gate',
    'I think the resolver might be leaking',
    "I'm not sure the pin is fresh",
    'possibly the receipt chain forked',
    'it seems the door is stale',
  ];

  it('a hedged source always yields a hedged atom (marker retained or re-applied)', () => {
    for (const text of hedgedPhrasings) {
      const good = ok(distillConversation([{ role: 'owner', text }]));
      expect(good.atoms.length, text).toBe(1);
      expect(good.atoms[0].hedged, text).toBe(true);
      // the produced summary must itself read as hedged — never a bare assertion
      expect(/\b(maybe|might|think|not sure|possibly|seems?|\[hedged\])/i.test(good.atoms[0].text), text).toBe(true);
    }
  });

  it('re-applies a [hedged] marker when truncation would strip the only hedge from the tail', () => {
    // hedge lives at the END; the 280-char cap drops it → distiller must re-mark, not harden.
    const filler = 'the migration preflight walked every tracked directory and re-pinned the ring table '.repeat(6);
    const text = `${filler} but maybe that is wrong`;
    const good = ok(distillConversation([{ role: 'owner', text }]));
    const atom = good.atoms[0];
    expect(atom.truncated).toBe(true);
    expect(atom.hedged).toBe(true);
    expect(atom.text.startsWith('[hedged] ')).toBe(true);
    expect(atom.text.length).toBeLessThanOrEqual(280); // law 2 still holds with the marker on
  });

  it('a non-hedged assertion is NOT marked hedged (no false uncertainty added)', () => {
    const good = ok(distillConversation([{ role: 'owner', text: 'The gate is closed and the pin is 8294e2.' }]));
    expect(good.atoms[0].hedged).toBe(false);
    expect(good.atoms[0].text.startsWith('[hedged]')).toBe(false);
  });
});

describe('conversationDistiller: law 2 — summary only, never a raw transcript', () => {
  it('caps every atom at 280 chars and collapses whitespace', () => {
    const long = 'alpha '.repeat(200); // ~1200 chars of real words
    const good = ok(distillConversation([{ role: 'owner', text: long }]));
    const atom = good.atoms[0];
    expect(atom.text.length).toBeLessThanOrEqual(280);
    expect(atom.truncated).toBe(true);
    expect(atom.text).not.toContain('  '); // whitespace collapsed
    expect(atom.text.trim()).toBe(atom.text); // no leading/trailing whitespace
  });

  it('collapses tabs/newlines/runs even when the turn fits under the cap', () => {
    const good = ok(distillConversation([{ role: 'owner', text: 'we\t decided\n\n  to   block   the   change' }]));
    expect(good.atoms[0].text).toBe('we decided to block the change');
    expect(good.atoms[0].truncated).toBe(false);
  });
});

describe('conversationDistiller: law 3 — forbidden-content HARD FAIL (fail closed)', () => {
  it('refuses (drops) an atom whose summary carries a secret-shaped value, keeping the safe atoms', () => {
    const secret = 'sk-' + 'A1b2C3d4E5f6G7h8'; // matches FORBIDDEN_VALUE_RE (\bsk-[A-Za-z0-9]{12,})
    const good = ok(distillConversation([
      { role: 'owner', text: `here is the api key ${secret} keep it` },
      { role: 'owner', text: 'and we decided to ship the safe change' },
    ]));
    // the secret-bearing atom is refused; only the safe one survives
    expect(good.atoms.length).toBe(1);
    expect(good.atoms.every((a) => !a.text.includes('sk-'))).toBe(true);
    expect(good.atoms[0].text).toContain('safe change');
  });

  it('refuses a summary containing a 64+ hex run (secret-shaped) and a PEM header', () => {
    const hex = 'a'.repeat(64);
    const r1 = ok(distillConversation([{ role: 'owner', text: `the digest is ${hex} noted` }]));
    expect(r1.atoms.length).toBe(0); // the only candidate was forbidden → dropped, empty (valid) result
    const r2 = ok(distillConversation([{ role: 'owner', text: '-----BEGIN PRIVATE KEY----- leaked here somehow' }]));
    expect(r2.atoms.length).toBe(0);
  });
});

describe('conversationDistiller: law 4 — deterministic scope-aware ranking', () => {
  it('owner + decision turns outrank auma small talk, and the order is stable', () => {
    const turns: ConversationTurn[] = [
      { role: 'auma', text: 'good morning, the weather feels calm today over here' },
      { role: 'owner', text: 'We decided to ratify the ring-1 write boundary promotion.' },
      { role: 'system', text: 'session started, transport bound to loopback only here' },
      { role: 'auma', text: 'I noticed the resolver confines to the caller-supplied root now' },
    ];
    const good = ok(distillConversation(turns));
    expect(good.atoms[0].role).toBe('owner'); // owner + decision cue → top
    // ranks are monotonically non-increasing (sorted)
    for (let i = 1; i < good.atoms.length; i++) {
      expect(good.atoms[i - 1].rank).toBeGreaterThanOrEqual(good.atoms[i].rank);
    }
  });

  it('is fully deterministic: identical input yields byte-identical atoms', () => {
    const turns: ConversationTurn[] = [
      { role: 'owner', text: 'maybe we should block the change', at: '2026-07-06T00:00:00Z' },
      { role: 'auma', text: 'I think that seems reasonable to hold for now' },
      { role: 'system', text: 'the loopback door restarted with updated env flags' },
    ];
    expect(JSON.stringify(distillConversation(turns))).toBe(JSON.stringify(distillConversation(turns)));
  });

  it('honors maxAtoms (highest-ranked kept) and minChars (small talk floor)', () => {
    const turns: ConversationTurn[] = [
      { role: 'owner', text: 'We decided A is the plan and we will ship it.' },
      { role: 'owner', text: 'We also decided B is blocked until the gate is green.' },
      { role: 'auma', text: 'ok' }, // below the default minChars floor → dropped as small talk
    ];
    const good = ok(distillConversation(turns, { maxAtoms: 1 }));
    expect(good.atoms.length).toBe(1);
    // the "ok" turn is never present regardless of cap
    const all = ok(distillConversation(turns, { maxAtoms: 10 }));
    expect(all.atoms.length).toBe(2);
    expect(all.atoms.some((a) => a.text === 'ok')).toBe(false);
  });
});

describe('conversationDistiller: fail-closed on malformed input (typed refusal, never a throw)', () => {
  it('refuses non-array, invalid role, non-string text, and non-string at', () => {
    expect(distillConversation('nope' as unknown as ConversationTurn[]).ok).toBe(false);
    expect(distillConversation([{ role: 'stranger', text: 'x' } as unknown as ConversationTurn]).ok).toBe(false);
    expect(distillConversation([{ role: 'owner', text: 42 } as unknown as ConversationTurn]).ok).toBe(false);
    expect(distillConversation([{ role: 'owner', text: 'ok text here', at: 99 } as unknown as ConversationTurn]).ok).toBe(false);
    expect(distillConversation([null as unknown as ConversationTurn]).ok).toBe(false);
  });

  it('refuses an over-long transcript and an over-long single turn', () => {
    const many = Array.from({ length: 5_001 }, () => ({ role: 'owner' as const, text: 'a real sentence here to keep' }));
    expect(distillConversation(many).ok).toBe(false);
    const huge = { role: 'owner' as const, text: 'z'.repeat(40_001) };
    expect(distillConversation([huge]).ok).toBe(false);
  });

  it('an all-small-talk transcript is a valid EMPTY result, not a refusal', () => {
    const good = ok(distillConversation([
      { role: 'auma', text: 'ok' },
      { role: 'owner', text: '...' },
      { role: 'system', text: '   ' },
    ]));
    expect(good.atoms).toEqual([]);
  });
});

describe('conversationDistiller: adversarial edge cases', () => {
  it('a hedged secret is refused, not laundered into a hedged-but-safe-looking atom', () => {
    // the nightmare: uncertainty markers wrapped around a secret. Law 3 wins — the atom is dropped
    // entirely, never re-emitted as "[hedged] … sk-…" which would look doubly safe.
    const secret = 'sk-' + 'Z9y8X7w6V5u4T3s2';
    const good = ok(distillConversation([{ role: 'owner', text: `maybe the token is ${secret}, not sure` }]));
    expect(good.atoms.length).toBe(0);
  });

  it('a turn that is pure punctuation/whitespace produces no atom (no empty summary)', () => {
    const good = ok(distillConversation([{ role: 'owner', text: '!!! ??? --- ... ,,, ;;;' }]));
    expect(good.atoms.length).toBe(0);
  });

  it('preserves the optional `at` timestamp verbatim on the atom, and omits it when absent', () => {
    const withAt = ok(distillConversation([{ role: 'owner', text: 'we decided to ship it', at: '2026-07-06T12:00:00Z' }]));
    expect(withAt.atoms[0].at).toBe('2026-07-06T12:00:00Z');
    const withoutAt = ok(distillConversation([{ role: 'owner', text: 'we decided to ship it' }]));
    expect('at' in withoutAt.atoms[0]).toBe(false);
  });
});
