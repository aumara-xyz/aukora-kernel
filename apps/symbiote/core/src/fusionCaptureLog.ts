// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Opt-in raw Fusion Council reply capture (issue #34/Round 6). AUKORA_FUSION_CAPTURE=1 persists each
 * council model's raw reply verbatim, outside the repo, for building REAL parser-fixing fixtures against
 * REAL model output — the same discipline the paren-bug fix (issue #22) used, done properly this time:
 * capture first, fix the parser against captured evidence, never guess-and-check against live traffic.
 *
 * Kept out of the glyph engine module that calls it (a donor file landed with zero imports of its own —
 * see that module's own header) so this round's capture hook there stays a single call, not a
 * structural rewrite. Off by default; a disk-write failure here must never break a real council run.
 */
import * as fs from 'fs';
import { join } from 'path';
import { symbioteHome } from '../../authority/symbiotePaths';

export function captureRawFusionReply(modelSlug: string, rawText: string, now = new Date().toISOString()): void {
  if (process.env.AUKORA_FUSION_CAPTURE !== '1') return;
  try {
    const dir = join(symbioteHome(), 'fusion-captures');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safeSlug = modelSlug.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = now.replace(/[:.]/g, '-');
    fs.writeFileSync(join(dir, `${stamp}-${safeSlug}.txt`), rawText, { mode: 0o600 });
  } catch {
    // capture is best-effort/advisory — never break a real council run over a disk write failure.
  }
}
