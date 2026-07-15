// M2 serve/path preflight — pin the seed-root/path contract so the local runtime stays coherent and
// self-rooted, can't drift back onto donor repos / the old OpenCode shell, and never exposes authority or an
// all-interface bind. See docs/SEED_ROOT_CONTRACT.md. Drift fails the gate.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ROOT = join(__dirname, '..', '..');
const rd = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

// the runtime launchers/servers (NOT the scanners, which legitimately denylist donor names as patterns)
const SHELL_LAUNCHERS = ['scripts/console.sh', 'scripts/status.sh', 'scripts/heartbeat.sh', 'scripts/self-map.sh', 'scripts/website.sh', 'First Contact.command'];
const SERVERS = ['dashboard/serve.ts', 'website/serve.ts'];
const ALL_LAUNCHERS = [...SHELL_LAUNCHERS, ...SERVERS];

describe('seed-root contract #1 — launchers self-root at the seed (relocatable, no hardcoded paths)', () => {
  it('each shell launcher derives its root from BASH_SOURCE', () => {
    for (const f of SHELL_LAUNCHERS) expect(rd(f)).toMatch(/BASH_SOURCE\[0\]/);
  });
  it('each TS server self-roots via import.meta.url', () => {
    for (const f of SERVERS) expect(rd(f)).toMatch(/import\.meta\.url/);
  });
  it('no launcher hardcodes an absolute /Users or /home repo path', () => {
    for (const f of ALL_LAUNCHERS) {
      const src = rd(f).split('\n').filter(l => !/PATH=|\.local\/bin|homebrew/.test(l)).join('\n');
      expect(src).not.toMatch(/\/Users\/[a-z]/i);
      expect(src).not.toMatch(/\/home\/[a-z]/i);
    }
  });
});

describe('seed-root contract #2 — no donor-repo / external-shell runtime dependency', () => {
  it('no launcher references a donor repo as a path', () => {
    for (const f of ALL_LAUNCHERS) expect(rd(f)).not.toMatch(/aukora-(os|trinity|kira|kernel)/i);
  });
  it('no launcher references opencode at all (issue #23: self_edit/opencode was deleted, archived to archive/self_edit-opencode-fork — the seed carries no OpenCode fork of its own anymore)', () => {
    expect(existsSync(join(ROOT, 'self_edit'))).toBe(false);
    for (const f of ALL_LAUNCHERS) {
      expect(rd(f)).not.toMatch(/opencode/i);
    }
  });
});

describe('seed-root contract #3 — local serving is loopback-only', () => {
  it('both servers bind 127.0.0.1 and never 0.0.0.0', () => {
    for (const f of SERVERS) {
      const src = rd(f);
      expect(src).toMatch(/hostname:\s*["']127\.0\.0\.1["']/);
      expect(src).not.toMatch(/hostname:\s*["']0\.0\.0\.0["']/); // the BIND, not a comment mentioning it
    }
  });
});

describe('seed-root contract #4 — serve lane carries no authority + spawns only allowlisted seed scripts', () => {
  it('the console server spawns ONLY allowlisted seed scripts (status.sh, heartbeat.sh)', () => {
    const spawns = rd('dashboard/serve.ts').match(/spawnSync\(\[[^\]]*\]/g) || [];
    expect(spawns.length).toBeGreaterThan(0);
    for (const s of spawns) expect(s).toMatch(/scripts\/(status|heartbeat)\.sh/);
  });
  it('no server / console launcher signs, unlocks, promotes, authorizes, or mutates live authority', () => {
    for (const f of ['dashboard/serve.ts', 'website/serve.ts', 'scripts/console.sh', 'First Contact.command']) {
      expect(rd(f)).not.toMatch(/\b(signPoP|signHead|signPromotion|unlockLivePromotion|promoteLive|aumlokMemoryWrite|grantAuthority)\s*\(/);
    }
  });
});

describe('seed-root contract #5 — state path is the one documented contract', () => {
  it('scripts that use a state dir use ${AUKORA_SYMBIOTE_HOME:-$HOME/.aukora-symbiote}', () => {
    for (const f of ['scripts/status.sh', 'scripts/aumlok-authority.sh']) {
      expect(rd(f)).toMatch(/AUKORA_SYMBIOTE_HOME:-\$HOME\/\.aukora-symbiote/);
    }
  });
  it('the contract is documented', () => {
    expect(existsSync(join(ROOT, 'docs', 'SEED_ROOT_CONTRACT.md'))).toBe(true);
  });
});

describe('seed-root contract #6 — self-map / graphify run from the seed itself', () => {
  it('self-map.sh roots at the seed and scans seed dirs', () => {
    const src = rd('scripts/self-map.sh');
    expect(src).toMatch(/cd "\$REPO"/);
    expect(src).toContain('core/src');
  });
  it('graphify is invoked from the seed root (cd $REPO)', () => {
    expect(rd('scripts/console.sh')).toMatch(/cd "\$REPO" && graphify update \./);
  });
});

describe('seed-root contract #7 — the kernel (core/src) stays pure: no HTTP server lives inside it', () => {
  it('no core/src/*.ts file starts an HTTP server / uses the Bun server runtime (servers live in dashboard/ + website/)', () => {
    const dir = join(ROOT, 'core', 'src');
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      if (/Bun\.serve\s*\(|createServer\s*\(|Bun\.file\s*\(/.test(readFileSync(join(dir, f), 'utf-8'))) offenders.push(f);
    }
    // a loose server under the pure kernel both mislocates an I/O surface AND breaks the kernel tsc gate
    // (core/ compiles without @types/bun); keep servers out of core/src.
    expect(offenders, `HTTP server(s) found inside the pure kernel core/src: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('seed-root contract #8 — the Aukora FU lane is an observer/dashboard, never a kernel or authority', () => {
  // FU = Fusion Under-the-Hood: a local observer room that visualizes council/perceiver state as advisory
  // evidence. Allowed as an observer surface; forbidden inside the pure kernel or on any authority path.
  const FU = 'dashboard/fu';
  it('FU lives OUTSIDE core/src and inside dashboard/', () => {
    expect(existsSync(join(ROOT, FU, 'server.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'core', 'src', 'server.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'core', 'src', 'dashboard.html'))).toBe(false);
  });
  it('the FU server binds loopback only (127.0.0.1), never all-interfaces', () => {
    const s = rd(`${FU}/server.ts`);
    expect(s).toMatch(/listen\(\s*\d+\s*,\s*['"]127\.0\.0\.1['"]/);
    expect(s).not.toMatch(/listen\(\s*\d+\s*,\s*\(/); // listen(port, cb) with no host = all-interfaces
  });
  it('FU imports NOTHING from the kernel — it cannot reach the gate / authority / signing', () => {
    const s = rd(`${FU}/server.ts`);
    expect(s).not.toMatch(/from ['"][^'"]*\/core\//);
    expect(s).not.toMatch(/require\(['"][^'"]*\/core\//);
  });
  it('FU carries no authority path and no capture surface (server + page)', () => {
    for (const f of ['server.ts', 'dashboard.html']) {
      const s = rd(`${FU}/${f}`);
      expect(s).not.toMatch(/\b(signPoP|signHead|signPromotion|unlockLivePromotion|promoteLive|aumlokMemoryWrite|grantAuthority)\b/);
      expect(s).not.toMatch(/getUserMedia|MediaRecorder|SpeechRecognition/);
    }
  });
  it('the FU observer server is READ-ONLY — writes nothing, deletes nothing, runs no tool', () => {
    const s = rd(`${FU}/server.ts`);
    expect(s).not.toMatch(/writeFileSync|appendFileSync|createWriteStream|rmSync|unlinkSync|renameSync|mkdirSync/);
    expect(s).not.toMatch(/child_process|execSync|\bexec\s*\(|\bspawn\s*\(|Bun\.spawn/);
  });
  it('the FU server guards path traversal — /api/run/:id cannot escape dashboard/fu/runs', () => {
    const s = rd(`${FU}/server.ts`);
    expect(s).toMatch(/path\.basename/);          // strips ../ directory components
    expect(s).toMatch(/startsWith\(RUNS_DIR\)/);  // and refuses anything resolving outside the runs dir
  });
  it('the FU server exposes only read-only run endpoints (runs / latest / :id / stream)', () => {
    const s = rd(`${FU}/server.ts`);
    for (const ep of ["'/api/runs'", "'/api/run/latest'", "'/api/run/'", "'/api/stream'"]) expect(s).toContain(ep);
  });
});

describe('seed-root contract #9 — no UI/server/voice route can reach the AUMLOK signer or rehearsal builder', () => {
  // The AUMLOK Ed25519 "dev_real" signer/builder live in core/src/aumlokSigner.ts + the rehearsal builder in
  // aumlokAuthorityRoot.ts. Neither may be importable or callable from any UI, server, or voice surface — the
  // real function names (not the placeholder names #4's regex checks) must never appear reachable there.
  const UI_AND_SERVER_SURFACES = ['dashboard/serve.ts', 'website/serve.ts', 'dashboard/fu/server.ts', 'core/src/console.html'];
  it('no UI/server surface calls the real signer, keygen, or rehearsal-builder functions', () => {
    for (const f of UI_AND_SERVER_SURFACES) {
      const s = rd(f);
      expect(s).not.toMatch(/\b(signPromotionAuthorization|signKeyLifecycleEvent|generateKeypair|buildRehearsalReceipt)\s*\(/);
    }
  });
  it('no UI/server surface imports the AUMLOK signer module at all', () => {
    for (const f of UI_AND_SERVER_SURFACES) {
      expect(rd(f)).not.toMatch(/aumlokSigner/);
    }
  });
});

describe('seed-root contract #10 — self_edit residue class-catcher (issue #24)', () => {
  // Fable's QA finding: contract #2's opencode check above only scans LAUNCHER scripts, so a stale
  // "self_edit still exists" claim in a doc, comment, or unrelated source file slips past it entirely
  // (scripts/dev/aukora-ide-paths.mjs, dashboard/serve.ts's anatomy graph, and docs/ARCHITECTURE.md's
  // diagram all did, independently, after the issue #23 deletion). This is the broader catch: every
  // TRACKED file mentioning the literal string "self_edit" must be on this explicit, reviewed
  // allowlist. A new mention — whether a stale reintroduction or a legitimate new historical note —
  // must be added here consciously; it can never pass by silently matching nothing.
  const ALLOWLISTED_SELF_EDIT_MENTIONS = new Set([
    'core/src/rootOrganismRegistry.ts',            // comment: explains the registry row removal
    'core/tests/convexReadOnlyInvariant.test.ts',  // comment: explains removal from the RUNTIME scan list
    'core/tests/nativeIdeDispatcher.test.ts',      // negative assertion: no import of self_edit/opencode
    'core/tests/seedRootContract.test.ts',         // this file: contract #2's absence-check + this allowlist
    'docs/AUKORA_SYMBIOTE_SINGULARITY_PATH.md',    // historical build-log note about the deletion
    'docs/BUILT_STATE.md',                         // "what this isn't" note about the deletion
    'docs/SEED_ROOT_CONTRACT.md',                  // note about the deletion
    'docs/issues-snapshot/issue-006.md',           // generated GitHub issue snapshot: historical evidence
    'docs/issues-snapshot/issue-016.md',           // generated GitHub issue snapshot: historical evidence
    'docs/issues-snapshot/issue-017.md',           // generated GitHub issue snapshot: historical evidence
    'docs/issues-snapshot/issue-021.md',           // generated GitHub issue snapshot: historical evidence
    'docs/issues-snapshot/issue-022.md',           // generated GitHub issue snapshot: historical evidence
    'docs/issues-snapshot/issue-023.md',           // generated GitHub issue snapshot: historical evidence
    'docs/issues-snapshot/issue-024.md',           // generated GitHub issue snapshot: historical evidence
  ]);

  it('every git-tracked file mentioning self_edit is on the allowlist above', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean);
    const offenders: string[] = [];
    for (const rel of tracked) {
      let content: string;
      try { content = readFileSync(join(ROOT, rel), 'utf-8'); } catch { continue; } // binary/unreadable — skip
      if (!content.includes('self_edit')) continue;
      if (!ALLOWLISTED_SELF_EDIT_MENTIONS.has(rel)) offenders.push(rel);
    }
    expect(offenders, `unreviewed self_edit mention(s) — add to the allowlist above (deliberately) or fix the stale reference: ${offenders.join(', ')}`).toEqual([]);
  });
});
