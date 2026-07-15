/**
 * 24Z.15 — Kernel Read-Only Mount (Great Merge execution, first true mount).
 *
 * Scans the real kernel source (node-template/convex; external ~/aukora-kernel as a donor reference) and
 * reports each module's presence + path as MOUNTED_READONLY metadata the a read-only consumer can read. It
 * NEVER imports/executes kernel code, deploys Convex, or mutates anything — it is inventory only. A module
 * is `MOUNTED_READONLY` when present (consumed as metadata); `MISSING` when its file is absent;
 * `ACTIVE_RUNTIME` is reserved for code actually executed (none here — no overclaim).
 */
import * as fs from 'fs';
import * as path from 'path';

export type KernelModuleStatus = 'mounted_readonly' | 'missing';

export interface KernelModuleEntry {
  id: string;        // concept (receipts, merkle_log, …)
  file: string;      // candidate filename in node-template/convex
  path: string;      // absolute path checked
  present: boolean;
  hasDoc: boolean;   // a sibling claims/doc reference (best-effort)
  status: KernelModuleStatus;
}

export interface KernelReadOnlyMount {
  schema: 'kernel-readonly-mount-v0';
  kernelRoot: string;
  externalKernelPresent: boolean;
  modules: KernelModuleEntry[];
  summary: { total: number; mounted: number; missing: number };
  executableImport: false;  // hard — kernel code is never imported/executed here
  convexDeploy: false;      // hard — no deploy
  mountedIntoApp: boolean;  // consumed by the console as metadata
  advisoryOnly: true;
  grantsAuthority: false;
}

// concept → real filename in node-template/convex (the kernel substrate)
const KERNEL_MODULE_SPECS: Array<{ id: string; file: string }> = [
  { id: 'receipts', file: 'aukoraReceipts.ts' },
  { id: 'merkle_log', file: 'aukoraMerkleLog.ts' },
  { id: 'signed_head', file: 'aukoraSignedHead.ts' },
  { id: 'witness', file: 'aukoraWitness.ts' },
  { id: 'witness_export', file: 'aukoraWitnessExport.ts' },
  { id: 'pq_signer', file: 'aukoraPqcSigner.ts' },
  { id: 'aumlok_root', file: 'aumlokRootRegistry.ts' },
  { id: 'aumlok_ceremony', file: 'aumlokCeremony.ts' },
  { id: 'aumlok_memory', file: 'aumlokMemory.ts' },
  { id: 'aumlok_derive', file: 'aukoraAumlokDerive.ts' },
  { id: 'runtime', file: 'aukoraRuntime.ts' },
  { id: 'action_registry', file: 'aukoraActionRegistry.ts' },
  { id: 'node_factory', file: 'aukoraNodeFactory.ts' },
  { id: 'token', file: 'aukoraToken.ts' },
  { id: 'channel', file: 'aukoraChannel.ts' },
  { id: 'code_attestation', file: 'codeAttestation.ts' },
  { id: 'rate_limit', file: 'aukoraRateLimit.ts' },
  { id: 'core', file: 'aukoraCore.ts' },
];

export interface KernelMountOptions {
  repoRoot?: string;
  externalBase?: string;
  mountedIntoApp?: boolean; // default true (it IS consumed via the manifest)
}

export function buildKernelReadOnlyMount(opts: KernelMountOptions = {}): KernelReadOnlyMount {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..', '..');
  const externalBase = opts.externalBase ?? path.resolve(repoRoot, '..');
  const kernelRoot = path.resolve(repoRoot, 'node-template', 'convex');
  const docDir = path.join(kernelRoot, 'CLAIMS.md');
  const hasClaims = fs.existsSync(docDir);

  const modules: KernelModuleEntry[] = KERNEL_MODULE_SPECS.map((spec) => {
    const abs = path.join(kernelRoot, spec.file);
    const present = fs.existsSync(abs);
    return {
      id: spec.id,
      file: spec.file,
      path: abs,
      present,
      hasDoc: present && hasClaims,
      status: present ? 'mounted_readonly' : 'missing',
    };
  });

  const mounted = modules.filter((m) => m.present).length;
  return {
    schema: 'kernel-readonly-mount-v0',
    kernelRoot,
    externalKernelPresent: fs.existsSync(path.resolve(externalBase, 'aukora-kernel')),
    modules,
    summary: { total: modules.length, mounted, missing: modules.length - mounted },
    executableImport: false,
    convexDeploy: false,
    mountedIntoApp: opts.mountedIntoApp ?? true,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function kernelMountGrantsAuthority(_m: KernelReadOnlyMount): false {
  return false;
}

/** Compact context for the console: "what kernel modules are mounted? where is the receipt code?" */
export function summarizeKernelMount(m: KernelReadOnlyMount): string {
  const mounted = m.modules.filter((x) => x.present);
  const missing = m.modules.filter((x) => !x.present).map((x) => x.id);
  return [
    `Kernel read-only mount: ${m.summary.mounted}/${m.summary.total} modules present at ${m.kernelRoot} (read-only, NOT executed).`,
    `Mounted: ${mounted.map((x) => `${x.id}(${x.file})`).join(', ') || 'none'}.`,
    missing.length ? `Missing: ${missing.join(', ')}.` : 'No missing modules.',
    `executableImport=${m.executableImport} · convexDeploy=${m.convexDeploy} · status=MOUNTED_READONLY (not ACTIVE_RUNTIME).`,
  ].join('\n');
}
