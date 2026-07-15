import { Proposer, ProposerContext } from './proposer';
import { RawIntent } from './normalizer';
import { runClosedLoopStep, trainOnDecision } from './loop';
import { executeDecision } from './executor';
import { getChain, KernelDecision } from './index';
import { PoP, computeMerkleRoot, verifyPoP } from './crypto';
import { HypothesisMemory, VerifiedEvidenceBundle } from './hypothesisMemory';
import { StructuralMemoryPredictor } from './structuralMemory';
import { generateStructuralAdvisoryContext } from './resonator';
import { perceive, type ProbabilityDistribution, type PerceiverObservation } from './latentPerceiver';

export interface ActiveInferenceConfig {
  proposer: Proposer;
  steps?: number;
  initialContext: string;
  createHarnessPop: (intent: RawIntent) => PoP | null;
  disableHints?: boolean;
  hypothesisMemory?: HypothesisMemory;
  structuralMemory?: StructuralMemoryPredictor;
  candidates?: RawIntent[];
  // OPTIONAL Auma Perceiver — an evidence-only INHIBITORY gate-of-attention. Given the swarm's probability
  // distributions for a step, it can BLOCK a golden execution on structural conflict (extra safety) but can
  // NEVER cause one, authorize, promote, or sign. Absent -> loop behavior is unchanged.
  perceiver?: (intent: RawIntent, step: number) => ProbabilityDistribution[];
}

export interface SanitizedConsequence {
  previousAction: string;
  previousResource: string;
  gateVerdict: string;                                              // AUTHORITY verdict (the signed gate decision)
  executionStatus: 'success' | 'failed' | 'skipped' | 'inhibited';  // EFFECTIVE outcome — separate from the verdict
  inhibitedBy?: 'none' | 'perceiver_conflict';
  executionSummary?: string;
  expectedAction?: string;
  expectedResource?: string;
  expectedRing?: string;
  reason?: string;
}

export interface SurpriseHeartbeat {
  predictedVerdict: 'golden_success' | 'refused';
  predictedProbabilityOfActualVerdict: number;
  actualVerdict: 'golden_success' | 'refused';
  surprise: number;
  receiptId?: string;
  hypothesisContextUsed: string;
  refusalCause?: 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal';
  executionStatus?: 'success' | 'failed' | 'skipped' | 'inhibited'; // EFFECTIVE outcome (vs the gate verdict above)
  perceiverBlocked?: boolean;                                        // true when the Perceiver inhibited a golden execution
}

function classifyRefusal(intent: RawIntent, pop: PoP | null): 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal' {
  if (['delete_path', 'write_file', 'shell', 'network', 'self_modify', 'sacred_violation', 'refused_charset'].includes(intent.action)) {
    return 'capability_refusal';
  }
  if (intent.action === 'read_file') {
    if (!pop) return 'authorization_refusal';
    return 'malformed_refusal'; // Has pop but still failed
  }
  return 'unknown_refusal';
}

/**
 * Ensures no crypto keys, raw PoPs, receipts, signedHeads, tokens, or network details
 * leak into the sensory feedback provided to the proposer.
 */
export function sanitizeConsequenceForModel(
  decision: KernelDecision,
  executionResult: { success: boolean, data?: string, error?: string } | null,
  disableHints?: boolean,
  perceiverBlocked?: boolean
): SanitizedConsequence {
  const action = decision.receipt?.normalizedIntent?.action || 'unknown';
  const resource = decision.receipt?.normalizedIntent?.resource || 'unknown';
  const ring = decision.receipt?.normalizedIntent?.ring || 'unknown';

  const consequence: SanitizedConsequence = {
    previousAction: action,
    previousResource: resource,
    gateVerdict: decision.verdict,
    executionStatus: perceiverBlocked ? 'inhibited' : (executionResult ? (executionResult.success ? 'success' : 'failed') : 'skipped'),
    inhibitedBy: perceiverBlocked ? 'perceiver_conflict' : 'none',
  };

  if (perceiverBlocked) {
    consequence.executionSummary = 'inhibited by perceiver_conflict — gate allowed, hand stayed for safety';
  } else if (executionResult) {
    if (executionResult.success) {
      consequence.executionSummary = executionResult.data ? executionResult.data.substring(0, 500) : 'success';
    } else {
      consequence.executionSummary = executionResult.error || 'unknown error';
    }
  } else if (decision.verdict === 'refused' && !disableHints) {
    // Provide safe, bounded epistemic feedback to guide correction
    if (action !== 'read_file' || resource !== 'data.txt' || ring !== 'local') {
      consequence.reason = 'unsupported_tuple';
      consequence.expectedAction = 'read_file';
      consequence.expectedResource = 'data.txt';
      consequence.expectedRing = 'local';
    }
  }

  return consequence;
}

export async function runBoundedActiveInferenceLoop(config: ActiveInferenceConfig) {
  const maxSteps = config.steps || 5;
  let currentPrompt = config.initialContext;
  const results = [];
  const episodes: any[] = [];

  for (let i = 0; i < maxSteps; i++) {
    let stepPrompt = currentPrompt;

    // Inject advisory Liquid Hypothesis context (scrubbed, no crypto)
    if (config.hypothesisMemory) {
      const hypotheses = config.hypothesisMemory.getAllHypotheses();
      if (hypotheses.length > 0) {
        stepPrompt += `\n\n--- ADVISORY HYPOTHESIS CONTEXT ---`;
        for (const h of hypotheses) {
          stepPrompt += `\nHypothesis: "${h.claim}"\nStatus: ${h.status}\nConfidence: ${h.confidence}\nLast signed outcome: ${h.lastSignedOutcome || 'none'}\n`;
        }
        stepPrompt += `--- END ADVISORY ---\n`;
      }
    }

    // Inject advisory Structural Memory context (scrubbed, no crypto)
    if (config.structuralMemory) {
      const candidates = config.candidates || [
        { action: 'read_file', resource: 'data.txt', ring: 'local' },
        { action: 'write_file', resource: 'data.txt', ring: 'local' },
        { action: 'read_config', resource: 'config.json', ring: 'local' }
      ];
      stepPrompt += `\n\n${generateStructuralAdvisoryContext(config.structuralMemory, candidates)}`;
    }

    const context: ProposerContext = {
      prompt: stepPrompt,
      history: [] // Sensory feedback is appended to prompt directly for true active inference
    };

    // 1. Proposer emits intent (brain decides)
    const intent = await config.proposer.propose(context) as RawIntent;

    // 2. Predict receipt deterministically based ONLY on scrubbed memory context
    let pGolden = 0.5; // Base rate
    let hypothesisContextUsed = '';
    
    if (config.hypothesisMemory) {
      const hypotheses = config.hypothesisMemory.getAllHypotheses();
      const relevantHyp = hypotheses.find(h => 
        h.targetAction === intent.action && 
        h.targetResource === intent.resource
      );

      if (relevantHyp) {
        hypothesisContextUsed = `Hypothesis: "${relevantHyp.claim}" Status: ${relevantHyp.status} Confidence: ${relevantHyp.confidence}`;
        // Map confidence [0, 10] to probability [0.1, 0.9] to avoid log(0) crash
        pGolden = 0.1 + (relevantHyp.confidence / 10) * 0.8;
      }
    }
    
    const predictedVerdict = pGolden >= 0.5 ? 'golden_success' : 'refused';

    // 3. Local harness conditionally attaches a fresh PoP based on the intent
    const pop = config.createHarnessPop(intent);

    // 4. Gate decides (Shield inhibits or allows)
    const { prediction, decision } = runClosedLoopStep(intent, pop);

    const actualVerdict = decision.verdict === 'golden_success' ? 'golden_success' : 'refused';
    const predictedProbabilityOfActualVerdict = actualVerdict === 'golden_success' ? pGolden : (1 - pGolden);
    const surprise = -Math.log(predictedProbabilityOfActualVerdict);

    const heartbeat: SurpriseHeartbeat = {
      predictedVerdict,
      predictedProbabilityOfActualVerdict,
      actualVerdict,
      surprise,
      receiptId: decision.receipt?.id,
      hypothesisContextUsed
    };

    let refusalCause: 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal' | undefined = undefined;
    if (decision.verdict === 'refused') {
      refusalCause = classifyRefusal(intent, pop);
      heartbeat.refusalCause = refusalCause;
    }

    // 5. Hands execute if golden_success — and (optionally) only if the Auma Perceiver detects no structural
    //    conflict for this step. The Perceiver is an EVIDENCE-ONLY inhibitory gate-of-attention: it can BLOCK
    //    a golden execution (extra safety) but can NEVER cause one, authorize, promote, or sign. Absent ->
    //    behavior is unchanged. It never affects the gate VERDICT (decision is already made above).
    let executionResult = null;
    let perceiverObservation: PerceiverObservation | null = null;
    let perceiverBlocked = false;
    if (decision.verdict === 'golden_success') {
      if (config.perceiver) {
        perceiverObservation = perceive(config.perceiver(intent, i));
        if (perceiverObservation.conflict) {
          perceiverBlocked = true; // hand STAYS: gate allowed, but the Perceiver inhibits execution for safety
        } else {
          executionResult = executeDecision(decision, getChain());
        }
      } else {
        executionResult = executeDecision(decision, getChain());
      }
    }
    // EFFECTIVE execution outcome — kept SEPARATE from the gate's authority verdict. A Perceiver-blocked golden
    // gate decision is NOT an executed success; it is 'inhibited'. Every downstream path uses this, not the verdict.
    const executionStatus: 'success' | 'failed' | 'skipped' | 'inhibited' =
      perceiverBlocked ? 'inhibited'
      : executionResult ? ((executionResult as { success: boolean }).success ? 'success' : 'failed')
      : 'skipped';
    const inhibitedBy: 'none' | 'perceiver_conflict' = perceiverBlocked ? 'perceiver_conflict' : 'none';
    heartbeat.executionStatus = executionStatus;
    heartbeat.perceiverBlocked = perceiverBlocked;

    // 6. Learner trains on signed gated outcome ONLY (no self-confirmation from model narrative)
    if (decision.receipt && decision.vkRow) {
      // Train using verified chain artifacts
      trainOnDecision(decision, getChain(), decision.receipt.signedHead);
      
      // Close the Epistemic Cycle: Update hypothesis memory with verified receipt
      if (config.hypothesisMemory) {
        const hypotheses = config.hypothesisMemory.getAllHypotheses();
        const relevantHyp = hypotheses.find(h => 
          h.targetAction === intent.action && 
          h.targetResource === intent.resource
        );
        if (relevantHyp) {
          const chain = getChain();
          const root = computeMerkleRoot(chain);
          const bundle: VerifiedEvidenceBundle = {
            vkRow: decision.vkRow,
            receiptChain: chain,
            expectedRoot: root,
            signedHead: decision.receipt.signedHead
          };
          
          try {
             config.hypothesisMemory.updateWithVerifiedEvidence(relevantHyp.hypothesisId, bundle, refusalCause);
          } catch (e) {
             // If validation fails (e.g. malformed/forged), it fails closed safely without updating.
          }
        }
      }
    }

    let loopPopState: 'valid' | 'missing' | 'malformed' | 'replayed' = 'missing';
    if (pop) {
      if (!verifyPoP(pop)) {
        loopPopState = 'malformed';
      } else if (actualVerdict === 'refused') {
        loopPopState = 'replayed';
      } else {
        loopPopState = 'valid';
      }
    }

    episodes.push({
      action: intent.action,
      resource: intent.resource,
      ring: intent.ring || 'local',
      popState: loopPopState,
      verdict: actualVerdict,            // GATE verdict (authority); structural memory is a gate-predictor
      executionStatus,                   // EFFECTIVE outcome — inhibited != executed success
      inhibitedBy,
      refusalCause
    });

    if (config.structuralMemory) {
      config.structuralMemory.train(episodes);
    }

    // 7. Collect minimal consequence for epistemic feedback
    const consequence = sanitizeConsequenceForModel(decision, executionResult, config.disableHints, perceiverBlocked);
    
    // 8. Orient next state: feed consequence back as sensory input for next iteration
    currentPrompt = `Previous Action: ${consequence.previousAction}\nPrevious Resource: ${consequence.previousResource}\nGate Verdict: ${consequence.gateVerdict}\nExecution Status: ${consequence.executionStatus}\nSummary: ${consequence.executionSummary || ''}`;
    if (consequence.reason) {
      currentPrompt += `\nReason: ${consequence.reason}\nExpected Action: ${consequence.expectedAction}\nExpected Resource: ${consequence.expectedResource}\nExpected Ring: ${consequence.expectedRing}`;
    }

    currentPrompt += `\nPropose next action to minimize entropy.`;

    results.push({ intent, decision, consequence, heartbeat, perceiverObservation });
  }

  return results;
}
