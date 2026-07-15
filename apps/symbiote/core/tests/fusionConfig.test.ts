import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveFusionCouncil, evaluateFusionQuorum } from '../src/fusionConfig';
import { defaultCouncil, knownCouncil } from '../src/aukoraFuEngine';

// Issue #34: council roster selection via AUKORA_FUSION_MODELS — a pure filter over a KNOWN selectable
// roster that FAILS CLOSED on an all-unknown override (never silently fires the full default council — the
// spend footgun), and never returns an empty council on the ok path.

const DEFAULT = [
  { slug: 'deepseek/deepseek-v4-pro', id: 'DSK' },
  { slug: 'qwen/qwen3.7-max', id: 'QWN' },
  { slug: 'z-ai/glm-5.2', id: 'GLM' },
];
// The selectable universe is WIDER than the default: an optional member (here 'OPT') is known but not in
// the default active set — proving the two-roster split resolveFusionCouncil now takes.
const KNOWN = [...DEFAULT, { slug: 'anthropic/claude-fable-5', id: 'OPT' }];

let prev: string | undefined;
beforeEach(() => { prev = process.env.AUKORA_FUSION_MODELS; });
afterEach(() => { if (prev === undefined) delete process.env.AUKORA_FUSION_MODELS; else process.env.AUKORA_FUSION_MODELS = prev; });

describe('fusionConfig: resolveFusionCouncil (fail-closed filter)', () => {
  it('no env override → the default roster runs (default behavior unchanged), source=default', () => {
    delete process.env.AUKORA_FUSION_MODELS;
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('default');
    expect(r.council).toEqual(DEFAULT);
  });

  it('empty / whitespace-only env → the default roster (never an empty council)', () => {
    process.env.AUKORA_FUSION_MODELS = '   ';
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.council).toEqual(DEFAULT);
  });

  it('filters to exactly the requested slugs, preserving env order, source=env-selected', () => {
    process.env.AUKORA_FUSION_MODELS = 'z-ai/glm-5.2,deepseek/deepseek-v4-pro';
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('env-selected');
    expect(r.council.map((m) => m.id)).toEqual(['GLM', 'DSK']);
  });

  it('tolerates whitespace around comma-separated slugs', () => {
    process.env.AUKORA_FUSION_MODELS = ' deepseek/deepseek-v4-pro , qwen/qwen3.7-max ';
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok && r.council.map((m) => m.id)).toEqual(['DSK', 'QWN']);
  });

  it('mixed known + unknown drops the unknown and keeps the lean known roster', () => {
    process.env.AUKORA_FUSION_MODELS = 'deepseek/deepseek-v4-pro,totally/made-up-model';
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.council.map((m) => m.id)).toEqual(['DSK']);
  });

  it('can select a member that is KNOWN but NOT in the default roster (the two-roster split)', () => {
    process.env.AUKORA_FUSION_MODELS = 'anthropic/claude-fable-5';
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.council.map((m) => m.id)).toEqual(['OPT']); // one member, from the KNOWN (not default) set
  });

  it('FAILS CLOSED when every requested slug is unknown — does NOT return the full default council', () => {
    process.env.AUKORA_FUSION_MODELS = 'nonexistent/model-one,nonexistent/model-two';
    const r = resolveFusionCouncil(DEFAULT, KNOWN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/unknown/i);
    expect(r.requested).toEqual(['nonexistent/model-one', 'nonexistent/model-two']);
    // the footgun: the previous version returned [...DEFAULT] here. The result carries no council at all.
    expect((r as { council?: unknown }).council).toBeUndefined();
  });

  it('a pathologically empty default roster fails closed too (never an empty ok council)', () => {
    delete process.env.AUKORA_FUSION_MODELS;
    const r = resolveFusionCouncil([], KNOWN);
    expect(r.ok).toBe(false);
  });
});

describe('fusionConfig: Fable registration on the REAL rosters (issue #34)', () => {
  const FABLE = 'anthropic/claude-fable-5';

  it('Fable is NOT in defaultCouncil() — default behavior unchanged (still the original 5)', () => {
    expect(defaultCouncil().some((m) => m.slug === FABLE)).toBe(false);
    expect(defaultCouncil()).toHaveLength(5);
  });

  it('Fable IS a known/selectable council member', () => {
    expect(knownCouncil().some((m) => m.slug === FABLE)).toBe(true);
  });

  it('Fable-only env resolves to a lean one-member council', () => {
    process.env.AUKORA_FUSION_MODELS = FABLE;
    const r = resolveFusionCouncil(defaultCouncil(), knownCouncil());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.council.map((m) => m.slug)).toEqual([FABLE]);
  });

  it('mixed Fable + unknown drops the unknown and keeps Fable', () => {
    process.env.AUKORA_FUSION_MODELS = `${FABLE},totally/made-up-model`;
    const r = resolveFusionCouncil(defaultCouncil(), knownCouncil());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.council.map((m) => m.slug)).toEqual([FABLE]);
  });

  it('the recommended lean 3-member Fable-inclusive roster resolves in order', () => {
    process.env.AUKORA_FUSION_MODELS = `${FABLE},z-ai/glm-5.2,deepseek/deepseek-v4-pro`;
    const r = resolveFusionCouncil(defaultCouncil(), knownCouncil());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.council.map((m) => m.slug)).toEqual([FABLE, 'z-ai/glm-5.2', 'deepseek/deepseek-v4-pro']);
  });

  it('unknown-only (e.g. a typo) fails closed and does NOT fire the full default council', () => {
    process.env.AUKORA_FUSION_MODELS = 'anthropic/claude-fabel-5'; // deliberate typo
    const r = resolveFusionCouncil(defaultCouncil(), knownCouncil());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/unknown/i);
    expect((r as { council?: unknown }).council).toBeUndefined();
  });
});

describe('fusionConfig: evaluateFusionQuorum is division-safe on an empty council', () => {
  it('empty results → NO_QUORUM with zeroed, non-NaN vote counts (no divide-by-zero)', () => {
    const q = evaluateFusionQuorum([]);
    expect(q.status).toBe('NO_QUORUM');
    for (const v of [q.completedVotes, q.nonVotes, q.redVotes, q.greenVotes, q.yellowVotes, q.completedCount, q.failureCount, q.totalCount]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });
});
