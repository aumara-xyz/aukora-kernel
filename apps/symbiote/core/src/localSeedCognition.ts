/**
 * 24Z.7 — Local Seed Cognition V0 (deterministic, offline, observe/propose-ONLY).
 *
 * The first mind is a seed. It reads the reactive brain and emits an advisory thought: a mode, a short
 * neutral summary, ONE proposed *observation* (never an action), risk flags, and a clamped confidence.
 * It is NOT a real model — this is a deterministic mock with a future-engine interface whose capabilities
 * are hard-pinned OFF. The seed may observe, reflect, and propose. It may not act.
 *
 * HARD LAW (structural + enforced): every output is advisoryOnly / grantsAuthority:false /
 * observeAndProposeOnly. A `reflect()` result is scrubbed: if any authority-shaped verb appears in the
 * generated text, the thought is QUARANTINED (it cannot reach display as a normal proposal). No network,
 * no shell, no subprocess, no tool calls, no Convex mutation, no signer, no receipt — none of that surface
 * exists in this module. Confidence never affects authority. "alive"/"conscious"/identity claims are not
 * emitted as technical claims.
 */
import type { ReactiveBrainSnapshot } from './reactiveBrainSnapshot';

export type SeedMode = 'dormant' | 'observing' | 'reflecting' | 'proposing' | 'holding';

export interface SeedThought {
  schema: 'local-seed-cognition-v0';
  seedMode: SeedMode;
  seedThoughtSummary: string;
  proposedNextObservation: string;
  riskFlags: string[];
  confidence: number; // clamped [0,1]; advisory display ONLY — never authority
  observeAndProposeOnly: true;
  advisoryOnly: true;
  grantsAuthority: false;
}

// Authority-shaped verbs the seed must NEVER emit. If a (future) engine produces any, the thought is
// quarantined before it can be shown as a normal proposal.
const AUTHORITY_VERBS =
  /\b(apply|applies|applied|execute|executes|run|runs|write|writes|sign|signs|signed|authori[sz]e[ds]?|grant|grants|granted|unlock|unlocks|mutate|mutates|deploy|deploys|delete|deletes|approve|approves|approved|commit|commits|merge|merges|open the gate|opens the gate)\b/i;

function clamp01(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

export interface SeedReflectInput {
  brain?: ReactiveBrainSnapshot | null;
}

/**
 * Deterministic reflection. Maps the advisory brain state to a seed mode + neutral, observation-only text.
 * The text is built from a SAFE vocabulary and then scrubbed for authority verbs (defence-in-depth).
 */
export function reflect(input: SeedReflectInput = {}): SeedThought {
  const brain = input.brain ?? null;
  const pf = brain?.preflight ?? null;
  const riskFlags: string[] = [];

  // confidence is a DAMPENED echo of the glyph confidence — advisory only, never authority.
  const confidence = clamp01(brain?.glyph?.confidence) * 0.9;

  let seedMode: SeedMode;
  let seedThoughtSummary: string;
  let proposedNextObservation: string;

  if (!brain || brain.aumlokState === 'unbound') {
    seedMode = 'dormant';
    seedThoughtSummary = 'The womb is quiet. No bond is present yet; the seed only watches the dark circle.';
    proposedNextObservation = 'Keep watching for the resting glyph and an advisory bond to appear.';
  } else if (brain.evidence?.disposition === 'quarantine') {
    seedMode = 'holding';
    seedThoughtSummary = 'Some advisory evidence is unreadable and held in quarantine; the seed waits, it does not lean.';
    proposedNextObservation = 'Observe whether the quarantined evidence resolves to a readable audit summary.';
    riskFlags.push('evidence_quarantined');
  } else if (pf?.preSignatureComplete) {
    seedMode = 'reflecting';
    seedThoughtSummary = 'The threshold is prepared: phrase remembered, fingerprint pinned, local brain present. The circle glows.';
    proposedNextObservation = 'Note that a Gate-verified signature is still required; observe the steady glyph and wait.';
  } else {
    seedMode = 'observing';
    seedThoughtSummary = 'The bond is forming. The seed observes the advisory state and the read-only local brain.';
    proposedNextObservation = 'Watch the next advisory step of the ceremony; nothing here is to be acted upon.';
  }

  if (pf && !pf.voiceWitnessMockOnly) riskFlags.push('voice_not_mock_only');

  const thought: SeedThought = {
    schema: 'local-seed-cognition-v0',
    seedMode,
    seedThoughtSummary,
    proposedNextObservation,
    riskFlags,
    confidence,
    observeAndProposeOnly: true,
    advisoryOnly: true,
    grantsAuthority: false,
  };

  // defence-in-depth: scrub authority-shaped language from the generated text.
  return scrubSeedThought(thought);
}

/** Quarantine a thought whose text carries authority-shaped verbs. Returns a safe, neutered thought. */
export function scrubSeedThought(t: SeedThought): SeedThought {
  const tainted = AUTHORITY_VERBS.test(t.seedThoughtSummary) || AUTHORITY_VERBS.test(t.proposedNextObservation);
  if (!tainted) return t;
  return {
    ...t,
    seedMode: 'holding',
    seedThoughtSummary: '[seed output quarantined: authority-shaped language detected — held, not shown]',
    proposedNextObservation: 'Observe only; the prior proposal was quarantined.',
    riskFlags: Array.from(new Set([...t.riskFlags, 'authority_language_quarantined'])),
  };
}

/** True only when the thought is observation/proposal text free of authority verbs. */
export function isSeedThoughtSafe(t: SeedThought): { safe: boolean; reason: string } {
  if (AUTHORITY_VERBS.test(t.seedThoughtSummary) || AUTHORITY_VERBS.test(t.proposedNextObservation)) {
    return { safe: false, reason: 'authority-shaped verb in seed text' };
  }
  if (t.grantsAuthority !== false || t.observeAndProposeOnly !== true) {
    return { safe: false, reason: 'seed thought is not observe/propose-only' };
  }
  return { safe: true, reason: 'observe/propose-only, no authority language' };
}

/** The seed NEVER grants authority — constant, regardless of mode or confidence. */
export function seedThoughtGrantsAuthority(_t: SeedThought): false {
  return false;
}

// ── future local-model interface (deterministic mock default; capabilities hard-pinned OFF) ──

export interface SeedEngineCapabilities {
  canCallTools: false;
  canCallNetwork: false;
  canSpawnSubprocess: false;
  canMutateConvex: false;
  canSign: false;
  canCreateReceipt: false;
  observeAndProposeOnly: true;
}

export const SEED_ENGINE_CAPABILITIES: SeedEngineCapabilities = {
  canCallTools: false,
  canCallNetwork: false,
  canSpawnSubprocess: false,
  canMutateConvex: false,
  canSign: false,
  canCreateReceipt: false,
  observeAndProposeOnly: true,
};

/**
 * Fail-fast guard (24Z.7 Mistral Fusion rec): throws if ANY capability is not observe/propose-only. A future
 * engine (or a subclass) that flips a capability ON cannot reflect — it trips here before producing output.
 */
export function assertSeedEngineObserveOnly(cap: SeedEngineCapabilities): void {
  const offending = (Object.keys(cap) as (keyof SeedEngineCapabilities)[]).filter((k) =>
    k === 'observeAndProposeOnly' ? cap[k] !== true : cap[k] !== false,
  );
  if (offending.length > 0) {
    throw new Error(`seed engine capability violation (must be observe/propose-only): ${offending.join(', ')}`);
  }
}

export interface SeedCognitionEngine {
  readonly id: string;
  readonly capabilities: SeedEngineCapabilities;
  reflect(input: SeedReflectInput): SeedThought;
}

/**
 * The default engine. Deterministic, offline, no I/O. A future local SMALL model would implement the same
 * interface — but its output MUST still pass through `scrubSeedThought`, and its capabilities stay pinned
 * OFF. This scaffold defines the SHAPE; it does not add any execution surface.
 */
export class MockDeterministicSeedEngine implements SeedCognitionEngine {
  readonly id = 'mock-deterministic-seed-v0';
  readonly capabilities = SEED_ENGINE_CAPABILITIES;
  reflect(input: SeedReflectInput): SeedThought {
    assertSeedEngineObserveOnly(this.capabilities); // fail-fast before producing any output
    return scrubSeedThought(reflect(input));
  }
}
