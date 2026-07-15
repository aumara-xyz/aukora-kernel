// Host-agnostic, read-only Convex inventory test. Required by the hardening brief: the seed's Convex
// receiver must name NO private/research lanes, inventory NO host topology, grant NO authority, and have
// NO mutation path. (Private-lane words are split so THIS enforcer file stays clean of the literals.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildConvexBrainSnapshot, validateSnapshot } from '../src/convexBrainSnapshot';

const SRC = join(__dirname, '..', 'src');
const read = (f: string) => readFileSync(join(SRC, f), 'utf-8');
const FILES = ['convexBrainSnapshot.ts', 'convexTopology.ts', 'convexBrainReadonly.ts', 'convexBrainReadOnlyMount.ts'];
const LANE = ['v' + 'k', 'do' + 'jo', 'fer' + 'al', 'harv' + 'ester', 'pala' + 'din', 'vyma' + 'kira', 'b5' + 'lite', 'baby' + 'Model'];
const laneRe = new RegExp('\\b(' + LANE.join('|') + ')\\b', 'i');

describe('Convex inventory is host-agnostic + read-only', () => {
  const snap = buildConvexBrainSnapshot();

  it('snapshot is host-agnostic — no organs, no donor inventory, no source repos', () => {
    expect(snap.organs).toEqual([]);
    expect(snap.donorCount).toBe(0);
    expect(snap.sourceRepos).toEqual([]);
    expect(snap.bridgeMode).toBe('missing');
  });

  it('snapshot grants no authority, is advisory, and validates clean', () => {
    expect(snap.grantsAuthority).toBe(false);
    expect(snap.advisoryOnly).toBe(true);
    expect(validateSnapshot(snap).valid).toBe(true);
  });

  it('no private-lane / research-lane strings in the Convex receiver files', () => {
    for (const f of FILES) {
      expect(laneRe.test(read(f)), `${f} names a private/research lane`).toBe(false);
    }
  });

  it('no Convex mutation path in the receiver files', () => {
    for (const f of FILES) {
      const code = read(f).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      expect(/\.mutation\s*\(/.test(code), `${f} has a Convex mutation() call`).toBe(false);
    }
  });
});
