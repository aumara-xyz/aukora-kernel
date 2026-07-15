// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Root Organism Registry — the seed's truth source about ITSELF.
 *
 * Enumerates the aukora-symbiote organs and reports each one's REAL mount state from a live `fs`
 * existence check (no ghosts: an organ is `missing` unless its path exists). Seed-native: it is
 * computed from the SEED root, it describes the symbiote's own organs, and the source donor repos
 * are reported as EXTERNAL PROVENANCE — never as mounted/active organs. ADVISORY: the registry grants
 * no authority and triggers nothing — it only reports.
 */
import * as fs from 'fs';
import * as path from 'path';

export type MountState = 'active_runtime' | 'mounted' | 'lab_only' | 'donor_only' | 'parked' | 'missing';
export type OrganRole =
  | 'runtime' | 'membrane' | 'read_only_context' | 'active_engine'
  | 'kernel_substrate' | 'donor' | 'lab' | 'tooling';

export interface OrganEntry {
  id: string;
  path: string;            // absolute path checked
  present: boolean;        // real fs existence
  mountState: MountState;  // honest classification (missing if absent)
  role: OrganRole;
  licenseRisk: string;     // 'none' | 'review' | specific
  safeToExpose: boolean;   // safe to surface in an external/provenance view
  consumedBy: string;      // what ACTUALLY consumes it today, or 'not_yet'
  provenBy: string;        // test/evidence that proves it
}

export interface OrganismRegistry {
  schema: 'root-organism-registry-v1-seed';
  generatedFromRoot: string;
  organs: OrganEntry[];
  kernelModules: string[];
  summary: { total: number; present: number; missing: number; activeRuntime: number; labOrDonor: number };
  advisoryOnly: true;
  grantsAuthority: false;
}

interface OrganSpec {
  id: string;
  rel?: string;   // path relative to the SEED root (an in-seed organ)
  ext?: string;   // path relative to the seed's PARENT (an external donor repo — provenance only)
  mountState: Exclude<MountState, 'missing'>; // intended state WHEN present; missing overrides
  role: OrganRole;
  licenseRisk: string;
  safeToExpose: boolean;
  consumedBy: string;
  provenBy: string;
}

// The seed's own organs (in-seed), then the donor repos (external provenance — NOT mounted).
const ORGAN_SPECS: OrganSpec[] = [
  { id: 'core', rel: 'core/src', mountState: 'active_runtime', role: 'kernel_substrate', licenseRisk: 'none', safeToExpose: true, consumedBy: 'the kernel law — everything', provenBy: 'core/tests headless suite' },
  { id: 'authority', rel: 'authority', mountState: 'active_runtime', role: 'membrane', licenseRisk: 'none', safeToExpose: true, consumedBy: 'gate · AUMLOK · chokepoint — decides every effect', provenBy: 'gate byte-pin + gate tests' },
  { id: 'memory', rel: 'memory', mountState: 'active_runtime', role: 'read_only_context', licenseRisk: 'none', safeToExpose: true, consumedBy: 'advisory recall (suggests, never authorizes)', provenBy: 'memory chain tests' },
  // Round 3 (issue #23): self_edit/opencode (a 97-file, 1.0MB vendored OpenCode fork, 46 of 64 .ts
  // files importing @opencode-ai/* installed nowhere in this repo, zero real runtime importers, never
  // typechecked as part of core/tsconfig.json's include scope) was deleted from main and archived to
  // branch archive/self_edit-opencode-fork. It was never a real active_engine — removed rather than
  // reported as 'missing', matching how donor repos are handled below: not an organ of this seed.
  { id: 'receiver', rel: 'receiver', mountState: 'mounted', role: 'read_only_context', licenseRisk: 'none', safeToExpose: true, consumedBy: 'read-only Convex receiver (organs live in core)', provenBy: 'convexReadOnlyInvariant.test' },
  { id: 'fusion', rel: 'fusion', mountState: 'mounted', role: 'read_only_context', licenseRisk: 'none', safeToExpose: true, consumedBy: 'Fusion council — reviews, never authorizes (organs in core)', provenBy: 'fusionConfig tests' },
  { id: 'tests', rel: 'core/tests', mountState: 'active_runtime', role: 'runtime', licenseRisk: 'none', safeToExpose: true, consumedBy: 'the headless behavior gate (scripts/test.sh)', provenBy: 'self-proving' },
  { id: 'deferred-tests', rel: 'deferred-tests', mountState: 'parked', role: 'lab', licenseRisk: 'none', safeToExpose: true, consumedBy: 'visible test debt — needs a host harness', provenBy: 'deferred-tests/README.md' },
  { id: 'dashboard', rel: 'dashboard', mountState: 'mounted', role: 'tooling', licenseRisk: 'none', safeToExpose: true, consumedBy: 'the builder console (observer only — no authority)', provenBy: 'dashboard/README.md' },
  { id: 'lab_only', rel: 'lab_only', mountState: 'lab_only', role: 'lab', licenseRisk: 'none', safeToExpose: false, consumedBy: 'gitignored lab artifacts — never shipped', provenBy: 'fs existence check' },
  // NOTE: donor source repos are NOT inventoried here — they are external PROVENANCE, not organs of the
  // seed. Where the code came from is documented in docs/ (extraction map), not in the live self-map.
];

// The seed's own kernel organs we expect in core/src; reported only if the file truly exists.
const EXPECTED_KERNEL_MODULES = [
  'kernelActionClassifier', 'forbiddenContent', 'sandboxApply', 'patchApproval', 'patchLoopReceipt',
  'manifestSigner', 'mldsaSandboxSigner', 'convexBrainReadonly', 'fractalFusion', 'aumlokApprovalRoot',
  'runtimeTruthManifest', 'speculativePrefix', 'vk', 'crypto', 'normalizer',
];

export interface RegistryOptions {
  /** Seed-root override (for tests). Defaults to the aukora-symbiote root resolved from this file. */
  repoRoot?: string;
  /** External base override (for tests). Defaults to the seed root's parent (donor repos as siblings). */
  externalBase?: string;
}

function inventoryKernelModules(srcDir: string): string[] {
  if (!fs.existsSync(srcDir)) return [];
  return EXPECTED_KERNEL_MODULES.filter((m) => fs.existsSync(path.join(srcDir, `${m}.ts`)));
}

export function buildRootOrganismRegistry(opts: RegistryOptions = {}): OrganismRegistry {
  // core/src/rootOrganismRegistry.ts -> up TWO is the seed root (aukora-symbiote), not the host above it.
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..');
  const externalBase = opts.externalBase ?? path.resolve(repoRoot, '..');

  const organs: OrganEntry[] = ORGAN_SPECS.map((spec) => {
    const abs = spec.rel != null ? path.resolve(repoRoot, spec.rel) : path.resolve(externalBase, spec.ext!);
    const present = fs.existsSync(abs);
    return {
      id: spec.id,
      path: abs,
      present,
      mountState: present ? spec.mountState : 'missing', // missing ALWAYS wins over an intended state
      role: spec.role,
      licenseRisk: spec.licenseRisk,
      safeToExpose: present && spec.safeToExpose,
      consumedBy: present ? spec.consumedBy : 'n/a (missing)',
      provenBy: spec.provenBy,
    };
  });

  const kernelModules = inventoryKernelModules(path.resolve(repoRoot, 'core', 'src'));

  const present = organs.filter((o) => o.present).length;
  const summary = {
    total: organs.length,
    present,
    missing: organs.length - present,
    activeRuntime: organs.filter((o) => o.mountState === 'active_runtime').length,
    labOrDonor: organs.filter((o) => o.mountState === 'lab_only' || o.mountState === 'parked' || o.mountState === 'donor_only').length,
  };

  return {
    schema: 'root-organism-registry-v1-seed',
    generatedFromRoot: repoRoot,
    organs,
    kernelModules,
    summary,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** The registry NEVER grants authority — it only reports the seed's truth. */
export function registryGrantsAuthority(_r: OrganismRegistry): false {
  return false;
}

/** A compact, prompt-safe summary the seed can fold into context, or answer "what am I made of?" with. */
export function summarizeRegistryForContext(r: OrganismRegistry): string {
  const line = (o: OrganEntry) => `- ${o.id}: ${o.present ? o.mountState : 'MISSING'} · role=${o.role} · ${o.consumedBy}`;
  return [
    `Aukora Symbiote (the seed) — ${r.summary.present}/${r.summary.total} organs present, ${r.summary.activeRuntime} active_runtime, ${r.summary.labOrDonor} lab/parked/donor.`,
    `Kernel organs inventoried in core/src (${r.kernelModules.length}): ${r.kernelModules.join(', ') || 'none'}.`,
    ...r.organs.map(line),
    'Advisory only — the registry reports; it grants no authority and changes nothing.',
  ].join('\n');
}
