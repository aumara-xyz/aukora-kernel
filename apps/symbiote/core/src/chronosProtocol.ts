// Chronos Protocol: Time-Domain Encoding for AI-to-AI Intelligence Transfer
// DESIGNED — requires bare-metal hardware with deterministic latency.
// Type definitions only; no implementation logic (standard cloud APIs cannot support microsecond precision).

// F-1: Pulse-width modulation envelope
export interface ChronosPulse {
  readonly pulseDurationMicroseconds: number;
  readonly gapDurationMicroseconds: number;
  readonly sequenceIndex: number;
  readonly carrierFrequencyHz: number;
}

// F-2: Non-phase-locked carrier for bidirectional communication
export interface CarrierFrequencyConfig {
  readonly baselineHz: number;
  readonly phaseAvoidanceMarginRadians: number;
  readonly spiralDirection: 'clockwise' | 'counterclockwise';
  readonly agentId: string;
}

export interface DualSpiralChannel {
  readonly agentA: CarrierFrequencyConfig;
  readonly agentB: CarrierFrequencyConfig;
  readonly sharedCarrierHz: number;
}

// F-3: Timestamp meta-encoding for hypothesis operations
export interface TimestampedHypothesisOp {
  readonly operationType: 'read' | 'write' | 'promote' | 'contradict';
  readonly hypothesisId: string;
  readonly absoluteTimestampMs: number;
  readonly interOpGapMs: number;
  readonly impliedConfidenceBand?: number;
}

// F-4: Temporal frequency analysis over receipt-verified timestamps
export interface TemporalBehaviorSignature {
  readonly agentId: string;
  readonly windowStartReceiptId: string;
  readonly windowEndReceiptId: string;
  readonly dominantFrequencyHz: number;
  readonly harmonics: readonly number[];
  readonly confidenceOscillationPeriodMs: number;
  readonly signatureHash: string;
}

// F-5: Phase-shift dictionary — confidence to timing delay mapping
export interface PhaseShiftEntry {
  readonly confidenceFloor: number;
  readonly confidenceCeiling: number;
  readonly delayMicroseconds: number;
  readonly phaseOffsetRadians: number;
}

export interface PhaseShiftDictionary {
  readonly version: string;
  readonly entries: readonly PhaseShiftEntry[];
  readonly resolutionMicroseconds: number;
  readonly dictionaryHash: string;
}

// F-6: Dual-channel communication (payload + timing)
export interface ChronosEnvelope {
  readonly discretePayload: Uint8Array;
  readonly timingChannel: readonly ChronosPulse[];
  readonly dictionaryVersion: string;
  readonly senderAgentId: string;
  readonly recipientAgentId: string;
}

// Engineering requirement marker — cannot implement over standard cloud APIs
export const CHRONOS_REQUIRES = {
  hardwareType: 'bare_metal_shared_memory' as const,
  alternativeHardware: 'dedicated_point_to_point_fiber' as const,
  minimumClockPrecision: 'nanosecond' as const,
  jitterTolerance: 'sub_microsecond' as const,
  cloudApiCompatible: false as const,
} as const;
