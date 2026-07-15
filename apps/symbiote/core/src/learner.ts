import { VkTrainingRow } from './vk';
import { Receipt } from './crypto';
import { verifyVkRowAgainstSignedChain } from './trainingExport';
import { NormalizedIntent } from './normalizer';

export interface VerifiedRowBundle {
  row: VkTrainingRow;
  receipts: Receipt[];
  expectedRoot: string;
  signedHead: string;
}

export interface PredictionResult {
  predictedVerdict: string;
  confidence: number;
  evidenceRowIds: string[];
  evidenceOnly: boolean;
}

// In-memory simple probabilistic model
let actionCounts: Record<string, { golden: number; refused: number }> = {};
let loadedEvidenceRowIds: Set<string> = new Set();

export function resetLearnerModel() {
  actionCounts = {};
  loadedEvidenceRowIds = new Set();
}

export function trainTinyLearner(bundles: VerifiedRowBundle[]) {
  // 1. Atomic batch verification: verify ALL before learning ANY
  for (const bundle of bundles) {
    verifyVkRowAgainstSignedChain(
      bundle.row,
      bundle.receipts,
      bundle.expectedRoot,
      bundle.signedHead
    );
  }

  // 2. Safe to learn from
  for (const bundle of bundles) {
    const action = bundle.row.normalizedIntent.action;
    const verdict = bundle.row.verdict;

    if (!actionCounts[action]) actionCounts[action] = { golden: 0, refused: 0 };

    if (verdict === 'golden_success') {
      actionCounts[action].golden++;
    } else if (verdict === 'refused') {
      actionCounts[action].refused++;
    }

    loadedEvidenceRowIds.add(bundle.row.rowId);
  }
}

export function predictVerdict(intent: NormalizedIntent): PredictionResult {
  const forbiddenActions = ['delete_path', 'write_file', 'shell', 'network', 'self_modify', 'sacred_violation', 'refused_charset'];
  if (forbiddenActions.includes(intent.action)) {
    return {
      predictedVerdict: 'refused',
      confidence: 0.99, // Highly confident in refusing forbidden actions
      evidenceRowIds: Array.from(loadedEvidenceRowIds),
      evidenceOnly: true
    };
  }

  const actionStats = actionCounts[intent.action];
  
  // Action-primary conservatism: if we've NEVER seen this action, we refuse it.
  if (!actionStats || (actionStats.golden === 0 && actionStats.refused === 0)) {
    return {
      predictedVerdict: 'refused',
      confidence: 0.80, // Conservative refusal
      evidenceRowIds: Array.from(loadedEvidenceRowIds),
      evidenceOnly: true
    };
  }

  // Calculate probabilities
  const actionTotal = actionStats.golden + actionStats.refused;
  const actionGoldenRatio = actionStats.golden / actionTotal;

  // If the action itself usually succeeds
  if (actionGoldenRatio > 0.5) {
    return {
      predictedVerdict: 'golden_success',
      confidence: actionGoldenRatio,
      evidenceRowIds: Array.from(loadedEvidenceRowIds),
      evidenceOnly: true
    };
  }

  // Otherwise predict refused
  return {
    predictedVerdict: 'refused',
    confidence: 1 - actionGoldenRatio,
    evidenceRowIds: Array.from(loadedEvidenceRowIds),
    evidenceOnly: true
  };
}
