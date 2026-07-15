// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.70 P1 — receipt-chain primitives for the IDE's governed memory, mirroring the PROVEN core
 * the kernel signing layer so the IDE memory chain is the SAME shape the kernel verifies:
 *   buildReceiptChainHash(payload, prevHash) = sha256( stableStringify({ prevHash, ...payload }) )
 * The hash covers the IMMUTABLE payload (incl. contentHash) — NOT the raw plaintext — which is precisely what lets RTBF
 * erase the plaintext while the chain stays provable (the tombstone keeps the row + its hash link). No Ed25519 head
 * signing here (that is the kernel signing layer mounted in Step 4); the IDE layer is hash-chained + AUMLOK-gated.
 */
import { createHash } from 'crypto';

export function sha256Hex(s: string): string { return createHash('sha256').update(s).digest('hex'); }

/** Deterministic JSON with recursively SORTED object keys (identical to the kernel canonicalizer). */
export function stableStringify(value: unknown): string { return JSON.stringify(normalizeStableJson(value)); }
function normalizeStableJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeStableJson);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = normalizeStableJson(obj[k]);
  return out;
}

/** Advance the per-chainKey hash chain (the actor is carried inside the payload, not part of the chain key). prevHash=null for genesis. */
export function buildReceiptChainHash(payload: Record<string, unknown>, prevHash: string | null): string {
  return sha256Hex(stableStringify({ prevHash, ...payload }));
}
