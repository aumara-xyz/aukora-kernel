// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Safe target-file reader (V3). The impure filesystem edge, hardened:
 *  - `lstat` (NOT `stat`) → a SYMLINK is refused, never followed (no traversal to a secret/private file).
 *  - directories and non-regular files are refused.
 *  - the size is checked BEFORE the read (no file-flood / oversized read); the read is a single pass.
 * TOCTOU note: the lstat→read window is minimized (one lstat, one read of the same path) and the read
 * bytes are D6 secret-scanned downstream before anything reaches a provider, so a swapped-in secret is
 * still refused. Content is NOT truncated — an oversize file is refused, not silently clipped.
 */
import * as fs from 'node:fs';

export const MAX_TARGET_BYTES = 1_048_576; // == LIMITS_PROFILES['default-v1'].maxFileBytes

export type ReadResult =
  | { readonly ok: true; readonly content: string; readonly bytes: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function safeReadTargetFile(abs: string, maxBytes: number = MAX_TARGET_BYTES): ReadResult {
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch { return { ok: false, code: 'E_MISSING_EVIDENCE', message: `not found: ${abs}` }; }
  if (st.isSymbolicLink()) return { ok: false, code: 'E_SYMLINK_REFUSED', message: 'target is a symlink — refused (no traversal)' };
  if (!st.isFile()) return { ok: false, code: 'E_MISSING_EVIDENCE', message: 'target is not a regular file' };
  if (st.size > maxBytes) return { ok: false, code: 'E_LIMIT_FILE_BYTES', message: `target ${st.size} > ${maxBytes} bytes — refused (no truncation)` };
  let content: string;
  try { content = fs.readFileSync(abs, 'utf8'); } catch (e) { return { ok: false, code: 'E_READ', message: String((e as Error).message ?? e) }; }
  return { ok: true, content, bytes: Buffer.byteLength(content, 'utf8') };
}
