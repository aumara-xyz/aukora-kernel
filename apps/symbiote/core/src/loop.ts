import { evaluateIntent, KernelDecision } from './index';
import { predictVerdict, PredictionResult, trainTinyLearner, VerifiedRowBundle } from './learner';
import { RawIntent, normalizeProposal } from './normalizer';
import { PoP, Receipt, computeMerkleRoot } from './crypto';
import { exportVkRow, loadVkRow } from './trainingExport';
import { Proposer, ProposerContext } from './proposer';

export function runProposerStep(proposer: Proposer, context: ProposerContext, pop: PoP | null): LoopStepResult {
  const rawIntent = proposer.propose(context) as RawIntent;
  return runClosedLoopStep(rawIntent, pop);
}

export async function runProposerStepAsync(proposer: Proposer, context: ProposerContext, pop: PoP | null): Promise<LoopStepResult> {
  const rawIntent = await proposer.propose(context);
  return runClosedLoopStep(rawIntent, pop);
}

export interface LoopStepResult {
  prediction: PredictionResult;
  decision: KernelDecision;
}

/**
 * Closed Learner -> Gate -> Receipt Loop Step
 * 
 * 1. The learner predicts a verdict (evidence-only).
 * 2. The proposal is submitted to the kernel (evaluateIntent) along with the PoP.
 * 3. The kernel makes the absolute, authoritative decision and signs the chain.
 * 4. The prediction NEVER substitutes for the kernel's verdict.
 */
export function runClosedLoopStep(rawIntent: RawIntent, pop: PoP | null): LoopStepResult {
  const normalizedIntent = normalizeProposal(rawIntent);
  
  // 1. Learner predicts
  const prediction = predictVerdict(normalizedIntent);

  // 2. Gate decides (absolute authority)
  const decision = evaluateIntent(rawIntent, pop);

  return {
    prediction,
    decision
  };
}

/**
 * Safely authenticates a decision and feeds it back into the learner.
 * This proves that only gated decisions with authentic signatures can become training data.
 */
export function trainOnDecision(
  decision: KernelDecision,
  allReceipts: Receipt[],
  signedHead: string
) {
  // Export and reload to simulate offline data cycle
  const jsonStr = exportVkRow(decision.vkRow!);
  const reloadedRow = loadVkRow(jsonStr);

  const bundle: VerifiedRowBundle = {
    row: reloadedRow,
    receipts: allReceipts,
    expectedRoot: '', // Computed below
    signedHead
  };

  // Compute the expected root from the provided receipts array
  bundle.expectedRoot = computeMerkleRoot(allReceipts);

  trainTinyLearner([bundle]);
}

export interface BurnCandidate {
  rawIntent: RawIntent;
  pop: PoP | null;
}

export interface BurnResult {
  stepResults: LoopStepResult[];
}

/**
 * Runs a multi-step sequence through the closed loop.
 * Training is strictly mediated and optional per step.
 */
export function runClosedLoopBurn(
  candidates: BurnCandidate[],
  trainAfterStep: boolean,
  globalReceiptHistory: Receipt[] // Passed in so we can build the chain for training
): BurnResult {
  const stepResults: LoopStepResult[] = [];
  const currentReceipts = [...globalReceiptHistory];

  for (const candidate of candidates) {
    const result = runClosedLoopStep(candidate.rawIntent, candidate.pop);
    stepResults.push(result);

    // If there is a receipt (i.e. the intent was evaluated), add to our local tracking chain
    if (result.decision.receipt) {
      currentReceipts.push(result.decision.receipt);
      
      // Explicit, optional, gate-mediated training
      if (trainAfterStep) {
        trainOnDecision(
          result.decision,
          [...currentReceipts], // Pass the full chain up to this point
          result.decision.receipt.signedHead
        );
      }
    }
  }

  return { stepResults };
}
