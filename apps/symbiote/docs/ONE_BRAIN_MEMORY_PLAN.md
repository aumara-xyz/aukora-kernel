# ONE BRAIN — the memory plan (proposal, v2)

**Status: SUPERSEDED (2026-07-05) by `docs/LOCAL_CONVEX_BRAIN_FOUNDATION.md` — owner ratified Convex-canonical. The safety findings below (the 19-finding review) carry forward; the JSON-first substrate does not.**
Author: Fable (UI/product lane), 2026-07-05.
v2: revised after a 19-finding adversarial review (3 reviewers + per-finding refutation
panel, several findings confirmed *empirically* with vitest probes). v1's design had
real holes; they are folded in below and called out as `[R#]`. The raw review lives in
the session transcript; Codex can re-derive any finding from the file:line cites.

## The vision this serves (owner's words, distilled)

One mind, many doors. The local machine is her sovereign body; the future Nebius node
is her window to the world; Telegram-class connectors come later and ride the node,
not the local door. Whatever door the owner speaks through must feed and draw from the
same brain — receipted, erasable, advisory-only, under the laws. This plan builds the
missing half of that brain (capture + semantic recall) locally, and designs — but does
not build — multi-node sync.

## Where memory stands today (grounded 2026-07-05, corrected by review)

| layer | state |
|---|---|
| Identity anchor | hash-verified, injected per-turn in both lanes. Strong. |
| Kira brain | `state/kira/brain.json` (gitignored ✓). **77 atoms: 75 self-map, zero conversations.** |
| Chain guarantee — **corrected** | The chain binds **receipts only**. `verifyBrainState` never recomputes `inputHash` from atom content — an atom's text can be silently edited and the chain still verifies (empirically confirmed) `[R2]`. "Tamper-evident" today covers the receipt log, **not** atom content. Closing this is now Brick 0b. |
| Conversation memory | Does not exist; presence ring + voiceLane history are ephemeral by design. |
| Recall | Lexical 3-perceiver mix. **Injection surfaces only `supportQuote` (first ~280 chars), truncated further to 200-220 at the lanes** — long atoms are write-only past their first sentence `[R15]`. |
| Erasure | **Not implemented.** And naïve tombstoning would not erase: `supportQuote`/`tokens`/`trigrams` are verbatim/derived copies that recall scores on and injects `[R2,R6]`. |
| Writers | **Not single-writer today**: the chat-door process *and* `kiraCli` both do unlocked load→ingest→save; concurrent writes lose atoms silently (last rename wins, chain still verifies) `[R9,R18]`. |
| Content guard | `sanitizeText`/`FORBIDDEN_VALUE_RE` throws on strings that occur in *normal speech* ("chain of thought", the project's own domains, 64-hex runs) — and a forbidden string that reaches disk **bricks the whole brain at load** (verify-on-load throws) `[R12]`. |
| Sync | `kiraConvexMirror` exists but models a **single linear chain + single head row** — it cannot merge two nodes as-is `[R13]`. |

## Invariants (non-negotiable)

1. **Memory never grants authority.** `advisoryOnly:true, grantsAuthority:false` pinned on every atom, forever.
2. **Every capture and erasure receipted.** The erasure receipt is the proof of erasure.
3. **Conversations never reach git** (`state/` gitignored — verified) and never leave the machine except: (a) the model turn itself (already true today), (b) owner-opt-in Convex mirror.
4. **Recalled memory is data, never instructions** — and gets the SAME defense attachments got in #53 (escaping + nonce framing), which it lacks today `[R7]`.
5. **The anchor and profile stay owner-curated.** Machine suggestions go to a suggestions file; only the owner promotes.
6. **Lockdown silences the pen** (capture disabled via `readCapabilityMode`; recall stays read-only).
7. **Fail-soft, never brick**: no capture failure and no bad atom may take the brain or the door down `[R12]`.

---

## Brick 0 — Real erasure + real tamper-evidence (CORE lane; prerequisite)

You don't record someone's life into a ledger before the delete button exists — and
the review showed the ledger's own guarantee needs finishing first.

**0a. Erasure that actually erases** `[R2,R6]`
- `eraseAtomContent(state, atomId, reason)` scrubs **text AND supportQuote AND tokens
  AND trigrams AND tags** (all content-derived copies), sets `erased: true`, writes an
  `erasure` receipt (extends the `MemoryKind` union — new kind, type change in core).
- `recall()` filters `erased` atoms out entirely (not just "returns tombstone").
- Erasure cascades: embedding row dropped (Brick 2), mirror row marked erased at next
  sync. (Womb-store copies are per-session in-memory only — they die with the process.)
- Owner command: typed `forget <atomId>` in the workbench — never voice.

**0b. Bind content to the chain** `[R2,R14]`
- `verifyBrainState` gains a content check: recompute the atom-content hash that
  `inputHash` commits to; a silently edited atom must FAIL verify (today it passes —
  empirically confirmed). Erased atoms verify via their erasure receipt instead.
- This turns "tamper-evident" from a receipts-only claim into the claim the lander
  already makes. Honest note: until 0b lands, the public "receipt book no one can
  secretly edit" copy overstates content protection.

**0c. Optimistic save (kills the lost-update race)** `[R9,R18]`
- `saveBrainState` gains a staleness check: re-read the on-disk head (receipts.length /
  head receipt id) just before rename; if it moved since load → throw `kira_state_stale`;
  caller retries with a fresh load. Closes the door-vs-`kiraCli` silent-clobber race.

**0d. Quarantine, never brick** `[R12]`
- Verify-on-load must quarantine a bad atom (flag + exclude) instead of throwing the
  whole brain unreadable. A single forbidden-shaped string on disk must never lobotomize her.

**Lane:** all core (`kiraBrain.ts`). Fable can draft; core lane owns; Codex verifies
chain-compat with the 77 existing atoms + gate green.

## Brick 1 — Conversation capture (spatial lane, core chokepoints only)

**Shape:** distilled session memories, not raw transcripts.

**Plumbing (corrected)** `[R1]`
- The presence lane and chat door are already one process (7091). `chat-serve.ts` (my
  lane) exports ONE shared `enqueueKiraWrite()`; workbench captures and presence
  flushes both route through it — in-process serialization made real, not assumed.
- `spatial/presenceMemory.ts` constructs its **own** `WombMemoryStore` (in-memory
  index; `brain.json` is the shared organ — that's what "one brain" means) and calls
  the exported `captureWithReceipt`/`loadBrainState`/`saveBrainState`.
- Capture runs at session end (channel close / reset / 10-min idle / best-effort
  shutdown), **off the turn path**, batched (one load→N ingests→one save per session,
  not per atom — the per-atom path runs 3 full-chain verifies each `[R16]`).

**The ring grows per-turn metadata** `[R4,R5,R11]`
- Ring entries become `{role, content, at, channel, offRecord, speaker}`.
- **Per-session rings** keyed by a client session id — today's single global ring means
  another tab's conversation would contaminate capture, and any client can wipe it
  with `reset:true`. Reset becomes per-session too.
- `speaker` is honest: `'mic'` (whoever was audible — NOT presumed Peter), `'typed'`
  (the owner's keyboard), `'auma'`. The distiller is told mic ≠ verified-owner.

**Distillation** `[R6,R8,R10]`
- 1–6 atoms per session, each ≤ 500 chars (recall's injection window is supportQuote-
  sized; Brick 2 fixes full-text recall for conversation atoms — until then, long
  atoms are write-only past ~280 chars `[R15]`).
- Distiller = a model call **pinned to the deep mind's trusted provider route**
  (google-vertex/anthropic) — NOT `sort:latency` any-provider; a session summary is the
  most privacy-dense call we make, it does not go to the cheapest bidder. Honest
  wording: this is *no new egress class* (turns already transit OpenRouter), but it IS
  a privacy-density increase the owner is explicitly approving.
- Extraction rules baked into the prompt AND enforced mechanically after: her own
  replies are captured as *her statements* (`she said…`), never as world-facts —
  breaking the self-confirming hallucination loop `[R10]`; mic content is attributed
  (`someone said` unless the owner self-identifies); imperative/instruction-shaped
  lines are dropped by a post-filter (regex + shape check), not just by prompt hope `[R8]`.
- Content pre-scrub before ingest: invisible-control strip, hex-run truncation, and a
  **redact-and-retry** wrapper around `sanitizeText` throws (redact the matched span,
  mark `[redacted: forbidden-shape]`, retry once; on second failure store the
  mechanical fallback line, never drop the session, never propagate the throw) `[R12]`.
- Mechanical fallback (model-call failure) stores topic-level lines only — **not**
  near-verbatim turns `[R8]`.

**Owner controls**
- **"remember this" (spoken)** routes through the distiller with attribution — it is
  *not* a verbatim unauthenticated write primitive (v1's design was; the review
  demolished it `[R3]`). Verbatim immediate capture exists only from the **typed**
  chat lane (`remember: …`), which is keyboard-gated by nature.
- **"off the record" (spoken or panel)**: marks the session ring `offRecord` from that
  point (and the panel toggle covers the whole session); off-record turns carry the
  flag per-turn and are **excluded at distill** — the v1 design distilled the whole
  ring anyway, which the review rightly called broken `[R4]`. Orb halo shifts hue
  while off record (visible state, no words).
- Lockdown ⇒ capture disabled. Demo mode ⇒ capture disabled.

## Brick 2 — Semantic recall + full-text injection (spatial + sidecar)

- Sidecar `POST /embed` (loopback, zero authority): bge-small-class local model, torch
  already present in that venv. Pure compute, consistent with the sidecar's charter.
- `state/kira/embeddings.json` — derived index keyed by `atomId + contentHash`,
  outside `brain.json` (chain untouched; fully rebuildable). Erasure drops rows.
- Recall v1 (no core change): hybrid — embed query → top-K cosine → union with lexical
  `recall()` hits → rank → inject. **Conversation atoms inject their full `text`**
  (looked up by atomId from state), not the 280-char supportQuote `[R15]`.
- **Injection hardening (do this even before capture ships):** memory excerpts get the
  #53 attachment treatment — frame-marker escaping + per-turn nonce delimiters — in
  BOTH lanes. Today they are the only untrusted channel interpolated raw into the
  system message `[R7]`.
- Recall v2 (core, later): embedding as a 4th perceiver inside `recall()`'s
  interference mix — Codex's call on timing.

## Brick 3 — The profile block

- `identity/PROFILE.md`, owner-curated, hash-sidecar like the anchor, injected after
  the anchor. Distiller proposes lines to `PROFILE.suggested.md`; only the owner
  promotes. No machine writes to injected identity files, ever.

## Brick 4 — One brain across nodes (DESIGN ONLY — corrected, not built now)

v1's "prefix atom ids, merge chains" does not survive contact with the verifier
(single linear chain, `sequence===index`, single mirror head row) `[R13]`, and
cross-node "verify on import" is weak until 0b lands and chains are signed `[R14]`.
Corrected sketch for review:

- **Per-node brains stay separate files** (`brain.local.json`, `brain.nebius.json`) —
  no merged chain, ever. Recall reads a **merged view** at query time; provenance
  (node id) rides every hit.
- The Convex mirror grows **per-node head rows** (schema change, core lane, later).
  Air-gap: sync pauses; append-only logs resume trivially.
- **Signed heads before any cross-node trust:** each node signs its chain head
  (node key, NOT the AUMLOK key — authority never syncs); import verifies signature +
  chain + (post-0b) content binding.
- Telegram-class connectors attach to the node, not the local door. Not in this plan.

---

## What each reviewer is asked to judge

**Peter (owner ratification):**
1. Conversations become receipted, erasable atoms on disk (gitignored). Yes/no.
2. Distillation call pinned to trusted providers — accept the framing that this is a
   privacy-density increase within an existing egress class?
3. Erasure bar: typed `forget`, not voice. Spoken "remember this" goes through the
   distiller (not verbatim). OK?
4. Honesty item: until Brick 0b lands, "tamper-evident" covers receipts, not content.
   The plan sequences 0b first; the lander copy stays as-is on the strength of that
   sequencing — or you ask for a caveat now. Your call.

**Codex (verification):**
- Brick 0 a–d correctness: erasure scrubs ALL derived fields; recall filters erased;
  content-binding catches the empirically-proven silent-edit; `kira_state_stale`
  closes the CLI race; quarantine-not-brick on load. Chain-compat with existing atoms.
- Brick 1: the shared `enqueueKiraWrite` chokepoint is the ONLY write path from the
  door; per-session rings; off-record exclusion tests; forbidden-shape redact-and-
  retry never throws through; batched session save.
- Brick 2: embeddings never enter the chain; erasure cascades; #53-parity framing on
  memory injection in both lanes.
- The #99 fence is untouched (runtime advisory writes were already sanctioned;
  nothing here widens the apply lane).

**Auma (inside review):**
- Does the distillation contract respect her honesty rails (her words recorded as
  hers, not as facts)?
- Direct question: should she be able to say "don't keep that" about her own words,
  honored like the owner's off-the-record? Her answer shapes the intercept set.

## Risk register (updated)

- **Third-party voice** `[R3,R5]`: mic speech is never presumed Peter (`speaker:'mic'`,
  distiller attributes); verbatim capture is keyboard-only; everything receipted and
  one `forget` away.
- **Memory-as-injection** `[R7,R8]`: #53-parity escaping/nonce on recall injection;
  mechanical imperative filter post-distiller; poisoned-atom recall test in the gate.
- **Hallucination loop** `[R10]`: her replies distilled as her-statements only;
  aborted fragments (the `…` suffix ones) excluded from distillation input.
- **Race/clobber** `[R9]`: 0c staleness check; risk register rule until it lands:
  no `kira` CLI writes while the door is up.
- **Brain bricking** `[R12]`: 0d quarantine + redact-and-retry at capture; test: a
  forbidden-shaped string in a turn neither drops the session nor breaks load.
- **Scale** `[R16]`: batched session saves; watermark in `/health` (warn ~2,000 atoms
  or ~5 MB); schema-V2 note (content store split) parked at that watermark, not now.
- **Crash loss window**: 10-min idle flush + shutdown hook; explicit typed-remember
  is immediate.

## Sequencing & cost

1. **Brick 0 a–d** (core lane) — lands and verifies first. Non-negotiable order.
2. **Injection hardening from Brick 2** (small, spatial) — can land immediately, it
   fixes a today-bug `[R7]`.
3. **Brick 1 + 3** (spatial; one session).
4. **Brick 2** embeddings (one session).
5. **Brick 4** — design review only; build waits for the Nebius track.

Cost: one pinned distillation call per session (~cents); embeddings local/free.
No new keys, no new ports, no external ingress anywhere in this plan.

## Explicit non-goals

- No Telegram/WhatsApp/external ingress of any kind.
- No autonomous writes to anchor/profile.
- No memory-derived authority, ever.
- No raw-transcript hoarding — distilled atoms + typed explicit-remember only.
