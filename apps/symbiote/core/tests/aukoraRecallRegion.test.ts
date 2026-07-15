import { describe, it, expect } from 'vitest';
import {
  applyRecallRegion,
  RECALL_BEGIN,
  RECALL_BEGIN_PREFIX,
  RECALL_END,
  EMPTY_BODY,
} from '../../memory/runtime/recallRegion';

// 24Z.82 — the durability invariants Codex required, proven procedurally in 24Z.81 (SIGSTOP :3210, apply re-derive →
// byte-identical), now LIVE in the suite as pure unit tests. applyRecallRegion is the single source of the recall-region
// rule; bootRecall.writeRecallToAgents just fetches the Convex status and writes `text` unless outcome === "preserved".
const BLOCK = '<recalled-memory>\n- favorite_color = teal\n</recalled-memory>';
const withRegion = (body: string, beginMarker = RECALL_BEGIN) =>
  `# AGENTS\n\nsome nav map\n\n## Recalled memory (advisory)\n${beginMarker}\n${body}\n${RECALL_END}\n`;
const countBegins = (s: string) => (s.match(/AUKORA_RECALL:BEGIN/g) ?? []).length;

describe('24Z.82 — recall-region durability (the three Codex invariants)', () => {
  it('INVARIANT 1 — status "down" PRESERVES the text byte-identical (an apply while Convex is down never blanks her)', () => {
    const before = withRegion(BLOCK);
    const { text, outcome } = applyRecallRegion(before, 'down', 'a DIFFERENT block that must NOT be written');
    expect(outcome).toBe('preserved');
    expect(text).toBe(before); // byte-identical — the caller must NOT writeFileSync on "preserved"
  });

  it('INVARIANT 1b — "down" preserves even an empty/garbage block arg (down means: do not touch, full stop)', () => {
    const before = withRegion(BLOCK);
    expect(applyRecallRegion(before, 'down', '').text).toBe(before);
    // and a file with NO region is also left untouched on down (nothing to fabricate)
    const noRegion = '# AGENTS\n\njust a nav map, no recall block\n';
    expect(applyRecallRegion(noRegion, 'down', BLOCK)).toEqual({ text: noRegion, outcome: 'preserved' });
  });

  it('INVARIANT 2 — status "empty" writes the "(no memories)" body (reached Convex, genuinely 0 rows)', () => {
    const { text, outcome } = applyRecallRegion(withRegion(BLOCK), 'empty', '');
    expect(outcome).toBe('empty');
    expect(text).toContain(EMPTY_BODY);
    expect(text).not.toContain('teal');           // the old block is replaced
    expect(countBegins(text)).toBe(1);            // still exactly one block
    expect(text).toContain(RECALL_BEGIN);          // canonical marker
  });

  it('INVARIANT 2b — status "ok" with an empty block is treated as empty (never writes a blank region)', () => {
    expect(applyRecallRegion(withRegion(BLOCK), 'ok', '').outcome).toBe('empty');
    expect(applyRecallRegion(withRegion(BLOCK), 'ok', '').text).toContain(EMPTY_BODY);
  });

  it('INVARIANT 3 — a DRIFTED begin marker is replaced IN-PLACE (prefix match → never a 2nd block)', () => {
    // an old/parenthetical-drifted marker (what bit us in 24Z.81 testing) must NOT spawn a duplicate region
    const drifted = withRegion('OLD CONTENT', '<!-- AUKORA_RECALL:BEGIN (auto) -->');
    expect(drifted).not.toContain(RECALL_BEGIN);   // precondition: the drifted marker is NOT the canonical one
    const { text, outcome } = applyRecallRegion(drifted, 'ok', BLOCK);
    expect(outcome).toBe('wrote');
    expect(countBegins(text)).toBe(1);             // ← exactly ONE block, not two
    expect(text).toContain(RECALL_BEGIN);          // upgraded to the canonical marker
    expect(text).toContain('teal');                // new block content present
    expect(text).not.toContain('OLD CONTENT');     // old content gone
  });

  it('status "ok" replaces the canonical region in place (idempotent single block)', () => {
    const { text, outcome } = applyRecallRegion(withRegion('- favorite_color = old'), 'ok', BLOCK);
    expect(outcome).toBe('wrote');
    expect(countBegins(text)).toBe(1);
    expect(text).toContain('teal');
    expect(text).not.toContain('= old');
  });

  it('no existing region → APPENDS exactly one region under a "Recalled memory" heading', () => {
    const noRegion = '# AGENTS\n\njust a nav map, no recall block yet';
    const { text, outcome } = applyRecallRegion(noRegion, 'ok', BLOCK);
    expect(outcome).toBe('wrote');
    expect(countBegins(text)).toBe(1);
    expect(text.startsWith('# AGENTS')).toBe(true); // original content preserved
    expect(text).toContain('## Recalled memory (advisory)');
    expect(text).toContain(RECALL_END);
  });

  it('malformed markers (END before BEGIN, or BEGIN without END) do not produce a garbled splice (review LOW)', () => {
    // END appears before BEGIN — ei < bi. Must NOT splice garble; append a clean region instead, original text preserved.
    const endBeforeBegin = `# A\n${RECALL_END}\nstray\n${RECALL_BEGIN}\norphan`;
    const r1 = applyRecallRegion(endBeforeBegin, 'ok', BLOCK);
    expect(r1.text.startsWith('# A')).toBe(true);   // original content not corrupted
    expect(r1.text).toContain('teal');               // new block appended
    expect(r1.text.endsWith(`${RECALL_END}\n`)).toBe(true);
    // BEGIN with no END — append, don't crash
    const beginNoEnd = `# A\n${RECALL_BEGIN}\ndangling`;
    expect(() => applyRecallRegion(beginNoEnd, 'ok', BLOCK)).not.toThrow();
    expect(applyRecallRegion(beginNoEnd, 'ok', BLOCK).text).toContain('teal');
  });

  it('markers are exported + consistent (the writer and any external reader agree on the prefix)', () => {
    expect(RECALL_BEGIN.startsWith(RECALL_BEGIN_PREFIX)).toBe(true);
    expect(RECALL_END).toContain('AUKORA_RECALL:END');
  });
});
