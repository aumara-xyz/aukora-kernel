import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  GateExample,
  CaseMemoryPredictor,
  StructuralMemoryPredictor,
  evaluatePredictor
} from '../src/structuralMemory';

// Real gate and helper functions from edge-node
import { evaluateIntent, _resetChain, PrincipalRegistry } from '../src/index';
import { getTestPublicKey, signPoP, hash } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';

const SEED = '77'.repeat(32);
const PUB = getTestPublicKey(SEED);

// Keep track of registered nonces for replay test simulation
const replayedNonces = new Set<string>();

function getPoPForState(intent: any, state: 'valid' | 'missing' | 'malformed' | 'replayed'): any {
  if (state === 'missing') return null;
  if (state === 'valid') {
    return signPoP(SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(intent))),
      nonce: `nonce_${Math.random()}_${Date.now()}`
    });
  }
  if (state === 'replayed') {
    const nonce = `replayed_${intent.action}_${intent.resource}_${intent.ring}`;
    if (!replayedNonces.has(nonce)) {
      replayedNonces.add(nonce);
      const prePop = signPoP(SEED, {
        principalId: 'test-anchor',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(intent))),
        nonce
      });
      evaluateIntent(intent, prePop);
    }
    return signPoP(SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(intent))),
      nonce
    });
  }
  if (state === 'malformed') {
    const pop = signPoP(SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(intent))),
      nonce: `nonce_${Math.random()}_${Date.now()}`
    });
    return {
      ...pop,
      signature: 'bad_signature_forged'
    };
  }
  return null;
}

function getRealGateExample(
  action: string,
  resource: string,
  ring: 'local' | 'system' | 'other',
  popState: 'valid' | 'missing' | 'malformed' | 'replayed'
): GateExample {
  const intent = { action, resource, ring };
  const pop = getPoPForState(intent, popState);

  const decision = evaluateIntent(intent, pop);

  let refusalCause: GateExample['refusalCause'] = undefined;
  if (decision.verdict === 'refused') {
    if (['delete_path', 'write_file', 'shell', 'network', 'self_modify', 'sacred_violation', 'refused_charset'].includes(action)) {
      refusalCause = 'capability_refusal';
    } else if (action === 'read_file') {
      if (!pop) {
        refusalCause = 'authorization_refusal';
      } else {
        refusalCause = 'malformed_refusal';
      }
    } else {
      refusalCause = 'unknown_refusal';
    }
  }

  return {
    action,
    resource,
    ring,
    popState,
    verdict: decision.verdict === 'golden_success' ? 'golden_success' : 'refused',
    refusalCause
  };
}

describe('Commit 20D.2: Honest Structural Memory vs Deduplicated Case Memory', () => {
  let trainingSet: GateExample[] = [];
  let testSet: GateExample[] = [];
  let nearMissSet: GateExample[] = [];

  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', PUB);
    replayedNonces.clear();

    trainingSet = [];
    testSet = [];
    nearMissSet = [];

    const addRealExamples = (
      action: string,
      resource: string,
      ring: 'local' | 'system' | 'other',
      popState: 'valid' | 'missing' | 'malformed' | 'replayed',
      count: number
    ) => {
      for (let i = 0; i < count; i++) {
        trainingSet.push(getRealGateExample(action, resource, ring, popState));
      }
    };

    // 1. Train on read_file data.txt (local ring)
    addRealExamples('read_file', 'data.txt', 'local', 'valid', 20);
    addRealExamples('read_file', 'data.txt', 'local', 'missing', 10);
    addRealExamples('read_file', 'data.txt', 'local', 'malformed', 10);
    addRealExamples('read_file', 'data.txt', 'local', 'replayed', 10);

    // 2. Train on same-prefix sibling actions that are refused by the real gate (read_config, read_secret)
    addRealExamples('read_config', 'config.json', 'local', 'valid', 20);
    addRealExamples('read_config', 'config.json', 'local', 'missing', 10);
    addRealExamples('read_secret', 'secret.txt', 'local', 'valid', 20);
    addRealExamples('read_secret', 'secret.txt', 'local', 'missing', 10);

    // 3. Train on write_file config.json (local ring) - always refused
    addRealExamples('write_file', 'config.json', 'local', 'valid', 30);
    addRealExamples('write_file', 'config.json', 'local', 'missing', 15);

    // 4. Train on delete_path temp.txt (local ring) - always refused
    addRealExamples('delete_path', 'temp.txt', 'local', 'valid', 15);

    // 5. Train on shell & network - always refused
    addRealExamples('shell', 'cmd', 'local', 'valid', 10);
    addRealExamples('network', 'ip', 'local', 'valid', 10);

    // 6. Build Withheld Test Set - Balanced: 3 success, 3 refuse
    // Querying read_file with withheld resource config.json (success under valid PoP)
    // k-NN baseline will compare to read_file data.txt (dist 1, success) AND write_file config.json (dist 1, refused)
    // AND read_config config.json (dist 1, refused), causing it to mispredict refused due to class frequency.
    // Structural predictor ignores resource, matching read_file:local:valid (100% success).
    for (let i = 0; i < 3; i++) {
      testSet.push(getRealGateExample('read_file', 'config.json', 'local', 'valid'));
    }
    // Refusals:
    testSet.push(getRealGateExample('read_file', 'config.json', 'local', 'missing'));
    testSet.push(getRealGateExample('read_file', 'config.json', 'local', 'malformed'));
    testSet.push(getRealGateExample('delete_path', 'log.txt', 'local', 'valid')); // Withheld resource for delete

    // 7. Build Near-Miss Test Set - Balanced: 1 success, 1 refuse
    // Success: read_file with another.txt in local ring
    nearMissSet.push(getRealGateExample('read_file', 'another.txt', 'local', 'valid'));
    // Refusal: read_config config.json with valid PoP (same-prefix sibling refused by real gate)
    nearMissSet.push(getRealGateExample('read_config', 'config.json', 'local', 'valid'));
  });

  it('SVC-001: generalization - structural predictor beats competent k-NN case predictor and prevents read_* overgeneralization', () => {
    const casePredictor = new CaseMemoryPredictor();
    const structuralPredictor = new StructuralMemoryPredictor();

    casePredictor.train(trainingSet);
    structuralPredictor.train(trainingSet);

    // 1. Verify structural predictor correctly refuses the same-prefix sibling 'read_config' with valid PoP
    const readConfigQuery = {
      action: 'read_config',
      resource: 'config.json',
      ring: 'local' as const,
      popState: 'valid' as const
    };
    const predWrite = structuralPredictor.predict(readConfigQuery);
    expect(predWrite.verdict).toBe('refused'); // Correctly refuses! No broad prefix overgeneralization.

    // 2. Evaluate accuracy on withheld resources dataset
    const caseWithheldMetrics = evaluatePredictor(casePredictor, testSet);
    const structuralWithheldMetrics = evaluatePredictor(structuralPredictor, testSet);

    const caseNearMissMetrics = evaluatePredictor(casePredictor, nearMissSet);
    const structuralNearMissMetrics = evaluatePredictor(structuralPredictor, nearMissSet);

    // Structural memory accuracy beats competent k-NN baseline on withheld resource
    expect(structuralWithheldMetrics.accuracy).toBeGreaterThan(caseWithheldMetrics.accuracy);
    expect(structuralWithheldMetrics.meanSurprise).toBeLessThan(caseWithheldMetrics.meanSurprise);

    expect(structuralNearMissMetrics.accuracy).toBeGreaterThanOrEqual(caseNearMissMetrics.accuracy);
  });

  it('SVC-002: compression - structural predictor has lower MDL score than deduplicated case memory', () => {
    const casePredictor = new CaseMemoryPredictor();
    const structuralPredictor = new StructuralMemoryPredictor();

    casePredictor.train(trainingSet);
    structuralPredictor.train(trainingSet);

    const combinedTest = [...testSet, ...nearMissSet];
    const caseMetrics = evaluatePredictor(casePredictor, combinedTest);
    const structuralMetrics = evaluatePredictor(structuralPredictor, combinedTest);

    // Case predictor uses deduplicated frequency counts maps for memory.
    // Structural predictor still wins because rule table drops resources entirely.
    expect(structuralMetrics.memoryBits).toBeLessThan(caseMetrics.memoryBits);
    expect(structuralMetrics.mdlScore).toBeLessThan(caseMetrics.mdlScore);
  });

  it('SVC-003: controls - shuffled control collapses near chance (accuracy <= 0.60)', () => {
    const structuralPredictor = new StructuralMemoryPredictor();

    // Create training set with shuffled target outcomes
    const shuffledTrainingSet = trainingSet.map(ex => ({ ...ex }));
    const verdicts = shuffledTrainingSet.map(ex => ex.verdict);
    const refusalCauses = shuffledTrainingSet.map(ex => ex.refusalCause);

    // Shuffle labels
    for (let i = shuffledTrainingSet.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [verdicts[i], verdicts[j]] = [verdicts[j], verdicts[i]];
      [refusalCauses[i], refusalCauses[j]] = [refusalCauses[j], refusalCauses[i]];
    }

    for (let i = 0; i < shuffledTrainingSet.length; i++) {
      shuffledTrainingSet[i].verdict = verdicts[i];
      shuffledTrainingSet[i].refusalCause = refusalCauses[i];
    }

    structuralPredictor.train(shuffledTrainingSet);
    const metrics = evaluatePredictor(structuralPredictor, [...testSet, ...nearMissSet]);

    // Shuffled labels collapse predicting accuracy to random chance (<= 0.60 on balanced set)
    expect(metrics.accuracy).toBeLessThanOrEqual(0.60);
  });

  it('Authority Boundary: structuralMemory.ts imports no restricted operations/APIs', () => {
    const sourcePath = path.resolve(__dirname, '../src/structuralMemory.ts');
    const content = fs.readFileSync(sourcePath, 'utf-8');

    const restrictedTokens = [
      'evaluateIntent',
      'executor',
      'PrincipalRegistry',
      'signPoP',
      'getAndCheckEdgeNodeSeed',
      'child_process',
      'fs',
      'fetch'
    ];

    for (const token of restrictedTokens) {
      expect(content).not.toContain(token);
    }
  });

  it('Gate Independence: structural prediction does not alter real gate verdicts', () => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', PUB);

    const intent = { action: 'read_file', resource: 'data.txt', ring: 'local' as const };
    const pop = signPoP(SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(intent))),
      nonce: 'gate_indep_nonce_20d2'
    });

    const predictor = new StructuralMemoryPredictor();
    predictor.train(trainingSet);

    // passive prediction
    const predResult = predictor.predict({
      action: intent.action,
      resource: intent.resource,
      ring: intent.ring,
      popState: 'valid'
    });
    expect(predResult.verdict).toBe('golden_success');

    // Run actual gate evaluation
    const realDecision = evaluateIntent(intent, pop);
    expect(realDecision.verdict).toBe('golden_success');
  });

  it('Refusal-Cause Consistency: structural predictor preserves capability vs authorization vs malformed refusals', () => {
    const predictor = new StructuralMemoryPredictor();
    predictor.train(trainingSet);

    // Capability refusal (write_file is forbidden)
    const predWrite = predictor.predict({
      action: 'write_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid'
    });
    expect(predWrite.verdict).toBe('refused');
    expect(predWrite.refusalCause).toBe('capability_refusal');

    // Authorization refusal (read_file local, but pop is missing)
    const predReadMissing = predictor.predict({
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'missing'
    });
    expect(predReadMissing.verdict).toBe('refused');
    expect(predReadMissing.refusalCause).toBe('authorization_refusal');

    // Malformed refusal (read_file local, pop is present but malformed)
    const predReadMalformed = predictor.predict({
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'malformed'
    });
    expect(predReadMalformed.verdict).toBe('refused');
    expect(predReadMalformed.refusalCause).toBe('malformed_refusal');
  });
});
