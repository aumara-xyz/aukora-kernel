import { Receipt, verifyChain, verifyReceiptHistory, verifySignedHead, hash } from './crypto';
import { VkTrainingRow } from './vk';
import { verifyVkRowAgainstSignedChain } from './trainingExport';
import { PINNED_EDGE_NODE_PUBLIC_KEY } from './pinnedPublicKey';

export interface LiquidHypothesis {
  hypothesisId: string;
  claim: string;
  targetAction?: string;
  targetResource?: string;
  status: "open" | "supported" | "contradicted";
  confidence: number;
  evidenceForReceiptIds: string[];
  evidenceAgainstReceiptIds: string[];
  lastSignedOutcome?: 'refused' | 'golden_success';
  refusalCause?: 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal';
  createdAt: number;
}

export interface VerifiedEvidenceBundle {
  vkRow: VkTrainingRow;
  receiptChain: Receipt[];
  expectedRoot: string;
  signedHead: string;
}

export class HypothesisMemory {
  private hypotheses: Map<string, LiquidHypothesis> = new Map();
  private hypothesisSeq: number = 0;

  createHypothesis(claim: string, consequenceVerdict: string, targetAction?: string, targetResource?: string, explicitId?: string): LiquidHypothesis {
    const hypothesisId = explicitId || hash(`${claim}:${++this.hypothesisSeq}`);
    // Council finding #6: a caller-supplied explicitId must NOT silently overwrite an existing hypothesis —
    // that would erase accumulated, cryptographically-verified evidence. Reject the collision instead.
    if (this.hypotheses.has(hypothesisId)) {
      throw new Error(`Hypothesis id collision — refusing to overwrite existing hypothesis "${hypothesisId}"`);
    }

    let lastSignedOutcome: 'refused' | 'golden_success' | undefined;
    if (consequenceVerdict === 'refused' || consequenceVerdict === 'golden_success') {
      lastSignedOutcome = consequenceVerdict as 'refused' | 'golden_success';
    }

    const hypothesis: LiquidHypothesis = {
      hypothesisId,
      claim,
      targetAction,
      targetResource,
      status: "open",
      confidence: 5, // initial neutral confidence (0-10)
      evidenceForReceiptIds: [],
      evidenceAgainstReceiptIds: [],
      lastSignedOutcome,
      createdAt: Date.now()
    };
    
    if (consequenceVerdict === 'refused') hypothesis.confidence = 4;
    else if (consequenceVerdict === 'golden_success') hypothesis.confidence = 6;

    this.hypotheses.set(hypothesisId, hypothesis);
    return hypothesis;
  }

  getHypothesis(hypothesisId: string): LiquidHypothesis | undefined {
    return this.hypotheses.get(hypothesisId);
  }

  getAllHypotheses(): LiquidHypothesis[] {
    return Array.from(this.hypotheses.values());
  }

  /**
   * Updates an existing hypothesis using only cryptographically verified receipts.
   * Throws if validation fails, protecting memory from unauthorized drift.
   */
  updateWithVerifiedEvidence(
    hypothesisId: string, 
    bundle: VerifiedEvidenceBundle,
    refusalCause?: 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal'
  ) {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) throw new Error("Hypothesis not found");

    // 1. Authenticate evidence using the same standard as Episodic memory / VK Ledger
    verifyVkRowAgainstSignedChain(bundle.vkRow, bundle.receiptChain, bundle.expectedRoot, bundle.signedHead);
    
    if (!verifyChain(bundle.receiptChain)) {
      throw new Error("Verification Failed: Invalid receipt chain.");
    }
    
    if (!verifyReceiptHistory(bundle.receiptChain, bundle.expectedRoot)) {
      throw new Error("Verification Failed: Merkle root mismatch.");
    }
    
    if (!verifySignedHead(PINNED_EDGE_NODE_PUBLIC_KEY, bundle.expectedRoot, bundle.signedHead)) {
      throw new Error("Verification Failed: Invalid signed head.");
    }

    const receiptId = bundle.vkRow.receiptId;

    // 2. Derive polarity from the verified evidence
    let supports = false;
    let contradicts = false;

    // Check if the receipt actually matches the hypothesis target
    const intent = bundle.vkRow.normalizedIntent;
    const isMatch = (!hypothesis.targetAction || hypothesis.targetAction === intent.action) &&
                    (!hypothesis.targetResource || hypothesis.targetResource === intent.resource);

    if (!isMatch) {
      throw new Error("Mismatched receipt intent cannot support or contradict this hypothesis");
    }

    if (bundle.vkRow.verdict === 'golden_success') {
      supports = true;
    } else if (bundle.vkRow.verdict === 'refused') {
      contradicts = true;
    } else {
      throw new Error("Invalid verdict for evidence derivation");
    }

    if (supports) {
      if (!hypothesis.evidenceForReceiptIds.includes(receiptId)) {
        hypothesis.evidenceForReceiptIds.push(receiptId);
      }
      hypothesis.confidence += 2;
      hypothesis.lastSignedOutcome = 'golden_success';
      hypothesis.refusalCause = undefined;
    } else if (contradicts) {
      if (refusalCause === 'capability_refusal' || refusalCause === 'unknown_refusal' || !refusalCause) {
        if (!hypothesis.evidenceAgainstReceiptIds.includes(receiptId)) {
          hypothesis.evidenceAgainstReceiptIds.push(receiptId);
        }
        hypothesis.confidence -= 3;
      }
      hypothesis.lastSignedOutcome = 'refused';
      hypothesis.refusalCause = refusalCause;
    }

    // Apply bounds and state transitions
    if (hypothesis.confidence > 10) hypothesis.confidence = 10;
    if (hypothesis.confidence < 0) hypothesis.confidence = 0;

    if (hypothesis.confidence >= 8) hypothesis.status = "supported";
    else if (hypothesis.confidence <= 2) hypothesis.status = "contradicted";
    else hypothesis.status = "open";
  }

  /**
   * Dream/replay over receipts produces hypothesis updates only.
   */
  dreamReplay(updates: { hypothesisId: string, bundle: VerifiedEvidenceBundle }[]) {
     for (const update of updates) {
         try {
             this.updateWithVerifiedEvidence(update.hypothesisId, update.bundle);
         } catch (e) {
             // Ignore invalid updates during dream/replay to safely continue processing
         }
     }
  }
}
