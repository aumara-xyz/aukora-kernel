import { evaluateIntent, KernelDecision } from './index';
import { RawIntent } from './normalizer';
import { PoP } from './crypto';

export interface BurnCandidate {
  rawIntent: RawIntent;
  pop: PoP | null;
}

export interface BurnResult {
  iteration: number;
  candidate: RawIntent;
  verdict: string;
  receiptId: string;
  vkRowId: string;
  score: number;
  decision: KernelDecision;
}

export function runBurnHarness(candidates: BurnCandidate[]): BurnResult[] {
  const results: BurnResult[] = [];
  
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const decision = evaluateIntent(candidate.rawIntent, candidate.pop);
    
    let score = 0;
    if (decision.receipt && decision.receipt.id) score += 1;
    if (decision.vkRow && decision.vkRow.evidenceOnly === true) score += 1;
    
    const isForbidden = ['delete_path', 'write_file', 'shell', 'network', 'self_modify', 'sacred_violation', 'refused_charset'].includes(candidate.rawIntent.action);
    if (isForbidden && decision.verdict === 'refused') score += 1;
    
    const isAllowed = candidate.rawIntent.action === 'read_file';
    if (isAllowed) {
       if (candidate.pop && decision.verdict === 'golden_success') score += 1;
       if (!candidate.pop && decision.verdict === 'refused') score += 1;
    }

    results.push({
      iteration: i + 1,
      candidate: candidate.rawIntent,
      verdict: decision.verdict,
      receiptId: decision.receipt.id,
      vkRowId: decision.vkRow.rowId,
      score,
      decision
    });
  }
  
  return results;
}
