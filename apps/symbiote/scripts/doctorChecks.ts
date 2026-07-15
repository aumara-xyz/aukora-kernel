// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): `bun run doctor` — the pure evaluation core.
//
// This module is a PURE function of an injected facts object → a set of PASS/CHECK/FAIL results
// with exact next actions. All host probing (running git, checking ports, statting disk) lives in
// the CLI (scripts/doctor.ts); this file NEVER touches the host, so the whole verdict layer is
// deterministic and unit-testable with synthetic facts.
//
// PRIVACY: facts carry only booleans/numbers/version strings/enums — never keys, env values,
// usernames, home paths, or memory contents. Rendering echoes only those safe values.

export type Status = 'PASS' | 'CHECK' | 'FAIL';

export interface DoctorFacts {
  platform: string;                 // process.platform
  arch: string;                     // process.arch
  bunVersion: string | null;        // required runtime
  gitVersion: string | null;        // required (clone/apply)
  nodeVersion: string | null;       // optional at runtime; needed for the behavior test suite
  ghPresent: boolean;               // optional; needed only to auth a PRIVATE clone
  ghAuthenticated: boolean | null;  // null = not determined
  sourceForm: 'clone' | 'zip';      // .git present?
  repoIsPrivate: boolean;           // the shared repo is private today
  nodeHomeWritable: boolean;        // can we create the node home? (boolean only, no path)
  freeDiskGb: number | null;        // null = undeterminable
  requiredPorts: number[];          // the ports the node needs
  portsInUse: number[];             // subset currently occupied
  shellAssetsPresent: boolean;      // the Spatial shell + its imports exist
  convexBackendPresent: boolean;    // the ~55MB backend binary is already downloaded
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: Status;
  detail: string;                   // safe, value-free
  nextAction?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  pass: number;
  check: number;
  fail: number;
  ok: boolean;                      // no FAIL
}

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHS = new Set(['arm64', 'x64']);
const MIN_FREE_GB = 2;

/** Pure: evaluate the injected facts into ordered PASS/CHECK/FAIL checks. */
export function evaluateDoctor(f: DoctorFacts): DoctorReport {
  const c: DoctorCheck[] = [];

  c.push(SUPPORTED_PLATFORMS.has(f.platform) && SUPPORTED_ARCHS.has(f.arch)
    ? { id: 'os', label: 'OS / architecture', status: 'PASS', detail: `${f.platform}/${f.arch} supported` }
    : { id: 'os', label: 'OS / architecture', status: 'FAIL', detail: `${f.platform}/${f.arch} is not a supported target`,
        nextAction: 'Run on macOS, Linux, or Windows (arm64 or x64).' });

  c.push(f.bunVersion
    ? { id: 'bun', label: 'Bun (required)', status: 'PASS', detail: `bun ${f.bunVersion}` }
    : { id: 'bun', label: 'Bun (required)', status: 'FAIL', detail: 'Bun not found — it is the runtime this project needs',
        nextAction: 'Install Bun: https://bun.sh, then reopen your terminal.' });

  c.push(f.gitVersion
    ? { id: 'git', label: 'Git (required)', status: 'PASS', detail: f.gitVersion }
    : { id: 'git', label: 'Git (required)', status: 'FAIL', detail: 'Git not found — needed to update and to sign/apply changes',
        nextAction: 'Install Git for your OS, then reopen your terminal.' });

  c.push(f.nodeVersion
    ? { id: 'node', label: 'Node (optional)', status: 'PASS', detail: `node ${f.nodeVersion}` }
    : { id: 'node', label: 'Node (optional)', status: 'CHECK', detail: 'Node not found — the app runs on Bun without it',
        nextAction: 'Install Node LTS only if you want to run the full test suite (bash scripts/test.sh).' });

  // gh matters only when authenticating a PRIVATE clone.
  const ghRelevant = f.sourceForm === 'clone' && f.repoIsPrivate;
  if (!ghRelevant) {
    c.push({ id: 'gh', label: 'GitHub CLI (optional)', status: 'PASS', detail: 'not needed for this source form' });
  } else if (f.ghPresent && f.ghAuthenticated === true) {
    c.push({ id: 'gh', label: 'GitHub CLI', status: 'PASS', detail: 'present and authenticated' });
  } else {
    c.push({ id: 'gh', label: 'GitHub CLI', status: 'CHECK',
      detail: f.ghPresent ? 'present but not authenticated for the private repo' : 'not found — needed to pull the private repo',
      nextAction: f.ghPresent ? 'Run: gh auth login' : 'Install GitHub CLI (gh) and run: gh auth login' });
  }

  c.push(f.sourceForm === 'clone'
    ? { id: 'source', label: 'Source form', status: 'PASS', detail: 'git clone — self-modify + live-apply available' }
    : { id: 'source', label: 'Source form', status: 'CHECK', detail: 'ZIP download — read/run only',
        nextAction: 'For self-modification and live-apply, use a real git clone instead of a ZIP.' });

  c.push(f.nodeHomeWritable
    ? { id: 'home', label: 'Node home writable', status: 'PASS', detail: 'the node home can be created/updated' }
    : { id: 'home', label: 'Node home writable', status: 'FAIL', detail: 'the node home is not writable',
        nextAction: 'Ensure your home directory is writable (the node stores its keys/memory there, locally).' });

  if (f.freeDiskGb === null) {
    c.push({ id: 'disk', label: 'Disk space', status: 'CHECK', detail: 'could not determine free space',
      nextAction: 'Ensure a few hundred MB free (backend ~55MB + dependencies).' });
  } else if (f.freeDiskGb < MIN_FREE_GB) {
    c.push({ id: 'disk', label: 'Disk space', status: 'CHECK', detail: `${f.freeDiskGb.toFixed(1)} GB free — low`,
      nextAction: 'Free some space (backend ~55MB + node_modules).' });
  } else {
    c.push({ id: 'disk', label: 'Disk space', status: 'PASS', detail: `${f.freeDiskGb.toFixed(1)} GB free` });
  }

  const inUse = f.portsInUse.filter((p) => f.requiredPorts.includes(p)).sort((a, b) => a - b);
  c.push(inUse.length === 0
    ? { id: 'ports', label: 'Required ports', status: 'PASS', detail: `${f.requiredPorts.length} loopback ports free` }
    : { id: 'ports', label: 'Required ports', status: 'CHECK', detail: `in use: ${inUse.join(', ')}`,
        nextAction: 'Stop whatever is using those ports, or set the AUKORA_*_PORT overrides.' });

  c.push(f.shellAssetsPresent
    ? { id: 'assets', label: 'Shell assets', status: 'PASS', detail: 'the Spatial shell and its modules are present' }
    : { id: 'assets', label: 'Shell assets', status: 'FAIL', detail: 'shell modules are missing (incomplete copy)',
        nextAction: 'Re-download a complete clone or ZIP of the repository.' });

  c.push(f.convexBackendPresent
    ? { id: 'backend', label: 'Convex backend', status: 'PASS', detail: 'the memory backend is already installed' }
    : { id: 'backend', label: 'Convex backend', status: 'CHECK', detail: 'not installed yet',
        nextAction: 'It downloads (~55MB, loopback-only) automatically on your first `bun run start`.' });

  const pass = c.filter((x) => x.status === 'PASS').length;
  const check = c.filter((x) => x.status === 'CHECK').length;
  const fail = c.filter((x) => x.status === 'FAIL').length;
  return { checks: c, pass, check, fail, ok: fail === 0 };
}

/** Pure: render one compact screen. Echoes only the safe fields already in the report. */
export function renderDoctor(r: DoctorReport): string {
  const glyph = (s: Status) => (s === 'PASS' ? '✓' : s === 'CHECK' ? '•' : '✗');
  const lines: string[] = ['AUKORA DOCTOR — read-only preflight', ''];
  for (const c of r.checks) {
    lines.push(`  ${glyph(c.status)} ${c.status.padEnd(5)} ${c.label} — ${c.detail}`);
    if (c.nextAction && c.status !== 'PASS') lines.push(`          → ${c.nextAction}`);
  }
  lines.push('');
  lines.push(`  ${r.pass} pass · ${r.check} check · ${r.fail} fail`);
  lines.push(r.ok
    ? '  READY — no blockers. CHECK items are optional/advisory.'
    : '  NOT READY — resolve the ✗ FAIL items above, then run `bun run doctor` again.');
  return lines.join('\n');
}
