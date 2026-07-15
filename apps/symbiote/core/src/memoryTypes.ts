import { RawIntent } from './normalizer';

// Liquid hypothesis memory (advisory tier).
export { LiquidHypothesis } from './hypothesisMemory';

// Dream/replay config — no live authority.
export interface DreamReplayConfig {
  readonly liveAuthority: false;
  readonly identityMutation: false;
  readonly canExecute: false;
  readonly canGrantAuthority: false;
  receiptChainSegment: readonly string[];
  maxReplaySteps: number;
}

// Multimodal proposer with invariant safety boundary.
export interface MultimodalProposal extends RawIntent {
  sourceModality: 'json' | 'visual' | 'vk_tensor' | 'audio';
  rawModalityPayload?: Uint8Array;
}

// Three-tier memory architecture.
export type MemoryTier = 'working' | 'episodic' | 'hypothesis';

export interface MemoryTierPolicy {
  tier: MemoryTier;
  requiresChainVerification: boolean;
  mutable: boolean;
  persistent: boolean;
}

export const MEMORY_TIER_POLICIES: readonly MemoryTierPolicy[] = [
  { tier: 'working', requiresChainVerification: false, mutable: true, persistent: false },
  { tier: 'episodic', requiresChainVerification: true, mutable: false, persistent: true },
  { tier: 'hypothesis', requiresChainVerification: true, mutable: true, persistent: true },
] as const;
