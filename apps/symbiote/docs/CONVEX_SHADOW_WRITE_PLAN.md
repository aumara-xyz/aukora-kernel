# Convex shadow-write capture — the plan, not the build (2026-07-07)

Written per Peter's directive after the first inside-out UI demo. **Nothing here is built.** No code
ships with this document, nothing changes recall, and nothing is armed. `brain.json` remains the one
canonical memory; the R5b gate (no recall cutover until Convex has real fuzzy recall/search) stands.
Build begins only on an explicit go from Peter/Codex.

## Ground truth today (verified in code, 2026-07-07)

- The voice lane writes NO memory anywhere: recall is a read-only `kira.recall()` over the local
  `brain.json`; tool rounds are ephemeral (never persisted to Kira/receipts/history).
- `/api/brain` truthfully reports `capture.wired: false`, pinned by
  `core/tests/convexReadOnlyInvariant.test.ts` — the whole organism makes zero Convex mutation calls.
- The governed write path ALREADY exists and is fully test-pinned but transport-less:
  `core/src/memoryAppend.ts` → the ONE registered mutation `aumlokMemory:aumlokMemoryWrite`
  (manifest resolution → subject PoP → one-shot grant → decision token minted+consumed in the same
  transaction → V4-signed receipt on the `mem:{owner}:{key}` chain → row insert). Loopback-only,
  fail-closed, `advisoryOnly:true / grantsAuthority:false` on every envelope.

## The shadow-write brick, smallest honest shape (three pieces)

1. **Transport** — the admin-authenticated `deps.invoke` wiring for exactly one function
   (`aumlokMemoryWrite`), with key custody under `~/.aukora-symbiote/convex/` (0600, outside the
   repo, never synced). Already planned as its own brick; this is the bulk of the work.
2. **Subject provisioning** — a dedicated `capture` subject: manifest + subject PoP + one-shot
   grants minted through the existing kernel ceremonies. No new authority classes; the kernel's
   existing refusal lattice is the boundary. Also bulk.
3. **One call site** — after a completed voice turn, best-effort and env-gated
   (`AUKORA_MEMORY_SHADOW_CAPTURE=1`, default OFF): write ONE bounded summary record
   (`turn-summary-v1`: timestamps, capped owner-text digest, capped reply digest, model id,
   `advisoryOnly:true`, `grantsAuthority:false`). Hard rules:
   - a failed shadow write NEVER touches the turn (fire-and-forget, no retry loop, no fallback store);
   - no attachment content, no tool outputs, no recalled-memory text, no key material, no
     chain-of-thought — digests of the two speech acts only;
   - recall stays 100% on `brain.json`; nothing reads the shadow rows yet;
   - `capture.wired` on the Settings card flips to true ONLY when this actually ships, so the card
     never lies.

## Sizing and order

Piece 3 is a small PR. Pieces 1–2 are the real work (custody + PoP ceremonies) and must land first —
in that order, each with its refusal tests before any data flows. Recommend: keep pieces 1–2 as the
already-planned kernelAdapter brick on Peter/Codex's side of the mesh; Zeb's node can carry piece 3
once 1–2 exist.

## What would make this worth building

A shadow table of governed, receipted turn summaries gives R5b a migration corpus to test fuzzy
recall against — without ever risking the canonical brain. Until Convex recall demonstrably beats
`kira.recall` on that corpus, nothing cuts over.
