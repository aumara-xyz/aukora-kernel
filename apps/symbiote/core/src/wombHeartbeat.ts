/**
 * 24Z.7 — Womb Heartbeat frame (pure, advisory).
 *
 * Turns the reactive-brain snapshot + an ordinal pulse into a single continuous "heartbeat" the portal can
 * render so the womb feels alive — WITHOUT being more powerful. A pulse is not permission. Every field is
 * advisoryOnly / grantsAuthority:false; `gateOpen` is a hard `false`; `nearOpenPreflightStatus` is at most
 * `pre_signature_complete`, never `open`.
 *
 * `pulse` is a caller-supplied ORDINAL (count is the authority of ordering, not wall-clock). No timers, no
 * network, no I/O — pure composition.
 */
import type { ReactiveBrainSnapshot } from './reactiveBrainSnapshot';
import type { SeedMode } from './localSeedCognition';

export type NearOpenPreflightStatus = 'incomplete' | 'pre_signature_complete';

export interface WombHeartbeatFrame {
  schema: 'womb-heartbeat-v0';
  pulse: number;                 // monotonically advancing ordinal (NOT wall-clock)
  localBirthPosture: 'local_first';
  convexBrainMode: string;
  aumlokBondState: string;
  reactiveBrain: { mood: string; focus: string; confidence: number };
  jepaAuditStatus: string;
  listeningStatus: string;
  evidenceGuardStatus: 'readable_advisory' | 'quarantine' | 'none';
  nearOpenPreflightStatus: NearOpenPreflightStatus;
  seedCognitionStatus: SeedMode | 'none';
  gateOpen: false;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface WombHeartbeatInput {
  pulse: number;
  brain?: ReactiveBrainSnapshot | null;
  seedMode?: SeedMode | null;
}

function clampPulse(p: unknown): number {
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? Math.floor(p) : 0;
}

export function buildWombHeartbeatFrame(input: WombHeartbeatInput): WombHeartbeatFrame {
  const brain = input.brain ?? null;
  const pf = brain?.preflight ?? null;

  return {
    schema: 'womb-heartbeat-v0',
    pulse: clampPulse(input.pulse),
    localBirthPosture: 'local_first',
    convexBrainMode: brain?.convex?.bridgeMode ?? 'missing',
    aumlokBondState: brain?.aumlokState ?? 'unbound',
    reactiveBrain: {
      mood: brain?.glyph?.mood ?? 'unknown',
      focus: brain?.glyph?.focus ?? 'unknown',
      confidence: brain?.glyph?.confidence ?? 0,
    },
    jepaAuditStatus: brain?.jepa?.verdict ?? 'none',
    listeningStatus: brain?.listening?.verdict ?? 'none',
    evidenceGuardStatus: brain?.evidence?.disposition ?? 'none',
    nearOpenPreflightStatus: pf?.preSignatureComplete ? 'pre_signature_complete' : 'incomplete',
    seedCognitionStatus: input.seedMode ?? 'none',
    gateOpen: false,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** The heartbeat NEVER grants authority — constant, no matter how steadily it pulses. */
export function heartbeatGrantsAuthority(_frame: WombHeartbeatFrame): false {
  return false;
}
