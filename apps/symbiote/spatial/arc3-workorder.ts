// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// The ARC lane's first lawful crossing (THE GREAT MERGE #178, round 4): when
// a finished MK·PULSE run has NAMED a silent door, the finding may become a
// proposal-intent DRAFT — through the exact ceremony chat/voice already use
// (core/src/proposalIntent.ts). Advisory speech, nothing more: the draft
// writes nothing to the repo, grants no authority, and only the owner's
// AUMLOK signature — after workbench re-verification — can ever turn any of
// it into a change. The owner signs or ignores. Nothing self-applies.
//
// Boundaries, by construction:
//   · gated OFF by default (AUKORA_ARC3_WORKORDERS=1 to enable) — the same
//     default-off shape as Fusion's auto-review stage;
//   · the hollow control port never drafts (silent by design is not a finding);
//   · affected paths are labelled `inferred` — the game knows the door's URL,
//     never the file; the honesty spine stays intact;
//   · one draft per finding: the intent id is a content hash, so re-drafting
//     the same finding lands on the same file (idempotent, no gate spam).

import { buildProposalIntent, writeProposalIntent } from '../core/src/proposalIntent';
import { buildArc3GameReceipt, writeArc3GameReceipt } from '../core/src/arc3GameReceipt';
import type { PulseSurface } from './arc3-pulse';

// Where an operator would LOOK for each door — stated hints, never facts.
const SURFACE_SCRIPTS: Record<string, string> = {
  spatial: 'spatial/serve.ts',
  'chat-door': 'spatial/chat-serve.ts',
  'arc-door': 'spatial/arc3-serve.ts',
  brain: 'scripts/brain-setup.ts',
};

export interface PulseFinding {
  surface: PulseSurface;
  guid: string;
  level: number;   // the level this naming completed
  probes: number;  // how many times the silent door was probed, mark included
}

export type WorkOrderResult =
  | { drafted: true; intentId: string; path: string }
  | { drafted: false; reason: string };

export function maybeDraftPulseWorkOrder(
  finding: PulseFinding,
  opts: { enabled?: boolean; homeDir?: string } = {},
): WorkOrderResult {
  const enabled = opts.enabled ?? process.env.AUKORA_ARC3_WORKORDERS === '1';
  if (!enabled) return { drafted: false, reason: 'work orders are gated off (set AUKORA_ARC3_WORKORDERS=1)' };
  if (finding.surface.name === 'hollow') {
    return { drafted: false, reason: 'the hollow control is silent by design — no order for a door that has none' };
  }
  const script = SURFACE_SCRIPTS[finding.surface.name];
  const intent = buildProposalIntent({
    goal: `restart the '${finding.surface.name}' door — the pulse game named it silent`,
    rationale: `MK·PULSE run ${finding.guid} (level ${finding.level}) probed ${finding.surface.url} `
      + `${finding.probes} time${finding.probes === 1 ? '' : 's'} and it never answered; the mark — a repeat `
      + `probe — confirmed silence. Advisory finding from a read-only game: every probe was a loopback GET, `
      + `and the receipts live in the run.`,
    affectedPaths: [{
      path: script ?? `(operator to locate the server behind ${finding.surface.url})`,
      epistemicStatus: 'inferred',
      note: 'the game knows the door URL, never the file — the workbench or an operator must verify',
    }],
    riskNotes: 'Advisory only. A restart is an operator action; this draft grants nothing, applies nothing, '
      + 'and the owner may sign or ignore it. The game that authored it cannot write to the repo, sign, or apply.',
    authoredBy: 'arc3',
  });
  const path = writeProposalIntent(intent, opts.homeDir);
  // Beside the intent: the game's own receipt — structured, keyed by intentId,
  // so the signing screen can show exactly what the game saw. Best-effort and
  // display-only: a failed receipt write never blocks the (already-written)
  // intent, and the gate degrades to honest absence.
  writeArc3GameReceipt(buildArc3GameReceipt({
    intentId: intent.intentId,
    door: finding.surface.name,
    url: finding.surface.url,
    guid: finding.guid,
    level: finding.level,
    probes: finding.probes,
  }), opts.homeDir);
  return { drafted: true, intentId: intent.intentId, path };
}
