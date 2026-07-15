// Council #4a — receipts now bind the PoP authorization-provenance (who authorized, with which nonce/method/
// args), with NO secret leak: fingerprints + hashes only. Tamper-evident via the id preimage + chain linkage.
// Plus migration/rollback: legacy v0 receipts (no provenance) still verify under the unchanged v0 preimage.
import { describe, it, expect } from 'vitest';
import { evaluateIntent, getChain, _resetChain, PrincipalRegistry } from '../src/index';
import { Receipt, verifyChain, hashReceiptPreimage, generateReceipt, getTestPublicKey, signPoP, hash, canonicalIntentSerialize } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';

const POP_SEED = '77'.repeat(32);
function goldenPoP(raw: any, nonce: string) {
  const intent = normalizeProposal(raw);
  const argsHash = hash(canonicalIntentSerialize(intent));
  return signPoP(POP_SEED, { principalId: 'prov-admin', methodId: 'evaluateIntent', argsHash, nonce });
}
// a chain whose first receipt is golden (carries provenance) and second is refused (provenance null)
function chain() {
  _resetChain();
  PrincipalRegistry.set('prov-admin', getTestPublicKey(POP_SEED));
  const raw = { action: 'read_file', resource: 'p.txt', ring: 'local' };
  evaluateIntent(raw as any, goldenPoP(raw, 'nonce-A'));
  evaluateIntent({ action: 'write_file', resource: 'x', ring: 'local' } as any, null);
  return getChain().map((r) => ({ ...r, normalizedIntent: { ...r.normalizedIntent }, provenance: r.provenance ? { ...r.provenance } : r.provenance }));
}

describe('council #4a — receipts bind PoP auth-provenance', () => {
  it('a golden_success receipt records provenance; a refused receipt records null', () => {
    const c = chain();
    expect(c[0].verdict).toBe('golden_success');
    expect(c[0].version).toBe(1);
    expect(c[0].seq).toBe(0);
    expect(c[0].provenance).toBeTruthy();
    expect(c[0].provenance!.methodId).toBe('evaluateIntent');
    expect(c[1].verdict).toBe('refused');
    expect(c[1].provenance).toBeNull();
    expect(c[1].seq).toBe(1);
  });

  it('provenance leaks NO secret — hashes/fingerprints only (no raw nonce, no signature)', () => {
    const c = chain();
    const p = c[0].provenance!;
    expect(JSON.stringify(p)).not.toContain('nonce-A');         // raw nonce NEVER stored
    expect(p.nonceHash).toBe(hash('nonce-A'));                  // only its hash
    expect(p.principalFingerprint).toBe(hash(getTestPublicKey(POP_SEED)));
    expect((p as any).signature).toBeUndefined();
    expect((p as any).nonce).toBeUndefined();
  });

  it('tampering ANY provenance field breaks verifyChain', () => {
    for (const f of ['principalFingerprint', 'methodId', 'argsHash', 'nonceHash'] as const) {
      const c = chain();
      (c[0].provenance as any)[f] = 'TAMPERED';
      expect(verifyChain(c)).toBe(false);
    }
  });

  it('tampering the sequence number breaks verifyChain', () => {
    const c = chain();
    c[0].seq = 99;
    expect(verifyChain(c)).toBe(false);
  });

  it('seq is monotonic and equals the chain index', () => {
    _resetChain();
    for (let i = 0; i < 5; i++) evaluateIntent({ action: 'read_file', resource: `s${i}`, ring: 'local' } as any, null);
    getChain().forEach((r, i) => expect(r.seq).toBe(i));
  });

  it('MIGRATION/rollback: legacy v0 receipts (no provenance) still verify; new v1 verify too', () => {
    const intent = normalizeProposal({ action: 'read_file', resource: 'legacy', ring: 'local' });
    const ih = hash(canonicalIntentSerialize(intent));
    // v0: built with the UNCHANGED legacy preimage, no version/seq/provenance — simulates a pre-#4a receipt
    const v0: Receipt = { id: hashReceiptPreimage('refused', intent, 'genesis_hash'), verdict: 'refused', intentHash: ih, normalizedIntent: intent, prevHash: 'genesis_hash', signedHead: '' };
    expect(verifyChain([v0])).toBe(true);
    // v1 from generateReceipt
    const v1 = generateReceipt('refused', intent, ih, 'genesis_hash', 0, null);
    expect(v1.version).toBe(1);
    expect(verifyChain([v1])).toBe(true);
  });
});
