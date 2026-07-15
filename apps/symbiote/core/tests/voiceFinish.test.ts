import { describe, it, expect } from 'vitest';
import {
  renderVoiceFinish,
  TOKEN_CAP_MARKER,
  CONTENT_FILTER_PARTIAL_MARKER,
  CONTENT_FILTER_EMPTY_NOTICE,
} from '../../spatial/voiceFinish';

describe('voiceFinish: honest rendering of finish_reason (fixes the short-reply bug)', () => {
  it('normal stop → shows the full text, no marker', () => {
    const r = renderVoiceFinish('Hello, here is my full answer.', 'stop', 4096);
    expect(r.displayText).toBe('Hello, here is my full answer.');
    expect(r.emptyContentFiltered).toBe(false);
    expect(r.diagnostic).toBeUndefined();
  });

  it('length (token cap) → text + still-capped marker + diagnostic', () => {
    const r = renderVoiceFinish('a long reply cut at the cap', 'length', 4096);
    expect(r.displayText).toBe('a long reply cut at the cap' + TOKEN_CAP_MARKER);
    expect(r.diagnostic).toMatch(/finish_reason=length at max_tokens=4096/);
  });

  it('content_filter with PARTIAL text → shows the partial text + an honest "cut short" marker (not a bare fragment)', () => {
    // This is the screenshot case: "The whole-repo" / "...contained secret-shaped".
    const r = renderVoiceFinish('Good — reads are working. One note: my whole-repo search for "convex" got refused because two results contained secret-shaped', 'content_filter', 4096);
    expect(r.displayText).toContain('contained secret-shaped');
    expect(r.displayText).toContain(CONTENT_FILTER_PARTIAL_MARKER.trim());
    expect(r.emptyContentFiltered).toBe(false);
    expect(r.diagnostic).toMatch(/content_filter/);
  });

  it('content_filter with EMPTY text → no text, an honest notice, NOT "unreachable"', () => {
    const r = renderVoiceFinish('', 'content_filter', 4096);
    expect(r.displayText).toBeNull();
    expect(r.emptyContentFiltered).toBe(true);
    expect(r.emptyContentFilterNotice).toBe(CONTENT_FILTER_EMPTY_NOTICE);
    // The honest notice must NOT claim the model is unreachable or the key is bad.
    expect(r.emptyContentFilterNotice).not.toMatch(/unreachable|not reachable|no OpenRouter key/i);
    expect(r.emptyContentFilterNotice).toMatch(/content filter/i);
  });

  it('empty for a non-filter reason → no text, not flagged as content-filtered (caller handles recovery)', () => {
    const r = renderVoiceFinish('', 'stop', 4096);
    expect(r.displayText).toBeNull();
    expect(r.emptyContentFiltered).toBe(false);
    expect(r.emptyContentFilterNotice).toBeUndefined();
  });

  it('whitespace-only content is treated as empty', () => {
    expect(renderVoiceFinish('   \n  ', 'content_filter', 4096).emptyContentFiltered).toBe(true);
    expect(renderVoiceFinish('   \n  ', 'stop', 4096).displayText).toBeNull();
  });

  it('undefined finish_reason with text → shows the text plainly', () => {
    const r = renderVoiceFinish('plain reply', undefined, 4096);
    expect(r.displayText).toBe('plain reply');
    expect(r.diagnostic).toBeUndefined();
  });
});
