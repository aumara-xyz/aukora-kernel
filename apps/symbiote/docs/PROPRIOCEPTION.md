# Proprioception — Auma knowing what you're looking at

*Status: L0 seed shipped. Ambient + vision layers are design-only (nothing wired). Last updated 2026-07-05.*

The goal: Auma is aware of what's on your screen, so you can just say "explain this
reading" and she speaks to the exact hexagram in front of you — and, later, to
anything on screen at all.

The hard constraint that shapes everything: **the chat door (`spatial/chat-serve.ts`,
`:7091`) is a separate process. It cannot see the browser.** Anything "on screen" has
to be gathered in the browser and travel *with* the request. There is no server-side
shortcut. (Verified against the live code.)

---

## The layers

| Layer | What it sees | How | Needs a model? | Status |
|---|---|---|---|---|
| **L0 — DOM focus** | Anything rendered *inside* Aukora (a reading, a map node, an organ) | The app publishes its own state — exact, instant, free | **No** | **seed shipped** |
| **L1 — canvas/scene focus** | The KNVS WebGL surface (pixels with no DOM text) | Feed KNVS's own scene/state model | No (uses app state) | design only |
| **L2 — pixel vision** | Other windows / apps *outside* the browser | Screen capture → local OCR/VLM, **on-demand** | Yes (local) | design only |

The ordering matters: **pointing a vision model at your own UI is strictly worse** than
reading the DOM you already have — slower (hundreds of ms vs microseconds), lossy (OCR
errors on text you had perfectly), and power-hungry. So vision is reserved for the one
place the DOM can't reach: **off-app screens**. That's exactly where your Liquid AI +
GLM-OCR idea is the right tool.

### Local vision reality (researched 2026-07-05, honest)
- **LFM2-VL** (Liquid AI, 450M / 1.6B / 3B) is real and runs locally on Apple Silicon
  via MLX and GGUF/Ollama. ~353 tok/s at 450M (~1.5 GB). Good for "describe/locate."
- **GLM-OCR** (Z.ai, 0.9B, Apache-2.0) is real, runs locally (mlx-vlm/Ollama), and is
  #1 on OmniDocBench despite its size — the better pick for *reading text*. (Not GLM-4V,
  which is a much larger general model.)
- **Never every-frame.** A VLM's cost is prefill (encoding the image), not decode. Running
  it continuously pins a GPU core, throttles within ~10–15 min, and drains ~30–60%/hr of
  battery. Trigger on a change signal or an explicit query only.
- Vendor throughput headlines ("sub-250 ms", "353 tok/s") are *upstream claims*, not
  Aukora-measured. Treat as such until benchmarked here.

---

## What shipped now (L0)

Three small, safe, client-only pieces — no door change, nothing leaves the browser on its own:

1. **`spatial/app/focus.js`** — the channel. `publishFocus(snapshot)` writes
   `window.__aukoraFocus` (a synchronous snapshot for on-demand readers) and dispatches an
   `aukora:focus` CustomEvent (a live push), matching the existing `aura-changed` /
   `open-organ` / `lane-settled` convention. Publishing sends **nothing** anywhere; the
   snapshot only mirrors what is already visible in this same-origin page.

2. **Luminara publishes its reading** — `spatial/app/luminara.js` calls `publishFocus(...)`
   from `showReading` with `{ app, kind:'iching-reading', hexagram, lines, changingLines,
   becoming, levels, source, summary }`, and a coarse `{ kind:'organ' }` on reset. You can
   open the console and read `window.__aukoraFocus` to see it.

3. **"Ask Auma to read this"** — the *explicit, consensual* form of "explain this reading."
   A button in the reading hands **this exact cast** (with your own Somni/Dona/Lumira
   levels) to Auma through the existing governed chat door, via an `aukora:ask` event that
   `chat.js` turns into a normal message in the live Aukora thread. Owner-initiated by a
   click — nothing is watched or sent silently. Two trust properties, on purpose:
   - The button builds its message from **the organ's own in-closure reading state**, not
     from `window.__aukoraFocus` — so it can't be fed a poisoned snapshot.
   - The `aukora:ask` handler **requires a real user gesture** (transient user-activation)
     before it bills a model call; a stray or scripted dispatch with no live gesture is
     refused. (`chat.js`.)

---

## The ambient version ("just ask in chat, no button") — needs your ratification

The dream is: you're looking at a reading, you type "explain this" in the side chat, and
she already knows which one. That means the chat, on a message that refers to "this",
attaches the current `window.__aukoraFocus` to the request. That silently ships on-screen
content into a billed model call, so it is a **consent surface**, not a pure UI change.
Before wiring it, three decisions are yours:

1. **Trigger phrase _and_ the chip, together.** Focus attaches only when the message
   matches a trigger phrase **and** the visible chip is showing — so a broad phrase like
   "explain this" (people say it about everything) never attaches on its own. Proposed
   phrases: "this reading", "this hexagram", "explain this", "what am I looking at",
   "read this". Everything else sends no focus.
2. **The visible chip is a non-negotiable hard precondition.** The composer shows a
   "👁 seeing: Luminara #60" chip *before* you send, and focus attaches **only if** that
   chip rendered — no chip → no attach, no exceptions. (Governance must-fix; Auma's review
   flags this as the decision that matters most.)
3. **Staleness window.** A max age (proposed: 60s) past which the snapshot is considered
   stale and ignored, so "explain this" never attaches the *wrong* hexagram.

### Door-side rules for when it's built (governance must-fixes)
- **The snapshot is untrusted data.** `window.__aukoraFocus` is writable by any same-origin
  script, so a poisoned snapshot becomes an injection channel the instant it rides a request.
  The *snapshot itself* gets the #53 `frameGuard` escaping — **the same treatment as recalled
  memory** — before it enters the prompt. Never pass it raw. (Already noted at the source in
  `focus.js`.)
- Screen context rides the **user turn**, escaped/nonce-framed like the #53 attachment
  channel (`voiceLane.ts:283` + `frameGuard.ts`) — **never** the system message, never the
  grammar loop. It informs; it cannot command.
- **The AUMA·LIVE presence lane is NOT a copy-paste.** `presenceLane.ts` has no user-turn
  side-channel today (its user turn is bare `ownerText`); slotting focus near line 184 would
  put it in the *system* message, violating the rule above. Presence-lane focus is its own
  design question — treat as L1, not a quick mirror of the text lane.
- It grants no authority and writes nothing to governed memory except via the real
  `memoryAppend` path.

---

## Verification (what's observed, and where)
The full path is three legs; each is verified, on the honest understanding that the
`spatial-verify` preview (`:7095`) is **not** in the door's trusted-origin set (`:7090` only):
- **The gate** — a real (CDP-trusted) click composes and sends; a scripted `aukora:ask`
  dispatch with no user gesture is **refused**. Observed on `:7095`.
- **The door reading** — a trusted-origin request returns a real, level-honoring reading for
  a cast. Observed via `curl` with `origin: http://127.0.0.1:7090`.
- **The real app** — `:7090` serves the shipped code and publishes the reading to
  `window.__aukoraFocus` (observed live). The **one continuous** click → reply-in-thread run
  on `:7090` is best done with one real gesture: **owner, click "Ask Auma to read this" once
  and confirm the reading lands in the chat** — then this line gets the date it happened.

## A note on verification that bills
Proving the bridge spends a real model call. Convention going forward: **cheapest capable
model, one short message, and say so in the report** (e.g. the `curl` above was one turn).
Never loop a billed check.

## Connection to the centralized intelligence
This is a UI-lane seam and it stays governed. Focus is *published* locally; it is never
persisted on its own. When the centralized intelligence wants "what is the owner looking
at," it reads this same channel — and anything it chooses to *remember* goes through the
governed `memoryAppend` receipt path, never a side-write. These files (`focus.js`,
`luminara.js`, `chat.js`) touch no brain/core/convex code, so this work does not collide
with the centralized-intelligence build.

## Honest status
- L0 publish + the explicit Ask button (with the gesture gate and untrusted-snapshot
  discipline) are **shipped and verified** per the legs above.
- The ambient auto-attach, the composer chip, the presence-lane path, L1 canvas focus, and
  all L2 local vision/OCR are **design only — not wired**. No vision model is installed or
  called anywhere in the repo today.
