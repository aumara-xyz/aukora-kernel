import { describe, it, expect } from 'vitest';
import { exportVkRow, loadVkRow, verifyVkRowAgainstSignedChain } from '../src/trainingExport';
import { evaluateIntent, PrincipalRegistry, _resetChain } from '../src/index';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot, signHead } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { decodeVkPayload, encodeVkPayload } from '../src/vk';
import { runBurnHarness } from '../src/burn';

const POP_SEED = "77".repeat(32);
const EDGE_NODE_SEED = "88".repeat(32);
const ATTACKER_SEED = "99".repeat(32);

const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);
const EDGE_NODE_PUBLIC_KEY = getTestPublicKey(EDGE_NODE_SEED);
const ATTACKER_PUBLIC_KEY = getTestPublicKey(ATTACKER_SEED);

function createValidPoP(rawIntent: any): any {
  const intent = normalizeProposal(rawIntent);
  const intentHash = hash(JSON.stringify(intent));
  return signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: intentHash,
    nonce: Math.random().toString(),
  });
}

describe('Aukora Edge-Node Training Export', () => {
  it('exported rows reload from JSON and correctly cold-decode', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    // Export to JSON
    const jsonStr = exportVkRow(decision.vkRow!);
    expect(typeof jsonStr).toBe('string');
    
    // Reload
    const reloadedRow = loadVkRow(jsonStr);
    
    // Ensure exact equality
    expect(reloadedRow.rowId).toBe(decision.vkRow!.rowId);
    expect(reloadedRow.glyphHash).toBe(decision.vkRow!.glyphHash);
    
    // Cold decode
    const decoded = decodeVkPayload(reloadedRow.vkPayload);
    expect(decoded.action).toBe('read_file');
    expect(decoded.resource).toBe('data.txt');
  });

  it('export excludes secrets and only contains safe fields', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    const jsonStr = exportVkRow(decision.vkRow!);
    const parsed = JSON.parse(jsonStr);
    
    // Assert exactly what we expect is there
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual([
      'codebookHash',
      'codebookVersion',
      'createdAt',
      'evidenceOnly',
      'glyphHash',
      'intentHash',
      'normalizedIntent',
      'receiptHash',
      'receiptId',
      'rowId',
      'verdict',
      'vkPayload'
    ]);
    
    // Ensure no secrets leaked
    expect(parsed.receipt).toBeUndefined(); // Raw receipt contains pop signature
    expect(jsonStr).not.toContain(POP_SEED);
  });

  it('createdAt does not affect reproducibility hash (glyphHash is independent of time)', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = createValidPoP(rawIntent);
    
    // The evaluation sets createdAt = Date.now() internally
    const decision1 = evaluateIntent(rawIntent, pop);
    
    const reloaded = loadVkRow(exportVkRow(decision1.vkRow!));
    
    const originalGlyph = reloaded.glyphHash;
    reloaded.createdAt = 999999999; // Mutate time
    
    // The canonical hash of the vkPayload must still match the original glyphHash
    expect(hash(JSON.stringify(reloaded.vkPayload))).toBe(originalGlyph);
  });

  // --- Commit 7.5 Integrity Tests ---

  it('loadVkRow rejects tampered glyphHash', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.glyphHash = hash('tampered');
    
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/glyphHash does not match canonical payload/);
  });

  it('loadVkRow rejects tampered payloadCode', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.vkPayload.payloadCodes[0] = 'A99:tampered'; // Mutate payload
    
    // The glyphHash check will fail because the canonical payload hash changed
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/glyphHash does not match canonical payload/);
  });

  it('loadVkRow rejects tampered codebookHash', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.codebookHash = hash('tampered-schema');
    
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/Codebook hash mismatch between row and payload/);
  });

  // --- Commit 7.6 Cross-Binding Tests ---

  it('loadVkRow rejects top-level verdict flipping while vkPayload is unchanged', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.verdict = 'refused'; // Attempt to poison top-level
    
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/Cross-binding Failed: decoded verdict mismatch/);
  });

  it('loadVkRow rejects normalizedIntent.resource flipping while vkPayload is unchanged', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.normalizedIntent.resource = 'malicious.txt';
    // Must recalculate intentHash to bypass that specific check and hit the cross-binding check
    parsed.intentHash = hash(JSON.stringify(parsed.normalizedIntent));
    
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/Cross-binding Failed: decoded resource mismatch/);
  });

  it('loadVkRow rejects intentHash flipped or inconsistent with normalizedIntent', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.intentHash = hash('tampered-intent'); // Just flip the hash
    
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/Cross-binding Failed: intentHash mismatch/);
  });

  it('loadVkRow rejects top-level receiptId flipping while vkPayload is unchanged', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const jsonStr = exportVkRow(decision.vkRow!);
    
    const parsed = JSON.parse(jsonStr);
    parsed.receiptId = 'forged-receipt-id';
    
    expect(() => loadVkRow(JSON.stringify(parsed))).toThrow(/Cross-binding Failed: decoded receiptId mismatch/);
  });

  it('export works identically on both accepted and refused decisions', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    // Accepted
    const acceptedIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const acceptedDecision = evaluateIntent(acceptedIntent, createValidPoP(acceptedIntent));
    const acceptedReloaded = loadVkRow(exportVkRow(acceptedDecision.vkRow!));
    expect(acceptedReloaded.verdict).toBe('golden_success');
    
    // Refused
    const refusedIntent = { action: 'delete_path', resource: 'sys', ring: 'root' };
    const refusedDecision = evaluateIntent(refusedIntent, createValidPoP(refusedIntent));
    const refusedReloaded = loadVkRow(exportVkRow(refusedDecision.vkRow!));
    expect(refusedReloaded.verdict).toBe('refused');
  });

  it('burn -> JSONL round trip: run harness, export all rows, reload all rows', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
    
    // Create 10 candidates to run the burn
    const candidates = [
      { action: 'read_file', resource: 'burn_1.txt', ring: 'local' },
      { action: 'read_file', resource: 'burn_2.txt', ring: 'local' },
      { action: 'delete_path', resource: 'sys.txt', ring: 'local' },
      { action: 'read_file', resource: 'burn_4.txt', ring: 'local' },
      { action: 'read_file', resource: 'burn_5.txt', ring: 'local' },
      { action: 'read_file', resource: 'burn_6.txt', ring: 'local' },
      { action: 'read_file', resource: 'burn_7.txt', ring: 'local' },
      { action: 'read_file', resource: 'burn_8.txt', ring: 'local' },
      { action: 'read_file', resource: 'aukoraConfig', ring: 'local' },
      { action: 'read_file', resource: 'burn_10.txt', ring: 'local' }
    ].map((c, i) => ({
      rawIntent: c,
      pop: i === 3 ? null : signPoP(POP_SEED, { // 3 has missing pop, mimicking burn test
        principalId: i === 4 ? 'unknown-admin' : 'test-admin',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(c))),
        nonce: i === 6 ? 'burn-nonce-1' : `burn-nonce-${i+1}` // 6 is replay
      })
    }));

    const burnRows = runBurnHarness(candidates); // returns VkTrainingRow[]
    
    expect(burnRows.length).toBe(10);
    
    // Export to JSONL format
    const jsonl = burnRows.map(r => exportVkRow(r.decision.vkRow!)).join('\n');
    const lines = jsonl.split('\n');
    
    expect(lines.length).toBe(10);
    
    let successCount = 0;
    let refusedCount = 0;
    
    // Reload and assert
    lines.forEach(line => {
      const reloaded = loadVkRow(line);
      expect(reloaded).toBeDefined();
      expect(reloaded.evidenceOnly).toBe(true);
      
      // We implicitly assert cold-decode passed because loadVkRow runs decodeVkPayload
      if (reloaded.verdict === 'golden_success') successCount++;
      if (reloaded.verdict === 'refused') refusedCount++;
    });
    
    // Assert corpus has both accepted and refused
    expect(successCount).toBeGreaterThan(0);
    expect(refusedCount).toBeGreaterThan(0);
  });
  // --- Commit 8 Authentic Row Verification Tests ---

  it('valid exported row + matching receipt + valid signed head verifies successfully', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    const receipts = [decision.receipt];
    const root = computeMerkleRoot(receipts);
    
    const jsonStr = exportVkRow(decision.vkRow!);
    const loadedRow = loadVkRow(jsonStr);

    const result = verifyVkRowAgainstSignedChain(
      loadedRow,
      receipts,
      root,
      decision.receipt.signedHead
    );
    expect(result).toBe(true);
  });

  it('forged row with all fields internally recomputed but no matching receipt is rejected', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const receipts = [decision.receipt];
    const root = computeMerkleRoot(receipts);

    // Attacker crafts a perfect, internally consistent row
    const jsonStr = exportVkRow(decision.vkRow!);
    const parsed = JSON.parse(jsonStr);
    
    parsed.receiptId = 'forged-receipt-id';
    parsed.receiptHash = 'forged-receipt-id';
    parsed.vkPayload = encodeVkPayload(decision.vkRow!.normalizedIntent, decision.vkRow!.verdict, 'forged-receipt-id');
    parsed.glyphHash = hash(JSON.stringify(parsed.vkPayload));
    
    const forgedRow = loadVkRow(JSON.stringify(parsed));
    
    // loadVkRow passes because the row is internally self-consistent!
    expect(forgedRow).toBeDefined();

    // But verify against the signed chain fails because the receipt doesn't exist
    expect(() => verifyVkRowAgainstSignedChain(forgedRow, receipts, root, decision.receipt.signedHead))
      .toThrow(/No matching receipt found in chain/);
  });

  it('row with flipped receiptHash is rejected', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const receipts = [decision.receipt];
    const root = computeMerkleRoot(receipts);

    const loadedRow = loadVkRow(exportVkRow(decision.vkRow!));
    loadedRow.receiptHash = 'tampered'; // Mutate loaded row

    expect(() => verifyVkRowAgainstSignedChain(loadedRow, receipts, root, decision.receipt.signedHead))
      .toThrow(/receiptHash mismatch/);
  });

  it('fully forged bundle (attacker receipt, attacker head) is rejected by pinned node key', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    
    // The attacker forges a fake receipt using their own signature
    const attackerReceipts = [{...decision.receipt}];
    const attackerRoot = computeMerkleRoot(attackerReceipts);
    const attackerHead = signHead(ATTACKER_SEED, attackerRoot); // Attacker signs the root
    
    const loadedRow = loadVkRow(exportVkRow(decision.vkRow!));

    // The module should use its own PINNED EDGE_NODE_PUBLIC_KEY, not trust the attacker bundle
    expect(() => verifyVkRowAgainstSignedChain(loadedRow, attackerReceipts, attackerRoot, attackerHead))
      .toThrow(/signed head signature invalid/);
  });

  it('valid row with wrong Merkle root is rejected', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    const receipts = [decision.receipt];
    const wrongRoot = hash('tampered-root');

    const loadedRow = loadVkRow(exportVkRow(decision.vkRow!));

    expect(() => verifyVkRowAgainstSignedChain(loadedRow, receipts, wrongRoot, decision.receipt.signedHead))
      .toThrow(/verifyReceiptHistory failed/);
  });

  it('boundary-documenting test: loadVkRow accepts a forged row, but verify rejects it', () => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

    // Honest decision
    const honestIntent = { action: 'read_file', resource: 'honest.txt', ring: 'local' };
    const honestDecision = evaluateIntent(honestIntent, createValidPoP(honestIntent));
    const receipts = [honestDecision.receipt];
    const root = computeMerkleRoot(receipts);

    // Attacker offline-crafts a fake decision
    const fakeIntent = { action: 'delete_path', resource: 'sys', ring: 'root' };
    const fakePayload = encodeVkPayload(fakeIntent as any, 'golden_success', 'fake-id');

    const forgedJson = JSON.stringify({
      rowId: 'fake-row-id',
      receiptId: 'fake-id',
      receiptHash: 'fake-id',
      intentHash: hash(JSON.stringify(fakeIntent)),
      normalizedIntent: fakeIntent,
      verdict: 'golden_success',
      vkPayload: fakePayload,
      glyphHash: hash(JSON.stringify(fakePayload)),
      codebookVersion: 'vk-edge-v1',
      codebookHash: fakePayload.codebookHash,
      evidenceOnly: true,
      createdAt: 12345
    });

    // 1. Proves loadVkRow only checks internal consistency
    const forgedRow = loadVkRow(forgedJson);
    expect(forgedRow.verdict).toBe('golden_success');

    // 2. Proves verifyVkRowAgainstSignedChain requires cryptographic authenticity
    expect(() => verifyVkRowAgainstSignedChain(forgedRow, receipts, root, honestDecision.receipt.signedHead))
      .toThrow(/No matching receipt found in chain/);
  });
});
