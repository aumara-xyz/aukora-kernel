// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * G1 deploy allowlist enforcer. PURE — no filesystem, network, environment, subprocess, or time.
 *
 * A bundle-relative POSIX path is DEPLOYABLE iff it matches an `ALLOW` glob AND matches NO `DENY` glob
 * (allow ∧ ¬deny). Fail-closed: a path that matches nothing in ALLOW is refused; a path that matches any
 * DENY glob is refused even if an ALLOW glob would have permitted it (deny wins).
 *
 * ALLOW/DENY below are the exact mirror of deploy/deploy-allowlist.json. They are duplicated here so this
 * module stays pure (no JSON read at runtime); test/allowlist.test.ts asserts BYTE-for-glob equality between
 * these constants and the JSON file, so drift is caught by `npm run verify`, never silently.
 */

/** Mirror of deploy/deploy-allowlist.json `allow`. */
export const ALLOW: readonly string[] = [
  'd6/**',
  'src/**',
  'test/**',
  'package.json',
  'tsconfig.json',
  'deploy/**',
  'MANIFEST.json',
];

/** Mirror of deploy/deploy-allowlist.json `deny`. Every private-key / secret-material shape. */
export const DENY: readonly string[] = [
  '**/*.key',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/.ssh/**',
  '**/*.pem',
  '**/.env*',
  '**/*secret*',
  '**/authority-*.key',
];

/**
 * Compile a restricted glob to an anchored RegExp. Supported tokens (documented in the JSON):
 *   `**\/` → zero or more leading segments   `**` → any run incl. '/'   `*` → any run excl. '/'   `?` → one non-'/'.
 * Every other character is matched literally (regex metacharacters are escaped). Pure and total.
 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++; // consumed second '*'
        if (glob[i + 1] === '/') { i++; re += '(?:[^/]+/)*'; } // '**/' → zero or more dir segments
        else { re += '.*'; }                                    // '**'  → any run including '/'
      } else {
        re += '[^/]*';                                          // '*'   → any run excluding '/'
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\/'.indexOf(c) !== -1) {
      re += '\\' + c;                                           // escape regex metacharacter (and '/')
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

const ALLOW_RE: readonly RegExp[] = ALLOW.map(globToRegExp);
const DENY_RE: readonly RegExp[] = DENY.map(globToRegExp);

/**
 * Normalize + defend a bundle-relative path. Rejects absolute paths, backslashes, empty segments, `.`/`..`
 * traversal, embedded NUL, and leading `./`. This is a STRING guard; the on-VM sealer additionally verifies
 * resolved real paths. Returns the cleaned POSIX-relative path or throws `E_PATH`.
 */
export function normalizeRel(relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) throw new Error('E_PATH:empty');
  if (relPath.indexOf('\0') !== -1) throw new Error('E_PATH:nul');
  if (relPath.indexOf('\\') !== -1) throw new Error('E_PATH:backslash');
  if (relPath.charCodeAt(0) === 0x2f) throw new Error('E_PATH:absolute'); // leading '/'
  const parts = relPath.split('/');
  for (const seg of parts) {
    if (seg === '' ) throw new Error('E_PATH:empty-segment'); // '//' or trailing '/'
    if (seg === '.' || seg === '..') throw new Error('E_PATH:traversal');
  }
  return parts.join('/');
}

export function isAllowed(rel: string): boolean {
  for (const re of ALLOW_RE) if (re.test(rel)) return true;
  return false;
}

export function isDenied(rel: string): boolean {
  for (const re of DENY_RE) if (re.test(rel)) return true;
  return false;
}

/**
 * Assert a single path is deployable, or throw. `allow ∧ ¬deny`, deny wins. The path is normalized first,
 * so traversal / absolute / NUL inputs throw before any glob is consulted.
 */
export function assertDeployable(relPath: string): string {
  const rel = normalizeRel(relPath);
  if (isDenied(rel)) throw new Error(`E_DENIED:${rel}`);       // key/secret material — refuse (deny wins)
  if (!isAllowed(rel)) throw new Error(`E_NOT_ALLOWED:${rel}`); // not on the explicit allowlist — refuse
  return rel;
}

export interface BundleCheck {
  /** Paths that passed allow ∧ ¬deny and may transfer. */
  readonly deployable: readonly string[];
  /** Paths refused because they matched a DENY glob (key/secret material). */
  readonly denied: readonly string[];
  /** Paths refused because they matched no ALLOW glob. */
  readonly notAllowed: readonly string[];
  /** Paths refused because normalization failed (absolute/traversal/NUL/backslash). */
  readonly invalid: readonly string[];
  /** denied ∪ notAllowed ∪ invalid — everything excluded from the transfer. */
  readonly excluded: readonly string[];
}

/**
 * Classify a full staged file list into deployable vs. the excluded/denied set. Pure and total: any path
 * that would throw in assertDeployable is bucketed rather than thrown, so the caller sees the WHOLE picture.
 * `deny` is evaluated before `allow`, so a key file under an allowed dir lands in `denied`, not `deployable`.
 */
export function checkBundle(fileList: readonly string[]): BundleCheck {
  const deployable: string[] = [];
  const denied: string[] = [];
  const notAllowed: string[] = [];
  const invalid: string[] = [];
  for (const raw of fileList) {
    let rel: string;
    try { rel = normalizeRel(raw); } catch { invalid.push(raw); continue; }
    if (isDenied(rel)) { denied.push(rel); continue; }        // deny wins
    if (!isAllowed(rel)) { notAllowed.push(rel); continue; }
    deployable.push(rel);
  }
  const excluded = [...denied, ...notAllowed, ...invalid];
  return { deployable, denied, notAllowed, invalid, excluded };
}
