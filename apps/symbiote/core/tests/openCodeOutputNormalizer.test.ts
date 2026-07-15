import { describe, it, expect } from 'vitest';
import { scanHiddenChannels, normalizeModelText, parseOpenCodePatch, HiddenChannelError, PatchParseError } from '../src/openCodeOutputNormalizer';

// 24Z.25 — OpenCode output is UNTRUSTED text and a known hidden-channel surface (GLOSSOPETRAE/VK doctrine).
// Fixtures are built from explicit CODE POINTS (not invisible literals) so they survive file encoding.
const cp = (n: number) => String.fromCodePoint(n);
const cleanPatch = JSON.stringify({ objective: 'add a note', files: [{ relPath: 'drafts/note.md', content: '# hi\n' }] });

describe('24Z.25: hidden-channel scanner detects covert payloads', () => {
  it('detects zero-width / BOM / word-joiner', () => {
    for (const n of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) {
      expect(scanHiddenChannels(`apply${cp(n)}now`).some((f) => f.kind === 'zero_width'), `U+${n.toString(16)}`).toBe(true);
    }
  });
  it('detects bidi override/isolate controls', () => {
    expect(scanHiddenChannels(`a${cp(0x202e)}b`).some((f) => f.kind === 'bidi_control')).toBe(true); // RLO
    expect(scanHiddenChannels(`a${cp(0x2066)}b`).some((f) => f.kind === 'bidi_control')).toBe(true); // LRI
  });
  it('detects tag characters (invisible instruction smuggling)', () => {
    expect(scanHiddenChannels(`x${cp(0xe0041)}y`).some((f) => f.kind === 'tag_char')).toBe(true);
  });
  it('detects private-use code points (BMP + plane 15/16)', () => {
    expect(scanHiddenChannels(`x${cp(0xe000)}y`).some((f) => f.kind === 'private_use')).toBe(true);
    expect(scanHiddenChannels(`x${cp(0xf0001)}y`).some((f) => f.kind === 'private_use')).toBe(true);
  });
  it('detects C0/C1 control chars but allows tab/newline/cr', () => {
    expect(scanHiddenChannels(`a${cp(0x07)}b`).some((f) => f.kind === 'control_char')).toBe(true);
    expect(scanHiddenChannels('a\tb\nc\r')).toEqual([]);
  });
  it('flags homoglyph-risk letters (Cyrillic/Greek that look Latin)', () => {
    expect(scanHiddenChannels(`${cp(0x0430)}pply`).some((f) => f.kind === 'homoglyph_risk')).toBe(true); // Cyrillic 'а' + pply
    expect(scanHiddenChannels('apply')).toEqual([]); // pure ASCII is clean
  });
  it('clean ASCII JSON has zero findings', () => {
    expect(scanHiddenChannels(cleanPatch)).toEqual([]);
  });
});

describe('24Z.25: normalizeModelText NFC-normalizes then scans', () => {
  it('collapses NFD to NFC (so NFD/NFC tricks do not slip past keyword checks)', () => {
    const nfd = `a${cp(0x0301)}pply`; // 'a' + combining acute (NFD) + "pply"
    const r = normalizeModelText(nfd);
    expect(r.changedByNfc).toBe(true);
    expect(r.normalized.normalize('NFC')).toBe(r.normalized);
  });
});

describe('24Z.25: parseOpenCodePatch is fail-closed (normalize → refuse hidden → parse as data)', () => {
  it('parses a clean candidate as DATA (never executed)', () => {
    const c = parseOpenCodePatch(cleanPatch);
    expect(c.engineSource).toBe('opencode');
    expect(c.sanitized).toBe(true);
    expect(c.files).toEqual([{ relPath: 'drafts/note.md', content: '# hi\n' }]);
  });
  it('REFUSES output containing ANY hidden channel (human-opacity refusal)', () => {
    const zw = JSON.stringify({ objective: 'ok', files: [{ relPath: 'drafts/x.md', content: `nor${cp(0x200b)}mal` }] });
    expect(() => parseOpenCodePatch(zw)).toThrow(HiddenChannelError);
    const tag = JSON.stringify({ objective: `ok${cp(0xe0041)}`, files: [{ relPath: 'drafts/x.md', content: 'y' }] });
    expect(() => parseOpenCodePatch(tag)).toThrow(HiddenChannelError);
  });
  it('REFUSES non-JSON output', () => {
    expect(() => parseOpenCodePatch('here is your diff: ...')).toThrow(PatchParseError);
  });
  it('REFUSES path escape / absolute path in a file', () => {
    expect(() => parseOpenCodePatch(JSON.stringify({ objective: 'x', files: [{ relPath: '../etc/passwd', content: 'y' }] }))).toThrow(PatchParseError);
    expect(() => parseOpenCodePatch(JSON.stringify({ objective: 'x', files: [{ relPath: '/abs', content: 'y' }] }))).toThrow(PatchParseError);
  });
  it('REFUSES empty / oversized file sets', () => {
    expect(() => parseOpenCodePatch(JSON.stringify({ objective: 'x', files: [] }))).toThrow(PatchParseError);
    const many = { objective: 'x', files: Array.from({ length: 21 }, (_, i) => ({ relPath: `drafts/f${i}.md`, content: 'y' })) };
    expect(() => parseOpenCodePatch(JSON.stringify(many))).toThrow(PatchParseError);
  });
  it('REFUSES forbidden content in metadata (objective / relPath)', () => {
    const lie = JSON.stringify({ objective: 'production wired at https://prod.convex.cloud', files: [{ relPath: 'drafts/x.md', content: 'y' }] });
    expect(() => parseOpenCodePatch(lie)).toThrow(PatchParseError);
  });

  // 24Z.25 red-team (HIGH): JSON \uXXXX escapes are literal ASCII in the raw text — the pre-parse scan misses them,
  // then JSON.parse DECODES them into live hidden codepoints. The post-parse scan on DECODED fields must catch them.
  it('REFUSES escape-encoded hidden channels that only appear AFTER JSON.parse (incl. in content)', () => {
    // raw text contains the literal backslash-u escapes (ASCII), so a naive pre-parse scan sees nothing
    const escObjective = '{"objective":"add \\u202eEVIL\\u202c \\u200bnote","files":[{"relPath":"drafts/x.md","content":"ok"}]}';
    expect(() => parseOpenCodePatch(escObjective)).toThrow(HiddenChannelError);
    const escRelPath = '{"objective":"ok","files":[{"relPath":"drafts/app\\u200b.ts","content":"ok"}]}';
    expect(() => parseOpenCodePatch(escRelPath)).toThrow(HiddenChannelError);
    // content is the injection vector — a tag char / homoglyph decoded into content must also be refused
    const escContent = '{"objective":"ok","files":[{"relPath":"drafts/x.ts","content":"export const \\u0430pply = true // \\ue0041"}]}';
    expect(() => parseOpenCodePatch(escContent)).toThrow(HiddenChannelError);
    // a clean escape-encoded payload (no hidden chars) still parses fine
    const clean = '{"objective":"add a \\u0041 note","files":[{"relPath":"drafts/x.md","content":"hi \\u0042"}]}';
    expect(parseOpenCodePatch(clean).sanitized).toBe(true);
  });

  // 24Z.26 red-team (MEDIUM false-positive): a legitimate non-Latin comment (confusables, NO authority word) must
  // NOT be over-refused; a homoglyph'd AUTHORITY word (even out-of-map ɑ/math-bold) must be refused.
  it('allows legit non-Latin content (no authority word) but refuses homoglyph-hidden authority words', () => {
    const legit = JSON.stringify({ objective: 'add note', files: [{ relPath: 'drafts/n.md', content: '// автор Иван привет мир' }] });
    expect(parseOpenCodePatch(legit).sanitized).toBe(true);                       // legit Russian comment allowed
    const ho = JSON.stringify({ objective: 'ok', files: [{ relPath: 'd/x.ts', content: `${cp(0x0251)}pply = true` }] }); // ɑpply
    expect(() => parseOpenCodePatch(ho)).toThrow(HiddenChannelError);
    const mb = JSON.stringify({ objective: `the ${cp(0x1d5ee)}dmin panel`, files: [{ relPath: 'd/x.ts', content: 'x' }] }); // 𝗮dmin
    expect(() => parseOpenCodePatch(mb)).toThrow(HiddenChannelError);
  });
});
