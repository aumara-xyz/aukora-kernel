// The recent-memory seat tool — memory_peek (PURE READ, newest-first governed memory observability).
// Pinned: it rides on the read-tools promotion, bounds/validates limit, returns short inert previews,
// witnesses every call fail-closed, and grants no authority.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let mockPeek = vi.fn();
vi.mock('../../scripts/memoryRecallAdapter', () => ({
  peekRecentOwnerMemories: (limit: number) => mockPeek(limit),
}));

import { memoryPeekAvailable, voiceToolSchemas, dispatchVoiceToolAsync } from '../../spatial/voiceReadToolBridge';
import { readFlightLog, verifyFlightChain } from '../src/flightRecorder';

const ADVISORY_MODE = path.join(os.tmpdir(), 'aukora-memorypeek-absent-mode.json'); // absent => advisory
const TOOL = 'memory_peek';

let prevEnv: string | undefined, prevFlight: string | undefined;
let flightDir: string, lockdownMode: string, home: string;

beforeEach(() => {
  mockPeek = vi.fn();
  prevEnv = process.env.AUKORA_VOICE_READ_TOOLS; process.env.AUKORA_VOICE_READ_TOOLS = '1';
  prevFlight = process.env.AUKORA_FLIGHT_RECORDER_DIR;
  flightDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-memorypeek-flight-'));
  process.env.AUKORA_FLIGHT_RECORDER_DIR = flightDir;
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-memorypeek-home-'));
  lockdownMode = path.join(home, 'mode.json');
  fs.writeFileSync(lockdownMode, JSON.stringify({ mode: 'lockdown' }));
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.AUKORA_VOICE_READ_TOOLS; else process.env.AUKORA_VOICE_READ_TOOLS = prevEnv;
  if (prevFlight === undefined) delete process.env.AUKORA_FLIGHT_RECORDER_DIR; else process.env.AUKORA_FLIGHT_RECORDER_DIR = prevFlight;
  try { fs.rmSync(flightDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('memory_peek — gating + schema', () => {
  it('rides on read-tools availability and is not offered when that surface is off or locked down', () => {
    expect(memoryPeekAvailable(ADVISORY_MODE)).toBe(true);
    expect(voiceToolSchemas(ADVISORY_MODE).map((s) => s.function.name)).toContain(TOOL);
    delete process.env.AUKORA_VOICE_READ_TOOLS;
    expect(memoryPeekAvailable(ADVISORY_MODE)).toBe(false);
    expect(voiceToolSchemas(ADVISORY_MODE).map((s) => s.function.name)).not.toContain(TOOL);
    process.env.AUKORA_VOICE_READ_TOOLS = '1';
    expect(memoryPeekAvailable(lockdownMode)).toBe(false);
  });
});

describe('memory_peek — argument discipline + success shape', () => {
  it('refuses an out-of-range limit before touching the adapter', async () => {
    const r = await dispatchVoiceToolAsync(TOOL, { limit: 99 }, ADVISORY_MODE);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/between 1 and 8/);
    expect(mockPeek).not.toHaveBeenCalled();
  });

  it('returns short newest-first previews with provenance, and keeps the advisory/no-authority frame', async () => {
    mockPeek.mockResolvedValue({
      ok: true,
      hits: [
        { key: 'turn.1', value: JSON.stringify({ schema: 'turn-summary-v1', at: '2026-07-09T10:00:00.000Z', atoms: [{ text: 'recent memory one' }] }), citation: 'convex:mem:aumara.root:turn.1', createdAt: 1000, rank: 1, advisoryOnly: true, grantsAuthority: false },
        { key: 'turn.2', value: 'raw row text', citation: 'convex:mem:aumara.root:turn.2', createdAt: 900, rank: 2, advisoryOnly: true, grantsAuthority: false },
      ],
      advisoryOnly: true,
      grantsAuthority: false,
    });
    const r = await dispatchVoiceToolAsync(TOOL, { limit: 2 }, ADVISORY_MODE);
    expect(r.ok).toBe(true);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
    const out = r.output as any;
    expect(out.found).toBe(true);
    expect(out.count).toBe(2);
    expect(out.hits[0]).toMatchObject({ key: 'turn.1', citation: 'convex:mem:aumara.root:turn.1', rank: 1, schema: 'turn-summary-v1' });
    expect(out.hits[0].preview).toContain('recent memory one');
    expect(out.hits[1].preview).toContain('raw row text');
    expect(out.note).toContain('grants no authority');
  });

  it('surfaces a governed-backend refusal honestly as ok:false', async () => {
    mockPeek.mockResolvedValue({ ok: false, error: 'owner_seed_missing: no owner root seed at ~/.aukora-symbiote/convex/memory-root.seed', advisoryOnly: true, grantsAuthority: false });
    const r = await dispatchVoiceToolAsync(TOOL, {}, ADVISORY_MODE);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('owner_seed_missing');
  });
});

describe('memory_peek — witnessed on the flight recorder', () => {
  it('records one content-free event per call; the chain stays valid and never carries preview text', async () => {
    mockPeek.mockResolvedValue({
      ok: true,
      hits: [{ key: 'turn.1', value: 'do not log this preview text', citation: 'convex:mem:aumara.root:turn.1', createdAt: 1000, rank: 1, advisoryOnly: true, grantsAuthority: false }],
      advisoryOnly: true,
      grantsAuthority: false,
    });
    expect((await dispatchVoiceToolAsync(TOOL, {}, ADVISORY_MODE)).ok).toBe(true);
    const nowIso = new Date().toISOString();
    const events = readFlightLog(flightDir, nowIso).filter((e: any) => e.kind === 'memory_peek');
    expect(events.length).toBe(1);
    expect(verifyFlightChain(flightDir, nowIso).ok).toBe(true);
    expect(JSON.stringify(events[0])).not.toContain('do not log this preview text');
  });
});
