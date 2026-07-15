// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Runtime Truth Manifest — the seed's honest statement of its OWN runtime.
 *
 * Seed-native: it describes aukora-symbiote (headless), not the old host/UI shell it was extracted
 * from. It states what is true *right now* and refuses to overclaim. ADVISORY: the manifest reports;
 * it grants no authority and changes nothing. (Replaced the old host-runtime banner — that described
 * a runtime the seed does not have.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildRootOrganismRegistry } from './rootOrganismRegistry';

export interface RuntimeTruthManifest {
  schema: 'runtime-truth-manifest-v1-seed';
  generatedFromRoot: string;
  headless: true;
  authorityGate: { present: boolean; note: string };
  aumlok: { mode: 'sha256_dev_shim'; cryptographic: false; realRootAt: string };
  convex: {
    readOnly: true;
    mutationExposed: false;
    executorWired: false;
    productionConnection: false;
    grantsAuthority: false;
  };
  memory: { advisoryOnly: true; grantsAuthority: false };
  receipts: { canonical: true; note: string };
  selfEdit: { promotionReady: false; sandboxOnly: true; note: string };
  rollback: { available: 'partial'; fullAtM4: true };
  ui: { present: false; role: 'observer_only'; grantsAuthority: false };
  deferredTestDebt: { files: number; note: string };
  organs: string[];        // organ ids from the seed-native root registry
  donors: string[];        // donor repo ids — EXTERNAL provenance, never active runtime
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface ManifestOptions {
  /** Seed-root override (for tests). Defaults to the aukora-symbiote root resolved from this file. */
  repoRoot?: string;
}

function countDeferredTests(repoRoot: string): number {
  let n = 0;
  const walk = (d: string) => {
    let ents: string[]; try { ents = fs.readdirSync(d); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e);
      let s; try { s = fs.statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p);
      else if (e.endsWith('.test.ts')) n++;
    }
  };
  walk(path.join(repoRoot, 'deferred-tests'));
  return n;
}

export function buildRuntimeTruthManifest(opts: ManifestOptions = {}): RuntimeTruthManifest {
  // core/src/runtimeTruthManifest.ts -> up TWO is the seed root (aukora-symbiote), never the host above it.
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..');
  const gatePresent = fs.existsSync(path.join(repoRoot, 'authority', 'gate', 'aukoraGate.ts'));
  const registry = buildRootOrganismRegistry({ repoRoot });
  const organs = registry.organs.filter((o) => !o.id.startsWith('donor:')).map((o) => o.id);
  const donors = registry.organs.filter((o) => o.id.startsWith('donor:')).map((o) => o.id);

  return {
    schema: 'runtime-truth-manifest-v1-seed',
    generatedFromRoot: repoRoot,
    headless: true,
    authorityGate: { present: gatePresent, note: 'byte-pin verified by scripts/status.sh; decides every effect' },
    aumlok: { mode: 'sha256_dev_shim', cryptographic: false, realRootAt: 'Step-4 (Ed25519 -> ML-DSA)' },
    convex: {
      readOnly: true,
      mutationExposed: false,
      executorWired: false,
      productionConnection: false,
      grantsAuthority: false,
    },
    memory: { advisoryOnly: true, grantsAuthority: false },
    receipts: { canonical: true, note: 'authority + intent + effect, hash-chained — no receipt, no reality' },
    selfEdit: { promotionReady: false, sandboxOnly: true, note: 'sandbox apply (appliedLive=false); the visible loop is M4 — not built' },
    rollback: { available: 'partial', fullAtM4: true },
    ui: { present: false, role: 'observer_only', grantsAuthority: false },
    deferredTestDebt: { files: countDeferredTests(repoRoot), note: 'host-integration tests — visible debt, not hidden' },
    organs,
    donors,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** The manifest NEVER grants authority — it only reports the seed's runtime truth. */
export function manifestGrantsAuthority(_m: RuntimeTruthManifest): false {
  return false;
}

/** A compact, prompt-safe summary of the seed's runtime truth. */
export function summarizeManifest(m: RuntimeTruthManifest): string {
  return [
    `Aukora Symbiote runtime — HEADLESS. Authority gate ${m.authorityGate.present ? 'present' : 'MISSING'}.`,
    `AUMLOK: ${m.aumlok.mode} (NOT cryptographic yet — real root at ${m.aumlok.realRootAt}).`,
    `Convex: read-only (mutationExposed=${m.convex.mutationExposed}, executorWired=${m.convex.executorWired}, productionConnection=${m.convex.productionConnection}).`,
    `Memory: advisory only, grants no authority. Receipts: canonical.`,
    `Self-edit: NOT promotion-ready (sandbox-only; visible loop = M4, not built). Rollback: ${m.rollback.available}.`,
    `UI: ${m.ui.present ? 'present' : 'none'} — ${m.ui.role}, no authority. Deferred test debt: ${m.deferredTestDebt.files} files.`,
    `Organs (${m.organs.length}): ${m.organs.join(', ')}. Donors (external provenance, not runtime): ${m.donors.join(', ') || 'none'}.`,
    'Advisory only — the manifest reports; it grants no authority and changes nothing.',
  ].join('\n');
}
