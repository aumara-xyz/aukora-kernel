#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * drand-checkpoint — stamp this node's memory-state markers against the public drand beacon.
 *
 *   AUKORA_DRAND_ANCHOR=1 bun scripts/drand-checkpoint.ts
 *
 * Appends one line to ~/.aukora-symbiote/aumlok/drand-checkpoints.jsonl binding a BLS-verified
 * drand round to the node's current capture-status markers (last written row key + hex-truncated
 * receipt — the display-only truth surface /api/brain already serves). Anyone can later verify the
 * round against drand's pinned public key, proving these markers existed by that round's time.
 *
 * ADVISORY ONLY: a checkpoint stamps, never gates (grantsAuthority:false). Egress is owner-gated by
 * AUKORA_DRAND_ANCHOR=1 — unarmed, this script refuses and touches nothing. V1 subject is the
 * capture-status marker; binding the full Convex receipt-chain HEAD hash is the follow-up brick
 * (needs the governed head read; tracked in the PR that added this).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchDrandAnchor, drandArmed } from '../core/src/drandAnchor';

const HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
const STATUS = path.join(HOME, 'convex', 'capture-status.json');
const OUT = path.join(HOME, 'aumlok', 'drand-checkpoints.jsonl');

async function main(): Promise<void> {
  if (!drandArmed()) {
    console.error('refused: drand anchoring is owner-gated egress — run with AUKORA_DRAND_ANCHOR=1');
    process.exit(1);
  }
  const res = await fetchDrandAnchor();
  if (!res.ok) {
    console.error(`refused: no verified drand round (${res.reason}) — an unverified checkpoint is worse than none`);
    process.exit(1);
  }
  let subject: { captureLastKey: string | null; captureLastReceipt: string | null } = { captureLastKey: null, captureLastReceipt: null };
  try {
    const s = JSON.parse(fs.readFileSync(STATUS, 'utf-8'));
    subject = { captureLastKey: s?.lastKey ?? null, captureLastReceipt: s?.lastReceipt ?? null };
  } catch { /* no capture status yet — an empty subject is an honest checkpoint of a fresh node */ }

  const line = {
    schema: 'drand-checkpoint-v1',
    anchor: res.anchor,
    subject,
    at: new Date().toISOString(),
    advisoryOnly: true,
    grantsAuthority: false,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true, mode: 0o700 });
  fs.appendFileSync(OUT, JSON.stringify(line) + '\n', { mode: 0o600 });
  console.log(`✓ checkpoint: round ${res.anchor.round} (drift ${res.anchor.roundDriftFromClock} rounds) ⇐ ${subject.captureLastKey ?? 'no capture rows yet'}`);
  console.log(`  appended to ${OUT} — verify any time against drand's pinned quicknet key.`);
}

main();
