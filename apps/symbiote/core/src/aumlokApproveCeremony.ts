// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * #105b — the device-local APPROVE ceremony core. This is the SAME sign→re-verify→apply path the terminal
 * ceremony (scripts/aumlok-authority.sh sign + workbench apply) already performs; it is factored here so the
 * local approve door can run it AFTER the owner completes a proposal-bound challenge. It does NOT lower the
 * trust root one inch: the owner's private key is read LOCALLY on the machine (never sent to the browser,
 * never returned, never logged), the authorization is signed with it, and dispatchSignedLiveApply RE-VERIFIES
 * that signature against the freshly-recomputed proposal hash before it writes anything.
 *
 * "The AI does not sign." This module is invoked only by the owner's approval gesture (challenge confirmed);
 * it mints no authority of its own. It exists so Peter's OWN approval moves from a terminal command to a UI
 * click — the receipts still say, truthfully, that his key signed.
 *
 * KEY HYGIENE (load-bearing): the private key is read into a local const, used for the one signature, and the
 * function returns ONLY the resulting receipt (which carries the public SIGNATURE, never the key). No error
 * path includes the key. Callers must never log the returned key-free result's raw error alongside key bytes
 * (there are none here to leak).
 */
import * as fs from 'fs';
import * as path from 'path';
import { readPendingProposalByHash } from './selfEditProposalArtifact';
import { signPromotionAuthorization } from './aumlokSigner';
import { pinAuthorityRoot } from './aumlokAuthorityRoot';
import { dispatchSignedLiveApply } from './nativeLiveApply';
import { recordSignedAppliedDisposition } from './proposalDispositionWrite';
import { readProposalDispositionRows } from './proposalDispositionRead';
// #361 Fable Finish Cycle A: on a v2-bound node the door signs the mandatory DUAL Ed25519+ML-DSA-65
// receipt from published hybrid custody — the v1 Ed-only path below survives ONLY where no v2 state
// exists (mirroring nativeLiveApply's own sentinel, so signer and writer can never disagree about
// which suite a node speaks).
import { hybridV2StatePresent, hybridBindStatusV2 } from './aumlokBindV2';
import { signPromotionV2FromCustody } from './aumlokSignerCustodyV2';
import { AUMLOK_SUITE_V2, AUMLOK_MODE_V2, type SignedPromotionV2 } from './aumlokAuthorityV2';
import type { SignedPromotionReceipt } from './aumlokAuthorityRoot';

export interface ApproveCeremonyPaths {
  homeDir?: string;   // ~/.aukora-symbiote  (keys live under homeDir/aumlok/)
  repoRoot?: string;  // the live repo dispatchSignedLiveApply writes to (default: its own resolved root)
}

export type ApproveResult =
  | { ok: true; proposalHash: string; commitSha: string; rollbackCommand: string; receiptHash: string; dispositionRecorded: boolean; dispositionWarning: string | null }
  | { ok: false; reason: string };

function aumlokKeyDir(homeDir: string): string { return path.join(homeDir, 'aumlok'); }

export interface AumlokKeyStatus {
  keyPresent: boolean;
  publicKeyPresent: boolean;
  /** honest suite truth (#361 Cycle A): which authority suite this node's signing material speaks.
   *  'none' = unbound; v2 wins whenever ANY v2 state exists (a v2 node with incoherent custody reports
   *  suite v2 with keyPresent=false — fail-closed, never silently offered the v1 path). */
  suite: typeof AUMLOK_SUITE_V2 | 'ed25519-v1' | 'none';
  custody: typeof AUMLOK_MODE_V2 | 'software_classical' | null;
}

/** Key status. v1: existence-only, never opens the key file (as before). v2: bound ONLY via full custody
 *  coherence — hybridBindStatusV2 reads the stored seeds INTERNALLY to re-derive the pinned public root
 *  (never returned or logged; this is a human-side door module, the same custody tier as the signing path
 *  below). Used to decide whether to offer approval at all. */
export function aumlokKeyStatus(homeDir: string): AumlokKeyStatus {
  if (hybridV2StatePresent(homeDir)) {
    const v2 = hybridBindStatusV2(homeDir);
    return { keyPresent: v2.bound, publicKeyPresent: v2.bound, suite: AUMLOK_SUITE_V2, custody: v2.bound ? AUMLOK_MODE_V2 : null };
  }
  const dir = aumlokKeyDir(homeDir);
  const keyPresent = existsFile(path.join(dir, 'authority-ed25519.key'));
  const publicKeyPresent = existsFile(path.join(dir, 'authority-ed25519.pub'));
  return { keyPresent, publicKeyPresent, suite: keyPresent ? 'ed25519-v1' : 'none', custody: keyPresent ? 'software_classical' : null };
}
function existsFile(p: string): boolean { try { return fs.statSync(p).isFile(); } catch { return false; } }

/** Read the private key under strict custody — regular file, no symlink, no group/other bits. LOUD refusal. */
function readPrivateKeyStrict(privPath: string): { ok: true; key: string } | { ok: false; reason: string } {
  let st;
  try { st = fs.lstatSync(privPath); } catch { return { ok: false, reason: 'no signing key present (run keygen in your terminal first)' }; }
  if (st.isSymbolicLink()) return { ok: false, reason: 'signing key is a symlink — refused' };
  if (!st.isFile()) return { ok: false, reason: 'signing key is not a regular file — refused' };
  if ((st.mode & 0o077) !== 0) return { ok: false, reason: `signing key is group/world accessible (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it` };
  const raw = fs.readFileSync(privPath, 'utf-8').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return { ok: false, reason: 'signing key is malformed' };
  return { ok: true, key: raw.toLowerCase() };
}

export type ApprovalSignVerdict =
  | { ok: true; signedReceipt: SignedPromotionReceipt | SignedPromotionV2 }
  | { ok: false; reason: string };

/**
 * The door's SIGNING decision (#361 Fable Finish Cycle A), extracted so the suite-dispatch seam is
 * directly testable: ANY v2 state on this node means the mandatory dual Ed25519+ML-DSA-65 receipt is
 * produced from published hybrid custody (incoherent custody REFUSES — never a silent v1 fallback),
 * mirroring nativeLiveApply's own sentinel so signer and writer can never disagree about which suite a
 * node speaks. The legacy Ed-only path survives only where no v2 state exists. The nonce binds the
 * signature to the owner's confirmed challenge. Signing only — this function never applies anything;
 * the writer downstream independently re-verifies whatever this returns.
 */
export function signProposalHashForApproval(homeDir: string, proposalHash: string, nonce: string): ApprovalSignVerdict {
  if (typeof proposalHash !== 'string' || !/^[0-9a-f]{64}$/.test(proposalHash)) return { ok: false, reason: 'proposal hash must be a bare 64-hex string' };
  if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'missing approval nonce' };
  if (hybridV2StatePresent(homeDir)) {
    const dual = signPromotionV2FromCustody(homeDir, { proposalHash, nonce });
    if (!dual.ok) return { ok: false, reason: dual.reason };
    return { ok: true, signedReceipt: dual.signedReceipt };
  }
  const dir = aumlokKeyDir(homeDir);
  const pub = readPublic(path.join(dir, 'authority-ed25519.pub'));
  if (!pub.ok) return { ok: false, reason: pub.reason };
  let keyId: string;
  try { keyId = pinAuthorityRoot(pub.key).keyId; } catch (e) { return { ok: false, reason: `authority root invalid: ${e instanceof Error ? e.message : String(e)}` }; }

  const priv = readPrivateKeyStrict(path.join(dir, 'authority-ed25519.key'));
  if (!priv.ok) return { ok: false, reason: priv.reason };

  // Build + sign the authorization LOCALLY. issuedAt via Date is fine here (this is a live ceremony, not a
  // pure function); the nonce binds it to the owner's confirmed challenge.
  const auth = { keyId, proposalHash, draftHash: proposalHash, nonce, issuedAt: new Date().toISOString(), expiresAt: null as string | null };
  try {
    return { ok: true, signedReceipt: signPromotionAuthorization(priv.key, auth) };
  } catch {
    // NEVER include the key or its bytes in an error.
    return { ok: false, reason: 'signing failed (key present but signature could not be produced)' };
  }
}

/**
 * Sign and apply ONE proposal by hash, using the owner's LOCAL key. Fail-closed everywhere:
 *   - the proposal must be a valid pending artifact whose hash matches the requested hash;
 *   - the private key must exist under strict custody;
 *   - the signature is re-verified against the recomputed hash by dispatchSignedLiveApply before any write;
 *   - `nonce` is the challenge nonce, so the signed authorization is bound to the specific approval gesture.
 * On success the applied artifact is archived out of pending-proposals so the queue never re-offers a
 * done proposal (queue-honesty). NEVER returns or logs the private key.
 */
export function approveAndApplyProposal(proposalHash: string, nonce: string, paths: ApproveCeremonyPaths = {}): ApproveResult {
  const homeDir = paths.homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  if (typeof proposalHash !== 'string' || !/^[0-9a-f]{64}$/.test(proposalHash)) return { ok: false, reason: 'proposal hash must be a bare 64-hex string' };
  if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'missing approval nonce' };

  const dir = aumlokKeyDir(homeDir);
  const loaded = readPendingProposalByHash(proposalHash, homeDir);
  if (!loaded.ok) return { ok: false, reason: `proposal not found or invalid: ${loaded.reason}` };
  const artifact = loaded.artifact;

  // A terminal owner disposition is closure, not advisory to the authorization path. In particular,
  // a rejected artifact can never be revived into an approval if an archive move was interrupted.
  const dispositions = readProposalDispositionRows(homeDir, 100);
  if (dispositions.refusedReason) return { ok: false, reason: `cannot trust proposal disposition journal: ${dispositions.refusedReason}` };
  const prior = dispositions.rows.find((row) => row.proposalHash === artifact.proposalHash);
  if (prior) return { ok: false, reason: `proposal already has terminal disposition: ${prior.disposition}` };

  // #361 Fable Finish Cycle A — suite dispatch (extracted, testable): the door's signature comes from
  // signProposalHashForApproval below; the writer downstream independently re-verifies it.
  const signed = signProposalHashForApproval(homeDir, artifact.proposalHash, nonce);
  if (!signed.ok) return { ok: false, reason: signed.reason };
  const signedReceipt = signed.signedReceipt;

  const result = dispatchSignedLiveApply({ goal: artifact.goal, proposalHash: artifact.proposalHash, files: artifact.files, signedReceipt });
  if (!result.ok || !result.receipt) return { ok: false, reason: result.reason ?? 'apply refused' };

  // Close the observer half of the loop AFTER the signed apply is real. This row is advisory closure
  // evidence linked to the verified receipt; it never participates in the authorization decision.
  const disposition = recordSignedAppliedDisposition({
    proposalHash: artifact.proposalHash,
    decidedAt: result.receipt.createdAt,
    commitSha: result.receipt.commitSha,
    receiptHash: result.receipt.receiptHash,
  }, homeDir);

  // Queue honesty: an applied proposal must not keep showing as "ready". Archive its artifact (best-effort).
  try {
    const archive = path.join(dir, 'pending-proposals', 'applied-archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(loaded.filePath, path.join(archive, path.basename(loaded.filePath)));
  } catch { /* archiving is best-effort; the apply already succeeded and is receipted */ }

  return {
    ok: true,
    proposalHash: artifact.proposalHash,
    commitSha: result.receipt.commitSha,
    rollbackCommand: result.receipt.rollbackCommand,
    receiptHash: result.receipt.receiptHash,
    dispositionRecorded: disposition.ok,
    dispositionWarning: disposition.ok ? null : `apply succeeded, but proposal disposition could not be recorded: ${disposition.reason}`,
  };
}

function readPublic(pubPath: string): { ok: true; key: string } | { ok: false; reason: string } {
  try {
    const raw = fs.readFileSync(pubPath, 'utf-8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) return { ok: false, reason: 'public key malformed' };
    return { ok: true, key: raw.toLowerCase() };
  } catch { return { ok: false, reason: 'no public key / authority root present' }; }
}
