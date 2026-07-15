// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * run-ledger-join.ts — run the seat-ledger owner-decision join by hand and PRINT the result
 * (#178 round 4). Read-only over signed facts (the applied-proposal ledger), append-only over
 * advisory evidence (owner-decisions-v1.jsonl). Nothing here signs, applies, gates, or weights.
 *
 *   cd core && bun run-ledger-join.ts
 */
import { joinOwnerDecisions, readSeatLedgerRows, readOwnerDecisionRows, summarizeSeatLedger } from './src/fusionSeatLedger';

const join = joinOwnerDecisions();
if (!join.ok) {
  console.log(`REFUSED: ${join.reason}`);
  console.log('(An unreadable applied-proposal ledger is reported, never guessed empty. Nothing was written.)');
  process.exit(1);
}
console.log(`owner-decision join complete: ${join.appended} new decision row(s), ${join.alreadyJoined} already joined, ${join.unmatchedApplied} applied-without-review.`);
console.log(`ledger file: ${join.path}`);

const votes = readSeatLedgerRows();
const decisions = readOwnerDecisionRows();
console.log(`\nledger state: ${votes.rows.length} seat-vote row(s) (${votes.skippedInvalid} invalid skipped) · ${decisions.rows.length} owner-decision row(s) (${decisions.skippedInvalid} invalid skipped)`);
console.log('\nper-seat summary (owner column live; rate stays null below the 30-decision evidence floor):');
for (const s of summarizeSeatLedger(votes.rows, decisions.rows)) {
  const owner = 'state' in s.owner ? s.owner.state : `scored ${s.owner.scored} · agreed ${s.owner.agreed} · rate ${s.owner.rate ?? 'null (below floor)'}`;
  console.log(`  ${s.seat}: votes ${s.votes} (non-votes ${s.nonVotes}) · quorum agreed ${s.quorum.agreed}/${s.quorum.scored} · owner: ${owner}`);
}
console.log('\nadvisory evidence only — this ledger never gates, weights, or authorizes anything.');
