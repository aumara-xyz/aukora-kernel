// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Versioned Fusion advisory artifact (self-optimization v0). The public, schema-versioned shape Aukora may
 * consume as EVIDENCE ONLY. It carries the quorum, schedule/budget summary, typed attention items, and a
 * retry recommendation — but NO raw model payloads (findings/risks prose), NO secrets, NO PoP/signature/
 * signedHead, and NO authority_granted/gate_changed. The validator fails CLOSED on an unknown/legacy schema.
 * advisoryOnly=true, grantsAuthority=false: Fusion reviews; it never authorizes.
 */
import type { AttentionItem, RetryPack, TerminalReviewSummary } from './fusionSelfOpt';
import { scanForbiddenKeys, scanForbiddenValues, normalizeKey } from './forbiddenContent';

export const FUSION_ADVISORY_SCHEMA = 'fusion-advisory-v1' as const;

export interface FusionAdvisoryArtifactV1 {
  schema: typeof FUSION_ADVISORY_SCHEMA;
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
  scheduleSummary: { planned: number; scheduled: number; unscheduled: number; budget: number };
  quorum: { status: string; completedVotes: number; nonVotes: number; redVotes: number; greenVotes: number; yellowVotes: number };
  providerContactedCount: number;        // truth: how many calls actually reached a provider
  attentionItems: AttentionItem[];
  retry: { pairs: RetryPack['pairs']; supersede: string[] };
  terminalReview: { safeAsEvidence: boolean; summary: string };
}

export function buildFusionAdvisoryArtifact(input: {
  createdAt: string;
  scheduleSummary: FusionAdvisoryArtifactV1['scheduleSummary'];
  quorum: FusionAdvisoryArtifactV1['quorum'];
  providerContactedCount: number;
  attentionItems: AttentionItem[];
  retry: RetryPack;
  terminalReview: TerminalReviewSummary;
}): FusionAdvisoryArtifactV1 {
  return {
    schema: FUSION_ADVISORY_SCHEMA,
    advisoryOnly: true,
    grantsAuthority: false,
    createdAt: input.createdAt,
    scheduleSummary: input.scheduleSummary,
    quorum: input.quorum,
    providerContactedCount: input.providerContactedCount,
    attentionItems: input.attentionItems,
    retry: { pairs: input.retry.pairs, supersede: input.retry.supersede },
    terminalReview: { safeAsEvidence: input.terminalReview.safeAsEvidence, summary: input.terminalReview.summary },
  };
}

// The EXACT top-level keys a valid fusion-advisory-v1 may carry. Anything else fails CLOSED. This positive
// allow-list is what closes the old denylist leak (signature / pop / gate_unlocked previously slipped through
// because the validator only checked a fixed set of bad keys instead of rejecting everything unknown).
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema', 'advisoryOnly', 'grantsAuthority', 'createdAt', 'scheduleSummary',
  'quorum', 'providerContactedCount', 'attentionItems', 'retry', 'terminalReview',
]);

// Authority-shaped key names an advisory artifact may NEVER carry at ANY depth — each would be a vector for
// advisory->authority confusion (the council's top "authority" concern). The two legitimate posture markers
// (advisoryOnly / grantsAuthority, both pinned below) are explicitly exempt.
const AUTHORITY_KEY_RE = /(authoritygranted|authoritychanged|gatechanged|gateunlock|gateopen|unlock|promote|promotion|approval|approved|approve|authorize|authoris|capabilitygrant|grantauthority|livepromotion|selfmodify)/;

function scanAuthorityShapedKeys(obj: unknown): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const full = p ? `${p}.${k}` : k;
      const norm = normalizeKey(k);
      if (norm !== 'advisoryonly' && norm !== 'grantsauthority' && (norm === 'authority' || AUTHORITY_KEY_RE.test(norm))) {
        found.push(full);
      }
      walk(v, full);
    }
  };
  walk(obj, '');
  return found;
}

/**
 * Fail-closed validator — a POSITIVE allow-list, not a denylist. An artifact is valid ONLY if: schema is
 * exactly fusion-advisory-v1; every top-level key is on the allow-list (unknown keys rejected); advisoryOnly
 * is true and grantsAuthority is false; and NO authority-shaped key, NO forbidden secret/PoP/signature/
 * private-key key, and NO secret-shaped value appears at any depth. This is the gate every consumer must
 * pass an artifact through before treating it as evidence — advisory in, never authority out.
 */
export function validateFusionAdvisoryArtifact(a: unknown): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { valid: false, reason: 'not an object' };
  const art = a as Record<string, unknown>;

  if (art.schema !== FUSION_ADVISORY_SCHEMA) return { valid: false, reason: 'unknown/legacy schema — fail closed' };

  for (const k of Object.keys(art)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) return { valid: false, reason: `unknown top-level key '${k}' — allow-list fails closed` };
  }

  if (art.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (art.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };

  const authorityKeys = scanAuthorityShapedKeys(art);
  if (authorityKeys.length) return { valid: false, reason: `authority-shaped key(s) forbidden: ${authorityKeys.join(', ')}` };

  const secretKeys = scanForbiddenKeys(art);
  if (secretKeys.length) return { valid: false, reason: `forbidden secret/PoP/signature/private-key field(s): ${secretKeys.join(', ')}` };

  const secretValues = scanForbiddenValues(art);
  if (secretValues.length) return { valid: false, reason: `secret-shaped value(s) at: ${secretValues.join(', ')}` };

  return { valid: true };
}

/** Aukora may consume an artifact only as EVIDENCE — and only a valid v1. Never as authority. */
export function fusionArtifactGrantsAuthority(_a: FusionAdvisoryArtifactV1): false { return false; }
