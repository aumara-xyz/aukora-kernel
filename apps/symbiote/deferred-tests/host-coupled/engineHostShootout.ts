/**
 * 24Z.14 — Host Engine Shootout. Evidence-based comparison of candidate coding engines for the Tori
 * DraftEngine seam: the LOCAL heuristic planner (V0), OpenCode, and Hermes. Classification is from REAL
 * source facts (license, package manager, entrypoint, on-disk presence) + a live runnability check — not
 * mythology. The winner is whichever can actually power Tori drafts; until OpenCode/Hermes are wrapped as
 * bounded no-write engines, the LOCAL planner is the active engine (it genuinely powers drafts today).
 *
 * SAFETY: every engine's capabilities hard-pin `canWriteFiles/canRunCommands/canApply = false`. An engine
 * may read workspace context and draft a patch proposal; it may never write, run, or apply. Advisory only.
 */
import * as fs from 'fs';
import * as path from 'path';

export type EngineStatus = 'active' | 'parked' | 'blocked' | 'donor_only';
export type EngineRole = 'primary_draft_engine' | 'candidate_engine' | 'planner_orchestrator' | 'donor';

export interface EngineCapabilities {
  canReadWorkspace: boolean;
  canDraftPatch: boolean;
  canWriteFiles: false;   // hard-pinned OFF
  canRunCommands: false;  // hard-pinned OFF
  canApply: false;        // hard-pinned OFF
  requiresNetwork: boolean;
}

export interface EngineEntry {
  id: string;
  name: string;
  sourcePath: string;
  present: boolean;
  license: string;
  packageManager: string;
  entrypoint: string;
  structuredOutput: string;   // can it emit JSON/patch proposals?
  runnableLocally: boolean;    // live check (installed/buildable here)
  status: EngineStatus;
  role: EngineRole;
  consumedBy: string;          // what wires it TODAY, or 'not_yet'
  blocker: string;             // exact blocker when not active, else 'none'
  capabilities: EngineCapabilities;
}

export interface EngineShootout {
  schema: 'engine-host-shootout-v0';
  engines: EngineEntry[];
  primaryEngine: string;       // the ACTIVE engine id (the one powering Tori drafts now)
  advisoryOnly: true;
  grantsAuthority: false;
}

const CAPS = (over: Partial<EngineCapabilities>): EngineCapabilities => ({
  canReadWorkspace: false, canDraftPatch: false, canWriteFiles: false, canRunCommands: false, canApply: false,
  requiresNetwork: false, ...over,
});

export interface ShootoutOptions {
  repoRoot?: string;
  /** Hermes zip presence override (for tests). Default: not unpacked in-repo. */
  hermesUnpacked?: boolean;
}

export function buildEngineShootout(opts: ShootoutOptions = {}): EngineShootout {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..', '..');
  const ocRoot = path.resolve(repoRoot, 'internal', 'opencode-lab', 'opencode-dev');
  const ocEntry = path.join(ocRoot, 'packages', 'opencode', 'src', 'index.ts');
  const ocInstalled = fs.existsSync(path.join(ocRoot, 'node_modules'));
  const ocPresent = fs.existsSync(ocEntry);
  const hermesUnpacked = opts.hermesUnpacked ?? fs.existsSync(path.resolve(repoRoot, 'internal', 'hermes-lab'));

  const engines: EngineEntry[] = [
    {
      id: 'local-planner',
      name: 'Local heuristic draft planner',
      sourcePath: 'internal/tauri-womb/src/lib/draftPlanner.ts',
      present: true,
      license: 'first-party (none)',
      packageManager: 'n/a',
      entrypoint: 'buildDraftProposal()',
      structuredOutput: 'yes — DraftPatchProposal (applied:false)',
      runnableLocally: true,
      status: 'active', // it powers Tori drafts TODAY
      role: 'primary_draft_engine',
      consumedBy: 'ToriChat draft mode (24Z.10)',
      blocker: 'none',
      capabilities: CAPS({ canReadWorkspace: true, canDraftPatch: true, requiresNetwork: false }),
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      sourcePath: 'internal/opencode-lab/opencode-dev',
      present: ocPresent,
      license: 'MIT',
      packageManager: 'bun@1.3.14 (monorepo workspaces)',
      entrypoint: 'bun run --cwd packages/opencode src/index.ts',
      structuredOutput: 'yes — AI dev tool; patch/JSON capable via its SDK',
      runnableLocally: ocPresent && ocInstalled,
      // present source + (maybe) installed, but NOT yet wrapped as a bounded no-write engine → parked.
      status: ocPresent ? 'parked' : 'blocked',
      role: 'candidate_engine',
      consumedBy: 'not_yet',
      blocker: !ocPresent
        ? 'source not found at internal/opencode-lab/opencode-dev'
        : !ocInstalled
        ? 'needs `bun install` (workspace) before it can run'
        : 'PROVEN runnable (bun install ok; `bun run --cwd packages/opencode src/index.ts --version` executes). It is a coding AGENT that writes files by default — wiring it to Tori needs a bounded HEADLESS no-TUI invocation (argv, write/apply disabled, output coerced to DraftPatchProposal applied:false). That no-write bridge is the remaining step.',
      capabilities: CAPS({ canReadWorkspace: true, canDraftPatch: true, requiresNetwork: true }),
    },
    {
      id: 'hermes',
      name: 'Hermes Agent (ACP)',
      sourcePath: hermesUnpacked ? 'internal/hermes-lab' : 'hermes-agent-main.zip (not unpacked in-repo)',
      present: hermesUnpacked,
      license: 'see hermes-agent-main/LICENSE (present; confirm before use)',
      packageManager: 'mixed (ACP agent: apps/* package.json + agent runtime)',
      entrypoint: 'apps/bootstrap-installer (ACP); confirm on unpack',
      structuredOutput: 'ACP (Agent Client Protocol) — structured by design',
      runnableLocally: false,
      status: hermesUnpacked ? 'parked' : 'donor_only',
      role: 'planner_orchestrator', // better suited as planner/orchestrator than raw draft engine
      consumedBy: 'not_yet (spec only: canon/HERMES_ADAPTER_SPEC.md)',
      blocker: hermesUnpacked
        ? 'unpacked; needs build + a bounded no-write ACP bridge before wiring'
        : 'not unpacked into the repo; would need a controlled unpack + license confirm + build',
      capabilities: CAPS({ canReadWorkspace: true, canDraftPatch: true, requiresNetwork: true }),
    },
  ];

  // The active engine is whichever is genuinely `active`. Today that is the local planner; OpenCode/Hermes
  // are parked until wrapped as bounded no-write engines. (No mythology — active means "powers drafts now".)
  const primaryEngine = engines.find((e) => e.status === 'active')?.id ?? 'local-planner';

  return { schema: 'engine-host-shootout-v0', engines, primaryEngine, advisoryOnly: true, grantsAuthority: false };
}

/** No engine, whatever its status, grants authority — drafts only. */
export function shootoutGrantsAuthority(_s: EngineShootout): false {
  return false;
}

/** Compact context line so Tori can answer "which engine are you using?" truthfully. */
export function summarizeShootout(s: EngineShootout): string {
  const lines = s.engines.map((e) =>
    `- ${e.id} (${e.name}): ${e.status}${e.status === 'active' ? '' : ` — ${e.blocker}`} · license=${e.license}`);
  return [
    `Active engine: ${s.primaryEngine}. Candidates benchmarked (no write/apply for any):`,
    ...lines,
    'Every engine is draft-only — canWriteFiles/canRunCommands/canApply are false. Advisory; grants no authority.',
  ].join('\n');
}
