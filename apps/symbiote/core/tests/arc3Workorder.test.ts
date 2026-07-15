// The ARC lane's first lawful crossing (spatial/arc3-workorder.ts): a pulse
// finding may become a proposal-intent DRAFT through the existing ceremony —
// advisory speech only. These pins hold the boundaries: gated off by default,
// the hollow control never drafts, paths stay `inferred`, the draft grants
// nothing, and re-drafting the same finding is idempotent.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { maybeDraftPulseWorkOrder } from '../../spatial/arc3-workorder';
import { createPulseSession } from '../../spatial/arc3-pulse';
import type { PulseSurface } from '../../spatial/arc3-pulse';
import { readProposalIntentById, validateProposalIntent, buildProposalIntent } from '../src/proposalIntent';

const DOWN_DOOR: PulseSurface = { name: 'chat-door', url: 'http://127.0.0.1:7091/' };
const HOLLOW: PulseSurface = { name: 'hollow', url: 'http://127.0.0.1:1/' };

const homes: string[] = [];
function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'arc3-workorder-home-'));
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

describe('the crossing is gated and scoped', () => {
  it('gated OFF by default: no env, no opts — no draft', () => {
    const prev = process.env.AUKORA_ARC3_WORKORDERS;
    delete process.env.AUKORA_ARC3_WORKORDERS;
    try {
      const r = maybeDraftPulseWorkOrder({ surface: DOWN_DOOR, guid: 'g1', level: 1, probes: 2 }, { homeDir: tmpHome() });
      expect(r.drafted).toBe(false);
      if (!r.drafted) expect(r.reason).toContain('gated off');
    } finally {
      if (prev !== undefined) process.env.AUKORA_ARC3_WORKORDERS = prev;
    }
  });

  it('the hollow control never drafts, even when enabled', () => {
    const home = tmpHome();
    const r = maybeDraftPulseWorkOrder({ surface: HOLLOW, guid: 'g2', level: 1, probes: 2 }, { enabled: true, homeDir: home });
    expect(r.drafted).toBe(false);
    if (!r.drafted) expect(r.reason).toContain('silent by design');
    expect(fs.existsSync(path.join(home, 'aumlok', 'pending-intents'))).toBe(false); // nothing written at all
  });
});

describe('the draft itself — advisory speech through the real ceremony', () => {
  it('writes a valid proposal-intent-v1 that grants nothing and stays inferred', () => {
    const home = tmpHome();
    const r = maybeDraftPulseWorkOrder({ surface: DOWN_DOOR, guid: 'run-77', level: 1, probes: 3 }, { enabled: true, homeDir: home });
    expect(r.drafted).toBe(true);
    if (!r.drafted) return;
    const read = readProposalIntentById(r.intentId, home);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const intent = read.intent;
    expect(intent.authoredBy).toBe('arc3');
    expect(intent.advisoryOnly).toBe(true);
    expect(intent.grantsAuthority).toBe(false);
    expect(intent.goal).toContain('chat-door');
    expect(intent.rationale).toContain('run-77');
    for (const ap of intent.affectedPaths) expect(ap.epistemicStatus).toBe('inferred');
    // and the file lives exactly where the owner's gate reads pending intents
    expect(r.path).toBe(path.join(home, 'aumlok', 'pending-intents', `${r.intentId}.json`));
  });

  it('re-drafting the same finding is idempotent — same id, one file', () => {
    const home = tmpHome();
    const a = maybeDraftPulseWorkOrder({ surface: DOWN_DOOR, guid: 'run-88', level: 1, probes: 2 }, { enabled: true, homeDir: home });
    const b = maybeDraftPulseWorkOrder({ surface: DOWN_DOOR, guid: 'run-88', level: 1, probes: 2 }, { enabled: true, homeDir: home });
    expect(a.drafted && b.drafted).toBe(true);
    if (!a.drafted || !b.drafted) return;
    expect(b.intentId).toBe(a.intentId);
    expect(fs.readdirSync(path.join(home, 'aumlok', 'pending-intents')).length).toBe(1);
  });

  it("the schema accepts 'arc3' as an author and still rejects strangers", () => {
    const good = buildProposalIntent({
      goal: 'g', affectedPaths: [{ path: 'p', epistemicStatus: 'inferred' }], authoredBy: 'arc3',
    });
    expect(validateProposalIntent(good).valid).toBe(true);
    const bad = { ...good, authoredBy: 'martian' };
    expect(validateProposalIntent(bad).valid).toBe(false);
  });
});

describe('the session hands the naming over exactly once', () => {
  it('takeFinding returns the named door after a mark, then null', async () => {
    const surfaces: PulseSurface[] = [
      { name: 'a', url: 'up://a' }, { name: 'chat-door', url: 'down://d' },
      { name: 'b', url: 'up://b' }, { name: 'c', url: 'up://c' }, { name: 'd', url: 'up://d2' },
    ];
    const prober = async (url: string) => ({ up: url.startsWith('up://'), ms: 5 });
    const s = createPulseSession({ seed: 3, prober, surfaces });
    let fr = s.reset();
    expect(s.takeFinding()).toBeNull(); // nothing named yet
    // probe all tiles, find the silent one, mark it
    const anchors: Array<[number, number]> = [];
    const g = fr.frame[0];
    for (let y = 0; y < 60; y += 2) for (let x = 0; x < 64; x += 2) {
      if (g[y][x] === 5 && !anchors.some(([ax, ay]) => Math.abs(ax - x) < 8 && Math.abs(ay - y) < 8)) anchors.push([x, y]);
    }
    let silent: [number, number] | null = null;
    for (const [x, y] of anchors) {
      fr = await s.act('ACTION6', x, y);
      if (fr.frame[0][y][x] === 9) silent = [x, y];
    }
    await s.act('ACTION6', silent![0], silent![1]); // the mark
    const named = s.takeFinding();
    expect(named).not.toBeNull();
    expect(named!.surface.name).toBe('chat-door');
    expect(s.takeFinding()).toBeNull(); // handed over exactly once
  });
});
