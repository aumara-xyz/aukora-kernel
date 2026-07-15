// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Brick #104 wiring — reconstruct a proposal's files from unified DIFFS into whole-file CONTENT.
 *
 * A proposal file may be authored EITHER as `{relPath, content}` (whole file, the original path) OR as
 * `{relPath, diff}` (a unified diff against the CURRENT disk bytes, the #104 throughput path — a big file
 * no longer has to be reproduced byte-for-byte, which is fragile). This helper turns the diff form back
 * into the content form so EVERYTHING downstream is byte-identical to today: the same computeProposalHash,
 * the same sandbox, the same gate, the same AUMLOK signature over a full-content hash. The diff is purely a
 * transport optimization for how the change was authored; it changes NOTHING about what the owner signs.
 *
 * SAFETY — this grants no authority and applies nothing. Its guarantees:
 *   - EXACT-MATCH ONLY: applyUnifiedDiff refuses (fail-closed) unless every context/removed line matches the
 *     real disk bytes byte-for-byte; a diff that did not truly see the disk cannot produce a reconstruction,
 *     so the hash the owner signs is always bound to content actually derived from real disk bytes.
 *   - CONFINED READS: the disk read goes through resolveRepoReadPath (#75) — symlink-denied, realpath-
 *     confined, secret-shaped-refused — the SAME reader read_file uses. A diff cannot pull bytes from a
 *     sensitive/secret file to fold into a proposal.
 *   - DIFF IS MODIFY-ONLY: a diff targets a file that must already EXIST. A NEW file must use `content`
 *     (new files are small by definition; the fragility #104 solves is in LARGE existing files). A diff
 *     against a missing target refuses.
 *   - AMBIGUITY REFUSED: exactly one of content/diff per file; both-or-neither refuses.
 * The reader is INJECTED so this is unit-testable without a live repo; the default reads via the resolver.
 */
import * as fs from 'fs';
import { applyUnifiedDiff } from './unifiedDiff';
import { applyEditBlocks, type EditBlock } from './editBlocks';
import { resolveRepoReadPath } from './repoReadPathResolver';

/** A file as the agent/author submitted it. EXACTLY ONE authoring form per file:
 *  - `content` — whole new file (best for new or small files)
 *  - `edits`   — search/replace blocks against the current file (BEST for edits to large existing files; the
 *                LLM-friendly form — no line arithmetic; each find must match disk exactly once)
 *  - `diff`    — a unified diff against the current file (also supported; harder for models to author) */
export interface RawProposalFile { relPath: string; content?: string; diff?: string; edits?: EditBlock[] }
/** The reconstructed form every downstream stage consumes — identical to a whole-file proposal. */
export interface ReconstructedFile { relPath: string; content: string }

export type FileReader = (relPath: string) => { ok: true; content: string } | { ok: false; reason: string };

export type ReconstructResult =
  | { ok: true; files: ReconstructedFile[] }
  | { ok: false; reason: string };

/** Default disk reader: the SAME #75-confined resolver read_file uses. A missing target is a typed refusal
 *  (new files must use content), never a silent empty original. */
export function defaultRepoFileReader(relPath: string): { ok: true; content: string } | { ok: false; reason: string } {
  const r = resolveRepoReadPath(relPath);
  if (!r.ok) return { ok: false, reason: `cannot resolve diff target ${relPath}: ${r.reason}` };
  let isFile = false;
  try { isFile = fs.statSync(r.real).isFile(); } catch { return { ok: false, reason: `diff target not found: ${relPath} — new files must use content, not a diff` }; }
  if (!isFile) return { ok: false, reason: `diff target is not a file: ${relPath}` };
  try { return { ok: true, content: fs.readFileSync(r.real, 'utf-8') }; }
  catch (e) { return { ok: false, reason: `diff target unreadable: ${relPath} (${e instanceof Error ? e.message : String(e)})` }; }
}

const MAX_DIFF_CHARS = 200_000; // a diff larger than this is not the small-edit case #104 exists for

/**
 * Reconstruct every file to whole-file content. Whole-file inputs pass through unchanged; diff inputs are
 * applied against the current disk bytes and refuse fail-closed on ANY non-clean apply. Returns all files
 * in {relPath, content} form, or the FIRST refusal (atomic — one bad file fails the whole proposal, so a
 * partially-reconstructed change can never reach the gate).
 */
export function reconstructProposalFiles(
  files: RawProposalFile[],
  opts: { readFile?: FileReader } = {},
): ReconstructResult {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, reason: 'no files to reconstruct' };
  const readFile = opts.readFile ?? defaultRepoFileReader;
  const out: ReconstructedFile[] = [];
  for (const f of files) {
    if (!f || typeof f.relPath !== 'string' || !f.relPath) return { ok: false, reason: 'each file needs a non-empty relPath' };
    const hasContent = typeof f.content === 'string';
    const hasDiff = typeof f.diff === 'string';
    const hasEdits = Array.isArray(f.edits);
    // EXACTLY ONE authoring form per file — ambiguity (more than one) or emptiness (none) refuses fail-closed.
    const forms = (hasContent ? 1 : 0) + (hasDiff ? 1 : 0) + (hasEdits ? 1 : 0);
    if (forms > 1) return { ok: false, reason: `file ${f.relPath} has more than one of content/diff/edits — send exactly one` };
    if (forms === 0) return { ok: false, reason: `file ${f.relPath} has none of content/diff/edits` };
    if (hasContent) {
      out.push({ relPath: f.relPath, content: f.content as string });
      continue;
    }
    // Both diff and edits reconstruct against the CURRENT disk bytes (read through the #75-confined resolver).
    const read = readFile(f.relPath);
    if (!read.ok) return { ok: false, reason: read.reason };
    if (hasEdits) {
      const applied = applyEditBlocks(read.content, f.edits as EditBlock[]);
      if (!applied.ok) return { ok: false, reason: `edits for ${f.relPath} do not apply cleanly to disk: ${applied.reason}` };
      out.push({ relPath: f.relPath, content: applied.content });
      continue;
    }
    const diff = f.diff as string;
    if (diff.length > MAX_DIFF_CHARS) return { ok: false, reason: `diff for ${f.relPath} is too large (> ${MAX_DIFF_CHARS} chars)` };
    const applied = applyUnifiedDiff(read.content, diff);
    if (!applied.ok) return { ok: false, reason: `diff for ${f.relPath} does not apply cleanly to disk: ${applied.reason}` };
    out.push({ relPath: f.relPath, content: applied.content });
  }
  return { ok: true, files: out };
}

/** The authoring form a file used — for honest logging of the #104 path. */
export function proposalAuthoringForm(f: RawProposalFile): 'content' | 'diff' | 'edits' | 'invalid' {
  if (typeof f?.content === 'string') return 'content';
  if (Array.isArray(f?.edits)) return 'edits';
  if (typeof f?.diff === 'string') return 'diff';
  return 'invalid';
}

/** True iff any file is authored as a diff or edits (the #104 reconstruct path) — for logging/branching. */
export function proposalUsesDiff(files: RawProposalFile[]): boolean {
  return Array.isArray(files) && files.some((f) => f && (typeof f.diff === 'string' || Array.isArray(f.edits)));
}
