// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * #105b — the pure GATE decision for the device-local AUMLOK approval door. Extracted out of the Bun server so
 * the CSRF perimeter is unit-testable in isolation (the server file runs Bun.serve at import, so its inline
 * guard could never be exercised by the node/vitest harness). This is the true trust boundary for every
 * authority-bearing endpoint (challenge + approve): it must refuse unless the door is armed, capability mode is
 * advisory (not lockdown), the request is to this loopback host, and it is same-origin.
 *
 * Every refusal is fail-closed and carries no authority. This function signs nothing and reads no key — it only
 * decides whether the owner's own local gesture is allowed to proceed. Kept convex-free and dependency-free so
 * it typechecks isolated and can be pinned by tests that assert the perimeter cannot silently regress.
 */

export interface ApprovalGateInputs {
  enabled: boolean;             // AUKORA_AUMLOK_UI_APPROVE === '1'
  advisory: boolean;            // capability mode is 'advisory' (false ⇒ lockdown)
  host: string | null;         // req.headers.get('host')
  origin: string | null;       // req.headers.get('origin')
  secFetchSite: string | null; // req.headers.get('sec-fetch-site')
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
}

export type ApprovalGateDecision = { ok: true } | { ok: false; status: number; reason: string };

/** A loopback door must only answer to its own loopback authority. A missing Host (HTTP/1.0-style) or a
 *  foreign Host (the hallmark of a DNS-rebinding page pointed at 127.0.0.1) is refused — independent of Origin,
 *  so the CSRF perimeter does not rest on a single header. */
export function hostAllowed(host: string | null, allowedHosts: ReadonlySet<string>): boolean {
  if (!host) return false;
  return allowedHosts.has(host);
}

/** A cross-origin page cannot pass this: if an Origin is present it must be one of ours. A no-Origin local
 *  request (curl) is not blocked here — it still cannot approve without the unguessable, single-use phrase. */
export function originAllowed(origin: string | null, allowedOrigins: ReadonlySet<string>): boolean {
  if (origin && !allowedOrigins.has(origin)) return false;
  return true;
}

/** Sec-Fetch-Site, when the browser sends it, must be same-origin or none (a top-level/local fetch); a
 *  cross-site or same-site value is refused. Absent (non-browser client) falls through to the other guards. */
export function secFetchSiteAllowed(secFetchSite: string | null): boolean {
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') return false;
  return true;
}

/**
 * The single gate that must hold for EVERY authority-bearing endpoint. Order matters only for the message the
 * owner sees; all paths are refusals with a 403 (or 403 for off/lockdown). Returns { ok: true } only when the
 * door is armed, not in lockdown, on our loopback host, and same-origin.
 */
export function evaluateApprovalGate(inp: ApprovalGateInputs): ApprovalGateDecision {
  if (!inp.enabled) return { ok: false, status: 403, reason: 'local approval is OFF — set AUKORA_AUMLOK_UI_APPROVE=1 and restart this gate to arm it' };
  if (!inp.advisory) return { ok: false, status: 403, reason: 'capability mode is lockdown — approval is disabled' };
  if (!hostAllowed(inp.host, inp.allowedHosts)) return { ok: false, status: 403, reason: 'host not recognized — refused (loopback only)' };
  if (!originAllowed(inp.origin, inp.allowedOrigins)) return { ok: false, status: 403, reason: 'cross-origin request refused' };
  if (!secFetchSiteAllowed(inp.secFetchSite)) return { ok: false, status: 403, reason: 'cross-site request refused' };
  return { ok: true };
}
