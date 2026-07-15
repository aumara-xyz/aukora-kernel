// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The one shared hex-run chokepoint. Any 40+ hex-char run (a sha256, a signature, a commit hash, a
 * key-shaped blob) is collapsed to a 16-char prefix + ellipsis before it can land in advisory memory,
 * a flight-recorder line, or a captured event — so raw secret-shaped values never persist verbatim,
 * and Kira's own forbidden-content guard (which rejects 64+ hex runs) never silently drops a capture.
 *
 * Extracted from workbenchCommandLoop.ts (issue #54): the flight recorder needs the identical
 * sanitization, and copying it would be the THIRD duplication in this file's documented drift history.
 * One definition, many callers.
 */
// Usage: truncateHexRunsForCapture("deadbeefcafe1234deadbeefcafe1234deadbeefcafe") => "deadbeefcafe1234…"
export function truncateHexRunsForCapture(text: string): string {
  return text.replace(/[0-9a-f]{40,}/gi, (m) => `${m.slice(0, 16)}…`);
}
