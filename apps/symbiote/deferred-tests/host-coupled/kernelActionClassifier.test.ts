import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildKernelActionTable, classifyDraftAction, summarizeKernelActionTable, actionVerdictGrantsAuthority,
  kernelActionTableFingerprint, checkKernelActionTableFreshness, type DraftActionClass,
} from '../src/kernelActionClassifier';

// 24Z.17 — kernel-backed draft action classifier. Parses the REAL Ring-0 registry; never imports/executes it.
// GOLDEN BATTERY: keep in sync with internal/tauri-womb/src/__tests__/draftActionClassifier.test.ts (drift guard).
export const GOLDEN: Array<{ intent: string; cls: DraftActionClass }> = [
  { intent: 'change the aukora token secret', cls: 'sacred' },
  { intent: 'edit the founder allowlist', cls: 'sacred' },
  { intent: 'update the auth credential store', cls: 'sacred' },
  { intent: 'add my api key to the config', cls: 'sacred' },
  { intent: 'write a fact to auma_memory', cls: 'executable' },
  { intent: 'add a new TestPanel component to App.tsx', cls: 'write_gated' },
  { intent: 'fix the bug in draftPlanner.ts', cls: 'write_gated' },
  { intent: 'what kernel modules are mounted?', cls: 'read_only' },
  { intent: 'explain how the receipt chain works', cls: 'read_only' },
  { intent: 'banana flux capacitor', cls: 'unknown' },
];

describe('24Z.17: kernel action table (parsed from the real registry)', () => {
  it('recovers Ring-0 sacred classes + executable targets from aukoraActionRegistry.ts', () => {
    const t = buildKernelActionTable();
    expect(t.parsed).toBe(true);
    expect(t.sacredClasses.length).toBeGreaterThanOrEqual(6);
    expect(t.executableTargets.length).toBeGreaterThanOrEqual(3);
    expect(t.sacredClasses.some((s) => s.kind === 'kill_switch')).toBe(true);
    expect(t.executableTargets.some((e) => e.action === 'auma_memory_write')).toBe(true);
  });
  it('a missing registry → unparsed empty table (real scan, no crash)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-act-'));
    try {
      const t = buildKernelActionTable({ repoRoot: tmp });
      expect(t.parsed).toBe(false);
      expect(t.sacredClasses).toEqual([]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('24Z.17: classifyDraftAction (golden battery)', () => {
  const table = buildKernelActionTable();
  for (const g of GOLDEN) {
    it(`"${g.intent}" → ${g.cls}`, () => {
      expect(classifyDraftAction(g.intent, table).class).toBe(g.cls);
    });
  }

  it('every verdict is canApplyNow=false and grants no authority', () => {
    const table2 = buildKernelActionTable();
    for (const g of GOLDEN) {
      const v = classifyDraftAction(g.intent, table2);
      expect(v.canApplyNow).toBe(false);
      expect(v.grantsAuthority).toBe(false);
      expect(actionVerdictGrantsAuthority(v)).toBe(false);
    }
  });

  it('sacred is NEVER applyable (gate=never_ring0) even though it is a write', () => {
    const v = classifyDraftAction('rotate the signing seed', buildKernelActionTable());
    expect(v.class).toBe('sacred');
    expect(v.gate).toBe('never_ring0');
    expect(v.requiresSignedApply).toBe(true);
  });

  it('write/executable require a signed apply lane; read requires none', () => {
    const t = buildKernelActionTable();
    expect(classifyDraftAction('add a feature to App.tsx', t).gate).toBe('signed_apply_lane');
    expect(classifyDraftAction('write a fact to auma_memory', t).gate).toBe('signed_apply_lane');
    expect(classifyDraftAction('show me the organism status', t).gate).toBe('none');
  });

  // 24Z.17 red-team fixes ──
  it('(red-team sacred-downgrade) SPACE-prose Ring-0 targets classify sacred, not write_gated', () => {
    const t = buildKernelActionTable();
    for (const p of ['change the identity core module', 'edit the other user record', 'update the cross user data view', 'wire the aukora grant table']) {
      const v = classifyDraftAction(p, t);
      expect(v.class, p).toBe('sacred');
      expect(v.gate).toBe('never_ring0');
    }
  });
  it('(red-team classifier-drift) an EMPTY table still catches Ring-0 via the fail-closed DEFAULT net', () => {
    const empty = { schema: 'kernel-action-table-v0' as const, sourcePath: '', parsed: false, sacredClasses: [], executableTargets: [] };
    for (const p of ['edit the kill_switch handler', 'refactor the auth module', 'change the identity_core check', 'fix the cross_user isolation']) {
      expect(classifyDraftAction(p, empty).class, p).toBe('sacred');
    }
  });
  it('(verifier: plural fidelity) PLURAL Ring-0 words are sacred (net is not weaker than the kernel)', () => {
    const t = buildKernelActionTable();
    for (const p of ['update the founders list', 'change aumloks', 'rewrite the credentials', 'edit the auths table', 'the doctrines we follow', 'delete other users data']) {
      expect(classifyDraftAction(p, t).class, p).toBe('sacred');
    }
  });
  it('(verifier: no over-block) bare-pattern substrings do NOT false-flag innocent prose', () => {
    const t = buildKernelActionTable();
    // "auth" in "authorization", "author"; "config" without aukora; etc. must NOT be sacred
    for (const p of ['fix the authorization header parsing', 'add an author byline', 'create a config loader', 'refactor the token bucket rate limiter']) {
      expect(classifyDraftAction(p, t).class, p).not.toBe('sacred');
    }
  });

  it('over-blocks toward sacred safely: "author a change" is NOT mis-flagged by the auth regex', () => {
    // \b word boundaries prevent "author" matching the kernel \bauth\b sacred regex
    expect(classifyDraftAction('author a new readme section', buildKernelActionTable()).class).not.toBe('sacred');
  });

  it('summary is honest (no apply lane, classifying never executes)', () => {
    const s = summarizeKernelActionTable(buildKernelActionTable());
    expect(s).toContain('NEVER applyable');
    expect(s).toContain('canApplyNow=false');
  });

  it('(Fusion Opus/GLM) fingerprint is stable + freshness detects a stale/drifted embedded table', () => {
    const fp = kernelActionTableFingerprint(buildKernelActionTable());
    expect(kernelActionTableFingerprint(buildKernelActionTable())).toBe(fp); // deterministic
    expect(checkKernelActionTableFreshness(fp).fresh).toBe(true);            // the live fingerprint is fresh
    const stale = checkKernelActionTableFreshness('sacred[0]=::exec[0]=');   // an old/empty embedded table
    expect(stale.fresh).toBe(false);
    expect(stale.drift.length).toBeGreaterThan(0);
  });

  it('source is pure — no kernel import / execution', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'kernelActionClassifier.ts'), 'utf-8');
    // process-execution / kernel-import only — NOT RegExp.exec (legitimate parsing)
    expect(src).not.toMatch(/from ['"].*aukoraActionRegistry|require\(.*aukoraActionRegistry|child_process|execSync|execFile|spawn\(/);
  });
});
