// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.70 P1 — governed-memory CLI + the read-only "FPV of her mind". Subcommands:
 *   remember <text…>   govern (AUMLOK+secret) → hash-chained store → receipt
 *   recall             advisory read-only dump (no authority)
 *   forget <hash>      RTBF: erase plaintext, keep tombstone + chain link, receipt
 *   verify             recompute the chain (tamper-evidence)
 *   mind               the FPV — her current memory + receipt chain + state, READ-ONLY (the anti-black-box window)
 * The FPV/recall/verify exercise NO authority. Only remember/forget route through the gate.
 */
import { remember, recall, forget, verifyChain, loadEntries } from './memory';
import { readAukoraSession } from '../authority/gate/opencodeAskBridge';

function aumlok(): string {
  const s = readAukoraSession();
  const live = !!s.unlocked && (!s.expiresAt || s.expiresAt > Date.now());
  return live ? 'UNLOCKED' : 'LOCKED';
}

function fpv(): void {
  const chainKey = 'auma-ide';
  const v = verifyChain({ chainKey });
  console.log('🧠 AUMA — FPV of her mind  (read-only · memory NAVIGATES, it does NOT AUTHORIZE)');
  let chain: ReturnType<typeof loadEntries> = [];
  try { chain = loadEntries().filter((e) => e.payload.chainKey === chainKey).sort((a, b) => a.payload.seq - b.payload.seq); }
  catch (e) {
    console.log(`   AUMLOK: ${aumlok()}   ·   chain: ${chainKey}`);
    console.log(`   consistency: ✗ STORE CORRUPT — recall withheld (${(e as Error).message}); signed head: no (Ed25519 = Step 4)`);
    return;
  }
  const active = chain.filter((e) => e.status === 'active' && e.payload.operation === 'remember' && e.content != null);
  const tombs = chain.filter((e) => e.status === 'tombstoned');
  // Honest consistency: distinguish receipt-backed verification from mere internal hash consistency / unverified.
  const consistency = v.ok ? '✓ internal + receipt-backed agree' : (v.receiptsBacked ? `✗ BROKEN (${v.reason})` : `⚠ UNVERIFIED — ${v.reason}`);
  console.log(`   AUMLOK: ${aumlok()}   ·   chain: ${chainKey} · ${chain.length} events`);
  console.log(`   consistency: ${consistency}   ·   signed head: no (Ed25519 = Step 4)`);
  console.log(`   active memory (${active.length} facts):`);
  for (const e of active) console.log(`     #${e.payload.seq} [${e.payload.tier}] ${(e.content ?? '').slice(0, 88)}   (${e.hash.slice(0, 10)}…)`);
  if (!active.length) console.log('     (empty — she remembers nothing yet)');
  console.log(`   forgotten (RTBF tombstones): ${tombs.length}`);
  console.log('   — this is a window, not a wheel: nothing here authorizes an effect.');
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'remember': {
    const r = remember({ content: rest.join(' '), tier: 'fact' });
    console.log(`${r.effect.toUpperCase()} — ${r.reason}${r.entry ? ' · ' + r.entry.hash.slice(0, 12) + '…' : ''}`);
    process.exit(r.ok ? 0 : 1);
  }
  case 'recall': {
    const r = recall();
    console.log(r.banner);
    for (const f of r.facts) console.log(`  #${f.seq} [${f.tier}] ${f.content}`);
    if (!r.facts.length) console.log('  (no active memory)');
    break;
  }
  case 'forget': {
    const r = forget({ hash: rest[0] });
    console.log(`${r.effect.toUpperCase()} — ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }
  case 'verify': {
    const v = verifyChain();
    if (v.ok) console.log(`✓ verified: internal + receipt-backed (${v.length} events)`);
    else console.log(`${v.receiptsBacked ? '✗ BROKEN' : '⚠ UNVERIFIED'}: ${v.reason}`);
    process.exit(v.ok ? 0 : 1); // non-zero when broken OR unverified (receipts absent / corrupt) — fail-closed
  }
  case 'mind': default: fpv();
}
