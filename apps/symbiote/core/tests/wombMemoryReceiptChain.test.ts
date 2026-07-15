import { describe, it, expect } from 'vitest';
import { WombMemoryStore } from '../src/wombMemory';
import { createEmptyBrain, verifyBrainState } from '../src/kiraBrain';
import { captureWithReceipt } from '../src/wombMemoryReceiptChain';

describe('wombMemoryReceiptChain: real hash-chained receipts for womb-memory captures', () => {
  it('capture something, show the actual receipt (sequence, previousHash, id), run verifyBrainState()', () => {
    const store = new WombMemoryStore();
    let brain = createEmptyBrain();

    const result = captureWithReceipt(store, brain, 'turn', 'First capture', 'Hello from the womb', 'test.ts');
    brain = result.kiraState;

    // The wombMemory side still behaves exactly as before.
    expect(result.wombRecord.kind).toBe('turn');
    expect(result.wombRecord.content).toBe('Hello from the womb');
    expect(store.get(result.wombRecord.id)).toEqual(result.wombRecord);

    // The real, minted receipt — this is the proof the kira-chat asked for.
    expect(result.receipt.sequence).toBe(0);
    expect(result.receipt.previousHash).toBe('genesis'); // first receipt in the chain has no predecessor
    expect(typeof result.receipt.id).toBe('string');
    expect(result.receipt.id.length).toBeGreaterThan(0);
    expect(result.receipt.advisoryOnly).toBe(true);
    expect(result.receipt.grantsAuthority).toBe(false);

    // The chain is real and verifiable, not just a shape check.
    const verification = verifyBrainState(brain);
    expect(verification.ok).toBe(true);
    expect(verification.errors).toEqual([]);
    expect(brain.receipts.length).toBe(1);
    expect(brain.receipts[0].id).toBe(result.receipt.id);
  });

  it('a second capture chains its previousHash to the first receipt\'s own id — a real chain, not independent entries', () => {
    const store = new WombMemoryStore();
    let brain = createEmptyBrain();

    const first = captureWithReceipt(store, brain, 'turn', 'First', 'content one', 'a.ts');
    brain = first.kiraState;
    const second = captureWithReceipt(store, brain, 'fusion', 'Second', 'content two', 'b.ts');
    brain = second.kiraState;

    expect(second.receipt.sequence).toBe(1);
    expect(second.receipt.previousHash).toBe(first.receipt.id); // chained to the prior receipt's own id
    expect(second.receipt.previousHash).not.toBe('genesis');

    const verification = verifyBrainState(brain);
    expect(verification.ok).toBe(true);
    expect(brain.receipts.length).toBe(2);
    expect(brain.receipts.map((r) => r.sequence)).toEqual([0, 1]);
  });

  it('both organs stay in sync: wombMemory.all() and kiraBrain state both reflect every capture', () => {
    const store = new WombMemoryStore();
    let brain = createEmptyBrain();

    for (let i = 0; i < 5; i++) {
      const r = captureWithReceipt(store, brain, 'turn', `Turn ${i}`, `content ${i}`, `s${i}.ts`);
      brain = r.kiraState;
    }

    expect(store.all().length).toBe(5);
    expect(brain.receipts.length).toBe(5);
    expect(brain.atoms.length).toBe(5);
    expect(verifyBrainState(brain).ok).toBe(true);
  });

  it('maps wombMemory kinds onto kiraBrain kinds sensibly (receipt->receipt, code->code_map, safety/preference->note)', () => {
    const store = new WombMemoryStore();
    let brain = createEmptyBrain();

    const receiptCapture = captureWithReceipt(store, brain, 'receipt', 'R', 'chain event', 's.ts');
    brain = receiptCapture.kiraState;
    expect(receiptCapture.receipt.kind).toBe('receipt');

    const codeCapture = captureWithReceipt(store, brain, 'code', 'C', 'module map', 's.ts');
    brain = codeCapture.kiraState;
    expect(codeCapture.receipt.kind).toBe('code_map');

    const safetyCapture = captureWithReceipt(store, brain, 'safety', 'S', 'refusal note', 's.ts');
    brain = safetyCapture.kiraState;
    expect(safetyCapture.receipt.kind).toBe('note');
  });

  it('advisory-only discipline: neither organ gains any new authority through this wiring', () => {
    const store = new WombMemoryStore();
    let brain = createEmptyBrain();
    const r = captureWithReceipt(store, brain, 'turn', 'T', 'content', 's.ts', { tags: ['x'] });
    expect(r.wombRecord.advisoryOnly).toBe(true);
    expect(r.wombRecord.grantsAuthority).toBe(false);
    expect(r.atom.advisoryOnly).toBe(true);
    expect(r.atom.grantsAuthority).toBe(false);
    expect(r.receipt.advisoryOnly).toBe(true);
    expect(r.receipt.grantsAuthority).toBe(false);
    expect(r.kiraState.advisoryOnly).toBe(true);
    expect(r.kiraState.grantsAuthority).toBe(false);
  });

  it('immutable and tags pass through to the wombMemory record unchanged', () => {
    const store = new WombMemoryStore();
    let brain = createEmptyBrain();
    const r = captureWithReceipt(store, brain, 'fusion', 'Consensus', 'settled', 's.ts', { immutable: true, tags: ['consensus', 'organism'] });
    expect(r.wombRecord.immutable).toBe(true);
    expect(r.wombRecord.tags).toEqual(['consensus', 'organism']);
  });
});
