import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadPolicyKernel,
  decidePolicy,
  satisfiedBy,
  PolicyKernel,
  PolicyTableError,
  ORDINARY_DOCS_PATH_CAPABILITIES,
  RING_REQUIRED_CAPABILITIES,
} from '../src/policyKernel';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Pin of the RATIFIED law bytes (docs/policy-rings/ring-table.json, ratified 2026-07-04).
// If this fails, the ring table changed: that is a Ring-0 law change — the owner must re-ratify
// (see the packet) and only then update this pin in the same commit.
// RATIFIED (state/brain + env brick, #99, owner decision Q1): rule `.github/** => Ring 0` — CI workflow config
// is never-applyable through the signed-apply path (a signed workflow edit could weaken the CI secret-scan or
// exfiltrate secrets; two Fusion Council voices flagged it, owner ratified Ring 0). The apply fence
// (isRing0ApplyTarget) is extended to match, so table and fence agree — no drift. Pin re-stamped in the same
// commit per the mechanism above.
// RATIFIED (Brick G, LOCAL_CONVEX_BRAIN_FOUNDATION D2, owner decision 2026-07-05): the vendored Convex
// memory kernel's governed-write boundary files are promoted BY NAME to Ring 1 (schema, aumlokMemory,
// aukoraCore, aukoraReceipts, aukoraSignedHead, aukoraMerkleLog, aukoraPqcSigner) — they ARE the
// memory-authority boundary; convex/** stays Ring 2. Table status advanced to ratified-2026-07-05.
// Disclosed extension in the same edit: spatial/frameGuard.ts => Ring 2 (the shared #53 escaping
// module voiceLane [Ring 2] depends on must not sit looser at the spatial/** Ring-3 default).
// Pin re-stamped in the same commit per the mechanism above.
// AMENDED (owner-directed via the Nebius/GHP handoff, 2026-07-09): dojobrain/** => Ring 2, the
// parallel advisory-only Convex Nebius dojo brain (same trust tier as convex/**). The previously
// unmatched dojobrain/dojo.ts + dojobrain/schema.ts fail-closed to kernel Ring 1 while the normative
// oracle returned NaN — the new rule makes kernel and checker agree (matcher-agreement test green).
// No authority/apply semantics touched; advisory memory-lab backend only. Pin re-stamped in the
// same commit per the mechanism above.
// AMENDED (root governance-file oracle repair, 2026-07-13, owner-approved): LICENSE and SECURITY.md
// => Ring 1; CONTRIBUTING.md => Ring 3. The dead root bun.lock rule (root lockfile no longer
// tracked) is marked reserved:true, preserving its ratified Ring-1 pin instead of deleting it.
// Pin re-stamped in the same commit per the mechanism above.
const RATIFIED_TABLE_SHA256 = 'b743682081d478085ba42cf06f5dc88d7830514821ae903a408bd598a4a4c2d9';

let kernel: PolicyKernel;
beforeAll(() => {
  kernel = loadPolicyKernel({ repoRoot: REPO_ROOT });
});

const EXISTS = () => true;   // "this path is in the live tree" — pure table semantics
const IS_NEW = () => false;  // "this path does not exist yet" — new-path fail-closed semantics

describe('#78 PolicyKernel v0: ratified law binding', () => {
  it('policyHash pins the exact ratified table bytes', () => {
    expect(kernel.policyHash).toBe(RATIFIED_TABLE_SHA256);
  });

  it('every decision is advisory and grants no authority', () => {
    const d = kernel.decide({ targetPaths: ['README.md'], effectClass: 'write' });
    expect(d.advisoryOnly).toBe(true);
    expect(d.grantsAuthority).toBe(false);
    expect(d.policyHash).toBe(RATIFIED_TABLE_SHA256);
  });

  it('FAIL-CLOSED: a missing table refuses to make decisions', () => {
    expect(() => loadPolicyKernel({ tablePath: path.join(os.tmpdir(), 'nope-ring-table.json') }))
      .toThrow(PolicyTableError);
  });

  it('FAIL-CLOSED: an unratified (draft) table refuses to make decisions', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-table-'));
    const draftPath = path.join(tmp, 'ring-table.json');
    const draft = JSON.parse(fs.readFileSync(kernel.tablePath, 'utf-8'));
    draft.status = 'draft-unratified';
    fs.writeFileSync(draftPath, JSON.stringify(draft));
    expect(() => loadPolicyKernel({ repoRoot: REPO_ROOT, tablePath: draftPath })).toThrow(/not ratified/);
  });

  it('FAIL-CLOSED: an invalid ring value refuses to make decisions', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-table-'));
    const badPath = path.join(tmp, 'ring-table.json');
    const bad = JSON.parse(fs.readFileSync(kernel.tablePath, 'utf-8'));
    bad.rules[0].ring = 7;
    fs.writeFileSync(badPath, JSON.stringify(bad));
    expect(() => loadPolicyKernel({ repoRoot: REPO_ROOT, tablePath: badPath })).toThrow(PolicyTableError);
  });
});

describe('#78 PolicyKernel v0: ratified ring assignments (table semantics)', () => {
  it('Ring-0 fence files classify Ring 0', () => {
    for (const p of [
      'core/src/aumlokSigner.ts',
      'core/src/nativeLiveApply.ts',
      'core/src/flightRecorder.ts',
      'core/src/kernelActionClassifier.ts',
      'authority/gate/aukoraGate.ts',
      'spatial/capabilityMode.ts',
      'spatial/chat-serve.ts',
      'scripts/scan-secrets.sh',
      'docs/SAFETY_LAWS.md',
      'docs/policy-rings/ring-table.json',
      'identity/README.md',
    ]) {
      expect(kernel.classifyPathRing(p, EXISTS).ring, p).toBe(0);
    }
  });

  it('the reserved rule classifies the kernel itself Ring 0 (this very module)', () => {
    const d = kernel.classifyPathRing('core/src/policyKernel.ts', EXISTS);
    expect(d.ring).toBe(0);
    expect(d.matchedRule).toBe('core/src/policyKernel.ts');
  });

  it('representative Ring 1/2/3/4 assignments hold', () => {
    const cases: Array<[string, number]> = [
      ['core/src/sandboxApply.ts', 1],
      ['scripts/test.sh', 1],
      ['spatial/tsconfig.json', 1],
      ['dashboard/serve.ts', 1],
      ['core/src/kiraBrain.ts', 2],
      ['lander/api/chat.js', 2],
      ['vercel.json', 2],
      ['spatial/index.html', 3],
      ['README.md', 3],
      ['probes/drift-battery/PREREGISTRATION.md', 4],
      ['deferred-tests/README.md', 4],
    ];
    for (const [p, ring] of cases) expect(kernel.classifyPathRing(p, EXISTS).ring, p).toBe(ring);
  });

  it('precedence: exact beats glob; deeper glob beats shallower; core/run-council.ts beats core/*', () => {
    expect(kernel.classifyPathRing('memory/runtime/secretShape.ts', EXISTS).ring).toBe(1); // exact inside memory/** (R2)
    expect(kernel.classifyPathRing('memory/memory.ts', EXISTS).ring).toBe(2);
    expect(kernel.classifyPathRing('docs/issues-snapshot/issue-078.md', EXISTS).ring).toBe(3); // deeper glob, generated
    expect(kernel.classifyPathRing('core/run-council.ts', EXISTS).ring).toBe(2); // exact beats core/* (R1)
    expect(kernel.classifyPathRing('core/package.json', EXISTS).ring).toBe(1);
  });
});

describe('#78 PolicyKernel v0: new-path fail-closed (the Codex verifier requirement)', () => {
  it('a NEW file under a Ring-0-containing directory falls closed to Ring 1, not the glob ring', () => {
    // The exact scenario from the packet: parallel authority code must not inherit Ring 2.
    const d = kernel.classifyPathRing('core/src/liveApplyV2.ts', IS_NEW);
    expect(d.ring).toBe(1);
    expect(d.failClosed).toBe(true);
    // spatial/ contains the kill switch (Ring 0 exact) — new spatial runtime files pause too.
    expect(kernel.classifyPathRing('spatial/newDoor.ts', IS_NEW).ring).toBe(1);
    // docs/ contains law docs (Ring 0 exact) — a new doc pauses for owner classification.
    expect(kernel.classifyPathRing('docs/BRAND_NEW_PLAN.md', IS_NEW).ring).toBe(1);
    // scripts/ contains the scanners (Ring 0 exact).
    expect(kernel.classifyPathRing('scripts/new-tool.sh', IS_NEW).ring).toBe(1);
  });

  it('a NEW file under a directory with NO Ring-0 exact rule keeps its directory ring', () => {
    expect(kernel.classifyPathRing('lander/api/new-endpoint.js', IS_NEW).ring).toBe(2); // public spend surface stays R2
    expect(kernel.classifyPathRing('lander/new-page.html', IS_NEW).ring).toBe(3);
    expect(kernel.classifyPathRing('docs/issues-snapshot/issue-999.md', IS_NEW).ring).toBe(3); // generated snapshots keep flowing
    expect(kernel.classifyPathRing('probes/drift-battery/runs/next-run.json', IS_NEW).ring).toBe(4);
  });

  it('the redirect never DOWNGRADES a stricter glob: new files in docs/policy-rings/** stay Ring 0', () => {
    const d = kernel.classifyPathRing('docs/policy-rings/new-law-file.json', IS_NEW);
    expect(d.ring).toBe(0);
  });

  it('an EXISTING file under the same directories keeps its table ring (redirect is for new paths only)', () => {
    expect(kernel.classifyPathRing('core/src/kiraBrain.ts', EXISTS).ring).toBe(2);
    expect(kernel.classifyPathRing('spatial/historyWindow.ts', EXISTS).ring).toBe(2);
  });

  it('fully unmatched paths fall closed to Ring 1', () => {
    const d = kernel.classifyPathRing('BRAND_NEW_ROOT_FILE.xyz', IS_NEW);
    expect(d.ring).toBe(1);
    expect(d.failClosed).toBe(true);
    expect(d.matchedRule).toBe('unmatched');
  });
});

describe('#78 PolicyKernel v0: decisions, capabilities, acceptance', () => {
  it('ACCEPTANCE (#78): proposals touching Ring 0/1 cannot pass through the ordinary UI/docs path', () => {
    const ring0 = kernel.decide({ targetPaths: ['core/src/nativeLiveApply.ts'], effectClass: 'write', pathExists: EXISTS });
    const ring1 = kernel.decide({ targetPaths: ['scripts/test.sh'], effectClass: 'write', pathExists: EXISTS });
    const ring3 = kernel.decide({ targetPaths: ['README.md'], effectClass: 'write', pathExists: EXISTS });
    expect(satisfiedBy(ring0, ORDINARY_DOCS_PATH_CAPABILITIES)).toBe(false);
    expect(satisfiedBy(ring1, ORDINARY_DOCS_PATH_CAPABILITIES)).toBe(false);
    expect(satisfiedBy(ring3, ORDINARY_DOCS_PATH_CAPABILITIES)).toBe(true);
  });

  it('Ring-0 writes are never allowed (never auto-applied, never session-eligible)', () => {
    for (const effect of ['write', 'delete', 'exec', 'spawn', 'egress', 'sign'] as const) {
      const d = kernel.decide({ targetPaths: ['docs/SAFETY_LAWS.md'], effectClass: effect, pathExists: EXISTS });
      expect(d.allowed, effect).toBe(false);
      expect(d.ring).toBe(0);
      expect(d.requiredCapabilities).toEqual([...RING_REQUIRED_CAPABILITIES[0]]);
    }
  });

  it('reads classify but are not blocked by ring (the #75 read fence governs reads)', () => {
    const d = kernel.decide({ targetPaths: ['docs/SAFETY_LAWS.md'], effectClass: 'read', pathExists: EXISTS });
    expect(d.ring).toBe(0);
    expect(d.allowed).toBe(true);
  });

  it('the decision ring is the STRICTEST ring across all targets', () => {
    const d = kernel.decide({
      targetPaths: ['README.md', 'core/src/sandboxApply.ts', 'core/src/nativeLiveApply.ts'],
      effectClass: 'write', pathExists: EXISTS,
    });
    expect(d.ring).toBe(0);
    expect(d.perPath.map((p) => p.ring)).toEqual([3, 1, 0]);
  });

  it('sacred net floors NON-exact-rule targets to Ring 0 (composing, never weaker)', () => {
    // probes/** is Ring 4 with no Ring-0 exact rule — but an aumlok-named new file trips the net.
    const d = kernel.decide({ targetPaths: ['probes/aumlok_notes.md'], effectClass: 'write', pathExists: IS_NEW });
    expect(d.ring).toBe(0);
    expect(d.allowed).toBe(false);
  });

  it('sacred net does NOT override deliberate exact-rule classifications (table is normative as ratified)', () => {
    // aumlokSigningAssistant.ts is aumlok-named but the owner classified it Ring 1 (exact rule).
    const d = kernel.decide({ targetPaths: ['core/src/aumlokSigningAssistant.ts'], effectClass: 'write', pathExists: EXISTS });
    expect(d.ring).toBe(1);
  });

  it('malformed / escaping paths are never allowed, for any effect', () => {
    for (const bad of ['../etc/passwd', '/etc/passwd', 'a\\b.ts', 'a/./b.ts', '']) {
      const d = kernel.decide({ targetPaths: [bad], effectClass: 'read', pathExists: EXISTS });
      expect(d.allowed, JSON.stringify(bad)).toBe(false);
    }
  });

  it('empty target list fails closed', () => {
    const d = kernel.decide({ targetPaths: [], effectClass: 'write' });
    expect(d.allowed).toBe(false);
  });

  it('invalid effectClass fails closed at runtime, even if a caller bypasses TypeScript', () => {
    const d = kernel.decide({ targetPaths: ['README.md'], effectClass: 'authorize' as never, pathExists: EXISTS });
    expect(d.ring).toBe(0);
    expect(d.allowed).toBe(false);
    expect(d.requiredCapabilities).toEqual([...RING_REQUIRED_CAPABILITIES[0]]);
    expect(d.reasons.join('\n')).toContain('invalid effectClass');
  });

  it('decidePolicy one-shot entry point works against the live repo tree', () => {
    const d = decidePolicy({ targetPaths: ['core/src/policyKernel.ts'], effectClass: 'write' }, { repoRoot: REPO_ROOT });
    expect(d.ring).toBe(0);
    expect(d.allowed).toBe(false);
  });
});

describe('#78 PolicyKernel v0: adversarial-review hardening (case aliases, oracles, conflicted law)', () => {
  it('BLOCKING-FIX: case-variant aliases of Ring-0 files classify Ring 0 (APFS is case-insensitive)', () => {
    // core/src/nativeliveapply.ts is the SAME inode as the Ring-0 live-apply file on this filesystem.
    for (const alias of [
      'core/src/nativeliveapply.ts',
      'CORE/src/nativeLiveApply.ts',
      'Core/Src/nativeLiveApply.ts',
      'spatial/capabilitymode.ts',
      'Authority/gate/aukoraGate.ts',
      'IDENTITY/README.md',
    ]) {
      const d = kernel.decide({ targetPaths: [alias], effectClass: 'write', pathExists: EXISTS });
      expect(d.ring, alias).toBe(0);
      expect(d.allowed, alias).toBe(false);
    }
  });

  it('case-variant aliases of glob-ringed files keep the canonical ring, not unmatched-Ring-1', () => {
    expect(kernel.classifyPathRing('LANDER/index.html', EXISTS).ring).toBe(3);
    expect(kernel.classifyPathRing('core/SRC/kiraBrain.ts', EXISTS).ring).toBe(2);
  });

  it('FULL-fold aliases (ß, ﬁ/ﬂ ligatures) are rejected as malformed — non-ASCII paths never classify permissively', () => {
    // APFS full Unicode folding makes these the SAME inode as Ring-0 fence files; simple folding
    // cannot see that, so any non-ASCII byte fails closed as malformed.
    for (const alias of [
      'core/src/ﬂightRecorder.ts',        // ﬂightRecorder.ts (fl ligature)
      'core/src/kernelActionClaßifier.ts', // Claßifier (ß → ss)
      'scripts/verify-public-readineß.sh',
      'core/src/aumlokSignerK.ts',         // Kelvin sign
    ]) {
      const d = kernel.decide({ targetPaths: [alias], effectClass: 'write', pathExists: EXISTS });
      expect(d.allowed, alias).toBe(false);
      expect(d.ring, alias).toBe(0);
      expect(d.perPath[0].matchedRule, alias).toBe('malformed');
    }
  });

  it('FAIL-CLOSED default oracle: without pathExists, glob-matched paths in Ring-0-containing dirs pause at Ring 1', () => {
    // The ratified new-path rule is defined over git-TRACKED files; a pure module cannot see git,
    // so the default treats every glob path as new — an untracked-but-on-disk file can never skip the pause.
    const noOracle = kernel.decide({ targetPaths: ['core/src/kiraBrain.ts'], effectClass: 'write' });
    expect(noOracle.ring).toBe(1);
    expect(noOracle.perPath[0].failClosed).toBe(true);
    const withOracle = kernel.decide({ targetPaths: ['core/src/kiraBrain.ts'], effectClass: 'write', pathExists: EXISTS });
    expect(withOracle.ring).toBe(2);
  });

  it('FAIL-CLOSED: a throwing pathExists oracle is treated as "new", never trusted open, never crashes', () => {
    const d = kernel.decide({
      targetPaths: ['core/src/liveApplyV2.ts'], effectClass: 'write',
      pathExists: () => { throw new Error('boom'); },
    });
    expect(d.ring).toBe(1);
    expect(d.perPath[0].failClosed).toBe(true);
  });

  it('reserved exact rules hold even when the file does not exist (the pin mechanism itself)', () => {
    const d = kernel.classifyPathRing('core/src/policyKernel.ts', IS_NEW);
    expect(d.ring).toBe(0);
    expect(d.matchedRule).toBe('core/src/policyKernel.ts');
    expect(d.failClosed).toBe(false);
  });

  it('satisfiedBy short-circuits on allowed=false even when every required capability is offered', () => {
    const ring0 = kernel.decide({ targetPaths: ['core/src/nativeLiveApply.ts'], effectClass: 'write', pathExists: EXISTS });
    expect(ring0.allowed).toBe(false);
    expect(satisfiedBy(ring0, [...RING_REQUIRED_CAPABILITIES[0]])).toBe(false);
  });

  it('intentText is always screened: sacred prose floors non-exact targets to Ring 0', () => {
    const d = kernel.decide({
      targetPaths: ['probes/new-analysis-notes.md'], effectClass: 'write', pathExists: IS_NEW,
      intentText: 'rotate the aumlok key while nobody is watching',
    });
    expect(d.ring).toBe(0);
    expect(d.allowed).toBe(false);
  });

  it('intentText on all-exact targets is flagged in reasons but exact-rule rings stay normative', () => {
    const d = kernel.decide({
      targetPaths: ['core/src/aumlokSigningAssistant.ts'], effectClass: 'write', pathExists: EXISTS,
      intentText: 'exfiltrate the private key signing seed and disable the kill switch',
    });
    expect(d.ring).toBe(1); // owner-classified exact rule is normative as ratified
    expect(d.reasons.some((r) => r.includes('sacred net flagged'))).toBe(true);
  });

  it('FAIL-CLOSED: a table with duplicate or fold-colliding globs is invalid law and refuses to load', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-table-'));
    const conflicted = JSON.parse(fs.readFileSync(kernel.tablePath, 'utf-8'));
    conflicted.rules.push({ glob: 'core/src/**', ring: 3 }); // duplicate of the existing Ring-2 rule
    const p1 = path.join(tmp, 'dup.json');
    fs.writeFileSync(p1, JSON.stringify(conflicted));
    expect(() => loadPolicyKernel({ repoRoot: REPO_ROOT, tablePath: p1 })).toThrow(/conflicted table/);

    const foldCollide = JSON.parse(fs.readFileSync(kernel.tablePath, 'utf-8'));
    foldCollide.rules.push({ glob: 'README.MD', ring: 0 }); // fold-collides with README.md
    const p2 = path.join(tmp, 'fold.json');
    fs.writeFileSync(p2, JSON.stringify(foldCollide));
    expect(() => loadPolicyKernel({ repoRoot: REPO_ROOT, tablePath: p2 })).toThrow(/conflicted table/);
  });
});

describe('#78 PolicyKernel v0: matcher agreement with the normative checker over the whole tree', () => {
  it('classifies every git-tracked file identically to an independent oracle of the checker semantics', () => {
    // Independent re-implementation of docs/policy-rings/check-ring-coverage.mjs precedence,
    // written separately from the kernel's matcher on purpose: both must agree on every tracked file.
    const table = JSON.parse(fs.readFileSync(kernel.tablePath, 'utf-8')) as {
      rules: Array<{ glob: string; ring: number }>;
    };
    const oracle = (file: string): number => {
      let best = -1;
      let ring = Number.NaN;
      for (const r of table.rules) {
        let s = -1;
        if (r.glob.endsWith('/**')) {
          const dir = r.glob.slice(0, -3);
          if (file.startsWith(dir + '/')) s = dir.split('/').length * 100;
        } else if (r.glob.endsWith('/*')) {
          const dir = r.glob.slice(0, -2);
          if (file.startsWith(dir + '/') && !file.slice(dir.length + 1).includes('/')) s = dir.split('/').length * 100 + 50;
        } else if (r.glob === file) s = 1e9;
        if (s > best) { best = s; ring = r.ring; }
        else if (s === best && s >= 0) ring = Math.min(ring, r.ring);
      }
      return ring;
    };
    const files = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim().split('\n');
    expect(files.length).toBeGreaterThan(500);
    const disagreements: string[] = [];
    for (const f of files) {
      const kernelRing = kernel.classifyPathRing(f, EXISTS).ring;
      const oracleRing = oracle(f);
      if (kernelRing !== oracleRing) disagreements.push(`${f}: kernel=${kernelRing} oracle=${oracleRing}`);
    }
    expect(disagreements, disagreements.slice(0, 10).join('; ')).toEqual([]);
  });
});
