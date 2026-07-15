import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Pin recall to an EMPTY brain before the module loads (same reason as voiceLane.test.ts:
// voiceReply otherwise reads the live state/kira/brain.json and test outputs drift per machine).
const originalKiraState = process.env.AUKORA_KIRA_STATE;
process.env.AUKORA_KIRA_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-imageout-')), 'no-brain.json');

let voiceReply: typeof import('../../spatial/voiceLane').voiceReply;
let extractGeneratedImages: typeof import('../../spatial/voiceLane').extractGeneratedImages;
let voiceHistory: typeof import('../../spatial/voiceLane').voiceHistory;
let VOICE_ROSTER: typeof import('../../spatial/voiceLane').VOICE_ROSTER;
let VOICE_MAX_IMAGES: typeof import('../../spatial/voiceLane').VOICE_MAX_IMAGES;
let VOICE_MAX_IMAGE_CHARS: typeof import('../../spatial/voiceLane').VOICE_MAX_IMAGE_CHARS;

beforeAll(async () => {
  const lane = await import('../../spatial/voiceLane');
  voiceReply = lane.voiceReply;
  extractGeneratedImages = lane.extractGeneratedImages;
  voiceHistory = lane.voiceHistory;
  VOICE_ROSTER = lane.VOICE_ROSTER;
  VOICE_MAX_IMAGES = lane.VOICE_MAX_IMAGES;
  VOICE_MAX_IMAGE_CHARS = lane.VOICE_MAX_IMAGE_CHARS;
});

afterAll(() => {
  if (originalKiraState === undefined) delete process.env.AUKORA_KIRA_STATE;
  else process.env.AUKORA_KIRA_STATE = originalKiraState;
});

const IMAGE_MODEL = 'openai/gpt-5.4-image-2'; // roster entry with imageOut: true
const TEXT_MODEL = 'anthropic/claude-fable-5';
const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;

/** Mocks the catalog probe (fails → static roster) and captures every completion request body. */
function mockCompletion(message: Record<string, unknown>) {
  const bodies: Array<Record<string, unknown>> = [];
  const mock = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.includes('/models')) return { ok: false, status: 500 } as unknown as Response;
    if (url.includes('/chat/completions')) {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return {
        ok: true,
        json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }),
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { mock, bodies };
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-fake-key';
  voiceHistory.length = 0;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  voiceHistory.length = 0;
});

describe('image-making voices — roster', () => {
  it('carries the two catalog-verified image models, flagged imageOut', () => {
    for (const id of [IMAGE_MODEL, 'google/gemini-3.1-flash-image']) {
      const m = VOICE_ROSTER.find((r) => r.id === id);
      expect(m, id).toBeDefined();
      expect(m?.imageOut, id).toBe(true);
    }
    // text voices are NOT silently image-flagged
    expect(VOICE_ROSTER.find((r) => r.id === TEXT_MODEL)?.imageOut).toBeUndefined();
  });
});

describe('extractGeneratedImages — untrusted payload discipline', () => {
  it('accepts the OpenRouter shapes, only as data:image URLs', () => {
    expect(extractGeneratedImages([
      { type: 'image_url', image_url: { url: DATA_URL } },
      { url: DATA_URL },
      DATA_URL,
    ])).toEqual([DATA_URL, DATA_URL, DATA_URL]);
  });

  it('rejects remote URLs, junk shapes, and oversized payloads; caps the count', () => {
    expect(extractGeneratedImages([
      'https://evil.example/x.png',
      { image_url: { url: 'javascript:alert(1)' } },
      42, null, {}, { image_url: {} },
      'data:image/png;base64,' + 'A'.repeat(VOICE_MAX_IMAGE_CHARS + 1),
    ])).toEqual([]);
    expect(extractGeneratedImages(new Array(20).fill(DATA_URL))).toHaveLength(VOICE_MAX_IMAGES);
    expect(extractGeneratedImages('not-an-array')).toEqual([]);
    expect(extractGeneratedImages(undefined)).toEqual([]);
  });
});

describe('voiceReply — image generation round-trip', () => {
  it('an imageOut model requests image+text modalities and renders image entries', async () => {
    const { mock, bodies } = mockCompletion({ content: 'here is your picture', images: [{ type: 'image_url', image_url: { url: DATA_URL } }] });
    globalThis.fetch = mock as unknown as typeof fetch;
    const entries = await voiceReply('draw a golden council', IMAGE_MODEL, []);
    expect(bodies[0].modalities).toEqual(['image', 'text']);
    const images = entries!.filter((e) => e.kind === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].text).toBe(DATA_URL);
    const meta = entries!.find((e) => e.kind === 'tool_result' && e.tool === 'voice');
    expect(meta?.text).toMatch(/made 1 image\(s\)/);
  });

  it('a text-only model never requests image modalities', async () => {
    const { mock, bodies } = mockCompletion({ content: 'plain words' });
    globalThis.fetch = mock as unknown as typeof fetch;
    const entries = await voiceReply('hello', TEXT_MODEL, []);
    expect(bodies[0].modalities).toBeUndefined();
    expect(entries!.some((e) => e.kind === 'image')).toBe(false);
  });

  it('an image-only reply (no prose) is a real reply, and history stores a note, never the dataURL', async () => {
    const { mock } = mockCompletion({ content: '', images: [DATA_URL] });
    globalThis.fetch = mock as unknown as typeof fetch;
    const entries = await voiceReply('draw it', IMAGE_MODEL, []);
    expect(entries!.filter((e) => e.kind === 'image')).toHaveLength(1);
    const assistantTurn = voiceHistory[voiceHistory.length - 1];
    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.content).toMatch(/generated image/);
    expect(assistantTurn.content).not.toContain('data:image/');
  });
});
