// Brick 0 (ONE_BRAIN carried findings, landed on the live JSON brain) — the delete button and
// the truth checks that must exist BEFORE any capture or migration:
//   0b content-binding — the silent-edit probe that used to pass green now FAILS: every live
//      atom's bytes are recomputed against its receipt's inputHash on verify.
//   0d quarantine-not-brick — atom-level failures (forbidden-shaped content, hash mismatch)
//      contain the ONE atom at load; the ledger spine (receipt chain) still fails loud.
//   0a typed erasure — eraseMemory scrubs text + EVERY derived field (supportQuote/tokens/
//      trigrams/tags/links), appends a kind:'erasure' receipt, and the verifier enforces both
//      completeness (no leftover content) and provability (no scrub without a receipt).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createEmptyBrain,
  ingestMemory,
  eraseMemory,
  loadBrainState,
  saveBrainState,
  verifyBrainState,
  recall,
  type KiraBrainState,
} from '../src/kiraBrain';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-brick0-')), 'brain.json');

function seededBrain(): KiraBrainState {
  let state = createEmptyBrain();
  ({ state } = ingestMemory(state, { text: 'the moon garden protocol lives in the north wing', source: 'test', scope: 'garden' }));
  ({ state } = ingestMemory(state, { text: 'the harbor lighthouse blinks twice at dusk', source: 'test', scope: 'harbor' }));
  return state;
}

const clone = (s: KiraBrainState): KiraBrainState => JSON.parse(JSON.stringify(s));

describe('0b content-binding: the silent-edit probe now fails', () => {
  it('an untampered brain verifies green with zero quarantines (no false tamper flags)', () => {
    const state = seededBrain();
    const v = verifyBrainState(state);
    expect(v).toMatchObject({ ok: true, quarantinedCount: 0, erasedCount: 0 });
  });

  it('save→load round-trip (formatting, key order) never trips content-binding', () => {
    const file = tmpFile();
    saveBrainState(file, seededBrain());
    const back = loadBrainState(file);
    expect(verifyBrainState(back)).toMatchObject({ ok: true, quarantinedCount: 0 });
  });

  it('THE PROBE: silently editing an atom text now fails verification', () => {
    const tampered = clone(seededBrain());
    tampered.atoms[0].text = tampered.atoms[0].text.replace('north wing', 'south vault'); // the lie
    const v = verifyBrainState(tampered);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('content hash mismatch');
  });

  it('editing derived fields (supportQuote shown to her at recall) is NOT silently accepted either', () => {
    const tampered = clone(seededBrain());
    tampered.atoms[0].text = 'the moon garden protocol lives in the south vault';
    tampered.atoms[0].supportQuote = 'the moon garden protocol lives in the south vault';
    const v = verifyBrainState(tampered);
    expect(v.ok).toBe(false); // text participates in the bound hash; the lie cannot be made consistent
  });
});

describe('0d quarantine-not-brick: one bad atom never costs her the whole memory', () => {
  it('a tampered atom QUARANTINES at load; the rest of the brain survives and recalls', () => {
    const file = tmpFile();
    const state = seededBrain();
    const tampered = clone(state);
    tampered.atoms[0].text = 'the moon garden protocol lives in the south vault';
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2)); // raw write — simulating disk tamper
    const loaded = loadBrainState(file); // must NOT throw
    const q = loaded.atoms.find((a) => a.id === tampered.atoms[0].id)!;
    expect(q.quarantined).toBe(true);
    expect(q.quarantineReason).toContain('content hash mismatch');
    expect(verifyBrainState(loaded)).toMatchObject({ ok: true, quarantinedCount: 1 });
    // the jailed atom never reaches recall…
    expect(recall(loaded, 'moon garden protocol north wing').hits.map((h) => h.atomId)).not.toContain(q.id);
    // …and the healthy atom still does
    expect(recall(loaded, 'harbor lighthouse dusk').hits.length).toBeGreaterThan(0);
  });

  it('a forbidden-shaped string reaching disk quarantines instead of bricking the load (the old failure)', () => {
    const file = tmpFile();
    const tampered = clone(seededBrain());
    tampered.atoms[0].text = `stolen credential receiptHash=${'a'.repeat(64)}`;
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
    const loaded = loadBrainState(file); // pre-Brick-0 this threw kira_state_invalid — brain bricked
    const q = loaded.atoms.find((a) => a.id === tampered.atoms[0].id)!;
    expect(q.quarantined).toBe(true);
    expect(recall(loaded, 'harbor lighthouse dusk').hits.length).toBeGreaterThan(0);
  });

  it('the LEDGER spine still fails loud: receipt-chain tampering is not quarantinable', () => {
    const file = tmpFile();
    const tampered = clone(seededBrain());
    tampered.receipts[0].previousHash = 'evil';
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
    expect(() => loadBrainState(file)).toThrow(/kira_state_invalid/);
  });

  it('quarantine marks persist through save→load (the jail is durable, not per-process)', () => {
    const file = tmpFile();
    const tampered = clone(seededBrain());
    tampered.atoms[0].text = 'edited';
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
    const loaded = loadBrainState(file);
    saveBrainState(file, loaded); // must not refuse: the offender is contained, the state is lawful
    const again = loadBrainState(file);
    expect(again.atoms.find((a) => a.id === tampered.atoms[0].id)!.quarantined).toBe(true);
    expect(verifyBrainState(again)).toMatchObject({ ok: true, quarantinedCount: 1 });
  });
});

describe('0a typed erasure: content gone, the fact of the forget provable forever', () => {
  it('eraseMemory scrubs text and EVERY derived field, appends a chained erasure receipt', () => {
    const state = seededBrain();
    const target = state.atoms[0];
    const { state: next, atom, receipt } = eraseMemory(state, target.id, { reason: 'owner-forget', now: '2026-07-05T03:00:00.000Z' });
    expect(atom).toMatchObject({ erased: true, text: '', supportQuote: '', erasedAt: '2026-07-05T03:00:00.000Z' });
    expect(atom.tokens).toEqual([]);
    expect(atom.trigrams).toEqual([]);
    expect(atom.tags).toEqual([]);
    expect(atom.links).toEqual([]);
    expect(receipt).toMatchObject({ kind: 'erasure', atomId: target.id, sequence: 2, advisoryOnly: true, grantsAuthority: false });
    expect(receipt.previousHash).toBe(state.receipts[1].id); // chained, not floating
    expect(verifyBrainState(next)).toMatchObject({ ok: true, erasedCount: 1, receiptCount: 3 });
  });

  it('an erased memory is unrecallable, and stays erased through save→load', () => {
    const file = tmpFile();
    const state = seededBrain();
    const target = state.atoms[0];
    const { state: next } = eraseMemory(state, target.id);
    expect(recall(next, 'moon garden protocol north wing').hits.map((h) => h.atomId)).not.toContain(target.id);
    saveBrainState(file, next);
    const back = loadBrainState(file);
    expect(back.atoms.find((a) => a.id === target.id)).toMatchObject({ erased: true, text: '' });
    expect(verifyBrainState(back)).toMatchObject({ ok: true, erasedCount: 1 });
  });

  it('unknown atom and double-erase both refuse with typed errors', () => {
    const state = seededBrain();
    expect(() => eraseMemory(state, 'atom_nope')).toThrow(/kira_erase_unknown_atom/);
    const { state: next } = eraseMemory(state, state.atoms[0].id);
    expect(() => eraseMemory(next, state.atoms[0].id)).toThrow(/kira_erase_already_erased/);
  });

  it('TAMPER: a scrub WITHOUT an erasure receipt is flagged, not accepted as a forget', () => {
    const tampered = clone(seededBrain());
    const a = tampered.atoms[0];
    Object.assign(a, { erased: true, erasedAt: 'x', eraseReason: 'y', text: '', supportQuote: '', tokens: [], trigrams: [], tags: [], links: [] });
    const v = verifyBrainState(tampered);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('no erasure receipt');
  });

  it('TAMPER: editing the erasure record after the fact breaks the erasure receipt binding', () => {
    const { state: next } = eraseMemory(seededBrain(), seededBrain().atoms[0].id, { now: '2026-07-05T03:00:00.000Z' });
    const tampered = clone(next);
    tampered.atoms.find((a) => a.erased)!.erasedAt = '2020-01-01T00:00:00.000Z'; // backdating the forget
    const v = verifyBrainState(tampered);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('does not bind this erasure record');
  });

  it('HARDENING: eraseMemory scrubs source/scope on the atom copy too', () => {
    const state = seededBrain();
    const { atom } = eraseMemory(state, state.atoms[0].id);
    expect(atom.source).toBe('erased');
    expect(atom.scope).toBe('erased');
  });

  it('HARDENING: a natural-language forget reason is preserved on the receipt, not coerced to a label', () => {
    const state = seededBrain();
    const reason = "contains my ex's phone number";
    const { atom } = eraseMemory(state, state.atoms[0].id, { reason });
    expect(atom.eraseReason).toBe(reason); // spaces + apostrophe survive (old safeLabel dropped them)
  });

  it('HARDENING: control chars in a reason are stripped; a blank reason falls back honestly', () => {
    const state = seededBrain();
    const dirty = 'line one' + String.fromCharCode(1) + String.fromCharCode(2) + 'two';
    const { atom: a1 } = eraseMemory(state, state.atoms[0].id, { reason: dirty });
    expect(a1.eraseReason).toBe('line one two');
    const { atom: a2 } = eraseMemory(state, state.atoms[1].id, { reason: '   ' });
    expect(a2.eraseReason).toBe('owner-forget');
  });

  it('HARDENING: kind:"erasure" cannot be minted through the ordinary ingest path (no forged erasure proof)', () => {
    expect(() => ingestMemory(createEmptyBrain(), { text: 'fake', kind: 'erasure', source: 'x', scope: 'y' }))
      .toThrow(/kira_ingest_reserved_kind/);
  });

  it('TAMPER: un-erasing (restoring content while the erasure receipt stands) is flagged', () => {
    const state = seededBrain();
    const target = state.atoms[0];
    const { state: next } = eraseMemory(state, target.id);
    const tampered = clone(next);
    const a = tampered.atoms.find((x) => x.id === target.id)!;
    delete (a as unknown as Record<string, unknown>).erased;
    a.text = target.text;
    a.supportQuote = target.supportQuote;
    a.tokens = target.tokens;
    a.trigrams = target.trigrams;
    const v = verifyBrainState(tampered);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('erasure receipt exists but atom is not erased');
  });
});
