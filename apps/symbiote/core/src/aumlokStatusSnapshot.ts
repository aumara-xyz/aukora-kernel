// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK status snapshot — the ONE honest, read-only answer to "what state is AUMLOK actually in
 * right now?" for the workbench UI's right pane. Distinguishes four SEPARATE things that must never
 * be conflated in wording:
 *   1. session/phrase boundary   — aumlokBondCeremony.ts's ceremony state (never authority)
 *   2. cryptographic root status — does a keypair exist? is a public root pinned+valid?
 *   3. signed proposal state    — is there a per-proposal signed authorization on file? (Round 4 lane)
 *   4. live apply status        — isLivePromotionUnlocked() (always false today) + whether ANY
 *                                  per-proposal signed live-apply has ever actually happened
 * PURE reads only: file existence + parsing already-public manifest/ledger JSON. NEVER reads the
 * private key file's bytes, never returns key material, never mutates anything.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseRootManifest, validateRehearsalReceipt, type AumlokRehearsalReceiptV1 } from './aumlokAuthorityRoot';
// #361 Fable Finish Cycle A: the snapshot tells the truth about post-quantum hybrid custody. Reads are
// status-only (hybridBindStatusV2 re-derives pinned pubs from stored seeds INTERNALLY inside the bindV2
// module and returns PUBLIC fields only — this module still never touches key bytes itself).
import { hybridV2StatePresent, hybridBindStatusV2 } from './aumlokBindV2';
import { AUMLOK_SUITE_V2, AUMLOK_MODE_V2, displayFingerprintV2 } from './aumlokAuthorityV2';
import { readMigrationLineage } from './aumlokMigrateV2';

export interface AumlokStatusSnapshot {
  schema: 'aumlok-status-snapshot-v1';
  // 1. session/phrase boundary — advisory ceremony only, never authority (see aumlokBondCeremony.ts)
  sessionBoundary: { formed: boolean; note: string };
  // 2. cryptographic root status
  keyPresent: boolean;          // a PRIVATE key file exists at the human-held path (existence only — never read)
  publicRootPinned: boolean;    // a valid, integrity-checked AuthorityRootManifest is on disk
  publicRootRevoked: boolean;
  keyId: string | null;
  // 2b. post-quantum hybrid custody truth (#361 Cycle A) — exact suite + custody tier, never overclaimed:
  //     statePresent = ANY v2 state on this node (published bundle, staging, lock); bound = the COMPLETE
  //     bundle passed full custody coherence. rootFingerprint is DISPLAY-ONLY (12 hex of the full root id).
  hybridV2: {
    statePresent: boolean;
    bound: boolean;
    suite: typeof AUMLOK_SUITE_V2 | null;
    custody: typeof AUMLOK_MODE_V2 | null;
    rootFingerprint: string | null;
    /** #361 Cycle C: revocation + lineage truth. `revoked` = the pinned root is dual-signed dead;
     *  `rotations` = fingerprint rotation count; `migratedFromV1` = display fingerprint of the legacy
     *  root this identity migrated from (null on genesis binds), with `lineageVerified` = the persisted
     *  migration envelope fully re-verifies against the retained v1 manifest. */
    revoked: boolean;
    rotations: number;
    migratedFromV1: string | null;
    lineageVerified: boolean | null;
  };
  // 3. signed proposal / rehearsal state
  latestRehearsalReceipt: { receiptHash: string; createdAt: string; verifierValid: boolean } | null;
  rehearsalReceiptCount: number;
  // 4. live apply status — the only thing allowed to ever say "unlocked"
  livePromotionUnlocked: false; // literal — there is no standing/blanket unlock, ever, today
  signedLiveApplyLaneBuilt: true; // the per-proposal signed live-apply lane itself EXISTS (nativeLiveApply.ts) —
  // distinct from livePromotionUnlocked, which is about a BLANKET unlock that still does not exist
  appliedProposalCount: number; // how many proposals have actually been live-applied via that lane, ever
  signerVerifierSplitIntact: boolean; // aumlokSigner.ts never imported by aumlokAuthorityRoot.ts
  generatedAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface AumlokStatusPaths {
  homeDir?: string;   // defaults to ${AUKORA_SYMBIOTE_HOME:-~/.aukora-symbiote}
  repoRoot?: string;  // defaults to path.resolve(__dirname, '..', '..') — for the signer/verifier split check only
}

function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
}

/** Read-only: does aumlokAuthorityRoot.ts import aumlokSigner.ts (the private-key module)? It must not. */
function checkSignerVerifierSplitIntact(repoRoot: string): boolean {
  try {
    const src = fs.readFileSync(path.join(repoRoot, 'core', 'src', 'aumlokAuthorityRoot.ts'), 'utf-8');
    return !/from ['"]\.\/aumlokSigner['"]/.test(src) && !/require\(['"]\.\/aumlokSigner['"]\)/.test(src);
  } catch {
    return false; // fail closed — cannot prove the split, do not claim it is intact
  }
}

function readLatestRehearsalReceipt(receiptsDir: string): { file: string; receipt: AumlokRehearsalReceiptV1 } | null {
  let files: string[];
  try { files = fs.readdirSync(receiptsDir).filter((f) => f.startsWith('rehearsal-') && f.endsWith('.json')); }
  catch { return null; }
  if (!files.length) return null;
  files.sort(); // filenames are zero-padded-seq prefixed — lexicographic sort is chronological
  const last = files[files.length - 1];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(receiptsDir, last), 'utf-8'));
    return { file: last, receipt: parsed };
  } catch {
    return null;
  }
}

/** Build the honest AUMLOK status snapshot. Never throws; a missing/malformed file just reads as absent. */
export function buildAumlokStatusSnapshot(paths: AumlokStatusPaths = {}, now = new Date().toISOString()): AumlokStatusSnapshot {
  const homeDir = resolveHomeDir(paths.homeDir);
  const repoRoot = paths.repoRoot ?? path.resolve(__dirname, '..', '..');
  const keyDir = path.join(homeDir, 'aumlok');
  const privKeyPath = path.join(keyDir, 'authority-ed25519.key');
  const manifestPath = path.join(keyDir, 'authority-root.json');
  const receiptsDir = path.join(keyDir, 'receipts');

  const keyPresent = fs.existsSync(privKeyPath);

  let publicRootPinned = false;
  let publicRootRevoked = false;
  let keyId: string | null = null;
  try {
    const manifestJson = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = parseRootManifest(manifestJson);
    if (parsed.ok) {
      publicRootPinned = true;
      publicRootRevoked = parsed.root.revoked;
      keyId = parsed.root.keyId;
    }
  } catch { /* no manifest yet — honestly absent */ }

  let rehearsalReceiptCount = 0;
  try { rehearsalReceiptCount = fs.readdirSync(receiptsDir).filter((f) => f.startsWith('rehearsal-') && f.endsWith('.json')).length; } catch { /* none yet */ }

  let appliedProposalCount = 0;
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(keyDir, 'applied-ledger.json'), 'utf-8'));
    if (Array.isArray(ledger)) appliedProposalCount = ledger.length;
  } catch { /* no ledger yet, or unreadable — reads as 0, never throws */ }

  // #361 Cycle A — hybrid custody truth. bound requires FULL coherence (stored seeds re-derive the pinned
  // root inside the bindV2 module); statePresent without bound is an honest "v2 state exists but is not
  // coherent — this node fails closed" reading, never hidden.
  let hybridV2: AumlokStatusSnapshot['hybridV2'] = { statePresent: false, bound: false, suite: null, custody: null, rootFingerprint: null, revoked: false, rotations: 0, migratedFromV1: null, lineageVerified: null };
  try {
    if (hybridV2StatePresent(homeDir)) {
      const v2 = hybridBindStatusV2(homeDir);
      const lineage = readMigrationLineage(homeDir);
      hybridV2 = {
        statePresent: true,
        bound: v2.bound,
        suite: v2.bound ? AUMLOK_SUITE_V2 : null,
        custody: v2.bound ? AUMLOK_MODE_V2 : null,
        rootFingerprint: v2.bound && v2.rootId ? displayFingerprintV2(v2.rootId) : null,
        revoked: v2.revoked === true,
        rotations: v2.rotations ?? 0,
        migratedFromV1: lineage.state === 'migrated' ? displayFingerprintV2(lineage.oldRootId) : null,
        lineageVerified: lineage.state === 'migrated' ? lineage.lineageVerified : null,
      };
    }
  } catch { /* unreadable v2 state reads as present-but-unbound only if detected; never throws */ }

  let latestRehearsalReceipt: AumlokStatusSnapshot['latestRehearsalReceipt'] = null;
  const latest = readLatestRehearsalReceipt(receiptsDir);
  if (latest) {
    const v = validateRehearsalReceipt(latest.receipt);
    if (v.valid) {
      latestRehearsalReceipt = {
        receiptHash: latest.receipt.receiptHash,
        createdAt: latest.receipt.createdAt,
        verifierValid: latest.receipt.verifierResult.valid,
      };
    }
  }

  return {
    schema: 'aumlok-status-snapshot-v1',
    sessionBoundary: {
      formed: false, // the workbench UI's own client-side ceremony state is reported by the browser, not here
      note: 'Session/phrase boundary is a UI-local ceremony (aumlokBondCeremony.ts) — advisory only, never authority.',
    },
    keyPresent,
    publicRootPinned,
    publicRootRevoked,
    keyId,
    hybridV2,
    latestRehearsalReceipt,
    rehearsalReceiptCount,
    livePromotionUnlocked: false,
    signedLiveApplyLaneBuilt: true,
    appliedProposalCount,
    signerVerifierSplitIntact: checkSignerVerifierSplitIntact(repoRoot),
    generatedAt: now,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** A one-line, unambiguous, non-overclaiming summary for the UI's own logs / tests. */
export function summarizeAumlokStatus(s: AumlokStatusSnapshot): string {
  return [
    `hybrid v2: ${s.hybridV2.bound
      ? `BOUND (${s.hybridV2.suite}, ${s.hybridV2.custody}, root ${s.hybridV2.rootFingerprint}…${s.hybridV2.revoked ? ', REVOKED — authority dead' : ''}${s.hybridV2.rotations ? `, rotations ${s.hybridV2.rotations}` : ''}${s.hybridV2.migratedFromV1 ? `, migrated from v1 root ${s.hybridV2.migratedFromV1}… (lineage ${s.hybridV2.lineageVerified ? 'verified' : 'NOT verified'})` : ''})`
      : s.hybridV2.statePresent ? 'v2 state present but NOT coherent — fails closed' : 'not bound'}`,
    `key: ${s.hybridV2.bound ? 'hybrid v2 seeds held (human-held, in the published bundle, never read by this snapshot)' : s.keyPresent ? 'present (human-held, never read by this snapshot)' : 'NOT generated yet — run scripts/aumlok-authority.sh bind-v2'}`,
    `public root: ${s.publicRootPinned ? `pinned (keyId ${s.keyId}${s.publicRootRevoked ? ', REVOKED' : ''})` : 'not pinned'}`,
    `rehearsal receipts: ${s.rehearsalReceiptCount}`,
    `signed live-apply lane: built (${s.appliedProposalCount} proposal(s) actually applied so far)`,
    `live promotion: ${s.livePromotionUnlocked ? 'UNLOCKED' : 'locked (no standing unlock exists)'}`,
    `signer/verifier split: ${s.signerVerifierSplitIntact ? 'intact' : 'COULD NOT VERIFY'}`,
  ].join(' · ');
}
