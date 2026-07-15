// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * PolicyKernel v0 (issue #78, build-order step 1) — the single PolicyDecision entry point over the
 * owner-RATIFIED ring table (docs/policy-rings/ring-table.json, ratified 2026-07-04, decisions 1–11).
 *
 * This module is PURE DECISION DATA. Nothing consumes it yet (build-order step 2 wires ring decisions
 * into workbench/proposal evidence; flight-recorder witnessing per Decision 10 lands there too). It
 * grants no authority, changes no lane, and never executes anything. The live-apply lane's existing
 * guards (kernelActionClassifier sacred net, sandbox permits, AUMLOK verification) are UNCHANGED —
 * the kernel composes them, it does not replace them.
 *
 * RATIFIED semantics implemented here (the packet's "Classification rules" is the law text):
 *   - Matcher precedence identical to docs/policy-rings/check-ring-coverage.mjs (the normative
 *     matcher): exact file beats any glob; deeper directory globs beat shallower; `dir/*` (direct
 *     children) beats `dir/**` at the same directory.
 *   - New-path fail-closed: a path with no exact rule that is not an existing tracked file, whose
 *     winning glob directory contains any Ring-0 exact rule, classifies min(globRing, 1) — a new
 *     core/src/liveApplyV2.ts must NOT inherit Ring 2 from core/src/**. Fully unmatched paths are
 *     fail-closed Ring 1. (min(globRing, 1) so the redirect never DOWNGRADES a Ring-0/1 glob.)
 *
 * Kernel v0 EXTENSIONS — not in the ratified text; every one is strict-direction and disclosed:
 *   - Case-folded matching: rule paths and candidate paths are compared case-insensitively (NFC,
 *     lower-cased). The deployment filesystem (macOS APFS) is case-insensitive, so
 *     core/src/nativeliveapply.ts IS the Ring-0 live-apply file — a case-sensitive matcher would
 *     classify that alias Ring 2. The loader rejects tables whose rules collide after folding, and
 *     the tracked tree is verified collision-free, so folded matching equals the normative checker
 *     on every canonical path. Simple folding cannot see APFS FULL folding (ß→ss, ﬁ/ﬂ ligatures),
 *     so non-ASCII target paths are rejected as malformed outright — the ratified rule set is
 *     pure ASCII, and a non-ASCII path can only be an alias, a lookalike, or future law to ratify.
 *   - Fail-closed existence oracle: the ratified new-path rule is defined over git-TRACKED files,
 *     which a pure module cannot see (no subprocess — the spawn quarantine stands). Without a
 *     caller-supplied `pathExists` (tracked-set membership), every glob-matched path is treated as
 *     NEW — existing organism files pause at Ring 1 instead of their table ring until the caller
 *     provides the oracle. Untracked-but-on-disk files can therefore never skip the pause. A
 *     caller-supplied oracle that throws is treated as "new" (fail closed), never trusted open.
 *   - Sacred-net composition (composing, never weaker than the existing guard): a
 *     kernelActionClassifier sacred verdict over the intent text + non-exact-rule target paths
 *     floors the effective ring to 0. Exact rules are deliberate owner classifications and stay
 *     normative as ratified (e.g. aumlokSigningAssistant.ts stays Ring 1); when sacred intent is
 *     flagged but all targets are exact-rule, the decision records the flag without re-ringing.
 *   - The loader FAIL-CLOSES on any invalid law: missing/unreadable/malformed table, unratified
 *     status, invalid ring values, duplicate or fold-colliding rule globs (the normative checker
 *     treats a conflicted table as invalid law — the kernel refuses to load one rather than
 *     resolving it). Ring -1 targets are never allowed, any effect class, including read.
 *   - Malformed target paths (absolute, traversal, backslash, control chars) force allowed=false.
 *
 * Every decision carries policyHash = sha256 of the exact table bytes, so evidence binds to the
 * law version that produced it (Decision 10 / #73).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { buildKernelActionTable, classifyDraftAction, KernelActionTable } from './kernelActionClassifier';

export type Ring = -1 | 0 | 1 | 2 | 3 | 4;

/** Ratified Decision 11: the minimal effect-class vocabulary. */
export type EffectClass = 'read' | 'write' | 'delete' | 'exec' | 'spawn' | 'egress' | 'sign';

export interface RingRule {
  glob: string;
  ring: number;
  /** Pins a ring for a path that does not exist yet (e.g. this module before it was built). */
  reserved?: boolean;
}

export interface RingTable {
  status: string;
  packet?: string;
  rules: RingRule[];
}

export interface PathRingDecision {
  path: string;
  ring: Ring;
  matchedRule: string;         // winning glob/exact rule, or 'unmatched' / 'malformed'
  failClosed: boolean;         // true when a fail-closed rule (new-path / unmatched / malformed) fired
  reasons: string[];
}

export interface PolicyDecision {
  schema: 'policy-decision-v0';
  effectClass: EffectClass;
  ring: Ring;                  // strictest (lowest) effective ring across all targets
  allowed: boolean;
  requiredCapabilities: string[];
  reasons: string[];
  policyHash: string;          // sha256 hex of the ratified table bytes this decision was made under
  perPath: PathRingDecision[];
  advisoryOnly: true;          // v0: nothing consumes this yet
  grantsAuthority: false;      // a PolicyDecision is never itself permission
}

export interface PolicyDecisionInput {
  targetPaths: string[];       // repo-relative POSIX paths the action touches
  effectClass: EffectClass;
  intentText?: string;         // optional prose intent; when present it is ALWAYS screened by the sacred net
  /**
   * "Is this path an existing git-TRACKED file" — the oracle the ratified new-path rule is defined
   * over. WITHOUT it the kernel fails closed: every glob-matched path is treated as NEW (pauses at
   * Ring 1 under Ring-0-containing directories). A throwing oracle is treated as "new", never open.
   */
  pathExists?: (relPath: string) => boolean;
}

export interface PolicyKernelOptions { repoRoot?: string; tablePath?: string }

export interface PolicyKernel {
  policyHash: string;
  tablePath: string;
  table: RingTable;
  /** Pure ratified-table classification of one path (no sacred-net composition). */
  classifyPathRing(relPath: string, pathExists?: (p: string) => boolean): PathRingDecision;
  decide(input: PolicyDecisionInput): PolicyDecision;
}

/** Ratified per-ring capability requirements (packet ring-posture table; vocabulary per Decision 11). */
export const RING_REQUIRED_CAPABILITIES: Readonly<Record<Ring, readonly string[]>> = {
  [-1]: ['human_only'],
  0: ['owner_ceremony_ring0'],
  1: ['owner_signature_ring1', 'full_test_suite', 'advisory_review'],
  2: ['owner_signature', 'sandbox_tests', 'advisory_review'],
  3: ['owner_signature', 'sandbox_tests'],
  4: ['quarantine_lab'],
} as const;

/** What the ordinary UI/docs lane can offer — used by the #78 acceptance test: Ring 0/1 must be unsatisfiable here. */
export const ORDINARY_DOCS_PATH_CAPABILITIES: readonly string[] = ['owner_signature', 'sandbox_tests'];

/** A decision passes a lane iff it is allowed AND the lane offers every required capability. */
export function satisfiedBy(decision: PolicyDecision, offeredCapabilities: readonly string[]): boolean {
  if (!decision.allowed) return false;
  return decision.requiredCapabilities.every((c) => offeredCapabilities.includes(c));
}

const RATIFIED_STATUS = /^ratified-\d{4}-\d{2}-\d{2}$/;
const VALID_RINGS = new Set([-1, 0, 1, 2, 3, 4]);
const VALID_EFFECT_CLASSES = new Set<EffectClass>(['read', 'write', 'delete', 'exec', 'spawn', 'egress', 'sign']);
const EXACT = 1e9;

export class PolicyTableError extends Error {}

/** Case/normalization fold for matching — the deployment fs (APFS) is case-insensitive. */
function fold(p: string): string {
  let t = p;
  try { t = t.normalize('NFC'); } catch { /* malformed surrogate — leave as-is; will not match ASCII rules */ }
  return t.toLowerCase();
}

function isMalformedPath(p: unknown): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return true;
  if (p.startsWith('/') || p.includes('\\')) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(p)) return true;
  // The ratified rule set is pure ASCII. APFS performs FULL Unicode case folding (ß→ss, ﬁ/ﬂ
  // ligatures), which can alias fence files past simple NFC+lowercase folding — so any
  // non-ASCII byte in a target path fails closed as malformed (pause; owner classification).
  if (/[^\u0020-\u007E]/.test(p)) return true;
  const segments = p.split('/');
  return segments.some((s) => s === '' || s === '.' || s === '..');
}

/**
 * Matcher specificity — precedence identical to docs/policy-rings/check-ring-coverage.mjs (the
 * normative matcher); comparison is case-folded (disclosed kernel extension, see header).
 * Both arguments must already be folded.
 */
function specificity(foldedGlob: string, foldedFile: string): number {
  if (foldedGlob.endsWith('/**')) {
    const dir = foldedGlob.slice(0, -3);
    return foldedFile.startsWith(dir + '/') ? dir.split('/').length * 100 : -1;
  }
  if (foldedGlob.endsWith('/*')) {
    const dir = foldedGlob.slice(0, -2);
    return foldedFile.startsWith(dir + '/') && !foldedFile.slice(dir.length + 1).includes('/')
      ? dir.split('/').length * 100 + 50
      : -1;
  }
  return foldedGlob === foldedFile ? EXACT : -1;
}

function globDir(glob: string): string | null {
  if (glob.endsWith('/**')) return glob.slice(0, -3);
  if (glob.endsWith('/*')) return glob.slice(0, -2);
  return null;
}

/** Load + validate the ratified table. FAIL-CLOSED: any problem throws — no law, no decisions. */
export function loadPolicyKernel(opts: PolicyKernelOptions = {}): PolicyKernel {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..');
  const tablePath = opts.tablePath ?? path.join(repoRoot, 'docs', 'policy-rings', 'ring-table.json');

  let raw: Buffer;
  try {
    raw = fs.readFileSync(tablePath);
  } catch (e) {
    throw new PolicyTableError(`ring table unreadable at ${tablePath} — refusing to make policy decisions: ${(e as Error).message}`);
  }
  let table: RingTable;
  try {
    table = JSON.parse(raw.toString('utf-8')) as RingTable;
  } catch (e) {
    throw new PolicyTableError(`ring table is not valid JSON — refusing to make policy decisions: ${(e as Error).message}`);
  }
  if (!RATIFIED_STATUS.test(table.status ?? '')) {
    throw new PolicyTableError(`ring table status "${table.status}" is not ratified — the kernel only runs on owner-ratified law`);
  }
  if (!Array.isArray(table.rules) || table.rules.length === 0) {
    throw new PolicyTableError('ring table has no rules — refusing to make policy decisions');
  }
  const seenFolded = new Map<string, RingRule>();
  for (const r of table.rules) {
    if (typeof r.glob !== 'string' || r.glob.length === 0 || !VALID_RINGS.has(r.ring)) {
      throw new PolicyTableError(`invalid ring rule ${JSON.stringify(r)} — refusing to make policy decisions`);
    }
    const f = fold(r.glob);
    const dup = seenFolded.get(f);
    if (dup) {
      // The normative checker treats a same-specificity ring conflict as invalid law; the only way
      // two rules can tie is an identical (case-folded) glob — refuse the table rather than resolve it.
      throw new PolicyTableError(`duplicate/fold-colliding rule globs "${dup.glob}" and "${r.glob}" — a conflicted table is invalid law`);
    }
    seenFolded.set(f, r);
  }
  const policyHash = createHash('sha256').update(raw).digest('hex');

  // Precomputed folded forms + Ring-0 exact rules for the new-path fail-closed redirect.
  const foldedRules = table.rules.map((r) => ({ rule: r, folded: fold(r.glob) }));
  const ring0ExactFolded = table.rules
    .filter((r) => r.ring === 0 && globDir(r.glob) === null)
    .map((r) => fold(r.glob));
  const dirContainsRing0Exact = (foldedDir: string): boolean =>
    ring0ExactFolded.some((p) => p.startsWith(foldedDir + '/'));

  // Fail-closed default: without a tracked-set oracle every glob-matched path is NEW (see header).
  const defaultExists = (_rel: string): boolean => false;
  const safeExists = (oracle: ((p: string) => boolean) | undefined, rel: string): boolean => {
    try { return (oracle ?? defaultExists)(rel); } catch { return false; } // a broken oracle fails closed to "new"
  };

  // The sacred net is built once; parse failure degrades to the fail-closed DEFAULT patterns inside
  // buildKernelActionTable (documented there) — never to an empty net.
  const actionTable: KernelActionTable = buildKernelActionTable({ repoRoot });

  function classifyPathRing(relPath: string, pathExists?: (p: string) => boolean): PathRingDecision {
    if (isMalformedPath(relPath)) {
      return {
        path: typeof relPath === 'string' ? relPath : String(relPath), ring: 0, matchedRule: 'malformed', failClosed: true,
        reasons: ['malformed or escaping path — fail-closed to Ring 0, never allowed'],
      };
    }
    const folded = fold(relPath);
    let best = -1;
    let winner: RingRule | null = null;
    for (const { rule, folded: fg } of foldedRules) {
      const s = specificity(fg, folded);
      if (s > best) { best = s; winner = rule; }
    }
    if (best < 0 || winner === null) {
      return {
        path: relPath, ring: 1, matchedRule: 'unmatched', failClosed: true,
        reasons: ['no ring rule matches — fail-closed to Ring 1 (pause, owner classification)'],
      };
    }
    let ring = winner.ring as Ring;
    const reasons: string[] = [];
    const exactWin = best === EXACT;
    if (exactWin && relPath !== winner.glob) {
      reasons.push('case-folded match to an exact rule — classified as the canonical file (case-insensitive filesystem)');
    }
    let failClosed = false;
    if (!exactWin) {
      const exists = safeExists(pathExists, relPath);
      const d = globDir(winner.glob);
      if (!exists && d !== null && dirContainsRing0Exact(fold(d))) {
        const redirected = Math.min(ring, 1) as Ring;
        if (redirected !== ring) {
          reasons.push(`new/unverified path under a Ring-0-containing directory — fail-closed from Ring ${ring} to Ring 1 (pause, owner classification; supply a tracked-path oracle for exact ratified behavior)`);
          ring = redirected;
          failClosed = true;
        }
      }
    }
    reasons.unshift(`matched ${winner.glob} → Ring ${winner.ring}${exactWin ? ' (exact, owner-classified)' : ''}`);
    return { path: relPath, ring, matchedRule: winner.glob, failClosed, reasons };
  }

  function decide(input: PolicyDecisionInput): PolicyDecision {
    const base = { schema: 'policy-decision-v0' as const, advisoryOnly: true as const, grantsAuthority: false as const, policyHash };
    const effectClass = input.effectClass;
    if (!VALID_EFFECT_CLASSES.has(effectClass)) {
      return {
        ...base, effectClass, ring: 0, allowed: false, perPath: [],
        requiredCapabilities: [...RING_REQUIRED_CAPABILITIES[0]],
        reasons: [`invalid effectClass "${String(effectClass)}" — fail-closed to Ring 0, never allowed`],
      };
    }
    if (!Array.isArray(input.targetPaths) || input.targetPaths.length === 0) {
      return {
        ...base, effectClass, ring: 0, allowed: false, perPath: [],
        requiredCapabilities: [...RING_REQUIRED_CAPABILITIES[0]],
        reasons: ['no target paths — fail-closed, nothing to classify'],
      };
    }
    const perPath = input.targetPaths.map((p) => classifyPathRing(p as string, input.pathExists));
    let ring = Math.min(...perPath.map((d) => d.ring)) as Ring;
    const reasons = perPath.flatMap((d) => d.reasons.map((r) => `${d.path}: ${r}`));
    const anyMalformed = perPath.some((d) => d.matchedRule === 'malformed');

    // Sacred-net composition (see header): runs whenever intentText is present OR any target lacks
    // an exact rule. It floors only NON-exact-rule targets — exact rules are deliberate owner
    // classifications and stay normative as ratified.
    const nonExact = perPath.filter((d) =>
      d.matchedRule === 'malformed' || d.matchedRule === 'unmatched' || fold(d.matchedRule) !== fold(d.path));
    if (input.intentText !== undefined || nonExact.length > 0) {
      const netText = `${input.intentText ?? ''} ${effectClass} ${nonExact.map((d) => d.path).join(' ')}`.trim();
      const verdict = classifyDraftAction(netText, actionTable);
      if (verdict.class === 'sacred') {
        if (nonExact.length > 0 && ring > 0) {
          ring = 0;
          reasons.push(`sacred net (${verdict.matched}) floors non-exact-rule targets to Ring 0 — never weaker than the existing guard`);
          for (const d of nonExact) d.reasons.push('sacred net floored the effective decision ring to 0');
        } else {
          reasons.push(`sacred net flagged the intent (${verdict.matched}) — exact-rule rings stay normative as ratified; the live lane screens intent again at apply time`);
        }
      }
    }

    const allowed = !anyMalformed && ring !== -1 && (effectClass === 'read' ? true : ring >= 1);
    if (!allowed) {
      reasons.push(anyMalformed
        ? 'malformed target path — never allowed'
        : ring === -1
          ? 'Ring -1 — physical owner authority; never handled by the organism, any effect class'
          : `Ring ${ring} + effect "${effectClass}" — never auto-applied, never session-eligible; explicit owner ceremony only (outside this kernel)`);
    }
    return {
      ...base, effectClass, ring, allowed, perPath, reasons,
      requiredCapabilities: [...RING_REQUIRED_CAPABILITIES[ring]],
    };
  }

  return { policyHash, tablePath, table, classifyPathRing, decide };
}

/** Convenience one-shot entry point. Loads (and fail-closed validates) the ratified table on every call. */
export function decidePolicy(input: PolicyDecisionInput, opts: PolicyKernelOptions = {}): PolicyDecision {
  return loadPolicyKernel(opts).decide(input);
}
