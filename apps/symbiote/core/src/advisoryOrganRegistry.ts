// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Advisory / evidence organ registry — the strip-neutrality rail. Every organ that produces EVIDENCE or
 * ADVICE (memory, council, posture, future custody/witness/channel/nodeImport/vision/latent-perceiver) is
 * registered here by module basename. The standing invariant (cohesionInvariants.test): the GATE
 * (`core/src/index.ts`) imports NONE of these — so their output can inform context but can NEVER change a
 * gate verdict. Evidence is never authority. As each new advisory organ lands, add its basename here.
 */
export const ADVISORY_ORGANS = Object.freeze([
  // memory — suggests, never authorizes
  'hypothesisMemory', 'episodeMemory', 'wombMemory', 'mdlProcessMemory', 'continuityConsolidation', 'structuralMemory',
  // sleep / burn — skill optimization, advisory only
  'sleepSkill', 'burnDataset',
  // fusion council — multi-model review, advisory only
  'fractalFusion', 'fractalFusionEvidence', 'fusionConfig', 'externalReview', 'fusionSwarm',
  'fusionSelfOpt', 'fusionAdvisoryArtifact',
  // read-only posture / inventory
  'proprioceptionSnapshot', 'convexBrainSnapshot', 'convexTopology', 'runtimeTruthManifest',
  // future surfaces — registered AHEAD of arrival so the rail catches them the moment they would touch the gate
  'aukoraWitness', 'aukoraChannel', 'aukoraNodeImport', 'codeAttestation', 'latentPerceiver',
] as const);

// VK is the ONE evidence the gate writes — via a single narrow adapter (`writeVkRow`), DOWNSTREAM of the
// verdict (it cannot change it). It is intentionally NOT in ADVISORY_ORGANS because the gate is allowed to
// call writeVkRow; the VK-boundary invariant proves the row grants no authority and the verdict is produced
// before the write. Any OTHER VK touch-point in the gate would be a violation.
export const VK_GATE_ADAPTER = 'writeVkRow';
