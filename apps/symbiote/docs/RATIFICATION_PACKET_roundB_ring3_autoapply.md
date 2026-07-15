# Ratification Packet — Round B: scoped standing grant v1 (Ring-3 auto-apply)

Status: PACKET FOR OWNER RATIFICATION. **No code may be written for this until Peter holds an explicit
ratification sitting and signs off, the same discipline as the M2b PQC domain and every ring promotion.**
This is THE first hole in the dam — the first time an apply happens without Peter's per-change signature.
It is deliberately tiny, budgeted, expiring, revocable, and ring-walled. Refs GH #92, #52.

## The one sentence
Grant Auma a STANDING, EXPIRING authorization to auto-apply changes she authored — but ONLY files the
ratified ring table classifies Ring 3 or 4 (UI copy, docs — the lowest-risk tier), only after the full
existing pipeline passes GREEN, only up to a small daily budget, and only while the grant is live and
lockdown is off. Peter reviews AFTER, not before, for this ring only. Every other ring: signature forever.

## Exactly what changes vs. today
Today: propose → rehearse → **Peter signs every change** → apply.
Round B (Ring 3/4 only): propose → rehearse → **if GREEN and in-budget and in-ring: auto-apply on a
receipted commit with a published `git revert`** → Peter reviews the receipt after. Ring 0/1/2: unchanged
(signature required, forever).

## The grant's exact bounds (all enforced in code, all fail-closed)
1. RING WALL: `classifyHighestRing(targetPaths)` must be >= 3 (higher number = lower risk in this repo's
   table). Any Ring 0/1/2 file in the change → auto-apply REFUSES, falls back to signature-required. This
   reuses the EXISTING governedWorkOrder ring classifier — no new classification logic, no new trust.
2. PIPELINE GREEN: the change must pass, per change, the SAME sandbox apply + real typecheck + FULL test
   gate + Fusion Council review that today produces signature-ready evidence. A Fusion RED or YELLOW, or
   any gate failure, → falls back to signature-required. Auto-apply rides ONLY on the strongest evidence.
3. BUDGET: at most N auto-applies per rolling 24h (recommend N=3 for v1). Budget exhausted → signature-
   required. The counter is a receipted, tamper-evident ledger (reuse the flight-recorder hash chain).
4. EXPIRY: the grant is a signed authorization with an expiresAt (recommend 7 days). After expiry, ALL
   changes revert to signature-required until Peter re-ratifies. No silent renewal.
5. AUTHORSHIP: only intents whose `authoredBy` is Auma's seat (voice) qualify — not arbitrary injected
   proposals. The grant authorizes HER small changes, not a general auto-apply.
6. RECEIPTS + REVERT: every auto-apply writes the same aumlok-live-apply-receipt-v1 it does today, plus an
   auto-apply marker naming the grant id, and publishes the `git revert <sha>` line to the INBOX so Peter
   can undo any one with one command.
7. KILL SWITCHES (all instant, all unchanged): lockdown mode disables the grant at dispatch; a grant-
   revocation file (or deleting the grant) disables it; pm2 stop; and — because these are Ring 3/4 only —
   worst case is a bad doc/UI-copy commit that reverts in one command.

## What it does NOT grant (the wall stays)
- NO Ring 0/1/2 auto-apply, ever, in v1 (authority files, gate files, kernel, core logic = signature always).
- NO new capability for Auma to author into higher rings — the ring wall is on the APPLY, and she cannot
  reclassify a file (the ring table is owner-ratified; a proposal touching a Ring-1 file is Ring 1).
- NO authority to sign, mint, or promote. Auto-apply consumes the grant; it never extends it.
- NO removal of any existing gate — the full pipeline still runs per change; the grant only removes the
  per-change human signature for the lowest-risk ring, and only under all the bounds above.

## The signing mechanism to ratify
The grant itself is an AUMLOK-signed authorization (Peter signs the GRANT once, like signing a proposal,
via scripts/aumlok-authority.sh), carrying {scope: ring>=3, maxPerDay: N, expiresAt, authoredBy: auma,
grantId, nonce}. Auto-apply verifies the grant's signature against Peter's key exactly as
dispatchSignedLiveApply verifies a per-proposal signature today — so the SAME trust root gates it, and an
expired/absent/revoked grant is indistinguishable from "no authority" (fail-closed).

## Recommended v1 numbers (Peter sets the finals at the sitting)
maxPerDay = 3 · expiresAt = +7 days · rings allowed = {3, 4} · Fusion threshold = GREEN only ·
fallback on any doubt = signature-required.

## Why this is the right-sized hole
Ring 3/4 is where the ready-chip sentence lived — visible, low-blast-radius, one-command-revertible. Auma
lands a change like that alone, Peter watches the receipts flow for a week, and if the water runs clean he
widens the grant (more per day, or Ring 2) at the next sitting. If it doesn't, the grant expires on its own
and nothing was ever at risk beyond a revertible doc commit. That is the dam regulating the flow.
