// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the release-readiness verdict — all pipeline checks passing = PIPELINE SOUND, a
// remaining SECURITY placeholder is an OWNER item (not a fault), and any pipeline fault blocks + exits.
import { describe, it, expect } from 'vitest';
import { evaluateReadiness, type ReadinessChecks } from '../../scripts/releaseReadinessCore';

const allPass: ReadinessChecks = {
  exportWrote: true, exportScanClean: true, excludedPathsAbsent: true, friendShareHeadClean: true,
  friendShareHistoryClean: true, freshHistoryOneRoot: true, licensePresent: true, securityContactFilled: true,
};

describe('evaluateReadiness', () => {
  it('all pipeline checks passing → PIPELINE SOUND, no blockers (owner items always remain)', () => {
    const v = evaluateReadiness(allPass);
    expect(v.pipelineSound).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.ownerItems.length).toBeGreaterThan(0); // the owner --final export can never be auto-certified
  });

  it('pipeline sound but SECURITY placeholder unfilled → still sound; the fill is an OWNER item, not a fault', () => {
    const v = evaluateReadiness({ ...allPass, securityContactFilled: false });
    expect(v.pipelineSound).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.ownerItems.some((o) => /SECURITY\.md/.test(o))).toBe(true);
  });

  it('a dirty exported tree (scan fails) is a hard blocker → not sound', () => {
    const v = evaluateReadiness({ ...allPass, exportScanClean: false });
    expect(v.pipelineSound).toBe(false);
    expect(v.blockers.some((b) => /TIER-1 secret scan/.test(b))).toBe(true);
  });

  it('a leaked excluded path is a hard blocker', () => {
    const v = evaluateReadiness({ ...allPass, excludedPathsAbsent: false });
    expect(v.pipelineSound).toBe(false);
    expect(v.blockers.some((b) => /leaked into the artifact/.test(b))).toBe(true);
  });

  it('inherited (multi-commit) history is a hard blocker', () => {
    const v = evaluateReadiness({ ...allPass, freshHistoryOneRoot: false });
    expect(v.pipelineSound).toBe(false);
    expect(v.blockers.some((b) => /fresh history/.test(b))).toBe(true);
  });

  it('the report names the verdict and always lists the final-export owner item', () => {
    const v = evaluateReadiness(allPass);
    expect(v.report).toContain('PIPELINE SOUND');
    expect(v.ownerItems.some((o) => /--final --git/.test(o))).toBe(true);
  });
});
