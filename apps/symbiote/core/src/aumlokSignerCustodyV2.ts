// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK custody-backed HUMAN-SIDE dual signer (#361, Fable Finish Cycle A). Bridges the published hybrid
 * custody bundle (aumlokBindV2.ts, Brick 2) to the pure dual signer (aumlokSignerV2.ts, Brick 1) so the
 * OWNER's surfaces — the terminal script and the local approve door — can produce a closed dual-signed
 * promotion on a v2-bound node. Before this module existed the v2 verifier chain was proven but unreachable:
 * no owner surface could load seeds from custody, so a v2 node had no working approval path at all.
 *
 * Custody posture (same law as aumlokApproveCeremony.ts / aumlokBindCeremony.ts): this is a HUMAN-SIDE door
 * module. The organism's lanes never import it. Hard rules, all load-bearing:
 *   - COHERENCE FIRST: signing is gated on verifyBundleCoherence — the stored seeds must re-derive the
 *     pinned public root. An incomplete, tampered, or seed-swapped bundle refuses BEFORE any seed is used
 *     to sign. The authorization's rootId comes from that coherence check, never from a caller.
 *   - STRICT SEED READS: each seed file must be a regular file (no symlink), mode 0600, exactly 64
 *     lowercase hex — the same discipline as the v1 door's readPrivateKeyStrict, per seed.
 *   - SIGN-THEN-SELF-VERIFY: the produced receipt is verified with the ORGANISM's verifyPromotionV2 against
 *     the loaded root before it is returned — this module can never emit a receipt the writer would refuse.
 *   - Seeds are never returned, logged, or embedded in any error path. The phrase derives nothing here
 *     (it gates the owner's gesture elsewhere; it is not key material).
 *   - ML-DSA is signed only through the pqcSignWithDomain chokepoint (inside signPromotionV2) — this module
 *     imports no post-quantum core.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  verifyPromotionV2, verifyLifecycleV2,
  type PromotionAuthorizationV2, type SignedPromotionV2, type AuthorityRootV2,
  type KeyLifecycleEventV2, type SignedLifecycleV2,
} from './aumlokAuthorityV2';
import { signPromotionV2, signLifecycleV2 } from './aumlokSignerV2';
import { verifyBundleCoherence, loadHybridCustody, hybridBundleDir, HYBRID_SEED_FILES } from './aumlokBindV2';

export interface CustodyPromotionRequest {
  proposalHash: string;          // 64-hex — the exact reviewed content's hash (draftHash is pinned equal)
  nonce: string;                 // binds the signature to one approval gesture (challenge/CLI nonce)
  issuedAt?: string;             // default: now
  expiresAt?: string | null;     // default: null (no expiry)
}

export type CustodySignVerdict =
  | { ok: true; signedReceipt: SignedPromotionV2; rootId: string }
  | { ok: false; reason: string };

/** Read ONE seed under strict custody: regular file, no symlink, no group/other bits, 64 lowercase hex.
 *  LOUD refusal; no error path ever includes file bytes. */
function readSeedStrict(seedPath: string, which: string): { ok: true; seed: string } | { ok: false; reason: string } {
  let st: fs.Stats;
  try { st = fs.lstatSync(seedPath); } catch { return { ok: false, reason: `${which} seed missing` }; }
  if (st.isSymbolicLink()) return { ok: false, reason: `${which} seed is a symlink — refused` };
  if (!st.isFile()) return { ok: false, reason: `${which} seed is not a regular file — refused` };
  if ((st.mode & 0o077) !== 0) return { ok: false, reason: `${which} seed is group/world accessible (mode ${(st.mode & 0o777).toString(8)}) — refused` };
  const raw = fs.readFileSync(seedPath, 'utf-8').trim();
  if (!/^[0-9a-f]{64}$/.test(raw)) return { ok: false, reason: `${which} seed malformed — refused` };
  return { ok: true, seed: raw };
}

/**
 * Produce the mandatory dual Ed25519 + ML-DSA-65 promotion receipt from the node's PUBLISHED hybrid custody.
 * Fail-closed at every step; on success the receipt has already passed the organism's own verifyPromotionV2.
 */
export function signPromotionV2FromCustody(homeDir: string, req: CustodyPromotionRequest): CustodySignVerdict {
  if (typeof req?.proposalHash !== 'string' || !/^[0-9a-f]{64}$/.test(req.proposalHash)) {
    return { ok: false, reason: 'proposalHash must be a bare 64-hex string' };
  }
  if (typeof req.nonce !== 'string' || !req.nonce) return { ok: false, reason: 'missing nonce' };

  const bundle = hybridBundleDir(homeDir);
  // COHERENCE FIRST — stored seeds must re-derive the pinned public root before they may sign anything.
  const coherent = verifyBundleCoherence(bundle);
  if (!coherent.ok) return { ok: false, reason: `hybrid custody incoherent — refusing to sign: ${coherent.reason}` };
  const custody = loadHybridCustody(homeDir);
  if (!custody.ok) return { ok: false, reason: `hybrid custody unavailable — refusing to sign: ${custody.reason}` };
  const root: AuthorityRootV2 = custody.root;

  const ed = readSeedStrict(path.join(bundle, HYBRID_SEED_FILES.ed25519), 'ed25519');
  if (!ed.ok) return { ok: false, reason: ed.reason };
  const ml = readSeedStrict(path.join(bundle, HYBRID_SEED_FILES.mlDsa65), 'ml-dsa-65');
  if (!ml.ok) return { ok: false, reason: ml.reason };

  const authorization: PromotionAuthorizationV2 = {
    rootId: root.rootId, // from coherent custody — never caller-chosen
    proposalHash: req.proposalHash,
    draftHash: req.proposalHash,
    nonce: req.nonce,
    issuedAt: req.issuedAt ?? new Date().toISOString(),
    expiresAt: req.expiresAt ?? null,
  };

  let signedReceipt: SignedPromotionV2;
  try {
    signedReceipt = signPromotionV2(ed.seed, ml.seed, authorization);
  } catch {
    // NEVER include seed bytes in an error.
    return { ok: false, reason: 'dual signing failed (custody present but a signature could not be produced)' };
  }

  // SIGN-THEN-SELF-VERIFY — never emit a receipt the organism's verifier would refuse.
  const verified = verifyPromotionV2(signedReceipt, root, authorization.issuedAt);
  if (!verified.valid) return { ok: false, reason: `self-verification of the produced receipt failed: ${verified.reason}` };

  return { ok: true, signedReceipt, rootId: root.rootId };
}

export type CustodyLifecycleVerdict =
  | { ok: true; signedEvent: SignedLifecycleV2; rootId: string }
  | { ok: false; reason: string };

/**
 * Dual-sign a key-lifecycle event (rotate/revoke) with the CURRENT custody seeds (#361 Cycle C). Same
 * hard rules as promotion signing: coherence first, strict seed reads, sign-then-self-verify with the
 * organism's verifyLifecycleV2 (which refuses a revoked or expired current root — a dead root can
 * authorize nothing, not even its own successor). The caller (aumlokLifecycleV2.ts) owns the durable
 * ledger consume and the atomic install; this function only produces the verified signed event.
 */
export function signLifecycleV2FromCustody(homeDir: string, event: KeyLifecycleEventV2): CustodyLifecycleVerdict {
  const bundle = hybridBundleDir(homeDir);
  const coherent = verifyBundleCoherence(bundle);
  if (!coherent.ok) return { ok: false, reason: `hybrid custody incoherent — refusing to sign: ${coherent.reason}` };
  const custody = loadHybridCustody(homeDir);
  if (!custody.ok) return { ok: false, reason: `hybrid custody unavailable — refusing to sign: ${custody.reason}` };
  const root: AuthorityRootV2 = custody.root;
  if (event?.rootId !== root.rootId) return { ok: false, reason: 'lifecycle event rootId does not name this node\'s pinned root' };

  const ed = readSeedStrict(path.join(bundle, HYBRID_SEED_FILES.ed25519), 'ed25519');
  if (!ed.ok) return { ok: false, reason: ed.reason };
  const ml = readSeedStrict(path.join(bundle, HYBRID_SEED_FILES.mlDsa65), 'ml-dsa-65');
  if (!ml.ok) return { ok: false, reason: ml.reason };

  let signedEvent: SignedLifecycleV2;
  try {
    signedEvent = signLifecycleV2(ed.seed, ml.seed, event);
  } catch {
    return { ok: false, reason: 'dual signing failed (custody present but a signature could not be produced)' };
  }
  const verified = verifyLifecycleV2(signedEvent, root, event.issuedAt);
  if (!verified.valid) return { ok: false, reason: `self-verification of the signed lifecycle event failed: ${verified.reason}` };
  return { ok: true, signedEvent, rootId: root.rootId };
}
