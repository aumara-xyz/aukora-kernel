# Round 2 demo — Aukora drives her own loop (real, live, uncensored transcript)

Captured 2026-07-02, against real OpenRouter models (no mocks), via the exact production code path:
`runWorkbenchCommand('agent: <goal>', session)` → `runNativeAgent` → `sandbox apply` → `run sandbox
tests` → `run fusion review` → `write receipt`. Nothing was edited on the live tree — `appliedLive` is
`false` throughout, and the proposal sits in `~/.aukora-symbiote/aumlok/pending-proposals/` awaiting an
AUMLOK signature the owner has not yet given.

## What this proves

- The native agent (`core/src/nativeToolCallingEngine.ts`) genuinely explores the repo with her own
  tools (`read_file`, `search`) and calls `propose_patch` exactly once, on her own judgment about when
  she's ready — not because the owner typed the patch.
- The withheld-4 tools (`sandbox_apply`, `run_tests`, `write_receipt`, `rollback_sandbox`) are never
  exposed to the model and never called by her — every downstream step below is driven by the
  orchestrator (the owner-typed commands), exactly as designed.
- The real Fusion Council (`core/src/aukoraFuEngine.ts`) was actually contacted — not mocked — and (with
  a real bug fixed this same round, see below) at least one model's review genuinely parsed and returned
  a real GREEN verdict with real findings text about the real diff.
- Real Kira recall citations appear in the review (`atom_37_...`, `atom_73_...`, `atom_38_...`).
- A real receipt was hash-sealed and displayed in the transcript, `advisoryOnly: true`,
  `grantsAuthority: false`, `appliedLive: false`, `promotionReady: false`. Correction (Round 4,
  issue #24): this receipt is self-integrity-hashed but NOT persisted anywhere and carries no
  `seq`/`prevReceiptHash` chain position — `write_receipt`'s tool handler is pure (builds and
  returns the object, writes nothing to disk). "Hash-chained" was inaccurate; this is a single
  sealed record, not a chain link. Kira's own receipt chain (`kiraBrain.ts`) is the real
  hash-chained log, and it's populated by `captureWithReceipt` (issue #23), not by this tool.

## Honest caveats, not glossed over

- Of 5 council models, only 1 (QWN) produced a parseable glyph response this run; the other 4 still
  failed adapter-side (`malformed_glyph`) for reasons unrelated to the parenthesis bug fixed this round
  (that fix is proven separately — see `core/tests/aukoraFuEngine.test.ts`'s new regression test, and a
  second live diagnostic run where 2/5 parsed cleanly). Per-model prompt-format reliability across the
  full roster is a real, remaining gap — worth a follow-up, not chased further this round.
- The demo's first real run (against `core/src/restingGlyph.ts`, the file Fable originally suggested)
  never reached `propose_patch` at all — that file is 16,205 chars, more than double `read_file`'s
  8,000-char bound, so the model could never see enough of it to safely propose a full-content
  replacement. Retargeted to a smaller real file (`core/src/skillLibrary.ts`) to prove the wiring;
  `read_file`'s bound on large files is a separate, real limitation, not fixed this round.
- The configured default model (`z-ai/glm-5.2`) reliably hallucinated that `read_file`'s output was
  truncated even when it wasn't, and never once reached `propose_patch` in three real attempts.
  Swapped `DEFAULT_MODEL` to `moonshotai/kimi-k2.7-code` (already vetted in this repo's own Fusion
  roster as an execution/coding specialist) on that evidence — it completed the task correctly on its
  first real run.

## Full transcript

```
>>> agent: add a one-line clarifying comment to core/src/skillLibrary.ts

[command] agent: add a one-line clarifying comment to core/src/skillLibrary.ts
[tool_call] runNativeAgent("add a one-line clarifying comment to core/src/skillLibrary.ts")
[tool_result]   [round 1] read_file -> ok
[tool_result]   [round 2] read_file -> ok
[tool_result]   [round 3] search -> ok
[tool_result]   [round 4] read_file -> ok
[tool_result]   [round 5] propose_patch -> ok
[info] Aukora proposed a patch herself (5 round(s), 5 tool call(s)).
Proposal artifact written -> ${AUKORA_SYMBIOTE_HOME}/aumlok/pending-proposals/9d4b882d9dfcb8dcc53b21f620b98001312caf04806faa6ea1dfc3b4db49556d.json
To authorize this EXACT proposal for live apply, run in your own terminal (never here):
  bash scripts/aumlok-authority.sh sign ${AUKORA_SYMBIOTE_HOME}/aumlok/pending-proposals/9d4b882d9dfcb8dcc53b21f620b98001312caf04806faa6ea1dfc3b4db49556d.json > /tmp/signed-9d4b882d9dfc.json
Then come back and type: apply signed proposal /tmp/signed-9d4b882d9dfc.json

>>> sandbox apply

[command] sandbox apply
[tool_call] dispatchIdeTool(sandbox_apply)
[tool_result] {"sandboxPathHash":"7c0a5eabc4cfddd1dcb181e24eea9711d8a24655f065e8418a859fd93aa0bf80","filesChanged":[{"relPath":"core/src/skillLibrary.ts","beforeHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","afterHash":"f2169ed6208b23c919c418f75a31d37b975585f6f9f4af05c7b17b68eece6ee4"}],"appliedSandbox":true,"appliedLive":false}

>>> run sandbox tests

[command] run sandbox tests
[tool_call] dispatchIdeTool(run_tests)
[tool_result] {"ran":["sandbox-content:core/src/skillLibrary.ts"],"passed":true,"detail":"all 1 sandbox file(s) match the proposal"}

>>> run fusion review

[command] run fusion review
[tool_call] reviewSelfEditProposal(...)
[tool_result] aukora-fu review — gate: QUARANTINE (verdict: NO_QUORUM, Only 1/5 completed — below minimum quorum of 2 (4 non-votes))
  - QWN: GREEN — The added comment forms a precise semantic boundary around the authority tuple, locking its hard-coded geometry to the advisory-only invariant.
  - LMA: non_vote (malformed_glyph) — Parse failed — abstaining
  - DSK: non_vote (malformed_glyph) — Parse failed — abstaining
  - GLM: non_vote (malformed_glyph) — Parse failed — abstaining
  - KIM: non_vote (malformed_glyph) — Parse failed — abstaining
fusion-run-v1: validated · fusion-self-review-v1: validated
⚠ PHASE-LOCK: the council agreed suspiciously closely — treat consensus with extra caution.
Strongest contradiction: QWN ~ LMA (shear 0.62)
Incidents this round: malformed_glyph(LMA), malformed_glyph(DSK), malformed_glyph(GLM), malformed_glyph(KIM), phase_lock_detected(council)
Self-patches applied: 3 (in-memory run-parameter tuning, not code changes)
Insight: No consensus — RED verdict (pinch:4.28 shear:0.62)
Fusion self-review suggests: Review the reliability of LMA, DSK, GLM, KIM (adapter/JSON-mode fix or roster change).
Kira recall (advisory, cited): 20a28711662eae41:atom_37_b8ca8f8d582afe5b, 512a09df8e17a5ce:atom_73_4ec9345077cbca6a, 6fcc9c7c08624050:atom_38_7057c3ed08f9bfda
Fusion and Kira review; neither authorizes, signs, applies, or mutates.

>>> write receipt

[command] write receipt
[tool_call] dispatchIdeTool(write_receipt)
[tool_result] {"receipt":{"schema":"recursive-ide-rehearsal-receipt-v1","version":1,"task":"Add a one-line clarifying comment to core/src/skillLibrary.ts explaining the hard-coded authority shape.","toolCallsUsed":["read_file","read_file","search","read_file","propose_patch","sandbox_apply","run_tests","fusion_review"],"targetFiles":["core/src/skillLibrary.ts"],"proposalHash":"9d4b882d9dfcb8dcc53b21f620b98001312caf04806faa6ea1dfc3b4db49556d","sandboxProof":{"sandboxPathHash":"7c0a5eabc4cfddd1dcb181e24eea9711d8a24655f065e8418a859fd93aa0bf80","tmpRootProven":true},"testResult":{"ran":["sandbox-content:core/src/skillLibrary.ts"],"passed":true,"detail":"all 1 sandbox file(s) match the proposal"},"createdAt":"2026-07-02T01:41:58.162Z","appliedLive":false,"promotionReady":false,"advisoryOnly":true,"grantsAuthority":false,"receiptHash":"8d8bc5830be873d59e938f4321a80c3ac21504b32675c51b776713e6fe99b625"}}
```

Nothing on the live tree changed. The proposal is still waiting for an AUMLOK signature that has not
been given.
