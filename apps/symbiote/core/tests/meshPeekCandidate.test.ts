// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Focused tests for the DORMANT mesh_peek candidate (round 12). Pure library — no
// Convex, no IO. These validate the instrument; the frozen-bar benchmark lives in
// probes/mesh-peek/.
import { describe, expect, it } from 'vitest';
import { MeshPeekIndex, type GovernedRow } from '../src/meshPeekCandidate';

let seqCounter = 0;
const row = (p: Partial<GovernedRow> & Pick<GovernedRow, 'rowId' | 'subject' | 'origin' | 'claim'>): GovernedRow => ({
  turnKey: p.turnKey ?? `${p.origin}.t${seqCounter}`,
  seq: ++seqCounter,
  ...p,
});

describe('meshPeekCandidate (dormant)', () => {
  it('clumps rewordings of the same claim under one handle with exact sources', () => {
    const ix = new MeshPeekIndex();
    ix.addRow(row({ rowId: 'r1', subject: 'gate', origin: 'voice', claim: 'the gate checkpoint is tagged 41' }));
    ix.addRow(row({ rowId: 'r2', subject: 'gate', origin: 'voice', claim: 'the gate checkpoint is tagged 41' }));
    ix.addRow(row({ rowId: 'r3', subject: 'gate', origin: 'chat', claim: 'the gate checkpoint carries tag 41' }));
    const live = ix.liveHandles();
    expect(live).toHaveLength(1);
    expect(live[0].sourceRowIds).toEqual(['r1', 'r2', 'r3']);
    expect(live[0].origins).toEqual(['voice', 'chat']); // every contributing origin preserved
    expect(live[0].evidenceMass).toBe(3);
  });

  it('never merges across subjects, even with identical claims', () => {
    const ix = new MeshPeekIndex();
    ix.addRow(row({ rowId: 'a', subject: 'deploy-sync', origin: 'voice', claim: 'the sync call starts at 3pm' }));
    ix.addRow(row({ rowId: 'b', subject: 'council-sync', origin: 'voice', claim: 'the sync call starts at 3pm' }));
    expect(ix.liveHandles()).toHaveLength(2);
  });

  it('anchor conflict vetoes a merge inside the same subject', () => {
    const ix = new MeshPeekIndex();
    ix.addRow(row({ rowId: 'a', subject: 'sync', origin: 'voice', claim: 'the sync call starts at 3pm' }));
    ix.addRow(row({ rowId: 'b', subject: 'sync', origin: 'voice', claim: 'the sync call starts at 4pm' }));
    expect(ix.liveHandles()).toHaveLength(2);
  });

  it('turnsAgo is a count of distinct newer turn keys per origin, not a time delta', () => {
    const ix = new MeshPeekIndex();
    ix.addRow(row({ rowId: 'f1', subject: 'ledger', origin: 'lab', turnKey: 'lab.t1', claim: 'the ledger closes at entry 9' }));
    ix.addRow(row({ rowId: 'n1', subject: 'noise', origin: 'lab', turnKey: 'lab.t2', claim: 'idle musing with no facts' }));
    ix.addRow(row({ rowId: 'n2', subject: 'noise2', origin: 'lab', turnKey: 'lab.t3', claim: 'more idle musing, still no facts' }));
    ix.addRow(row({ rowId: 'n3', subject: 'noise2', origin: 'lab', turnKey: 'lab.t3', claim: 'more idle musing, still no facts here' }));
    const [top] = ix.peek({ text: 'when does the ledger close', subject: 'ledger' }, 1);
    // lab has taken turns t1,t2,t3 -> two DISTINCT turns newer than f1's t1 (t3 counted once)
    expect(top.turnsAgo).toEqual({ lab: 2 });
  });

  it('supersede: newest valid claim first, lineage intact, nothing deleted', () => {
    const ix = new MeshPeekIndex();
    ix.addRow(row({ rowId: 'v1', subject: 'beacon', origin: 'voice', claim: 'the beacon meets at 3pm' }));
    ix.addRow(row({ rowId: 'v2', subject: 'beacon', origin: 'chat', claim: 'the beacon moved to 4pm', supersedes: 'v1' }));
    const res = ix.peek({ text: 'when does the beacon meet' }, 3);
    expect(res[0].handle.sourceRowIds).toEqual(['v2']);          // newest valid claim first
    expect(res.some((r) => r.handle.sourceRowIds.includes('v1'))).toBe(false); // superseded excluded from peek
    const chain = ix.lineage(res[0].handle.handleId);
    expect(chain).toHaveLength(2);
    expect(chain[1].sourceRowIds).toEqual(['v1']);               // history reachable
    expect(chain[1].origins).toEqual(['voice']);                 // provenance of the corrected claim survives
    expect([...ix.reachableRowIds()].sort()).toEqual(['v1', 'v2']); // zero deletion
  });

  it('a correction never merges into the handle it supersedes (anchor-free claims)', () => {
    const ix = new MeshPeekIndex();
    ix.addRow(row({ rowId: 'v1', subject: 'motto', origin: 'voice', claim: 'the motto stays short and honest' }));
    ix.addRow(row({ rowId: 'v2', subject: 'motto', origin: 'chat', claim: 'the motto stays short and honest always', supersedes: 'v1' }));
    const live = ix.liveHandles();
    expect(live).toHaveLength(1);
    expect(live[0].sourceRowIds).toEqual(['v2']);
    expect(live[0].lineage).toHaveLength(1);
  });

  it('digest ranks by fresh evidence first and excludes the caller origin', () => {
    const ix = new MeshPeekIndex();
    // old heavy chatter (before sync point), one fresh fact + one fresh chatter after
    ix.addRow(row({ rowId: 'c1', subject: 'chatter', origin: 'lab', claim: 'thinking about weather in the mesh' }));
    ix.addRow(row({ rowId: 'c2', subject: 'chatter', origin: 'lab', claim: 'thinking about weather in the mesh' }));
    ix.addRow(row({ rowId: 'c3', subject: 'chatter', origin: 'lab', claim: 'thinking about the weather in the mesh' }));
    const sync = seqCounter;
    ix.addRow(row({ rowId: 'f1', subject: 'quorum', origin: 'lab', claim: 'the quorum needs 5 seats' }));
    ix.addRow(row({ rowId: 'f2', subject: 'quorum', origin: 'lab', claim: 'you need 5 seats for quorum' }));
    ix.addRow(row({ rowId: 'c4', subject: 'chatter', origin: 'lab', claim: 'thinking about weather in the mesh today' }));
    const d = ix.digest('voice', sync, 2);
    expect(Object.keys(d)).toEqual(['lab']);
    expect(d.lab[0].freshRowIds).toEqual(['f1', 'f2']);          // 2 fresh beats mass-4 chatter with 1 fresh
    expect(d.lab[0].handle.subject).toBe('quorum');
  });

  it('is deterministic: same rows, structurally identical handles', () => {
    const rows: GovernedRow[] = [];
    seqCounter = 100;
    for (let i = 0; i < 12; i++) {
      rows.push(row({ rowId: `d${i}`, subject: `s${i % 3}`, origin: `o${i % 2}`, claim: `claim number ${i % 4} about subject ${i % 3}` }));
    }
    const a = new MeshPeekIndex(); const b = new MeshPeekIndex();
    for (const r of rows) { a.addRow({ ...r }); b.addRow({ ...r }); }
    expect(JSON.stringify(a.allHandles())).toEqual(JSON.stringify(b.allHandles()));
  });

  it('fails closed on out-of-order seq and duplicate row ids', () => {
    const ix = new MeshPeekIndex();
    ix.addRow({ rowId: 'x', subject: 's', origin: 'o', turnKey: 'o.t1', seq: 10, claim: 'first claim' });
    expect(() => ix.addRow({ rowId: 'y', subject: 's', origin: 'o', turnKey: 'o.t1', seq: 9, claim: 'late claim' }))
      .toThrow('mesh_peek_rows_must_arrive_in_seq_order');
    expect(() => ix.addRow({ rowId: 'x', subject: 's', origin: 'o', turnKey: 'o.t2', seq: 11, claim: 'dup id' }))
      .toThrow('mesh_peek_duplicate_row_id');
  });

  // ---- round-13 config-correctness (would fail under the old fixed-DIM merge/renorm loops)
  it.each([64, 256, 1024])('merges + recalls correctly at non-default dim=%i (merge/renorm honor the instance dim)', (dim) => {
    // dim=1024 caught the old bug: merge loop only touched 0..511, leaving 512..1023
    // stale so the mean drifted off-unit and rewordings stopped clumping/recalling.
    // dim=64 caught the other half: the old loop indexed 64..511 out of a length-64
    // Float64Array (undefined arithmetic).
    const ix = new MeshPeekIndex({ dim });
    seqCounter = 0;
    ix.addRow(row({ rowId: 'r1', subject: 'gate', origin: 'voice', claim: 'the gate checkpoint is tagged 41' }));
    ix.addRow(row({ rowId: 'r2', subject: 'gate', origin: 'voice', claim: 'the gate checkpoint is tagged 41' }));
    ix.addRow(row({ rowId: 'r3', subject: 'gate', origin: 'chat', claim: 'the gate checkpoint carries tag 41' }));
    const live = ix.liveHandles();
    expect(live).toHaveLength(1);                          // rewordings still clump
    expect(live[0].sourceRowIds).toEqual(['r1', 'r2', 'r3']);
    // mu stayed a unit vector of exactly `dim` entries after the merges
    const [top] = ix.peek({ text: 'what tag is on the gate checkpoint', subject: 'gate' }, 1);
    expect(top.handle.sourceRowIds).toEqual(['r1', 'r2', 'r3']);
  });

  it('constructor fails closed on invalid dim / hashSeed', () => {
    expect(() => new MeshPeekIndex({ dim: 0 })).toThrow('mesh_peek_invalid_dim');
    expect(() => new MeshPeekIndex({ dim: -8 })).toThrow('mesh_peek_invalid_dim');
    expect(() => new MeshPeekIndex({ dim: 3.5 })).toThrow('mesh_peek_invalid_dim');
    expect(() => new MeshPeekIndex({ dim: 1 << 21 })).toThrow('mesh_peek_invalid_dim');
    expect(() => new MeshPeekIndex({ hashSeed: 1.5 })).toThrow('mesh_peek_invalid_hash_seed');
    expect(() => new MeshPeekIndex({ hashSeed: Number.MAX_SAFE_INTEGER + 2 })).toThrow('mesh_peek_invalid_hash_seed');
  });

  it('default config is byte-compatible: same handles with {} and no arg', () => {
    const rows: GovernedRow[] = [];
    seqCounter = 500;
    for (let i = 0; i < 10; i++) rows.push(row({ rowId: `z${i}`, subject: `s${i % 2}`, origin: `o${i % 3}`, claim: `fact ${i % 4} about topic ${i % 2}` }));
    const a = new MeshPeekIndex(); const b = new MeshPeekIndex({});
    for (const r of rows) { a.addRow({ ...r }); b.addRow({ ...r }); }
    expect(JSON.stringify(a.allHandles())).toEqual(JSON.stringify(b.allHandles()));
  });
});
