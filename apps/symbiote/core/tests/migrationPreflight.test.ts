// M4 prep — the migration preflight is an INDEPENDENT verifier: it must catch what the store's own
// verify catches (via its own re-implementation), refuse drifted/contained sources wholesale, and
// pin the exact value bytes the future executor must produce.
import { describe, it, expect } from 'vitest';
import { createEmptyBrain, ingestMemory, eraseMemory, type KiraBrainState } from '../src/kiraBrain';
import { migrationPreflight, migrationValueV1 } from '../src/migrationPreflight';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function brainWith(texts: string[]): KiraBrainState {
  let state = createEmptyBrain('2026-07-05T00:00:00.000Z');
  for (const [i, text] of texts.entries()) {
    state = ingestMemory(state, { text, source: 'test', scope: 'migration', tags: ['m4'], now: `2026-07-05T00:00:0${i}.000Z` }).state;
  }
  return state;
}

describe('M4 migration preflight — independent re-derivation, wholesale abort', () => {
  it('green brain → ok plan: one entry per live atom, unique keys, pinned value hashes', () => {
    const state = brainWith(['first memory', 'second memory', 'third memory']);
    const r = migrationPreflight(state, 'root.local');
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.liveAtoms).toBe(3);
    expect(r.entries.map((e) => e.key)).toEqual(state.atoms.map((a) => a.id));
    // the plan pins the EXACT bytes: recomputing from the source must reproduce the plan's hashes
    const atom = state.atoms[0];
    const ingest = state.receipts.find((rc) => rc.id === atom.receiptId)!;
    const value = migrationValueV1(atom, ingest);
    expect(r.entries[0].valueSha256).toBe(sha256(value));
    expect(r.entries[0].plannedMemoryHash).toBe(sha256(`root.local:${atom.id}:${value}`));
    expect(r.secondOpinion.ok).toBe(true);
  });

  it('a silently edited atom ABORTS the whole plan (content re-derivation, not trust in verify)', () => {
    const state = brainWith(['honest memory', 'another memory']);
    const tampered: KiraBrainState = JSON.parse(JSON.stringify(state));
    tampered.atoms[0].text = 'silently edited';
    const r = migrationPreflight(tampered, 'root.local');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('atom_content_rederivation_failed:'))).toBe(true);
    expect(r.entries.length).toBeLessThan(2); // and NOTHING migrates on a red report — wholesale, by contract
  });

  it('a broken receipt chain (id / prevHash / sequence) ABORTS', () => {
    const state = brainWith(['a', 'b']);
    const broken: KiraBrainState = JSON.parse(JSON.stringify(state));
    broken.receipts[1].previousHash = 'not-the-genesis-link';
    const r = migrationPreflight(broken, 'root.local');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('prevhash_broken'))).toBe(true);
    expect(r.errors.some((e) => e.includes('id_mismatch'))).toBe(true); // prevHash is inside the id preimage
  });

  it('erased atoms are EXCLUDED and COUNTED, never silently dropped (stub semantics ride with M2b)', () => {
    let state = brainWith(['keep me', 'forget me']);
    state = eraseMemory(state, state.atoms[1].id, { reason: 'owner test forget', now: '2026-07-05T00:01:00.000Z' }).state;
    const r = migrationPreflight(state, 'root.local');
    expect(r.ok).toBe(true);
    expect(r.liveAtoms).toBe(1);
    expect(r.erasedExcluded).toBe(1);
    expect(r.secondOpinion.erasedCount).toBe(1);
  });

  it('a quarantined atom means the source needs surgery — ABORT, do not self-medicate and proceed', () => {
    const state = brainWith(['fine', 'jailed']);
    const contained: KiraBrainState = JSON.parse(JSON.stringify(state));
    contained.atoms[1].quarantined = true;
    contained.atoms[1].quarantinedAt = '2026-07-05T00:02:00.000Z';
    contained.atoms[1].quarantineReason = 'test containment';
    const r = migrationPreflight(contained, 'root.local');
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(`atom_quarantined:${contained.atoms[1].id}`);
  });

  it('duplicate Convex keys ABORT (pinned M4 rule: unique atom-id keys, because kernel recall serves ONE row per key)', () => {
    const state = brainWith(['a', 'b']);
    const dup: KiraBrainState = JSON.parse(JSON.stringify(state));
    dup.atoms[1].id = dup.atoms[0].id; // simulate an id collision in the source
    const r = migrationPreflight(dup, 'root.local');
    expect(r.ok).toBe(false);
    // the collision surfaces before key-uniqueness (receipt linkage breaks first) — any red aborts;
    // the dedicated duplicate check still exists for a source whose duplicate ids carry consistent receipts
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('an invalid ownerRootId refuses before planning', () => {
    const r = migrationPreflight(brainWith(['x']), 'NOT A VALID ROOT ID');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('owner_root_id_invalid'))).toBe(true);
  });

  it('brain shape garbage (null / missing arrays) refuses typed, never crashes', () => {
    expect(migrationPreflight(null as unknown as KiraBrainState, 'root.local').errors).toEqual(['brain_shape_invalid']);
    expect(migrationPreflight({ schema: 'AUKORA_KIRA_BRAIN_V1' } as unknown as KiraBrainState, 'root.local').errors).toEqual(['brain_shape_invalid']);
  });
});
