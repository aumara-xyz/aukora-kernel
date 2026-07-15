// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the PURE verdict for "would a public release artifact be clean?" — a repeatable
// rehearsal of the release pipeline that any node can run (not the owner-only --final export). It
// takes the observed results of each check and produces a single READY / NOT-READY verdict, the hard
// pipeline blockers, and the remaining OWNER items (things only Peter can do). No filesystem/network.

export interface ReadinessChecks {
  // pipeline soundness — these must all hold for the SANITIZED artifact to be safe:
  exportWrote: boolean;            // the fixture export produced a tree
  exportScanClean: boolean;        // TIER-1 secret scan passes on the EXPORTED tree (even if source is red)
  excludedPathsAbsent: boolean;    // private/lab/coordination paths are absent from the artifact
  friendShareHeadClean: boolean;   // exported HEAD/ZIP carries no visitor PII
  friendShareHistoryClean: boolean;// exported fresh history carries no old visitor-data commits
  freshHistoryOneRoot: boolean;    // the export git tree is a single root commit (no inherited history)
  licensePresent: boolean;         // a root LICENSE exists (public release needs a license)
  // owner-only gates (not pipeline faults; block the ACTUAL public release):
  securityContactFilled: boolean;  // SECURITY.md no longer carries the <OWNER-FILL> placeholder
}

export interface ReadinessVerdict {
  pipelineSound: boolean;   // the export pipeline produces a clean artifact (provable by rehearsal)
  blockers: string[];       // hard pipeline faults (a bug to fix now)
  ownerItems: string[];     // remaining owner-only actions before public — never auto-certified here
  report: string;
}

const PIPELINE: { key: keyof ReadinessChecks; fail: string }[] = [
  { key: 'exportWrote', fail: 'the sanitized export did not produce a tree' },
  { key: 'exportScanClean', fail: 'the exported tree FAILS the TIER-1 secret scan — a private value would ship' },
  { key: 'excludedPathsAbsent', fail: 'an excluded private/lab/coordination path leaked into the artifact' },
  { key: 'friendShareHeadClean', fail: 'the exported HEAD/ZIP carries visitor PII' },
  { key: 'friendShareHistoryClean', fail: 'the exported history carries old visitor data' },
  { key: 'freshHistoryOneRoot', fail: 'the export is not a single-root fresh history (old history would be inherited)' },
  { key: 'licensePresent', fail: 'no root LICENSE is present' },
];

export function evaluateReadiness(c: ReadinessChecks): ReadinessVerdict {
  const blockers = PIPELINE.filter((p) => !c[p.key]).map((p) => p.fail);
  const ownerItems: string[] = [];
  if (!c.securityContactFilled) ownerItems.push('fill the SECURITY.md disclosure-contact placeholder (owner)');
  ownerItems.push('run the owner-only `releaseExport --final --git` on the owner node with private scan vectors');
  ownerItems.push('decide the private → public timing and publish deliberately');

  const pipelineSound = blockers.length === 0;

  const lines: string[] = [];
  lines.push(`RELEASE READINESS — ${pipelineSound ? 'PIPELINE SOUND ✓' : 'PIPELINE BLOCKED ✗'}`);
  if (blockers.length) { lines.push('BLOCKERS (fix now):'); for (const b of blockers) lines.push(`  ✗ ${b}`); }
  else lines.push('  the sanitized export produces a clean, fresh-history artifact.');
  lines.push('OWNER ITEMS remaining before public release:');
  for (const o of ownerItems) lines.push(`  • ${o}`);
  lines.push(pipelineSound
    ? 'VERDICT: the release PIPELINE is proven clean; public release is gated only on the owner items above.'
    : 'VERDICT: NOT READY — a pipeline blocker above must be fixed before any release.');
  return { pipelineSound, blockers, ownerItems, report: lines.join('\n') };
}
