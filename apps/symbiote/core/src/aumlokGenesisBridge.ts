// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * `aumlok-genesis-bridge` (#288 follow-up) — WHERE the genesis Aura's two rotation-stable facts
 * come from, now that real legacy identities exist.
 *
 * Ground truth (the round's finding): nodes bound before the binding-receipt era have a valid
 * `authority-root.json` — with a public `keyId` and a stable `createdAt`, both protected by the
 * manifest's integrity hash — but no `binding-receipt.json` at all. Honest absence was correct;
 * the product gap was that an old real identity could not reconstruct its first Aura base.
 *
 * PRECEDENCE LAW: the real binding receipt's `boundAt` wins WHENEVER the receipt file exists.
 * ONLY when that file is absent (the legacy shape) do we derive the exact same genesis packet
 * from the validated root's `createdAt`. A receipt that exists but is malformed FAILS CLOSED —
 * it never falls back, so corruption can never quietly re-seed a different base.
 *
 * ROTATION-STABILITY of the fallback: rotation rewrites only the KDF record and appends to an
 * EXISTING receipt (`appendRotationToReceipt` is read-modify-write inside a try/catch) — it never
 * creates a receipt and never rewrites the manifest, so a legacy node's source facts cannot move.
 *
 * READ-ONLY BY LAW: this module writes nothing, synthesizes no receipt, and opens exactly two
 * public files. The root is validated by the EXISTING fail-closed path (`parseRootManifest`:
 * closed keys, keyId↔publicKey match, integrity hash) — malformed root metadata yields honest
 * absence, never a guess.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseRootManifest } from './aumlokAuthorityRoot';
import { hybridBundleDir, hybridV2StatePresent, verifyBundleCoherence } from './aumlokBindV2';

export type GenesisFactsResolution =
  | { present: true; rootId: string; boundAt: string; source: 'hybrid-v2' | 'receipt' | 'root' }
  | { present: false };

const ABSENT: GenesisFactsResolution = { present: false };

/** Resolve the two content-free facts the genesis base derives from. Never writes; never opens
 *  any secret-adjacent artifact — a manifest-only home resolves successfully, which is the proof. */
export function resolveGenesisBindingFacts(homeDir: string): GenesisFactsResolution {
  const dir = path.join(homeDir, 'aumlok');

  // A hybrid identity is authoritative as soon as ANY v2 state exists. A partial or incoherent
  // bundle fails closed and can never fall back to a planted legacy manifest beside it.
  if (hybridV2StatePresent(homeDir)) {
    const bundle = hybridBundleDir(homeDir);
    const coherent = verifyBundleCoherence(bundle);
    if (!coherent.ok) return ABSENT;
    try {
      const receipt = JSON.parse(fs.readFileSync(path.join(bundle, 'binding-receipt-v2.json'), 'utf-8')) as {
        rootId?: unknown; boundAt?: unknown;
      };
      if (receipt.rootId !== coherent.rootId || typeof receipt.boundAt !== 'string' || receipt.boundAt.length === 0) return ABSENT;
      return { present: true, rootId: coherent.rootId, boundAt: receipt.boundAt, source: 'hybrid-v2' };
    } catch { return ABSENT; }
  }

  let rootJson: string;
  try { rootJson = fs.readFileSync(path.join(dir, 'authority-root.json'), 'utf-8'); }
  catch { return ABSENT; } // unbound node — honest absence
  const parsed = parseRootManifest(rootJson); // the existing fail-closed validation path
  if (!parsed.ok) return ABSENT;              // malformed root metadata — fail closed
  const rootId = parsed.root.keyId;

  const receiptFile = path.join(dir, 'binding-receipt.json');
  if (!fs.existsSync(receiptFile)) {
    // LEGACY bound node (pre-receipt era): the validated root's stable public createdAt is the
    // binding instant. Bind-only, integrity-protected, untouched by rotation — stable forever.
    const boundAt = parsed.root.createdAt;
    return typeof boundAt === 'string' && boundAt.length > 0
      ? { present: true, rootId, boundAt, source: 'root' }
      : ABSENT;
  }

  try {
    // the receipt EXISTS: it is the sole source. Only `boundAt` is ever extracted from it.
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as { boundAt?: unknown };
    const boundAt = typeof receipt?.boundAt === 'string' ? receipt.boundAt : '';
    return boundAt.length > 0 ? { present: true, rootId, boundAt, source: 'receipt' } : ABSENT;
  } catch { return ABSENT; } // present but unreadable — fail closed, never fall back
}
