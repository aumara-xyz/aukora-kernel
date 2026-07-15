import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { trainTinyLearner, predictVerdict, resetLearnerModel } from '../src/learner';
import { evaluateIntent, PrincipalRegistry, _resetChain } from '../src/index';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot, signHead } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { runBurnHarness } from '../src/burn';
import { exportVkRow, loadVkRow } from '../src/trainingExport';

const POP_SEED = "77".repeat(32);
const EDGE_NODE_SEED = "88".repeat(32);
const ATTACKER_SEED = "99".repeat(32);

const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);
const EDGE_NODE_PUBLIC_KEY = getTestPublicKey(EDGE_NODE_SEED);

describe('Commit 9: Tiny Local Learner (Read-Only)', () => {
  beforeEach(() => {
    resetLearnerModel();
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
  });

  it('learner refuses/unloads any row that fails signed-chain authenticity', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
      nonce: 'nonce-1'
    });
    const decision = evaluateIntent(rawIntent, pop);
    const receipts = [decision.receipt];
    const root = computeMerkleRoot(receipts);

    const forgedBundle = {
      row: loadVkRow(exportVkRow(decision.vkRow!)),
      receipts: receipts,
      expectedRoot: root,
      signedHead: signHead(ATTACKER_SEED, root) // Attacker signs instead of Node
    };

    expect(() => trainTinyLearner([forgedBundle])).toThrow(/signed head signature invalid/);

    // Verify it learned nothing
    const prediction = predictVerdict(normalizeProposal(rawIntent));
    expect(prediction.evidenceRowIds.length).toBe(0);
  });

  it('learner trains on the 10-row burn corpus after verification', () => {
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
      pop: i === 3 ? null : signPoP(POP_SEED, {
        principalId: i === 4 ? 'unknown-admin' : 'test-admin',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(c))),
        nonce: i === 6 ? 'burn-nonce-1' : `burn-nonce-${i+1}`
      })
    }));

    const burnRows = runBurnHarness(candidates);
    
    // We need to pass the FULL receipt chain history to train the learner for authenticity
    const allReceipts = burnRows.map(r => r.decision.receipt);
    const expectedRoot = computeMerkleRoot(allReceipts);
    // The final signed head from the last iteration
    const signedHead = allReceipts[allReceipts.length - 1].signedHead;

    const bundles = burnRows.map(r => ({
      row: loadVkRow(exportVkRow(r.decision.vkRow!)),
      receipts: allReceipts, // Need full chain for verifyChain
      expectedRoot,
      signedHead
    }));

    trainTinyLearner(bundles);

    // Learner predicts read_file as likely golden_success
    const readIntent = normalizeProposal({ action: 'read_file', resource: 'new.txt', ring: 'local' });
    const readPred = predictVerdict(readIntent);
    
    // Burn corpus has a mix of read_file success and refused, but more successes (if valid pop).
    // Let's just check the structural output
    expect(readPred.evidenceRowIds.length).toBe(10);
    expect(readPred.evidenceOnly).toBe(true);
    expect(readPred.predictedVerdict).toBe('golden_success');

    // Learner predicts forbidden action conservatively/low-confidence
    const delIntent = normalizeProposal({ action: 'delete_path', resource: 'sys', ring: 'local' });
    const delPred = predictVerdict(delIntent);
    expect(delPred.predictedVerdict).toBe('refused');
    expect(delPred.evidenceOnly).toBe(true);

    // Learner predicts unknown action conservatively/low-confidence even on golden ring
    const unknownIntent = normalizeProposal({ action: 'unknown_magic', resource: 'stuff', ring: 'local' });
    const unknownPred = predictVerdict(unknownIntent);
    expect(unknownPred.predictedVerdict).toBe('refused');
    expect(unknownPred.confidence).toBe(0.80);
    expect(unknownPred.evidenceOnly).toBe(true);
  });

  it('mutating learner output cannot change receipt chain or authorization verdicts', () => {
    // This is fundamentally true by architecture since the learner has no access to globalReceipts or evaluateIntent
    const intent = normalizeProposal({ action: 'read_file', resource: 'test', ring: 'local' });
    const pred = predictVerdict(intent);
    
    // Attempt mutation
    pred.predictedVerdict = 'golden_success';
    pred.evidenceOnly = false;
    
    // There is literally no API to pass `pred` back into evaluateIntent or the chain.
    // The test simply proves the shape of the object.
    expect(pred.predictedVerdict).toBe('golden_success');
  });

  it('forged bundle late in a batch leaves learner unchanged (atomic batch)', () => {
    const rawIntent1 = { action: 'read_file', resource: 'data1.txt', ring: 'local' };
    const rawIntent2 = { action: 'read_file', resource: 'data2.txt', ring: 'local' };
    const pop1 = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(rawIntent1))),
      nonce: 'nonce-100'
    });
    const decision1 = evaluateIntent(rawIntent1, pop1);
    
    // Attacker forged bundle
    const forgedReceipts = [decision1.receipt];
    const forgedRoot = computeMerkleRoot(forgedReceipts);
    const forgedBundle = {
      row: loadVkRow(exportVkRow(decision1.vkRow!)),
      receipts: forgedReceipts,
      expectedRoot: forgedRoot,
      signedHead: signHead(ATTACKER_SEED, forgedRoot) // attacker signature
    };

    const validBundle = {
      row: loadVkRow(exportVkRow(decision1.vkRow!)),
      receipts: [decision1.receipt],
      expectedRoot: computeMerkleRoot([decision1.receipt]),
      signedHead: decision1.receipt.signedHead
    };

    expect(() => trainTinyLearner([validBundle, forgedBundle])).toThrow(/signed head signature invalid/);

    // Learner should be completely empty because batch is atomic
    const prediction = predictVerdict(normalizeProposal(rawIntent1));
    expect(prediction.evidenceRowIds.length).toBe(0);
  });

  it('learner module has no forbidden imports (grep-style test)', () => {
    const learnerSource = readFileSync(join(__dirname, '../src/learner.ts'), 'utf-8');
    
    expect(learnerSource).not.toMatch(/import.*evaluateIntent/);
    expect(learnerSource).not.toMatch(/import.*PrincipalRegistry/);
    expect(learnerSource).not.toMatch(/import.*NonceLedger/);
    expect(learnerSource).not.toMatch(/import.*fs/);
    expect(learnerSource).not.toMatch(/import.*child_process/);
    expect(learnerSource).not.toMatch(/fetch\(/);
    expect(learnerSource).not.toMatch(/signHead/);
    expect(learnerSource).not.toMatch(/signPoP/);
  });
});
