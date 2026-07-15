/**
 * 24Y.6 — Canonical Convex topology + backend classifier.
 *
 * The womb may read MANY local Convex backends, but only ONE is the canonical Aukora kernel
 * (node-template/convex: signed receipt head, RFC6962 Merkle log, grants, AUMLOK, authority path).
 * Donor/lab backends (e.g. the organism loopback on :3220) must NEVER be mistaken for the brain.
 *
 * This module:
 *   1. models the known backends and their roles (a fail-closed registry), and
 *   2. provides a READ-ONLY classifier that probes a loopback endpoint and labels it by role.
 *
 * Laws: read-only only (queries the read endpoint, never the mutation endpoint), loopback-only,
 * never prints secrets, never sets grantsAuthority. A live response is a real brain signal ONLY
 * from a canonical_kernel.
 */
import {
  ConvexLoopbackConfig,
  ConvexLoopbackResult,
  ReceiptChainHeadPublic,
  LiveDataKind,
  rejectNonLoopback,
  scrubPayload,
  unwrapConvexEnvelope,
  parseReceiptHead,
  readWithFallback,
} from './convexBrainReadonly';
import {
  resolveCanonicalPin,
  verifyCanonicalReceiptHead,
  type CanonicalPin,
  type CanonicalityProof,
} from './convexCanonicalPin';
import {
  evaluateFreshness,
  advanceHighWater,
  type HighWaterRecord,
  type FreshnessResult,
  type FreshnessOptions,
} from './convexCanonicalFreshness';
import { ConvexBrainSnapshot, validateSnapshot } from './convexBrainSnapshot';

export type { CanonicalityProof }; // re-export the imported canonicality-proof type for consumers

// 'canonical_kernel_degraded' = cryptographically verified, but the head failed the freshness check
// (rollback/fork / severe replay risk). Verified-but-not-trusted-as-live.
export type BackendRole = 'canonical_kernel' | 'canonical_kernel_degraded' | 'donor_lab' | 'wrong_backend' | 'unavailable';

/**
 * Canonicality proof levels live in convexCanonicalPin.ts:
 *   'cryptographic_pin' — head ML-DSA signature verified against an EXPLICITLY PINNED public key (24Y.7).
 *   'name_marker_only'  — backend merely serves a type-valid same-named head; SPOOFABLE (no pin configured).
 *   'none'              — not canonical.
 * TRUE canonicality (canonicalBackendDetected / receiptHeadVisible / allowedForWomb) requires
 * 'cryptographic_pin'. Without a pin we refuse to call a backend canonical, even if the name marker matches.
 */

export interface TopologyEntry {
  name: string;
  url: string | null;       // null = not yet running (the canonical kernel has no live backend yet)
  role: BackendRole;
  expectedFunctions: string[];
  allowedForWomb: boolean;   // only the canonical kernel may feed the womb as brain signal
  hasSignedReceiptHead: boolean;
  notes: string;
}

/**
 * The canonical marker: the public head query only the real Aukora kernel exposes.
 * The donor marker: a read-only query the organism loopback lab exposes.
 * Both probes are READ-ONLY. They are the ONLY two functions this classifier may call,
 * besides the GET /instance_name metadata endpoint.
 */
export const CANONICAL_MARKER_QUERY = 'aukoraReceipts:getReceiptChainHeadPublic';
export const DONOR_MARKER_QUERY = 'nonCanonicalBackend:marker';
const PROBE_ALLOWLIST = new Set([CANONICAL_MARKER_QUERY, DONOR_MARKER_QUERY]);

/**
 * Fail-closed registry of the local backends observed in 24Y.5/24Y.6. `unknown` is the default
 * role for anything not positively identified — never assume canonical.
 */
export const TOPOLOGY: Record<string, TopologyEntry> = {
  canonicalKernel: {
    name: 'node-template-kernel',
    url: null, // NOT deployed to a live backend yet — start it on its own port (suggested :3230)
    role: 'canonical_kernel',
    expectedFunctions: [CANONICAL_MARKER_QUERY, 'aukoraReceipts:verifyReceiptChain'],
    allowedForWomb: true,
    hasSignedReceiptHead: true,
    notes: 'node-template/convex: the real Aukora kernel (signed head, RFC6962 Merkle log, grants, AUMLOK).',
  },
  organismLab: {
    name: 'auma-organism-backend',
    url: 'http://127.0.0.1:3220',
    role: 'donor_lab',
    expectedFunctions: [DONOR_MARKER_QUERY],
    allowedForWomb: false,
    hasSignedReceiptHead: false,
    notes: 'Donor/lab only. Toy organism_receipts hash chain (no signed head, no Merkle root). Do NOT overwrite.',
  },
  labBackend: {
    // 2026-07-01 (issue #11): re-verified live. This IS a real, running convex-local-backend serving
    // aukora-os's node-template/convex functions, which DOES include getReceiptChainHeadPublic — the
    // prior "does not serve the canonical kernel functions" note was stale/wrong. This static entry is
    // documentation only (not consulted by classifyBackend()'s live probes — confirmed by grep, no
    // runtime code path reads TOPOLOGY.labBackend). role stays 'wrong_backend' here to match exactly
    // what the LIVE classifier computes without a pin configured: a name-marker-present, spoofable,
    // NOT-canonical result — never call this canonical just because the port now responds.
    name: 'aukora-os-node-template-kernel',
    url: 'http://127.0.0.1:3210',
    role: 'wrong_backend',
    expectedFunctions: [CANONICAL_MARKER_QUERY],
    allowedForWomb: false,
    hasSignedReceiptHead: false,
    notes: 'A real backend responds here (aukora-os/node-template/convex) and DOES serve getReceiptChainHeadPublic, but AUKORA_CANONICAL_PIN_PUBLIC_KEY is not configured — classifyBackend() correctly refuses to call it canonical (name_marker_only, spoofable) until that pin is set. See issue #11.',
  },
};

export interface BackendClassification {
  url: string;
  role: BackendRole;
  instanceName: string | null;
  canonicalMarkerPresent: boolean;
  organismMarkerPresent: boolean;
  serverResponded: boolean;
  hasSignedReceiptHead: boolean;
  /** How strongly the canonical label is proven: cryptographic_pin > name_marker_only > none. */
  canonicalityProof: CanonicalityProof;
  /** True when canonicality is name-marker-only (no pin) — spoofable; surfaced so consumers never over-trust. */
  spoofable: boolean;
  /** True ONLY when the head signature verified against the explicitly pinned canonical public key. */
  cryptographicallyVerified: boolean;
  /** True when a pin IS configured but the backend FAILED it (possible spoof / wrong backend). */
  halt: boolean;
  /** Whether a canonical pin was configured at all (explicit, out-of-band). */
  pinConfigured: boolean;
  allowedForWomb: boolean;
  readOnly: true;
  advisoryOnly: true;
  grantsAuthority: false;
  notes: string;
}

interface ProbeResult { responded: boolean; ok: boolean; value: unknown }

/** READ-ONLY query probe. Only the two marker queries may be probed; only /api/query is hit. */
async function probeQuery(
  url: string,
  path: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<ProbeResult> {
  rejectNonLoopback(url);
  if (!PROBE_ALLOWLIST.has(path)) {
    throw new Error(`classifier_probe_not_allowed: ${path}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args: scrubPayload(args) ?? {} }),
      signal: controller.signal,
    });
    if (!response.ok) return { responded: false, ok: false, value: null };
    const raw = await response.json();
    const env = unwrapConvexEnvelope(raw);
    return { responded: true, ok: env.ok, value: env.value };
  } catch {
    return { responded: false, ok: false, value: null };
  } finally {
    clearTimeout(timeout);
  }
}

/** Best-effort read-only instance metadata. Never throws; returns null on any failure. */
async function probeInstanceName(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/instance_name`, { method: 'GET', signal: controller.signal });
    if (!response.ok || typeof (response as { text?: unknown }).text !== 'function') return null;
    const name = (await response.text()).trim();
    return name.length > 0 && name.length < 256 ? name : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function hasOkBoolean(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).ok === 'boolean';
}

/**
 * Classify a loopback Convex endpoint by READ-ONLY behavior. Non-loopback/cloud URLs are rejected
 * (throws). Never mutates, never prints secrets, never grants authority.
 */
export async function classifyBackend(
  config: ConvexLoopbackConfig,
  pin: CanonicalPin | null = resolveCanonicalPin(),
): Promise<BackendClassification> {
  rejectNonLoopback(config.url); // hard-rejects non-loopback / cloud before any probe

  const instanceName = await probeInstanceName(config.url, config.timeoutMs);
  const canonicalProbe = await probeQuery(config.url, CANONICAL_MARKER_QUERY, { chainKey: 'organism' }, config.timeoutMs);
  const donorProbe = await probeQuery(config.url, DONOR_MARKER_QUERY, { chainKey: 'organism' }, config.timeoutMs);

  const canonicalHead = canonicalProbe.responded && canonicalProbe.ok
    ? parseReceiptHead(scrubPayload(canonicalProbe.value))
    : null;
  const canonicalMarkerPresent = canonicalHead !== null;
  const organismMarkerPresent = donorProbe.responded && donorProbe.ok && hasOkBoolean(donorProbe.value);
  const serverResponded = instanceName !== null || canonicalProbe.responded || donorProbe.responded;

  // 24Y.7 CRYPTOGRAPHIC PIN GATE. TRUE canonicality requires the head signature to verify against an
  // EXPLICITLY PINNED public key. Decision matrix:
  //   pin set + head present + verifies   → canonical_kernel, cryptographic_pin (spoof-proof)
  //   pin set + head present + FAILS      → wrong_backend, HALT (impostor / wrong backend)
  //   pin set + no head (donor/empty)     → donor_lab / wrong_backend by markers (no canonical claim)
  //   pin UNSET + name marker present     → NOT canonical; name_marker_only + spoofable (refuse to trust)
  //   pin UNSET + no marker               → donor_lab / wrong_backend / unavailable by markers
  const verify = verifyCanonicalReceiptHead(canonicalHead, pin);
  const cryptographicallyVerified = verify.verified && verify.proof === 'cryptographic_pin';

  let role: BackendRole;
  let canonicalityProof: CanonicalityProof;
  let halt = false;

  if (cryptographicallyVerified) {
    role = 'canonical_kernel';
    canonicalityProof = 'cryptographic_pin';
  } else if (pin && canonicalMarkerPresent && verify.halt) {
    // A pin is configured and a head was served but FAILED verification → impostor, not canonical.
    role = organismMarkerPresent ? 'donor_lab' : 'wrong_backend';
    canonicalityProof = 'none';
    halt = true;
  } else if (!pin && canonicalMarkerPresent) {
    // No pin → cannot cryptographically confirm. Refuse to call it canonical; flag spoofable name-marker.
    role = organismMarkerPresent ? 'donor_lab' : 'wrong_backend';
    canonicalityProof = 'name_marker_only';
  } else if (organismMarkerPresent) {
    role = 'donor_lab';
    canonicalityProof = 'none';
  } else if (serverResponded) {
    role = 'wrong_backend';
    canonicalityProof = 'none';
  } else {
    role = 'unavailable';
    canonicalityProof = 'none';
  }

  const spoofable = canonicalityProof === 'name_marker_only';
  const hasSignedReceiptHead = canonicalMarkerPresent && canonicalHead!.headSigAlg !== null;
  const allowedForWomb = cryptographicallyVerified; // ONLY a crypto-verified kernel may feed the womb

  const notes =
    cryptographicallyVerified ? 'Canonical kernel — head signature VERIFIED against the pinned public key (cryptographic_pin).'
    : halt ? 'HALT: a head was served but FAILED the pinned-key verification — impostor / wrong backend.'
    : canonicalityProof === 'name_marker_only' ? 'Serves a same-named head but NO pin configured — name-marker only, SPOOFABLE; not trusted as canonical.'
    : role === 'donor_lab' ? 'Donor/lab backend (organism loopback). NOT canonical.'
    : role === 'wrong_backend' ? 'Server alive but not the canonical kernel.'
    : 'No live Convex backend responded on this loopback URL.';

  return {
    url: config.url,
    role,
    instanceName,
    canonicalMarkerPresent,
    organismMarkerPresent,
    serverResponded,
    hasSignedReceiptHead,
    canonicalityProof,
    spoofable,
    cryptographicallyVerified,
    halt,
    pinConfigured: pin !== null,
    allowedForWomb,
    readOnly: true,
    advisoryOnly: true,
    grantsAuthority: false,
    notes,
  };
}

export interface TopologyEnrichResult {
  snapshot: ConvexBrainSnapshot;
  classification: BackendClassification;
  backendRole: BackendRole;
  /** TRUE only when crypto-pin-verified AND freshness is not severely compromised (no rollback/fork). */
  canonicalBackendDetected: boolean;
  canonicalityProof: CanonicalityProof;
  spoofable: boolean;
  halt: boolean;
  /** True when the head signature verified against the pinned key (independent of freshness). */
  cryptographicallyVerified: boolean;
  /** True only for a confirmed FRESH advance (24Y.8). same_head/unknown/stale → false. */
  freshnessVerified: boolean;
  /** The high-water freshness verdict, or null when no crypto-verified head to judge. */
  freshness: FreshnessResult | null;
  replayRisk: 'none' | 'low' | 'severe';
  /** The high-water record to PERSIST iff freshness.advanced (caller writes it). null otherwise. */
  nextHighWater: HighWaterRecord | null;
  receiptHeadVisible: boolean;
  liveDataKind: LiveDataKind;
  receiptHead: ReceiptChainHeadPublic | null;
  loopbackResult: ConvexLoopbackResult;
  degradedReason: string | null;
}

/**
 * TOPOLOGY-GATED enrichment. The ONLY way to obtain a TRUE canonical brain signal.
 * receiptHeadVisible=true ONLY when ALL hold:
 *   (1) head signature CRYPTOGRAPHICALLY verified vs the pinned key (24Y.7),
 *   (2) the read used the allowlisted getReceiptChainHeadPublic query + type-validates,
 *   (3) freshness is not SEVERELY compromised — no rollback, no fork (24Y.8).
 * A rollback/fork (severe replay) → canonical_kernel_degraded, receiptHeadVisible=false.
 * A first observation (unknown_no_history) or stale-timestamp (low risk) → head still shown, but
 * freshnessVerified=false and said plainly. Without a pin, NO backend is canonical.
 *
 * Freshness needs a baseline: pass `priorHighWater` (from a local/evidence store) and persist the
 * returned `nextHighWater` when `freshness.advanced`. No Convex writes; state is the caller's.
 */
export async function enrichSnapshotWithTopology(
  snapshot: ConvexBrainSnapshot,
  config: ConvexLoopbackConfig,
  chainKey: string = 'organism',
  pin: CanonicalPin | null = resolveCanonicalPin(),
  priorHighWater: HighWaterRecord | null = null,
  freshnessOptions: FreshnessOptions = {},
): Promise<TopologyEnrichResult> {
  const classification = await classifyBackend(config, pin);
  const cryptographicallyVerified = classification.cryptographicallyVerified;

  // Read the head via the womb-facing allowlisted path (gives proper bridgeMode + static fallback).
  const loopbackResult = await readWithFallback(CANONICAL_MARKER_QUERY, snapshot, config, { chainKey });

  // ANTI-FAKE GATE + TOCTOU: re-verify the freshly-read head against the pin (not only the probe head).
  let verifiedHead: ReceiptChainHeadPublic | null = null;
  if (cryptographicallyVerified) {
    const freshHead = parseReceiptHead(loopbackResult.data);
    const reverify = verifyCanonicalReceiptHead(freshHead, pin);
    verifiedHead = reverify.verified && reverify.proof === 'cryptographic_pin' ? freshHead : null;
  }

  // 24Y.8 FRESHNESS: judge the crypto-verified head against the remembered high-water.
  let freshness: FreshnessResult | null = null;
  let nextHighWater: HighWaterRecord | null = null;
  if (verifiedHead) {
    freshness = evaluateFreshness(priorHighWater, {
      chainKey: verifiedHead.chainKey,
      count: verifiedHead.count,
      lastChainHash: verifiedHead.lastChainHash,
      receiptLogRoot: verifiedHead.receiptLogRoot,
      headSignedAt: verifiedHead.headSignedAt,
    }, freshnessOptions);
    if (freshness.advanced && freshnessOptions.now != null) {
      nextHighWater = advanceHighWater({
        chainKey: verifiedHead.chainKey, count: verifiedHead.count,
        lastChainHash: verifiedHead.lastChainHash, receiptLogRoot: verifiedHead.receiptLogRoot,
        headSignedAt: verifiedHead.headSignedAt,
      }, freshnessOptions.now);
    }
  }

  const replayRisk = freshness?.replayRisk ?? 'none';
  const severeReplay = replayRisk === 'severe';
  // A crypto-verified head is surfaced UNLESS freshness says severe replay (rollback/fork).
  const receiptHeadVisible = verifiedHead !== null && !severeReplay;
  const receiptHead = receiptHeadVisible ? verifiedHead : null;
  const freshnessVerified = freshness?.freshnessVerified ?? false;

  // Effective role: crypto-verified + severe replay → degraded; crypto-verified + ok → canonical.
  const backendRole: BackendRole =
    cryptographicallyVerified && severeReplay ? 'canonical_kernel_degraded'
    : cryptographicallyVerified ? 'canonical_kernel'
    : classification.role;
  const canonicalBackendDetected = backendRole === 'canonical_kernel' && receiptHeadVisible;

  let liveDataKind: LiveDataKind;
  if (classification.role === 'unavailable') liveDataKind = 'unavailable';
  else if (receiptHeadVisible) liveDataKind = 'receipt_chain_head_public';
  else liveDataKind = 'server_alive_query_unavailable';

  const degradedReason =
    receiptHeadVisible && freshnessVerified ? null
    : receiptHeadVisible ? `head crypto-verified but freshness not confirmed (${freshness?.verdict ?? 'no_history'}) — not a replay risk, but not proven fresh`
    : severeReplay ? `REPLAY/ROLLBACK: crypto-valid head FAILED freshness (${freshness?.verdict}) — degraded, not shown`
    : classification.halt ? 'HALT: head served but failed pinned-key verification (impostor / wrong backend)'
    : classification.canonicalityProof === 'name_marker_only' ? 'name-marker only, NO pin configured — spoofable, not trusted'
    : cryptographicallyVerified ? 'canonical kernel reachable but head read failed re-verification'
    : classification.role === 'donor_lab' ? 'donor/lab backend (organism) — not the canonical kernel'
    : classification.role === 'wrong_backend' ? 'backend is not the canonical kernel'
    : 'no live Convex backend on this loopback URL';

  const nextStep =
    receiptHeadVisible && freshnessVerified ? 'Cryptographically-pinned, FRESH canonical head visible. Next: bounded reactive subscription.'
    : severeReplay ? 'REPLAY/ROLLBACK detected — investigate; do NOT trust as live. Re-confirm against the kernel high-water.'
    : receiptHeadVisible ? 'Crypto-verified head; freshness not yet proven (first observation or freshness window not enforced).'
    : classification.halt ? 'HALT — backend failed the pin. Verify the target / re-check the pinned key.'
    : !classification.pinConfigured ? 'Set AUKORA_CANONICAL_PIN_PUBLIC_KEY (out-of-band) so canonicality can be cryptographically verified.'
    : classification.role === 'donor_lab' ? 'Donor/lab backend — start the canonical node-template kernel on its own port and point the bridge there.'
    : 'Start the canonical node-template kernel backend (loopback), then re-run.';

  const enriched: ConvexBrainSnapshot = {
    ...snapshot,
    bridgeMode: loopbackResult.bridgeMode,
    advisoryOnly: true,
    grantsAuthority: false,
    nextSafeWiringStep: nextStep,
  };

  if (receiptHeadVisible && freshnessVerified) {
    const riskIdx = enriched.risks.indexOf('No Convex subscription or read-only bridge exists between womb and kernel');
    if (riskIdx >= 0) enriched.risks.splice(riskIdx, 1);
  }

  const validation = validateSnapshot(enriched);
  if (!validation.valid) {
    throw new Error(`topology-enriched snapshot validation failed: ${validation.violations.join(', ')}`);
  }

  return {
    snapshot: enriched,
    classification,
    backendRole,
    canonicalBackendDetected,
    canonicalityProof: classification.canonicalityProof,
    spoofable: classification.spoofable,
    halt: classification.halt,
    cryptographicallyVerified,
    freshnessVerified,
    freshness,
    replayRisk,
    nextHighWater,
    receiptHeadVisible,
    liveDataKind,
    receiptHead,
    loopbackResult,
    degradedReason,
  };
}
