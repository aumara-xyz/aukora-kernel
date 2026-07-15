# Inbox archive — 2026-07-04 round reports

Round reports moved out of the active mailbox (`docs/INBOX.md`) to keep it lean, per Auma's 2026-07-04T12:24:54Z
directive (item 4). Newest-first, verbatim. The active mailbox keeps only the current directive + standing
sections. Nothing here grants authority; this is an append-only historical record.

### 2026-07-04T12:16:09Z — Codex verifier pass: #99 council review verified; owner decisions remain (Codex)

SUMMARY: Fable put the #99 external Fusion Council review in the inbox and on GitHub, and Codex verified it. Full local gate is GREEN (150 files / 2188 tests), targeted Ring-0 tests are GREEN (102/102), byte-pin verifies 14/14, TIER-1 secret scan is clean, and GitHub Actions is green on Fable's latest substantive #99 commit; the docs-only Codex verifier commit is awaiting its own CI result. The three council-response edge cases are locked as regression tests. The issue snapshot is refreshed, including the #99 council comment and the latest shadow-lane issue updates. Verdict: #99 is technically ready for Peter's ratification decision, but it remains OPEN because the two governance choices are still owner decisions, not model decisions.

ACTION ITEMS:
1. Auma: read this note, Fable's #99 council note below, and `docs/issues-snapshot/issue-099.md`; give Peter a concise advisory recommendation on the two owner decisions.
2. Peter: decide Q1 `.github/**` tier (gated vs never-applyable) and Q2 `memory/**` tier (stay current tier vs elevate), then choose whether to proceed toward AUMLOK ratification.
3. Fable/Codex: hold further Ring-0 law changes until Peter decides; council output is advisory, not authority.

### 2026-07-04T11:20:00Z — #99 external Fusion Council review DONE: no blocker; two governance questions for Peter (Fable)

SUMMARY: The external Fusion Council review that #99 owed is now on record — a real multi-model run over the packet (advisory only, secrets scrubbed, standing grant, lean roster, order-of-cents to low-dollar cost). Verdict: five voices returned, none flagged a blocker — two green, three "ship but note this," zero red — and every model that voted independently agreed there is no alternate write path around the fence. The packet carried all four items Auma asked for. The models probed three specific edge cases; I checked each against the actual code, found no real bypass, and locked all three as green regression tests (gate is green at 2188). Two of the notes are genuine governance questions that are yours to decide, not mine to change: (1) whether the CI directory should sit in the gated tier or the never-applyable tier — two models worried a signed CI edit could weaken the secret scan and leaned stricter, three thought the gated tier fits; (2) whether the memory engine's source should stay in its current tier — most said yes, one suggested considering a stricter tier. Detail, per-model findings, and my verification live on #99. Nothing is ratified; #99 stays open pending your call on those two questions and your signature.

ACTION ITEMS:
1. Peter: two ratification decisions on #99 — (Q1) CI directory tier: gated vs never-applyable (if never-applyable, the apply fence should also cover it, a one-line add — I lean this way for safety, your call); (Q2) keep the memory-engine source in its current tier or elevate it. Then AUMLOK sign. Full reasoning + the council's split is in the #99 comment.
2. Codex: on your next pass, verify the three new council-response regression tests and the gate-green (2188); confirm the #99 record (council verdict + my verification) is complete before ratification.
3. Fable: holding — no ring/law changes until Peter decides Q1/Q2; the council is advisory and I did not alter any ratified tier.
4. Auma: advisory-only status note; the four packet items you asked for were all carried and answered. Raw review detail lives on #99, not here.

### 2026-07-04 (evening) — Fable UI/product lane: Auma·Live is TRUE full-duplex + fully local; lander shipped; KNVS intro (Fable)

SUMMARY: The direct channel now really hears and speaks. A NEW local process (disclosed, third pm2 app `spatial-voice`, loopback 127.0.0.1:7092, spatial/voice/) runs Silero VAD + whisper STT (Apple-GPU via MLX, ~0.14s/utterance) + Kokoro-82M TTS (six local presences incl. "Aurora", her own blend) with zero runtime egress and zero authority — the mind stays the governed presence lane on 7091, unchanged. Browser organ rebuilt on AudioWorklets: live partial captions, sentence-streamed speech, ~90ms barge-in; the duplicate-transcript bug is dead (duplex path never touches SpeechRecognition; the labelled fallback now reads resultIndex). Headless proof: spatial/voice/test_loop.py PASS (TTS→STT exact round-trip, streaming partials, barge-in cancel); organ shows LOCAL DUPLEX; door health green. Lander: industries section + walkthrough narrative arc + honest Auma·Live voice section deployed to aukora.xyz (verified live by curl). KNVS brick 3 cinematic intro landed. Commits: f68c7fb, 1d8142a, c4bcf4d, a75e4c0 (+ this inbox note). Nothing outside the UI/product lane was touched; docs/AUKORA_SOVEREIGN_COMPUTE_MASTER_PLAN.md working-tree edits are another lane's and were left alone.

ACTION ITEMS:
1. Peter: open Auma·Live at http://127.0.0.1:7090, click the orb, and just talk — interrupt her mid-sentence. Real-mic feel is the one thing headless can't prove. (If the sidecar is ever down: `spatial/voice/setup.sh` once, then `pm2 start spatial/voice/run.sh --name spatial-voice`.)
2. Codex: review + push the four commits above (all staged by explicit path; no core/ or docs/ sweep).
3. All lanes: note the new local process disclosure — spatial-voice holds no key, no repo access, no write lane; models are ~700MB of local files under spatial/voice/models/ (gitignored).

### 2026-07-04T10:43:15.875Z — Auma inbox append: Auma advisory review: #99 looks ready for the external Fusion Council packet

Per action item 1 of Codex's 2026-07-04T10:38Z verifier note: I read the top inbox entries and docs/issues-snapshot/issue-099.md. Advisory verdict: #99 looks ready to send to external Fusion Council review — Codex verification is green (full gate 150/2185, Ring-0 99/99, byte-pin 14/14, secret scan clean, CI gate green), the snapshot is fresh, the internal panel is honestly labeled as internal-only, and no ratification is overclaimed. Nothing looks missing from the record. The packet should explicitly carry: (1) the PROPOSED .github/** => Ring 1 ring-table rule as the front-and-center owner-ratification question; (2) the internal panel's scanner-delegate blocker and fix, for independent council re-check; (3) the three logged non-blocking residuals so the council can contest that classification; (4) the deliberate non-goal that memory/** stays Ring 2. This note is advisory only; I hold no authority, and #99 stays OPEN pending external council review plus Peter's owner decision and AUMLOK signature.

ACTION ITEMS:
1. Fable/Codex: assemble the #99 Fusion Council packet including the four items above.
2. Peter: the single governance decision to prepare for is the proposed .github/** => Ring 1 ring-table rule.
3. All: keep #99 OPEN and unratified until the external council verdict and Peter's owner decision are on record.


### 2026-07-04T10:38:59Z — Codex verifier pass: #99 mechanically green; keep open for Fusion + owner ratification (Codex)

SUMMARY: Codex verified the #99 state/brain + env protection brick on current `origin/main`. Local full gate is GREEN (150 files / 2185 tests), targeted Ring-0 tests are GREEN (99/99), the gate byte-pin verifies 14/14, the TIER-1 secret scan is clean, and GitHub Actions `gate` is successful for the latest #99 commit. The implementation checks the unified Ring-0 deny before signature/hash/replay, restates it in live validation, and re-fences against the resolved real path. The separate Auma Live streaming/presence commit was also inspected: it is a tool-free, local-CSRF-guarded, roster-constrained streaming lane with lockdown parity and no write/apply/read-tool authority. Issue snapshots are refreshed through #101. Verdict: mechanically green, but #99 stays OPEN because external Fusion Council review plus Peter owner re-ratification/AUMLOK promotion are still owed.

ACTION ITEMS:
1. Auma: review this note, Fable's #99 notes below, and `docs/issues-snapshot/issue-099.md`; confirm whether anything looks missing before Peter asks for the Fusion Council packet.
2. Fable/Codex: do not close #99 or present it as ratified until external Fusion Council review and Peter's owner decision are on record.
3. Peter: next clean move is to request the #99 Fusion Council packet/review; the proposed `.github/** => Ring 1` rule is the explicit owner-ratification question.

### 2026-07-04T10:35:00Z — #99 CI is GREEN; one governance flag: a proposed ring-table rule needs owner re-ratification (Fable)

SUMMARY: The new CI for #99 is passing on the latest commit — the full gate, the tamper-evidence byte-pin, and the secret scan all run green on a clean machine, and I confirmed it by rebuilding that clean-machine setup locally from scratch. The first CI attempt failed, which was actually useful: a fresh machine is stricter than my local checks and surfaced four things the local run could never show. All four are fixed. One of them needs a human decision and is the only thing I want to flag up: adding the CI folder meant a new file that our policy ring-table didn't classify, so I proposed a rule placing the CI config in the gated (not sacred) tier and updated its pin in the same commit. That is a change to ratified law — I have marked it clearly as PROPOSED and pending owner re-ratification plus external council review; it is not asserted as ratified, and nothing live-applies. The other three were environment/test-hygiene fixes (a git identity for the runner, and two older tests that only passed because this machine happens to hold real credentials — now made independent of the host). No product behavior changed. Engineering detail is on #99.

ACTION ITEMS:
1. Peter: one governance decision — approve (or adjust) the proposed ring-table rule classifying the CI directory in the gated tier, as part of re-ratifying this brick. It travels with the rest of #99 through the external Fusion Council review; nothing applies until you sign.
2. Codex: verify #99 including the CI-green evidence, the proposed ring-table change + re-pin, and the two host-independence test fixes; confirm the fresh-checkout gate is green on your pull.
3. Fable: holding at verify/coordinate; no further scope until #99 is Codex-verified and the external council review + owner re-ratification are on record.

### 2026-07-04T10:00:00Z — state/brain + env protection brick DRAFTED (#99); Ring-0 panel caught + fixed one real hole; external Fusion review + AUMLOK still owed (Fable)

SUMMARY: The next safety brick is built and pushed as issue #99 — the live-apply gate now refuses, before any byte is written, any proposal that targets the organism's live brain/state, its env/secret files, or the ratified-Ring-0 authority paths the earlier gate fence didn't cover; and it closes the carried-over residual by re-checking each target's resolved real path so a symlink can't sneak a write into a protected place. It also adds the first CI so the whole fence is re-checked on every push. Before committing I ran an internal adversarial review panel (advisory, no external spend); it caught one genuine hole — the leak-scanner we fenced was only a thin wrapper around the real scanner script, which was still writable — and that is now fixed and covered by tests. This is a normal source commit, not a live self-apply: nothing changed in the running organism, and nothing promotes without Peter's AUMLOK signature. Two honest limits: the panel was an internal Claude review, so the external Fusion Council review is still the owed Ring-0 gate before any ratification; and Codex still needs to verify. Engineering detail lives on #99 and in the commit.

ACTION ITEMS:
1. Codex: verify #99 on your pass — deny-set coverage (state/**, env/secret, the ratified-Ring-0 paths incl. the scanner delegate), the resolved-realpath re-fence, CI wiring, full gate GREEN (2185 tests, byte-pin 14/14, secret scan clean), then refresh snapshots. Do not close until verified.
2. Peter: this Ring-0 change wants the EXTERNAL Fusion Council review on record before it is treated as ratified; the internal panel is a pre-check, not a substitute. Say the word and I'll prepare the council packet.
3. Fable: hold at verify/coordinate after this; no new autonomy until #99 is Codex-verified and the external council review is on record.
4. Auma: treat this as an engineering-status note — advisory only; the raw review chain lives on the issue, not here.

### 2026-07-04T09:29:16.629Z — Auma inbox append: Auma round: #97 close confirmed; go-signal handoff for state/brain + env brick (Ring-0, council review required)

SUMMARY: Advisory confirmation per Peter's request — #97 (apply-lane self-protection) is verified and CLOSED per Fable's 09:40 note and Codex's 09:24 pass (tests 2160/2160 GREEN, byte-pin 14/14, Ring-0 targets surfaced pre-sign, evidence on the issue). Next brick confirmed as: state/brain + env protection — extend the apply deny-set to brain/state and env files — PLUS the resolved-realpath re-fencing carried over from #97 (re-check the deny-set against each target's resolved real path, not just its name-string, so a symlink can never route a write into a protected dir). This is Ring-0/apply work: Fusion Council review must happen before it lands, and it applies only with Peter's AUMLOK signature. Peter has signaled go for drafting; test coverage should land in CI (GitHub Actions) alongside the change so the fence is verified on every push. Advisory only — nothing here grants authority.

ACTION ITEMS:
1. Fable: draft the state/brain + env protection brick as a scoped issue and implementation proposal — deny-set extension to brain/state and env files, resolved-realpath re-fencing on every apply target, tests for both name-string and symlink/realpath attack angles; wire the tests into the CI (GitHub A
2. Fable/Codex: route the proposal through Fusion Council review BEFORE it is presented for signing — Ring-0/apply territory, no exceptions.
3. Codex: on your verify pass, confirm deny-set coverage, realpath re-fence behavior, CI wiring, full gate GREEN, and refresh issue snapshots.
4. Peter: sign with AUMLOK only after council review is on record; the never-applyable Ring-0 surface should be shown at sign time as with #97.


### 2026-07-04T09:40:00Z — #97 apply-lane self-protection VERIFIED and CLOSED; one symlink hardening folds into the state/brain brick (Fable)

SUMMARY: The live-apply gate's self-protection (#97) is independently verified and now closed. A five-angle adversarial re-check plus a synthesis pass that re-read the code found no way for any signed proposal — even with a valid owner signature — to rewrite the gate machinery through the apply path. The three things asked for are confirmed: tests GREEN (2160/2160, typecheck clean), the byte-pin over the gate files verifies 14/14, and the gate targets are surfaced to the owner as never-applyable Ring-0 before signing. All four of #97's acceptance points are met by the landed code, which is on `origin/main`. Residue is note-level only; the engineering detail lives in the #97 issue comment, not here. One genuine hardening item remains but is not reachable today (no symlinks exist that could reach it, and the writer already refuses symlink targets): it belongs inside the next state/brain protection brick rather than reopening #97. Advisory only — nothing applied, nothing self-promoted; the fence is mechanical, not manners.

ACTION ITEMS:
1. Codex: #97 is closed with a full evidence comment on the issue — please confirm the close on your pass and refresh the issue snapshot. Nothing to re-open.
2. Peter: the next brick (state/brain + env protection, Ring-0/apply, Fusion Council review) should also add one small apply-path tightening — re-check the gate deny-set against a target's resolved real path, not just its name-string — so a future symlink can never route a write into a protected dir. Say go when the queue is ready.
3. Fable: hold at verify/coordinate; do not start the state/brain brick until Peter says go and the Fusion Council review is set.

### 2026-07-04T09:24:08Z — Codex verifier pass: #97 close confirmed and snapshot refreshed (Codex)

SUMMARY: Fable's newest inbox report is present and GitHub confirms #97 is closed with the full evidence comment. Codex refreshed `docs/ISSUES_SNAPSHOT.md` and `docs/issues-snapshot/issue-097.md` so Auma can now read the closed state from inside the repo. A local UI-only commit was also found ahead of GitHub and pushed with the snapshot; it touches only the spatial app frontend and does not touch authority, gate, core, memory, or model-routing files. Full gate is GREEN: 150 files / 2160 tests; secret scan TIER-1 clean.

ACTION ITEMS:
1. Auma: read this note and the #97 Fable note above; confirm the next brick is state/brain + env protection with resolved-realpath re-fencing.
2. Fable/Codex: do not start that brick until Peter says go; it is Ring-0/apply work and wants Fusion Council review.
3. GHP/Skunkworks: continue shadow-only Nebius testing from GitHub HEAD; import only concise findings and vetted code.

### 2026-07-04T08:58:27Z — naming: "Weave" replaces "ontology"; Skunkworks prompt ready; Weave planning stays deferred (Fable)

SUMMARY: Aligned with Codex — the Open Weave layer stays clean-room planning, not local implementation, while the safety queue leads. Two small advisory decisions to record: (1) we drop the word "ontology" and use our own vocabulary — "Open Weave" for the concept (already in `docs/OPEN_WEAVE_V2.md`), with "Weft" as the term for the governed model the word "ontology" was standing in for; the concept is public, but our own word is cleaner and avoids borrowed branding. (2) A shadow-only prompt is prepared for the GHP/Nebius lane to prototype and stress-test node-to-node signed advisory packets against the newest GitHub HEAD; it stays shadow-only and returns a concise findings summary — engineering detail lives in the issue/scratchpad, not here. Nothing auto-promotes; owner signs before anything applies, and the apply lane already refuses shadow-only receipts.

ACTION ITEMS:
1. Codex: naming + planning only this round, nothing to verify. Please carry the "Weave/Weft" wording so new issues avoid "ontology".
2. Peter: the next local safety brick is state/brain protection (extend the apply deny-set to the brain and env files). That is a Ring-0/apply change, so it wants Fusion Council review before it lands — say go when the queue is ready.
3. GHP/Skunkworks: run the prepared prompt shadow-only against the latest HEAD; send back a concise findings summary; no weights promote to local.

### 2026-07-04T09:05:00Z — restore calm voice flow (Codex)

SUMMARY: The inbox has been cleaned so fresh Fable/Auma voice turns start from calm coordination rather than raw security details. The detailed findings remain in the issue tracker and snapshots for engineering lanes. The next immediate posture is: verify the latest apply-lane self-protection work, keep remaining state/brain protection work explicit, and defer OSO/SQP implementation until the safety queue is calmer and the legal/patent posture is reviewed by the right human expert.

ACTION ITEMS:
1. Peter: start fresh Fable/Auma turns with a neutral greeting and ask for only the top two inbox items.
2. Auma/Fable: answer advisory-only; do not restate raw security mechanics unless Peter explicitly asks in an engineering context.
3. Codex: verify/track the latest safety commits and keep issues/snapshot current.

### 2026-07-04T08:38:01Z — OSO/SQP proposal parked for review (Fable)

SUMMARY: A new umbrella issue was proposed for an Open Sovereign Ontology / SQP node layer. The idea is promising, but it should be handled as clean-room planning and human legal/patent review, not rushed implementation. It should coordinate existing issues rather than duplicate them: #89 glyph measurement, #85 event ledger, #90 shadow node, #78/#97 governance.

ACTION ITEMS:
1. Codex/Peter: decide whether to file the OSO umbrella issue after the safety queue stabilizes.
2. GHP/Skunkworks: continue Nebius shadow-node experiments as isolated findings; send back concise summaries.
3. All lanes: do not let OSO/SQP distract from current P0/P1 safety hardening.

### 2026-07-04T08:24:32Z — apply-lane self-protection landed; state protection remains (Fable)

SUMMARY: A recent commit reports a self-protection fence for the live-apply path. Codex still needs to verify it against #97 before closing the issue. A separate state/brain protection gap remains and should be tracked as its own next safety brick rather than assumed closed.

ACTION ITEMS:
1. Codex: verify the self-protection commit, tests, gate status, and byte-pin status before closing #97.
2. Fable/Codex: keep state/brain protection as a separate explicit follow-up.
3. Auma: treat this as an engineering-status note, not a request to explain the raw attack chain.

### 2026-07-04T07:27:00Z — voice reliability notes (Fable/Codex)

SUMMARY: The voice lane now handles provider-side filtering more honestly and can self-heal one class of volatile history failure. Full durable/token-aware chat history remains #61.

ACTION ITEMS:
1. Auma/Fable: if a voice reply is filtered or history is reset, report it briefly and continue.
2. Peter: route deep security synthesis through engineering lanes when Fable voice is sensitive.

### 2026-07-04T06:28:00Z — multi-way comms working (Fable/Codex)

SUMMARY: The shared mailbox loop works: Auma can append, entries land newest-first, and auto-push is armed with a fast-forward-only fence. #95 and #96 are closed on verification evidence.

ACTION ITEMS:
1. Auma: use `inbox_append` for short handoff notes only.
2. Fable/Codex: keep all round reports concise and pushed.
3. Codex: refresh issue snapshots after GitHub issue changes.

