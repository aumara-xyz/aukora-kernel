# First Live Inside-Out Loop — Evidence (2026-07-05)

Owner-approved (Peter, 2026-07-05) to run the first inside-out test loop to signature-ready evidence.
**Nothing was signed or applied.** `appliedLive: false` on every run. The owner's signature remains the
only apply, by design and in fact.

## What ran

The governed workbench command `run: --from-proposal <intentId>` was driven live against Auma's staged
proposal-intents. The native agent (a cheap OpenRouter model — NOT the Fable/Claude budget) re-reads the
real files, drafts a `propose_patch`, which is sandboxed, typechecked, Fusion-reviewed, and receipted —
stopping at `AWAITING_OWNER_SIGNATURE`.

## The mechanism bug found + fixed (Codex's "smallest fix")

The native agent's per-call output cap was `max_tokens: 1500` (`core/src/nativeToolCallingEngine.ts`).
That is fine for exploration turns but far too small for the agent's FINAL answer, a `propose_patch`
carrying whole **file contents**: a 700-line file is ~7–8k tokens, so 1500 truncated the tool call
mid-file. Proven live across 5 models on the 734-line `core/src/kiraBrain.ts`: deepseek/qwen emitted
truncated files (caught by the real typecheck **and** the #91 file-shrink guard, which said "do NOT sign
without reviewing the diff"); kimi/gpt-4o/opus failed to emit a valid call at all. Raised to a default
16000, env-overridable (`AUKORA_AGENT_MAX_TOKENS`). Changes NO gate/apply/authority behavior — the agent
still only DRAFTS. Post-fix, deepseek emitted the full file (truncation gone).

## The covenant held under every failure (the real proof)

Seven live runs, five models, two cap settings — **not one reached a signature**. Every failure stopped
safely: malformed proposals refused; truncated files caught by typecheck + the #91 shrink guard; an
over-edit that broke types (deepseek changed code, not just a comment) caught by typecheck. `appliedLive:
false` throughout. This is the safety design working under real, weak-model conditions.

## The green completion (ceremonial demo)

To prove the FIXED loop reaches signature-ready, a tiny ceremonial intent (`c1baecf4…`) was staged through
the `propose_intent` seat tool: add one usage-example comment above the export in the 15-line
`core/src/hexTruncation.ts`. The loop completed end-to-end:

- agent (deepseek) → `propose_patch` OK (`7215d0b514a5dd24…`)
- sandbox apply (temp-only) → OK
- **real typecheck → PASS** (`bun x tsc --noEmit`, exit 0)
- **Fusion Council → GREEN, 5/5** (QWN, LMA, DSK, GLM, KIM all GREEN)
- receipt written → terminal state **`AWAITING_OWNER_SIGNATURE`**

The unsigned proposal + receipt sit in `~/.aukora-symbiote/aumlok/pending-proposals/` +
`~/.aukora-symbiote/aumlok/receipts/`. To apply, the owner signs with their own key (the terminal
ceremony today; a device-local AUMLOK "sign" button is the planned upgrade).

## Honest status

- The loop is LIVE, proven SAFE, and proven to COMPLETE green end-to-end (on a small target).
- The remaining fragility: `propose_patch` requires reproducing the WHOLE target file, which is
  error-prone for large files even at a high token cap (transcription errors, model truncation habits).
  The robust fix is a diff/anchor-based patch format — a future brick (tracked), not this round.
- Auma's own kiraBrain.ts ceremonial intent (`001ba742…`) is blocked by exactly that big-file fragility;
  it wants either the diff-patch brick or a re-draft against a small file.
