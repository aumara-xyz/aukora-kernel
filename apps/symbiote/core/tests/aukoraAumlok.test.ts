import { describe, it, expect } from 'vitest';
import { generate, generatorMinEntropy, ownBitsEstimate, isPlaceholder } from '../../authority/aumlok/ceremony';
import { classifyRisk } from '../../authority/gate/risk';

// 24Z.70c — AUMLOK ceremony unit checks (pure logic; CLI/IO is proven separately end-to-end).
describe('24Z.70c — AUMLOK ceremony', () => {
  it('generate() yields a valid 7-word acrostic (word1 = 6 letters = first letters of words 2..7)', () => {
    for (let i = 0; i < 20; i++) {
      const { phrase } = generate();
      const w = phrase.split(' ');
      expect(w.length).toBe(7);
      expect(w[0].length).toBe(6);
      expect(w.slice(1).map((x) => x[0]).join('')).toBe(w[0]); // the acrostic holds
    }
  });

  it('generated entropy is the HONEST min-entropy, at-or-above the refusal floor (Codex fix)', () => {
    const floor = 30;
    expect(generatorMinEntropy()).toBeGreaterThanOrEqual(floor); // generated is never weaker than custom-refusal floor
    expect(generate().bits).toBe(generatorMinEntropy());          // reports the guaranteed min-entropy, not an inflated per-draw
    expect(generatorMinEntropy()).toBeLessThan(48);               // honest: modest wordlist cannot be "strong" — that's Step 4
  });

  it('NO best-of-N collapse: anchors are UNIFORM (no single anchor dominates)', () => {
    const counts: Record<string, number> = {};
    const N = 3000;
    for (let i = 0; i < N; i++) { const a = generate().phrase.split(' ')[0]; counts[a] = (counts[a] || 0) + 1; }
    const distinct = Object.keys(counts).length;
    const maxFreq = Math.max(...Object.values(counts)) / N;
    expect(distinct).toBeGreaterThan(20);   // many anchors appear (not just "pebble")
    expect(maxFreq).toBeLessThan(0.10);      // no anchor wins ~96% of the time anymore
  });

  it('ownBitsEstimate refuses-tier for weak, higher for strong; penalizes repeats + acrostic correlation', () => {
    expect(ownBitsEstimate('cat cat cat').bits).toBeLessThan(30);              // weak → below the refuse floor
    expect(ownBitsEstimate('meadow maple ember azure dance owlet willow').bits).toBeGreaterThan(45);
    const rep = ownBitsEstimate('apple apple apple apple');
    expect(rep.notes.some((n) => /repeated/.test(n))).toBe(true);
  });

  it('isPlaceholder true for the shipped default, false once configured', () => {
    expect(isPlaceholder({ approvalKeyHash: '00', note: 'replace this hash with sha256 of your own phrase' })).toBe(true);
    expect(isPlaceholder({})).toBe(true); // no hash = unconfigured
    expect(isPlaceholder({ approvalKeyHash: 'abc123', mode: 'generated' })).toBe(false);
  });

  it('the ceremony code + keyfile are self-protected (governed edit → high-risk)', () => {
    expect(classifyRisk({ paths: ['aukora-ide/aumlok/ceremony.ts'], addedContent: '+weaken' }).risk).toBe('high');
    expect(classifyRisk({ paths: ['.aukora/aumlok-dev.json'], addedContent: '+forge hash' }).risk).toBe('high');
  });
});
