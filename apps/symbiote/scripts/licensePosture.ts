// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the license posture is now DECIDED — AGPL-3.0-or-later (owner, 2026-07-10). This PURE
// module verifies the three declarations agree (root LICENSE is real AGPLv3, package.json declares the
// SPDX id, source headers carry the same id) and classifies a dependency's declared license for
// AGPL-compatibility. No filesystem/network — callers pass strings.

export const CHOSEN_SPDX = 'AGPL-3.0-or-later';

/** The root LICENSE must be the canonical GNU AGPLv3 — checked by its hallmark clauses, incl. the §13
 *  "Remote Network Interaction" clause that distinguishes AGPL from GPL. */
export function isAgplLicenseText(text: string): boolean {
  return /GNU AFFERO GENERAL PUBLIC LICENSE/.test(text)
    && /Version 3, 19 November 2007/.test(text)
    && /Remote Network Interaction/.test(text);
}

export function packageDeclaresChosenLicense(pkg: { license?: unknown }): boolean {
  return typeof pkg.license === 'string' && pkg.license === CHOSEN_SPDX;
}

/** The SPDX identifier declared in a source header, if any. */
export function headerSpdxIdentifier(fileText: string): string | null {
  const m = /SPDX-License-Identifier:\s*([^\s*]+)/.exec(fileText);
  return m ? m[1] : null;
}

export interface PostureInput { licenseText: string; pkg: { license?: unknown }; sampleHeaderTexts: string[] }
export interface PostureReport { ok: boolean; problems: string[] }

/** All three declarations must agree for the posture to be reconciled. */
export function evaluateLicensePosture(i: PostureInput): PostureReport {
  const problems: string[] = [];
  if (!isAgplLicenseText(i.licenseText)) problems.push('root LICENSE is not the canonical GNU AGPLv3 text');
  if (!packageDeclaresChosenLicense(i.pkg)) problems.push(`package.json "license" is not "${CHOSEN_SPDX}"`);
  for (const [n, t] of i.sampleHeaderTexts.entries()) {
    const id = headerSpdxIdentifier(t);
    if (id && id !== CHOSEN_SPDX) problems.push(`sample header #${n} declares "${id}", not "${CHOSEN_SPDX}"`);
  }
  return { ok: problems.length === 0, problems };
}

// ── dependency-license compatibility with AGPL-3.0-or-later ────────────────────────────────────────
export type DepVerdict = 'compatible' | 'review' | 'incompatible';
// Permissive + GPL-family copyleft-compatible licenses can be combined into an AGPL work.
const COMPATIBLE = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0',
  'Zlib', 'Python-2.0', 'BlueOak-1.0.0', 'MPL-2.0', 'WTFPL', 'CC-BY-4.0',
  'AGPL-3.0-or-later', 'AGPL-3.0-only', 'GPL-3.0-or-later', 'GPL-3.0-only', 'LGPL-3.0-or-later', 'LGPL-3.0-only',
]);
// Known one-way-incompatible with AGPLv3 (older GPL "only" variants cannot be relicensed forward).
const INCOMPATIBLE = new Set(['GPL-2.0-only', 'LGPL-2.1-only', 'CDDL-1.0', 'EPL-1.0', 'MS-PL', 'MS-RL']);

/** Classify a dependency's declared SPDX-ish license string. Unknown/proprietary → review (human call). */
export function classifyDependencyLicense(raw: unknown): DepVerdict {
  if (typeof raw !== 'string' || !raw.trim() || /^(UNLICENSED|SEE LICENSE|Custom|Proprietary)/i.test(raw)) return 'review';
  // strip SPDX expression wrappers like "(MIT OR Apache-2.0)" — if ANY operand is compatible, treat compatible.
  const tokens = raw.replace(/[()]/g, ' ').split(/\s+(?:OR|AND)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (tokens.some((t) => INCOMPATIBLE.has(t)) && !tokens.some((t) => COMPATIBLE.has(t))) return 'incompatible';
  if (tokens.some((t) => COMPATIBLE.has(t))) return 'compatible';
  return 'review';
}
