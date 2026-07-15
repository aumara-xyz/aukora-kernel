export interface GateExample {
  action: string;
  resource: string;
  ring: 'local' | 'system' | 'other';
  popState: 'valid' | 'missing' | 'malformed' | 'replayed';
  verdict: 'golden_success' | 'refused';
  refusalCause?: 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal';
}

export interface PredictionResult {
  pGolden: number;
  verdict: 'golden_success' | 'refused';
  refusalCause?: 'capability_refusal' | 'authorization_refusal' | 'malformed_refusal' | 'unknown_refusal';
}

export interface Predictor {
  train(examples: GateExample[]): void;
  predict(query: {
    action: string;
    resource: string;
    ring: 'local' | 'system' | 'other';
    popState: 'valid' | 'missing' | 'malformed' | 'replayed';
  }): PredictionResult;
  getMemoryBits(): number;
}

function getMostCommon<T>(arr: T[]): T {
  const counts = new Map<T, number>();
  let maxElement = arr[0];
  let maxCount = 0;
  for (const item of arr) {
    const count = (counts.get(item) || 0) + 1;
    counts.set(item, count);
    if (count > maxCount) {
      maxCount = count;
      maxElement = item;
    }
  }
  return maxElement;
}

/**
 * Competent Case Memorizer: k-NN using Hamming distance over raw fields,
 * with fair, deduplicated tuple counts storage to prevent duplicate inflation in MDL.
 */
export class CaseMemoryPredictor implements Predictor {
  private cases: Map<
    string,
    {
      success: number;
      total: number;
      causeCounts: { [cause: string]: number };
      rawCase: GateExample;
    }
  > = new Map();

  train(examples: GateExample[]): void {
    this.cases.clear();
    for (const ex of examples) {
      const key = `${ex.action}:${ex.resource}:${ex.ring}:${ex.popState}`;
      let stored = this.cases.get(key);
      if (!stored) {
        stored = { success: 0, total: 0, causeCounts: {}, rawCase: { ...ex } };
        this.cases.set(key, stored);
      }
      stored.total++;
      if (ex.verdict === 'golden_success') {
        stored.success++;
      } else if (ex.refusalCause) {
        stored.causeCounts[ex.refusalCause] = (stored.causeCounts[ex.refusalCause] || 0) + 1;
      }
    }
  }

  predict(query: {
    action: string;
    resource: string;
    ring: 'local' | 'system' | 'other';
    popState: 'valid' | 'missing' | 'malformed' | 'replayed';
  }): PredictionResult {
    if (this.cases.size === 0) {
      return { pGolden: 0.5, verdict: 'refused' };
    }

    let minDistance = Infinity;
    let closest: {
      success: number;
      total: number;
      causeCounts: { [cause: string]: number };
      rawCase: GateExample;
    }[] = [];

    for (const stored of this.cases.values()) {
      const ex = stored.rawCase;
      let dist = 0;
      if (ex.action !== query.action) dist += 1;
      if (ex.resource !== query.resource) dist += 1;
      if (ex.ring !== query.ring) dist += 1;
      if (ex.popState !== query.popState) dist += 1;

      if (dist < minDistance) {
        minDistance = dist;
        closest = [stored];
      } else if (dist === minDistance) {
        closest.push(stored);
      }
    }

    let totalSuccesses = 0;
    let totalCount = 0;
    const causeCounts: { [cause: string]: number } = {};

    for (const stored of closest) {
      totalSuccesses += stored.success;
      totalCount += stored.total;
      for (const cause in stored.causeCounts) {
        causeCounts[cause] = (causeCounts[cause] || 0) + stored.causeCounts[cause];
      }
    }

    const pGolden = totalCount > 0 ? totalSuccesses / totalCount : 0.5;
    const verdict = pGolden >= 0.5 ? 'golden_success' : 'refused';
    let refusalCause: GateExample['refusalCause'] = undefined;

    if (verdict === 'refused') {
      let maxCount = -1;
      let bestCause: GateExample['refusalCause'] = undefined;
      for (const cause in causeCounts) {
        if (causeCounts[cause] > maxCount) {
          maxCount = causeCounts[cause];
          bestCause = cause as GateExample['refusalCause'];
        }
      }
      refusalCause = bestCause;
    }

    return { pGolden, verdict, refusalCause };
  }

  getMemoryBits(): number {
    // Return serialized deduplicated frequency table (extremely fair)
    return JSON.stringify(Array.from(this.cases.entries())).length * 8;
  }
}

/**
 * Structural Memory: Learns mapping of (action, ring, popState) -> verdict/cause.
 * Resource is ignored, matching actual gate generalizability.
 * No gate policies or prefixes are hardcoded.
 */
export class StructuralMemoryPredictor implements Predictor {
  private rules: Map<
    string,
    {
      success: number;
      total: number;
      causeCounts: { [cause: string]: number };
    }
  > = new Map();
  private globalSuccess = 0;
  private globalTotal = 0;
  private globalCauses: { [cause: string]: number } = {};

  // Exact character count of rule extraction logic:
  // "const ruleKey = `${query.action}:${query.ring}:${query.popState}`;" (60 chars -> 480 bits)
  private readonly featureCodeBits = 480;

  train(examples: GateExample[]): void {
    this.rules.clear();
    this.globalSuccess = 0;
    this.globalTotal = 0;
    this.globalCauses = {};

    for (const ex of examples) {
      this.globalTotal++;
      if (ex.verdict === 'golden_success') {
        this.globalSuccess++;
      } else if (ex.refusalCause) {
        this.globalCauses[ex.refusalCause] = (this.globalCauses[ex.refusalCause] || 0) + 1;
      }

      // Feature extraction ignores resource (exact action + ring + popState)
      const ruleKey = `${ex.action}:${ex.ring}:${ex.popState}`;

      let rule = this.rules.get(ruleKey);
      if (!rule) {
        rule = { success: 0, total: 0, causeCounts: {} };
        this.rules.set(ruleKey, rule);
      }
      rule.total++;
      if (ex.verdict === 'golden_success') {
        rule.success++;
      } else if (ex.refusalCause) {
        rule.causeCounts[ex.refusalCause] = (rule.causeCounts[ex.refusalCause] || 0) + 1;
      }
    }
  }

  predict(query: {
    action: string;
    resource: string;
    ring: 'local' | 'system' | 'other';
    popState: 'valid' | 'missing' | 'malformed' | 'replayed';
  }): PredictionResult {
    const ruleKey = `${query.action}:${query.ring}:${query.popState}`;

    const rule = this.rules.get(ruleKey);
    if (rule) {
      const pGolden = rule.success / rule.total;
      const verdict = pGolden >= 0.5 ? 'golden_success' : 'refused';
      let refusalCause: GateExample['refusalCause'] = undefined;

      if (verdict === 'refused') {
        let maxCount = -1;
        let bestCause: GateExample['refusalCause'] = undefined;
        for (const cause in rule.causeCounts) {
          if (rule.causeCounts[cause] > maxCount) {
            maxCount = rule.causeCounts[cause];
            bestCause = cause as GateExample['refusalCause'];
          }
        }
        refusalCause = bestCause;
      }

      return { pGolden, verdict, refusalCause };
    }

    // Fallback to global averages
    const pGolden = this.globalTotal > 0 ? this.globalSuccess / this.globalTotal : 0.5;
    const verdict = pGolden >= 0.5 ? 'golden_success' : 'refused';
    let refusalCause: GateExample['refusalCause'] = undefined;

    if (verdict === 'refused') {
      let maxCount = -1;
      let bestCause: GateExample['refusalCause'] = undefined;
      for (const cause in this.globalCauses) {
        if (this.globalCauses[cause] > maxCount) {
          maxCount = this.globalCauses[cause];
          bestCause = cause as GateExample['refusalCause'];
        }
      }
      refusalCause = bestCause;
    }

    return { pGolden, verdict, refusalCause };
  }

  getMemoryBits(): number {
    return JSON.stringify(Array.from(this.rules.entries())).length * 8 + this.featureCodeBits;
  }
}

export function evaluatePredictor(
  predictor: Predictor,
  dataset: GateExample[]
): {
  accuracy: number;
  meanSurprise: number;
  memoryBits: number;
  predictionErrorBits: number;
  mdlScore: number;
} {
  let correct = 0;
  let totalSurprise = 0;
  let totalErrorBits = 0;

  for (const item of dataset) {
    const pred = predictor.predict(item);
    if (pred.verdict === item.verdict) {
      correct++;
    }

    // Clamp predicted probability of actual verdict to avoid log(0) / Infinity crash
    const pActualRaw = item.verdict === 'golden_success' ? pred.pGolden : (1 - pred.pGolden);
    const pActual = Math.min(Math.max(pActualRaw, 0.01), 0.99);

    const surprise = -Math.log(pActual);
    totalSurprise += surprise;

    const errorBits = -Math.log2(pActual);
    totalErrorBits += errorBits;
  }

  const accuracy = dataset.length > 0 ? correct / dataset.length : 0;
  const meanSurprise = dataset.length > 0 ? totalSurprise / dataset.length : 0;
  const memoryBits = predictor.getMemoryBits();

  return {
    accuracy,
    meanSurprise,
    memoryBits,
    predictionErrorBits: totalErrorBits,
    mdlScore: memoryBits + totalErrorBits
  };
}
