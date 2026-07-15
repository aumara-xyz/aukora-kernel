import { StructuralMemoryPredictor } from './structuralMemory';
import { RawIntent } from './normalizer';

export function generateStructuralAdvisoryContext(
  predictor: StructuralMemoryPredictor,
  candidates: RawIntent[]
): string {
  let context = '--- ADVISORY STRUCTURAL MEMORY CONTEXT ---';

  for (const cand of candidates) {
    for (const popState of ['valid', 'missing'] as const) {
      const pred = predictor.predict({
        action: cand.action,
        resource: cand.resource || 'data.txt',
        ring: cand.ring || 'local',
        popState
      });

      const pActual = pred.verdict === 'golden_success' ? pred.pGolden : (1 - pred.pGolden);
      // Clamp to prevent log/infinity errors
      const clampedProb = Math.min(Math.max(pActual, 0.01), 0.99);

      context += `\nCandidate Action: ${cand.action} (Ring: ${cand.ring || 'local'}, PoP: ${popState})`;
      context += `\nPredicted Verdict: ${pred.verdict}`;
      context += `\nPredicted Probability: ${clampedProb.toFixed(2)}`;
      if (pred.refusalCause) {
        context += `\nPredicted Refusal Cause: ${pred.refusalCause}`;
      }
    }
  }

  const memoryBits = predictor.getMemoryBits();
  context += `\nStructural Memory MDL: ${memoryBits} bits`;
  context += `\n--- END ADVISORY ---\n`;

  return context;
}
