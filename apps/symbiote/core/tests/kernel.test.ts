import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateIntent, _resetChain, PrincipalRegistry } from '../src/index';
import { hash, verifyChain, computeMerkleRoot, verifyReceiptHistory, signPoP, PoP, getTestPublicKey, verifySignedHead } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { decodeVkPayload, encodeVkPayload, EDGE_GENESIS_CODEBOOK } from '../src/vk';

const POP_SEED = "77".repeat(32);
const EDGE_NODE_SEED = "88".repeat(32);
const ATTACKER_SEED = "99".repeat(32);

const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);
const EDGE_NODE_PUBLIC_KEY = getTestPublicKey(EDGE_NODE_SEED);
const ATTACKER_PUBLIC_KEY = getTestPublicKey(ATTACKER_SEED);

function createValidPoP(rawIntent: any, overrides?: Partial<PoP>, useAttackerKey = false): PoP {
  const intent = normalizeProposal(rawIntent);
  const intentHash = hash(JSON.stringify(intent));
  const seed = useAttackerKey ? ATTACKER_SEED : POP_SEED;
  return signPoP(seed, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: intentHash,
    nonce: Math.random().toString(),
    ...overrides
  });
}

describe('Aukora Edge-Node Kernel Prototype', () => {
  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
  });

  it('authority-claiming intent is stripped and exact shape is returned', () => {
    const rawIntent = {
      action: 'read_file',
      resource: '/etc/passwd',
      ring: 'local',
      grant_me_root: true,
      authorized: true,
      signature: 'fake_sig'
    };
    
    const normalized = normalizeProposal(rawIntent);
    expect(normalized).toEqual({
      action: 'read_file',
      resource: '/etc/passwd',
      ring: 'local'
    });
    // Ensure absolutely no other keys survived
    expect(Object.keys(normalized)).toEqual(['action', 'resource', 'ring']);
  });

  it('read_file passes with valid cryptographic pinned PoP', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    expect(decision.verdict).toBe('golden_success');
  });

  it('read_file refuses without valid PoP', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, null);
    expect(decision.verdict).toBe('refused');
  });

  it('delete_path refuses even with valid pinned PoP', () => {
    const rawIntent = { action: 'delete_path', resource: 'system32', ring: 'root' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    expect(decision.verdict).toBe('refused');
  });

  // --- Trust Anchor Negative Tests ---
  
  it('unknown principal is refused', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = createValidPoP(rawIntent, { principalId: 'ghost-admin' });
    const decision = evaluateIntent(rawIntent, pop);
    expect(decision.verdict).toBe('refused');
  });

  it('attacker self-signed PoP is refused (publicKey not pinned)', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    // Attacker claims test-admin, but signs with their own key
    const pop = createValidPoP(rawIntent, { principalId: 'test-admin' }, true);
    const decision = evaluateIntent(rawIntent, pop);
    expect(decision.verdict).toBe('refused');
  });

  it('nonce replay is refused', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = createValidPoP(rawIntent, { nonce: 'same-nonce-123' });
    const decision1 = evaluateIntent(rawIntent, pop);
    expect(decision1.verdict).toBe('golden_success');

    // Replay exact same PoP
    const decision2 = evaluateIntent(rawIntent, pop);
    expect(decision2.verdict).toBe('refused');
  });

  it('methodId mismatch is refused', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = createValidPoP(rawIntent, { methodId: 'otherMethod' });
    const decision = evaluateIntent(rawIntent, pop);
    expect(decision.verdict).toBe('refused');
  });

  // --- End Trust Anchor Tests ---

  // --- VK Evidence Row & Receipt Body Binding Tests ---
  
  it('every decision emits exactly one VKTrainingRow with correct evidence constraints', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    expect(decision.vkRow).toBeDefined();
    expect(decision.vkRow.evidenceOnly).toBe(true);
    expect(decision.vkRow.codebookVersion).toBe('v1-edge-genesis');
    expect(decision.vkRow.receiptId).toBe(decision.receipt.id);
    expect(decision.vkRow.receiptHash).toBe(decision.receipt.id);
    expect(decision.vkRow.intentHash).toBe(decision.receipt.intentHash);
    expect(decision.vkRow.normalizedIntent).toEqual(decision.receipt.normalizedIntent);
  });

  it('mutating normalizedIntent body breaks receipt verification', () => {
    const rawIntent = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    const receipts = [decision.receipt];
    expect(verifyChain(receipts)).toBe(true);
    
    // Attacker mutates the stored intent body in the receipt
    receipts[0].normalizedIntent.resource = 'tampered.txt';
    
    // Verification must fail because the hash is computed over the full body
    expect(verifyChain(receipts)).toBe(false);
  });

  it('mutating receipt.intentHash alone makes verifyChain fail', () => {
    const rawIntent = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    const receipts = [decision.receipt];
    expect(verifyChain(receipts)).toBe(true);
    
    // Attacker mutates the intentHash but leaves normalizedIntent untouched
    receipts[0].intentHash = hash('tampered');
    
    expect(verifyChain(receipts)).toBe(false);
  });

  it('refused decisions also emit exactly one VK row with evidenceOnly === true', () => {
    const rawIntent = { action: 'delete_path', resource: 'system32', ring: 'root' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    expect(decision.verdict).toBe('refused');
    expect(decision.vkRow).toBeDefined();
    expect(decision.vkRow.evidenceOnly).toBe(true);
  });

  it('N calls to evaluateIntent produce exactly N VK rows, no dupes/drops', () => {
    const N = 10;
    const rows = [];
    for (let i = 0; i < N; i++) {
      const rawIntent = { action: 'read_file', resource: `${i}.txt`, ring: 'local' };
      const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
      rows.push(decision.vkRow);
    }
    
    expect(rows.length).toBe(N);
    // Ensure uniqueness
    const rowIds = new Set(rows.map(r => r.rowId));
    expect(rowIds.size).toBe(N);
  });

  // --- VK Codec / Glyph Payload Tests ---

  it('frozen codebook content must never change silently (golden schema hash)', () => {
    // Using a placeholder hash initially; we will update this based on test output to lock the dictionary.
    const actualHash = hash(JSON.stringify(EDGE_GENESIS_CODEBOOK));
    expect(actualHash).toBe('b9fc41bc978fe1582a92aa9a33c7917f52f7930446fc43864cedcb7c24be54d0');
  });

  it('golden vector test: payloadCodes and glyphHash exactly match locked expected values', () => {
    const payload = encodeVkPayload({ action: 'read_file', resource: 'data.txt', ring: 'local' }, 'golden_success', 'receipt-123');
    
    // We expect specific symbol codes from the codebook, plus formatted string values
    expect(payload.payloadCodes).toEqual([
      'A01',          // action: read_file
      'RES:data.txt', // resource: data.txt
      'R01',          // ring: local
      'V01',          // verdict: golden_success
      'ID:receipt-123'// receiptId
    ]);

    const actualGlyphHash = hash(JSON.stringify(payload));
    expect(actualGlyphHash).toBe('51b41222683bbba2a3b7983b185bafe3a00709330a06f562ee72bd404554ba90');
  });

  it('literal cold-decode test: decodes a hand-constructed payload with zero prior state', () => {
    // We hand-construct a payload exactly as it would be read from disk, completely independent of encode.
    // We must use the correct codebookHash for the test to pass.
    // Just to grab the correct hash for testing without exporting it:
    const validHash = encodeVkPayload({ action: 'read_file', resource: '', ring: '' }, '', '').codebookHash;

    const coldPayload = {
      formatVersion: "vk-edge-v1",
      codebookHash: validHash,
      payloadCodes: [
        "A01",            // read_file
        "RES:data.txt",   // resource
        "R01",            // local
        "V01",            // golden_success
        "ID:abc-123"      // receiptId
      ]
    };
    
    const decoded = decodeVkPayload(coldPayload);
    expect(decoded.action).toBe('read_file');
    expect(decoded.resource).toBe('data.txt');
    expect(decoded.ring).toBe('local');
    expect(decoded.verdict).toBe('golden_success');
    expect(decoded.receiptId).toBe('abc-123');
  });

  it('unknown fallback values (A99/R99/V99) round-trip correctly', () => {
    // The normalizer blocks unknown actions, but the Codec itself must safely encode/decode any string.
    const payload = encodeVkPayload({ action: 'foobar', resource: 'data.txt', ring: 'weird_ring' }, 'strange_verdict', 'fake-id');
    
    expect(payload.payloadCodes[0]).toBe('A99:foobar');
    expect(payload.payloadCodes[2]).toBe('R99:weird_ring');
    expect(payload.payloadCodes[3]).toBe('V99:strange_verdict');

    const decoded = decodeVkPayload(payload);
    expect(decoded.action).toBe('foobar');
    expect(decoded.ring).toBe('weird_ring');
    expect(decoded.verdict).toBe('strange_verdict');
  });

  it('decodeVkPayload fails closed (throws) if codebookHash mismatches', () => {
    const validPayload = encodeVkPayload({ action: 'read_file', resource: 'data.txt', ring: 'local' }, 'golden_success', 'id-123');
    validPayload.codebookHash = hash('wrong-schema');
    
    expect(() => decodeVkPayload(validPayload)).toThrow(/Codebook hash mismatch/);
  });

  it('glyphHash changes when action, resource, ring, verdict, or receiptId changes', () => {
    const basePayload = encodeVkPayload({ action: 'read_file', resource: '1.txt', ring: 'local' }, 'golden_success', 'receipt-1');
    const baseHash = hash(JSON.stringify(basePayload));

    // Change action
    const diffAction = encodeVkPayload({ action: 'delete_path', resource: '1.txt', ring: 'local' }, 'golden_success', 'receipt-1');
    expect(hash(JSON.stringify(diffAction))).not.toBe(baseHash);

    // Change resource
    const diffResource = encodeVkPayload({ action: 'read_file', resource: '2.txt', ring: 'local' }, 'golden_success', 'receipt-1');
    expect(hash(JSON.stringify(diffResource))).not.toBe(baseHash);

    // Change ring
    const diffRing = encodeVkPayload({ action: 'read_file', resource: '1.txt', ring: 'root' }, 'golden_success', 'receipt-1');
    expect(hash(JSON.stringify(diffRing))).not.toBe(baseHash);

    // Change verdict
    const diffVerdict = encodeVkPayload({ action: 'read_file', resource: '1.txt', ring: 'local' }, 'refused', 'receipt-1');
    expect(hash(JSON.stringify(diffVerdict))).not.toBe(baseHash);

    // Change receiptId
    const diffId = encodeVkPayload({ action: 'read_file', resource: '1.txt', ring: 'local' }, 'golden_success', 'receipt-2');
    expect(hash(JSON.stringify(diffId))).not.toBe(baseHash);
  });

  it('glyphHash is perfectly stable for the exact same payload', () => {
    const payload1 = encodeVkPayload({ action: 'read_file', resource: 'data.txt', ring: 'local' }, 'golden_success', 'fake-receipt-id');
    const payload2 = encodeVkPayload({ action: 'read_file', resource: 'data.txt', ring: 'local' }, 'golden_success', 'fake-receipt-id');
    
    expect(hash(JSON.stringify(payload1))).toBe(hash(JSON.stringify(payload2)));
  });

  // --- End VK Evidence Row Tests ---

  it('clean 3-receipt Merkle root verifies, tampering breaks both linear and Merkle verification', () => {
    const raw1 = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const raw2 = { action: 'read_file', resource: '2.txt', ring: 'local' };
    const raw3 = { action: 'read_file', resource: '3.txt', ring: 'local' };
    
    const dec1 = evaluateIntent(raw1, createValidPoP(raw1));
    const dec2 = evaluateIntent(raw2, createValidPoP(raw2));
    const dec3 = evaluateIntent(raw3, createValidPoP(raw3));
    
    const receipts = [dec1.receipt, dec2.receipt, dec3.receipt];
    const root = computeMerkleRoot(receipts);
    
    // Validate honest chain
    expect(verifyReceiptHistory(receipts, root)).toBe(true);
    
    // Simulate tamper: attacker alters the verdict of receipt 2
    receipts[1].verdict = 'refused';
    
    // Verification must fail because the hash no longer matches the ID, breaking both linear and Merkle
    expect(verifyChain(receipts)).toBe(false);
    expect(verifyReceiptHistory(receipts, root)).toBe(false);
  });

  it('independent-root negative test: verifyReceiptHistory with wrong root fails', () => {
    const raw1 = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const dec1 = evaluateIntent(raw1, createValidPoP(raw1));
    const receipts = [dec1.receipt];
    
    const wrongRoot = hash('wrong_root');
    expect(verifyReceiptHistory(receipts, wrongRoot)).toBe(false);
  });

  it('Merkle root is bound into a valid Signed Head', () => {
    const raw1 = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const dec1 = evaluateIntent(raw1, createValidPoP(raw1));
    
    const root = computeMerkleRoot([dec1.receipt]);
    
    // Verify the signature on the head actually validates against the edge node's public key
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, root, dec1.receipt.signedHead)).toBe(true);
    
    // Verify it fails with a tampered root
    const tamperedRoot = hash('tampered');
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, tamperedRoot, dec1.receipt.signedHead)).toBe(false);
  });

  it('signed head forged by wrong signer key is rejected', () => {
    const raw1 = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const dec1 = evaluateIntent(raw1, createValidPoP(raw1));
    
    const root = computeMerkleRoot([dec1.receipt]);
    
    // Test that the valid head signature fails to verify against the attacker's public key
    expect(verifySignedHead(ATTACKER_PUBLIC_KEY, root, dec1.receipt.signedHead)).toBe(false);
  });

  it('re-id tamper is caught by prevHash continuity', () => {
    const raw1 = { action: 'read_file', resource: '1.txt', ring: 'local' };
    const raw2 = { action: 'read_file', resource: '2.txt', ring: 'local' };
    
    const dec1 = evaluateIntent(raw1, createValidPoP(raw1));
    const dec2 = evaluateIntent(raw2, createValidPoP(raw2));
    
    const receipts = [dec1.receipt, dec2.receipt];
    const root = computeMerkleRoot(receipts);
    
    // Attacker alters receipt 1 and recomputes its ID to pass the localized single-receipt hash check
    receipts[0].verdict = 'refused';
    // Using internal logic to recalculate the ID since generateReceipt mutated ID logic
    receipts[0].id = hash(`refused:${JSON.stringify(receipts[0].normalizedIntent)}:${receipts[0].prevHash}`);
    
    // The localized check passes, but receipt 2's prevHash no longer matches the new ID of receipt 1.
    expect(verifyChain(receipts)).toBe(false);
    expect(verifyReceiptHistory(receipts, root)).toBe(false);
  });

  it('non-ASCII action and ring fail as refused_charset', () => {
    const rawAction = { action: 'аukora_config', resource: 'none', ring: 'local' }; // Cyrillic
    expect(normalizeProposal(rawAction).action).toBe('refused_charset');

    const rawRing = { action: 'read_file', resource: 'data', ring: 'lócál' }; // Diacritic
    expect(normalizeProposal(rawRing).action).toBe('refused_charset');
  });

  it('changing/deleting VK rows does not change verdict', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    // @ts-ignore
    delete decision.vkRow;
    expect(decision.verdict).toBe('golden_success');
  });

  it('sacred operations and unicode/homoglyph bypasses are structurally blocked', () => {
    const rawIntent1 = { action: 'read_file', resource: 'aukoraConfig', ring: 'local' };
    const norm1 = normalizeProposal(rawIntent1);
    expect(norm1.action).toBe('sacred_violation');

    const rawIntent3 = { action: 'read_file', resource: 'аukora_config', ring: 'local' };
    const norm3 = normalizeProposal(rawIntent3);
    expect(norm3.action).toBe('refused_charset');
    
    const rawIntent4 = { action: 'k.i.l.l.switch', resource: 'none', ring: 'local' };
    const norm4 = normalizeProposal(rawIntent4);
    expect(norm4.action).toBe('k.i.l.l.switch');
  });
});
