// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Proposal artifact — the human-reviewable file the owner actually reads before signing. Writing this
 * artifact and re-deriving its hash via the SAME `computeProposalHash` function (never a second
 * implementation) closes a real confused-deputy risk: if the CLI re-hashed independently, any drift in
 * canonicalization between what Aukora hashed and what the terminal displays/signs would be a
 * substitution risk. Not secret — it's the diff itself, awaiting a human decision.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeProposalHash, type ProposalFile } from './proposalHash';
import { stampExpiresBy } from './stalenessCore';

export interface SelfEditProposalArtifactV1 {
  schema: 'self-edit-proposal-artifact-v1';
  goal: string;
  files: ProposalFile[];
  proposalHash: string;
  createdAt: string;
  /** #183 staleness core: stamped at draft time (createdAt + horizon). OPTIONAL so artifacts
   *  written before round 5 stay valid — the verdict layer gives those the default horizon. */
  expiresBy?: string;
}

const ARTIFACT_KEYS: ReadonlySet<string> = new Set(['schema', 'goal', 'files', 'proposalHash', 'createdAt', 'expiresBy']);
function hasOnlyKeys(obj: any, allowed: ReadonlySet<string>): boolean {
  return !!obj && typeof obj === 'object' && Object.keys(obj).every((k) => allowed.has(k));
}

/** Build the artifact. The hash is ALWAYS derived here via computeProposalHash — never accepted as
 *  caller input — so the artifact can never claim a hash that doesn't match its own goal+files. */
export function buildSelfEditProposalArtifact(goal: string, files: ProposalFile[], now = new Date().toISOString()): SelfEditProposalArtifactV1 {
  // expiresBy is OUTSIDE the proposal hash (goal+files only) — staleness metadata can never
  // perturb what the owner signs, and a revive never changes the hash being signed. Stamping is
  // TOLERANT here: an unparseable `now` (test fixtures pass markers) yields no stamp, and the
  // verdict layer then flags the artifact unknown-age — honest, never a new throw in an old path.
  const stampable = Number.isFinite(Date.parse(now));
  return { schema: 'self-edit-proposal-artifact-v1', goal, files, proposalHash: computeProposalHash(goal, files), createdAt: now, ...(stampable ? { expiresBy: stampExpiresBy(now) } : {}) };
}

/** Fail-closed shape validation + hash re-derivation check for a STORED/read-back artifact. */
export function validateSelfEditProposalArtifact(a: any): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  if (a.schema !== 'self-edit-proposal-artifact-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(a, ARTIFACT_KEYS)) return { valid: false, reason: 'unknown field(s) in artifact' };
  if (typeof a.goal !== 'string' || !a.goal) return { valid: false, reason: 'goal must be a non-empty string' };
  if (!Array.isArray(a.files) || !a.files.length) return { valid: false, reason: 'files must be a non-empty array' };
  for (const f of a.files) {
    if (!f || typeof f.relPath !== 'string' || typeof f.content !== 'string') return { valid: false, reason: 'each file needs relPath + content strings' };
  }
  if (typeof a.proposalHash !== 'string' || !a.proposalHash) return { valid: false, reason: 'proposalHash must be a non-empty string' };
  if (typeof a.createdAt !== 'string' || !a.createdAt) return { valid: false, reason: 'createdAt must be a non-empty string' };
  if (a.expiresBy !== undefined && (typeof a.expiresBy !== 'string' || !a.expiresBy)) return { valid: false, reason: 'expiresBy must be a non-empty string when present' };
  const recomputed = computeProposalHash(a.goal, a.files);
  if (recomputed !== a.proposalHash) return { valid: false, reason: 'proposalHash does not match the recomputed hash of goal+files — artifact tampered or corrupt' };
  return { valid: true };
}

function pendingProposalsDir(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'aumlok', 'pending-proposals');
}

/** Write the artifact to disk (outside the repo) so the owner's terminal can read + sign it. Returns the
 *  path written. */
export function writeSelfEditProposalArtifact(artifact: SelfEditProposalArtifactV1, homeDir?: string): string {
  const dir = pendingProposalsDir(homeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${artifact.proposalHash}.json`);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), { mode: 0o600 });
  return filePath;
}

/** Gate-safety (found live 2026-07-08): a `run:` chain writes its artifact at the AGENT stage, so a
 *  chain that later fails (typecheck, content check) would leave a signable-looking artifact at the
 *  gate. WITHDRAW moves it into pending-proposals/archive/ — never deleted, the evidence trail stays,
 *  but the gate no longer offers it. Never throws; returns the archived path or a refusal reason. */
export function withdrawSelfEditProposalArtifact(artifactPath: string): { ok: true; archivedPath: string } | { ok: false; reason: string } {
  try {
    const archiveDir = path.join(path.dirname(artifactPath), 'archive');
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    const archivedPath = path.join(archiveDir, path.basename(artifactPath));
    fs.renameSync(artifactPath, archivedPath);
    return { ok: true, archivedPath };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Read + validate a proposal artifact from disk. Never throws — returns a refusal reason instead. */
export function readSelfEditProposalArtifact(filePath: string): { ok: true; artifact: SelfEditProposalArtifactV1 } | { ok: false; reason: string } {
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch (e) { return { ok: false, reason: `cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}` }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: `invalid JSON in ${filePath}` }; }
  const v = validateSelfEditProposalArtifact(parsed);
  if (!v.valid) return { ok: false, reason: v.reason ?? 'invalid artifact' };
  return { ok: true, artifact: parsed as SelfEditProposalArtifactV1 };
}

/** Read + validate a pending proposal artifact BY ITS HASH (the id a signed receipt carries). The hash
 *  MUST be a bare 64-hex string — never a path (no traversal, no absolute path, no escape from the
 *  pending-proposals dir). validateSelfEditProposalArtifact has already re-derived the hash from
 *  goal+files, and it is cross-checked against the REQUESTED hash here — so a renamed/swapped file
 *  cannot smuggle different content under a signed hash. Never throws. (First-contact seam fix,
 *  2026-07-05: `apply signed proposal` in a FRESH workbench session had no way to load the proposal the
 *  owner had just signed — the artifact was on disk all along; this is its governed loader.) */
export function readPendingProposalByHash(proposalHash: string, homeDir?: string): { ok: true; artifact: SelfEditProposalArtifactV1; filePath: string } | { ok: false; reason: string } {
  if (typeof proposalHash !== 'string' || !/^[0-9a-f]{64}$/.test(proposalHash)) {
    return { ok: false, reason: `proposal hash must be a bare 64-hex string (no paths), got: ${String(proposalHash).slice(0, 80)}` };
  }
  const filePath = path.join(pendingProposalsDir(homeDir), `${proposalHash}.json`);
  const read = readSelfEditProposalArtifact(filePath);
  if (!read.ok) return read;
  if (read.artifact.proposalHash !== proposalHash) {
    return { ok: false, reason: `artifact at ${proposalHash}.json carries a DIFFERENT proposalHash (${read.artifact.proposalHash.slice(0, 16)}…) — file renamed or tampered` };
  }
  return { ok: true, artifact: read.artifact, filePath };
}
