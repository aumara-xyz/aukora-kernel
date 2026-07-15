// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the sanitized-export core, pinned. Private/research/runtime lanes are excluded;
// unsafe destinations refuse; final mode fails closed without owner vectors; the manifest is
// deterministic (order-independent, identical across repeated exports).
import { describe, it, expect } from 'vitest';
import {
  classifyForExport, validateDestination, finalModeAllowed, computeManifest, manifestHash,
  exportMode, renderExclusionReport, EXCLUSION_RULES,
} from '../../scripts/releaseExportManifest';

describe('classifyForExport — product ships, private lanes are held back', () => {
  const tracked = [
    'README.md', 'core/src/index.ts', 'spatial/app/shell.js',
    'lander/data/chats/example-conversation.example.json',   // synthetic → ships
    'lander/data/chats/c-real-visitor.json',                 // PII → excluded
    'lander/data/waitlist.jsonl',                            // PII → excluded
    'docs/NEBIUS_LAB_FINDINGS.md',                           // lab → excluded
    'GHP/canon/GHP_CORE_v2.md',                              // research → excluded
    'probes/gaussian-memory/probe.py',                       // research → excluded
    'dojobrain/dojo.ts',                                     // lab runtime → excluded
    'docs/mesh/handoff/GHP.md',                              // coordination → excluded
    'docs/mesh/2026-07-09/nebius-skunkworks-handoff.md',     // nebius → excluded
    'docs/CODEX_CHANNEL.md',                                 // coordination → excluded
    'docs/CODEX_MEGA_PROMPT.md',                             // agent ops (#319 §2D) → excluded
    'docs/CODEX_START_HERE.md',                              // agent ops (#319 §2D) → excluded
    'docs/OPEN_SOURCE_DECISION.md',                          // public decision doc → ships
    'scripts/scan-vectors.local.sh',                         // owner-private → excluded
    'state/convex/admin-key.txt',                            // runtime state → excluded
  ];
  const plan = classifyForExport(tracked);

  it('includes product files (incl. the synthetic .example) and nothing private', () => {
    expect(plan.include).toContain('README.md');
    expect(plan.include).toContain('spatial/app/shell.js');
    expect(plan.include).toContain('lander/data/chats/example-conversation.example.json');
    for (const priv of ['lander/data/chats/c-real-visitor.json', 'lander/data/waitlist.jsonl',
      'docs/NEBIUS_LAB_FINDINGS.md', 'docs/mesh/handoff/GHP.md', 'docs/CODEX_CHANNEL.md',
      'scripts/scan-vectors.local.sh', 'state/convex/admin-key.txt']) {
      expect(plan.include).not.toContain(priv);
    }
  });
  it('holds back every docs/CODEX_* agent-operations doc as lane-coordination, not just the channel (#319 §2D)', () => {
    for (const ops of ['docs/CODEX_CHANNEL.md', 'docs/CODEX_MEGA_PROMPT.md', 'docs/CODEX_START_HERE.md']) {
      expect(plan.include).not.toContain(ops);
      expect(plan.exclude.find((e) => e.path === ops)?.category).toBe('lane-coordination');
    }
    // a normal public docs/ file is unaffected by the CODEX_ prefix rule
    expect(plan.include).toContain('docs/OPEN_SOURCE_DECISION.md');
  });
  it('every exclusion carries a category, and the report is path/category/count (no contents)', () => {
    const cats = new Set(plan.exclude.map((e) => e.category));
    expect(cats.has('research-lab')).toBe(true);
    expect(cats.has('lane-coordination')).toBe(true);
    expect(cats.has('visitor-data')).toBe(true);
    expect(cats.has('owner-private')).toBe(true);
    const report = renderExclusionReport(plan.exclude);
    expect(report).toContain('EXPORT EXCLUSIONS');
    expect(report).toContain('research-lab');
    // paths appear; no file contents can (the function is given only paths)
    expect(report).toContain('docs/NEBIUS_LAB_FINDINGS.md');
  });
  it('the include set is sorted and stable', () => {
    expect(plan.include).toEqual([...plan.include].sort());
  });
});

describe('validateDestination — only a fresh dir outside the source is allowed', () => {
  const base = { destInsideSource: false, destExists: false, destNonEmpty: false, destIsSymlink: false, sourceDirty: false, dryRun: false };
  it('accepts a fresh external destination on a clean source', () => {
    expect(validateDestination(base).ok).toBe(true);
  });
  it('refuses a destination inside the source repo', () => {
    expect(validateDestination({ ...base, destInsideSource: true }).ok).toBe(false);
  });
  it('refuses a non-empty existing destination', () => {
    expect(validateDestination({ ...base, destExists: true, destNonEmpty: true }).ok).toBe(false);
  });
  it('refuses an existing empty destination too — exports always promote into a brand-new path', () => {
    expect(validateDestination({ ...base, destExists: true, destNonEmpty: false }).ok).toBe(false);
  });
  it('refuses a symlinked destination (escape risk)', () => {
    expect(validateDestination({ ...base, destIsSymlink: true }).ok).toBe(false);
  });
  it('refuses a dirty source unless dry-run', () => {
    expect(validateDestination({ ...base, sourceDirty: true }).ok).toBe(false);
    expect(validateDestination({ ...base, sourceDirty: true, dryRun: true }).ok).toBe(true);
  });
});

describe('finalModeAllowed — never certify a clean FINAL artifact without owner vectors', () => {
  it('final without owner vectors is refused', () => {
    expect(finalModeAllowed('final', false).ok).toBe(false);
  });
  it('final with owner vectors, and dry-run/fixture always, are allowed', () => {
    expect(finalModeAllowed('final', true).ok).toBe(true);
    expect(finalModeAllowed('dry-run', false).ok).toBe(true);
    expect(finalModeAllowed('fixture', false).ok).toBe(true);
  });
});

describe('computeManifest — deterministic, order-independent, identical across exports', () => {
  const filesA = [
    { path: 'b.txt', content: 'two' },
    { path: 'a.txt', content: 'one' },
    { path: 'nested/c.txt', content: 'three' },
  ];
  const filesB = [ // same content, different input order
    { path: 'nested/c.txt', content: 'three' },
    { path: 'a.txt', content: 'one' },
    { path: 'b.txt', content: 'two' },
  ];
  it('two exports of the same content produce the identical manifest + hash', () => {
    const m1 = computeManifest(filesA);
    const m2 = computeManifest(filesB);
    expect(m1).toBe(m2);
    expect(manifestHash(m1)).toBe(manifestHash(m2));
  });
  it('a single byte change flips the manifest hash', () => {
    const changed = computeManifest([{ path: 'a.txt', content: 'onE' }, ...filesA.slice(1)]);
    expect(manifestHash(changed)).not.toBe(manifestHash(computeManifest(filesA)));
  });
});

describe('exportMode — deterministic modes', () => {
  it('shell/command scripts are 0755, everything else 0644; git-exec bit honored', () => {
    expect(exportMode('scripts/start.sh', false)).toBe(0o755);
    expect(exportMode('First Contact.command', false)).toBe(0o755);
    expect(exportMode('README.md', false)).toBe(0o644);
    expect(exportMode('scripts/tool.ts', true)).toBe(0o755); // git says executable
  });
});

describe('EXCLUSION_RULES — every rule documents WHY (reviewable)', () => {
  it('no rule ships without a why', () => {
    for (const r of EXCLUSION_RULES) { expect(r.why.length).toBeGreaterThan(0); expect(r.category.length).toBeGreaterThan(0); }
  });
});
