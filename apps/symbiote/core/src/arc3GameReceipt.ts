// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The game's receipt for a work-order intent (THE GREAT MERGE #178 round 5).
 * When MK·PULSE names a silent door and drafts a proposal-intent (round 4), it
 * also writes THIS sidecar — the structured record of exactly what the game
 * saw: which door, which run, how many probes, the level the naming completed.
 * Keyed by intentId, it lives beside the intent so the signing screen can FUSE
 * the game's eyes into the moment of signature.
 *
 * Same discipline as the Fusion advisory sidecar (proposalFusionAdvisory.ts):
 *   - display-only, NEVER an input to any gate or apply path;
 *   - fail-closed on read (a tampered/absent sidecar is honest absence, never
 *     partial data mistaken for fact);
 *   - trusted-dir reads only; provenance (authoredBy, createdAt) travels with
 *     the shape so the owner always sees WHO recorded it and HOW OLD it is.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface Arc3GameReceiptV1 {
  schema: 'arc3-game-receipt-v1';
  intentId: string;         // the proposal-intent this receipt explains
  door: string;             // the surface the game named silent (e.g. 'chat-door')
  url: string;              // the loopback address it probed (read-only GET)
  guid: string;             // the MK·PULSE run
  level: number;            // the level the naming completed
  probes: number;           // times the silent door was probed, the mark included
  authoredBy: 'arc3';
  advisoryOnly: true;
  createdAt: string;
}

const KEYS: ReadonlySet<string> = new Set([
  'schema', 'intentId', 'door', 'url', 'guid', 'level', 'probes', 'authoredBy', 'advisoryOnly', 'createdAt',
]);

/** Same home-resolution rule as the other aumlok sidecars. */
export function arc3GameReceiptsDir(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'aumlok', 'arc3-game-receipts');
}

export function buildArc3GameReceipt(input: {
  intentId: string; door: string; url: string; guid: string; level: number; probes: number;
}, now = new Date().toISOString()): Arc3GameReceiptV1 {
  return {
    schema: 'arc3-game-receipt-v1',
    intentId: input.intentId,
    door: input.door,
    url: input.url,
    guid: input.guid,
    level: input.level,
    probes: input.probes,
    authoredBy: 'arc3',
    advisoryOnly: true,
    createdAt: now,
  };
}

export function validateArc3GameReceipt(a: unknown): { valid: true } | { valid: false; reason: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  const v = a as Record<string, unknown>;
  if (v.schema !== 'arc3-game-receipt-v1') return { valid: false, reason: `wrong schema: ${String(v.schema)}` };
  if (Object.keys(v).some((k) => !KEYS.has(k))) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (typeof v.intentId !== 'string' || !/^[0-9a-f]{64}$/.test(v.intentId)) return { valid: false, reason: 'intentId must be a 64-hex hash' };
  for (const k of ['door', 'url', 'guid'] as const) {
    if (typeof v[k] !== 'string' || !v[k]) return { valid: false, reason: `${k} must be a non-empty string` };
  }
  if (typeof v.level !== 'number' || !Number.isFinite(v.level)) return { valid: false, reason: 'level must be a number' };
  if (typeof v.probes !== 'number' || !Number.isFinite(v.probes)) return { valid: false, reason: 'probes must be a number' };
  if (v.authoredBy !== 'arc3') return { valid: false, reason: 'authoredBy must be arc3' };
  if (v.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (typeof v.createdAt !== 'string' || !v.createdAt) return { valid: false, reason: 'createdAt must be a non-empty string' };
  return { valid: true };
}

/** Write the receipt beside the intent. The intentId is a bare 64-hex hash (validated), so no path
 *  traversal is possible from the game's own naming. Returns the path or an honest reason. */
export function writeArc3GameReceipt(receipt: Arc3GameReceiptV1, homeDir?: string): { ok: true; path: string } | { ok: false; reason: string } {
  const v = validateArc3GameReceipt(receipt);
  if (!v.valid) return { ok: false, reason: v.reason };
  try {
    const dir = arc3GameReceiptsDir(homeDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filePath = path.join(dir, `${receipt.intentId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Read + validate a receipt by intentId. Never throws. Absence and tamper are DISTINCT: a missing file
 *  is `no receipt`, a corrupt one is `refused` — the signing screen must not read tamper as mere absence. */
export function readArc3GameReceipt(intentId: string, homeDir?: string):
  | { state: 'none' }
  | { state: 'refused'; reason: string }
  | { state: 'present'; receipt: Arc3GameReceiptV1 } {
  if (typeof intentId !== 'string' || !/^[0-9a-f]{64}$/.test(intentId)) return { state: 'none' };
  const filePath = path.join(arc3GameReceiptsDir(homeDir), `${intentId}.json`);
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return { state: 'none' }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { state: 'refused', reason: 'invalid JSON in game receipt' }; }
  const v = validateArc3GameReceipt(parsed);
  if (!v.valid) return { state: 'refused', reason: v.reason };
  if ((parsed as Arc3GameReceiptV1).intentId !== intentId) return { state: 'refused', reason: 'receipt intentId does not match its filename' };
  return { state: 'present', receipt: parsed as Arc3GameReceiptV1 };
}
