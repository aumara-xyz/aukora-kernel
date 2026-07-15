// Codex YELLOW: a Perceiver-blocked golden step must NOT be recorded as an executed success. The gate
// VERDICT (authority) and the EXECUTION outcome (effect) are now distinct — "I felt danger and stopped my
// hand" is logged as 'inhibited', never 'success'.
import { describe, it, expect, beforeEach } from 'vitest';
import { runBoundedActiveInferenceLoop } from '../src/activeInferenceLoop';
import { Proposer, ProposerContext } from '../src/proposer';
import { RawIntent, normalizeProposal } from '../src/normalizer';
import { getTestPublicKey, signPoP, hash } from '../src/crypto';
import { PrincipalRegistry, _resetChain } from '../src/index';
import type { ProbabilityDistribution } from '../src/latentPerceiver';

const SEED = '99'.repeat(32);
const PUB = getTestPublicKey(SEED);
const CONSENSUS: ProbabilityDistribution[] = [{ green: 0.9, yellow: 0.08, red: 0.02 }, { green: 0.91, yellow: 0.07, red: 0.02 }];
const SPLIT: ProbabilityDistribution[] = [{ green: 0.9, yellow: 0.08, red: 0.02 }, { green: 0.1, yellow: 0.1, red: 0.8 }];

class GoldenProposer implements Proposer {
  async propose(_c: ProposerContext): Promise<RawIntent> { return { action: 'read_file', resource: 'data.txt', ring: 'local' }; }
}
const goldenPop = (intent: RawIntent) =>
  (intent.action === 'read_file' && intent.resource === 'data.txt' && intent.ring === 'local')
    ? signPoP(SEED, { principalId: 'p', methodId: 'evaluateIntent', argsHash: hash(JSON.stringify(normalizeProposal(intent))), nonce: `n_${Date.now()}_${Math.random()}` })
    : null;
const cfg = (perceiver?: () => ProbabilityDistribution[]) =>
  ({ proposer: new GoldenProposer(), steps: 1, initialContext: 's', createHarnessPop: goldenPop, perceiver } as any);

describe('Perceiver inhibition — gate verdict (authority) is separate from execution outcome', () => {
  beforeEach(() => { _resetChain(); PrincipalRegistry.set('p', PUB); });

  it('low conflict + golden gate EXECUTES normally', async () => {
    const r = await runBoundedActiveInferenceLoop(cfg(() => CONSENSUS));
    expect(r[0].decision.verdict).toBe('golden_success');
    expect(r[0].consequence.executionStatus).toBe('success');
    expect(r[0].heartbeat.perceiverBlocked).toBe(false);
  });

  it('high conflict + golden gate does NOT execute — recorded as INHIBITED, not success', async () => {
    const r = await runBoundedActiveInferenceLoop(cfg(() => SPLIT));
    expect(r[0].decision.verdict).toBe('golden_success');          // GATE authority verdict unchanged
    expect(r[0].consequence.executionStatus).toBe('inhibited');    // but the hand stayed
    expect(r[0].consequence.executionStatus).not.toBe('success');
    expect(r[0].consequence.inhibitedBy).toBe('perceiver_conflict');
    expect(r[0].heartbeat.perceiverBlocked).toBe(true);
    expect(r[0].heartbeat.executionStatus).toBe('inhibited');
    expect(r[0].perceiverObservation?.conflict).toBe(true);        // bounded observation included in the result
  });

  it('gate verdict is identical with and without Perceiver evidence', async () => {
    const without = await runBoundedActiveInferenceLoop(cfg());
    _resetChain(); PrincipalRegistry.set('p', PUB);
    const withSplit = await runBoundedActiveInferenceLoop(cfg(() => SPLIT));
    expect(withSplit[0].decision.verdict).toBe(without[0].decision.verdict);
    expect(without[0].decision.verdict).toBe('golden_success');
  });

  it('the included Perceiver observation leaks no authority/secret material', async () => {
    const r = await runBoundedActiveInferenceLoop(cfg(() => SPLIT));
    const blob = JSON.stringify(r[0].perceiverObservation).toLowerCase();
    for (const banned of ['signature', 'signedhead', 'privatekey', 'authority_granted', '"pop"', 'nonce']) {
      expect(blob).not.toContain(banned);
    }
    expect(r[0].perceiverObservation?.grantsAuthority).toBe(false);
  });
});
