# AURA + The Living Canvas — Design Spec

> **Detokenization covenant (2026-07-10, owner-directed — supersedes the numeric framing
> below).** Parts of this document predate the AURA detokenization and are preserved as
> design history. Wherever it speaks of AURA as a token, a mintable or earnable amount, a
> balance, a cap, a streak multiplier, a vouch count, a rank, or proof of humanity, that
> mechanic is superseded and must not be built or claimed. AURA is a nonnumeric living
> coherence pattern — evidence, never authority — and no number derived from a person
> reaches a public surface. A signature proves key possession; drand proves public-time
> freshness; a receipt chain proves recorded continuity; peer attestations are social
> evidence. None of these, alone or together, proves biological humanity, honesty, or
> sole human control.

*One coherent, honest, buildable design for the AURA economy and the fluid gaming-engine surface. Everything here lives in our lane: `spatial/app/*`, `lander/*`, and this one doc. Nothing touches `core/`, `serve.ts` write paths (it stays GET-only), or any shadow-mesh / sovereign-compute / open-weave file.*

*Status vocabulary used throughout — and it is load-bearing:*
- **SHIPS TODAY (provisional/local)** — real code, real UI, honest. A local counter or a pure read. Never minted, never witnessed, always badged.
- **COMING (needs the chain / a second human)** — designed now, enforced later on the governed receipt chain via AUMLOK. We ship the *display half* and hand the *truth half* to the chain owner.

---

## 1. Vision

Two things are being built, and they share one substrate.

**AURA** is a *reading* of an append-only, hash-chained receipt ledger — the same governed chain the rest of Aukora runs on. It is **derived, never stored as an editable field**. Earned-only, non-transferable, streak-weighted (Fibonacci). It is *reputation, not authority* — AURA can never sign, unlock, or gate; only the Aumlok key does that. Proof-of-humanity is social: one real human vouches for another, one aura stands behind one aura.

Today the app can only honestly ship the **provisional local shadow** of that: a per-device tally that motivates the *rhythm* of real use, badged "provisional · not yet witnessed" on every surface, that reconciles **loss-only** down to whatever the chain later says is real. It can only ever shrink to truth, never inflate.

**The living canvas (KNVS)** is the answer to "build this as a gaming engine … anything she wants to become she can be, coming on the screen." The center pane stops being a document viewer and becomes a continuously-morphing WebGL2 particle field — she breathes, condenses into forms (trefoil, creature, tool, your name), dissolves back into flux. It is her living identity *and* the stage every future grown app precipitates onto. It renders; it never touches AURA state. Pure advisory, same posture as the map.

The honest through-line: **the provisional scaffold is the eventual real economy, just unwitnessed** — but (per the adversarial review) the server must *re-derive* AURA from independent chain evidence, never *promote* the client's local numbers. The client tally is a motivational shadow, discarded at witness time.

---

## 2. The Gaming Engine — the morph surface (KNVS)

### 2.1 What it is

A from-scratch WebGL2 particle-field organ that continuously curl-noise-morphs between forms, **forking the proven map renderer** rather than reinventing it. It mounts as a full-screen organ. It genuinely wows on first load, needs zero server change, and touches no AURA state.

### 2.2 Why the fork is nearly free (verified against the code)

`spatial/app/map/renderer.js` is a 359-LOC zero-dep WebGL2 engine whose entire mechanism is reusable:
- Positions live in an **RGBA32F, NEAREST, side=ceil(sqrt(n)) texture** (`posTex`), fetched per-instance in the node vertex shader via `texelFetch` (renderer.js:28), re-uploaded each frame with `texSubImage2D` (renderer.js:281) inside `R.updatePositions` (renderer.js:268).
- The node program draws **instanced billboard-impostor spheres**: a 4-vert `TRIANGLE_STRIP` (renderer.js:328), sphere-shaded analytically in the fragment shader with `if (r2 > 1.0) discard` + Lambert/rim (renderer.js:47). Thousands of soft blobs cost two triangles each, zero geometry.
- The edge program carries a ready-made ripple: a single `u_waveTime` uniform (renderer.js:99) with a band envelope. This is the "aura earned" pulse, recolored.
- `createRenderer` (renderer.js:139) already scaffolds initGL / frame / resize / **webglcontextlost** handling (renderer.js:347).

That is *already* a morph surface. Instead of a physics worker writing positions, a curl-noise flow field on the CPU writes into the same texture each frame; the same shader renders it with **no pipeline change**.

### 2.3 Morph mechanism

- **Idle:** every particle advected along `curl(noise(p·freq + t))` with a gentle centering pull so the cloud stays framed — the "always alive" breathing.
- **Forms are alternate position sets:** `trefoil(n)` (parametric knot — the Aukora glyph), `creature(n)` (points pushed to a summed-metaball iso-surface), `glyphPoints(n, text)` (rasterize text to an offscreen 2D canvas, sample opaque pixels → 3D points).
- **Morph = per-particle lerp** from its flow-field position toward its assigned target slot by an eased `morph` amount (0→1→hold→0), so forms condense and dissolve continuously. Nothing is ever "loaded"; forms precipitate out of the same mass.

### 2.4 Loop discipline (non-negotiable — battery)

The map uses on-demand rAF (`needFrame`/`loop`, map.js:178–202) and suspends via `visibilitychange` (map.js:80). KNVS runs *continuous-while-visible* but **must self-pause when hidden**: organs stay mounted and cached in shell's `mounted` Map (shell.js:136) and are toggled `display:none` (shell.js:172), so KNVS must stop its own rAF when its root is hidden *and* honor `visibilitychange`. A leaked rAF on a `display:none` organ is the single most likely regression here.

### 2.5 The AURA ripple (honest hook)

KNVS listens for a `window` `'aura-changed'` CustomEvent (fired by `aura-core.js`, §3) and fires the `u_waveTime` wave from the field center outward, recolored to `rgb(var(--hue-r))`. **This visualizes a provisional local bump and must never read as "AURA minted."** On-canvas copy stays neutral ("+ aura · provisional"). The renderer never writes AURA and never witnesses.

### 2.6 App-as-substrate (brick 2, seam stubbed now)

`morphInApp(node)`: morph the field toward the app's bounds, fade a real DOM panel in over the canvas, scatter particles back on close. For brick 1, wire the "tool" morph target to a placeholder card so the precipitate-into-UI motion is demonstrable end-to-end. A real grown app plugging in is explicitly COMING.

### 2.7 Files

- `spatial/app/knvs/knvs-renderer.js` — fork of renderer.js. Keep the node billboard program + `updatePositions` verbatim; replace `uploadGraph(graph)` with `initField(count, colors, sizes)`; keep `R.frame(vp, pixFactor, wave)` so the ripple uniforms are pre-wired. (M)
- `spatial/app/knvs/flow-field.js` — pure JS: `flowStep(pos, dt, t)` curl-noise advection + centering; target generators `trefoil(n)`, `creature(n)`, `glyphPoints(n, text)`. No deps, all CPU. (M)
- `spatial/app/knvs/knvs.js` — the organ: `mountKnvs(root)`, ~4000 particles in the three hues, continuous rAF with hidden-pause, control strip (`trefoil · creature · you`), `'aura-changed'` ripple hook, slow auto-orbit reusing `map/camera.js` `OrbitCamera`. (M)
- `spatial/app/shell.js` — one-line-each: import `mountKnvs`, add `knvs:` to `ORGANS` (near shell.js:105), add a `TABS.organs` row (near shell.js:112), and `knvs` is **already** in the fullApp gate (shell.js:169 — verified). (S)

---

## 3. The Earning Loop — the one that survives

The adversarial review's verdict on the earning model: **it survives as designed, precisely because it commits to being provisional.** The client-side breaks (localStorage rewrite, fake-door loop, dedupe evasion, clock rollback) are all real and are **accepted, not fought** — you cannot make a browser localStorage tally tamper-proof. What matters is that the number is never presented as real, and reconciliation is loss-only.

### 3.1 One writer: `spatial/app/aura-core.js` (mandatory, not optional)

Today the state key `'auma-lingwa-v15'` is read/written in three places independently (auma.js:13/33–35, aura.js:6/15). Adding chat.js as a fourth ad-hoc writer is the exact drift risk the project memory flags. So **extract one module**:

`spatial/app/aura-core.js` exports:
- `STATE_KEY = 'auma-lingwa-v15'`, `loadState`, `saveState`, `ensure(s)` (moved from auma.js, including the `xp → aura` migrate at auma.js:37).
- `readAura()` (moved from aura.js), extended to return `{ aura, lessons, fromMessages, fromLessons, todayEarned, dailyCap }`.
- `award(kind, opts)` — the single writer. Every award dispatches `window` `CustomEvent('aura-changed', { detail:{ kind, n, source } })`.
- A file-header comment stating plainly: *this counter is local to this device, editable by anyone with a console, and means nothing until a receipt lands on the governed chain. A door reply is client-observed only and proves nothing.*

auma.js and aura.js import from it; the key string stops being hardcoded in multiple files.

### 3.2 Award rules and numbers (locked)

**Lessons** (unchanged): `award('lesson')` = **+5**, first-completion-only. Caller keeps the `already` guard (auma.js:252). Replace the inline `STATE.aura += earned` (auma.js:255) with `if (!already) award('lesson')`. Keep the provisional pop + its honesty title (auma.js:265) verbatim.

**Messages:** hook at **chat.js:777** — inside `if (Array.isArray(data.entries))`, the door-acknowledged reply branch (verified: `text` is in scope in `send()`). **Not** at the you-bubble push (chat.js:755) and **not** in the submit handler (chat.js:819). `award('message', { text })` enforces, in order:

1. **Spam/format filter** (do NOT call it a "substance gate" — the adversary is right that it only checks shape): trim; reject if `<12` chars OR `<3` whitespace tokens OR no letter; slash/grammar commands (`text.startsWith('/')`) → 0.
2. **Repeat filter:** 32-bit hash of normalized text (lowercased, whitespace-collapsed, **trailing digits/punctuation stripped** so the trivial "…1 / …2" increment and a 21-line rotating pool are at least inconvenient); if in the last **50** hashes → 0. (Widened from 20 per the adversary; still cosmetic, not security.)
3. **Burst damper:** if `<20s` since last award, halve (base 1 → floor(0.5) = 0 effectively zeroes rapid fire); hard-zero after 8 awards in the current rolling minute.
4. **Daily cap:** base **+1**; if `todayEarned >= 40` → 0; clamp so it never exceeds 40. Date roll on local-date change (client clock — accepted as gameable, provisional).

All counters (`msgDay`, `todayEarned`, `msgCount`, `lastMsgTs`, `lastHashes`, `fromMessages`, `fromLessons`) persist inside the same `STATE_KEY` object under `s.meta`, so a refresh can't reset them. `award` returns `{ earned, reason }`.

### 3.3 Anti-farm — honest framing (folded from the stress reports)

- These rules are a **spam/formatting filter and a burst damper on a provisional counter** — NOT "anti-farming that prevents farming." A local stub door + a random-word generator can drip to the 40/day cap; a determined farmer who edits localStorage or rolls the clock bypasses everything. **Say so.** Do not sell any of it as tamper-proof or humanity-proof.
- **Casual-cheat hardening (2026-07-07, still not security):** aura-core now carries (a) an **integrity seal** — a salted checksum over the earning fields in a second storage key; editing the tally in devtools breaks it, and a broken seal *re-derives* the tally from lesson evidence (messages/readings/streak, which leave no evidence, reset — loss-only, surfaced plainly on the AURA page); and (b) **clock guards** — a rolled-back clock earns nothing, the daily cap refills only after ~20 real hours, and streak days need ~12 real hours plus fit inside an 8-grants-per-real-week window, so date-ratcheting caps near the honest rate. Both raise the bar from "type a number in the console" to "read the source and reproduce the seal." Anyone who reads the source still forges everything; the chain remains the only truth.
- The award-at-reply-branch is **not witnessing.** A forged/stub door on `127.0.0.1:7091` satisfies it. Document in the aura-core header that a door reply proves nothing until the door emits a `receipt` entry on the governed chain.
- The real anti-farm lives server-side (§7) and cannot be shadowed client-side: clock-authoritative rate limits, content-hash dedupe on the receipt chain, a genuine witness predicate, and aura-bearing receipts gated behind the vouching web.

### 3.4 The AURA page becomes live + honest

`spatial/app/aura.js`: import `readAura` from aura-core. Add a **today-meter** ("`todayEarned / 40` earned today") so the cap is visible. Name both sources ("N from lessons · M from messages — held here until she witnesses and receipts them"). Add `window.addEventListener('aura-changed', reRender)` re-reading `readAura()` and updating only the bignum + meter (fixes the mount-once staleness: organs mount once and cache, so the balance is otherwise stale). Keep the "provisional · not yet witnessed" badge (aura.js:70) and all explainer copy. **Add one plain line: "this number is local to this device and can be edited by anyone with the console — it means nothing until witnessed."**

---

## 4. Humanity-Proof Surface — an honest ladder, not a proof

The owner asked: "what else can we do with that for now?" The honest answer, folded from the adversarial review: **none of today's local signals are proof.** A bot types better than a human; an LLM writes novel teach-back sentences trivially; a flag-click is machine-dispatchable; streak/challenge timers are client-clock-gameable. So we ship them as an **engagement ladder ordered by *eventual* proof-strength**, all badged provisional, all funneling through the one `award` writer — and we never upgrade the copy to say "proof."

The ladder (weights = eventual proof-strength, all provisional today):

| Signal | Award | Proof-strength today | Ships? |
|---|---|---|---|
| Message | +1 (capped 40/day) | ~none (a bot types) | Today, lowest weight |
| Daily streak | +Fib(min(streak,7)), once/day — **capped at +13; see §10.4, unbounded Fib explodes** | weak heuristic (clock-gameable) | Today |
| Teach-back (free-write using the day's word) | +3 | theater (LLMs generate this) | Today, labelled weak |
| Correct-her (flag/edit a reply) | +2 | theater (self-clickable) | Today, labelled weak |
| Paced lesson challenge (human-plausible completion time) | +5 | weak (timer is a lower bound) | Today |
| Vouch-presence | display-only, **0 award** | real — but needs a second human + chain | COMING |

Design rules baked in from the stress report:
- **Streak** uses Fibonacci (matches the locked rule), keyed on local date with an idempotency key `streak:<date>`. Honestly a heuristic — a clock-roller forges a 300-day streak in one second. Ship it; don't trust it server-side.
- **Vouch stays display-only** with a badge: "ready to be vouched — social witnessing comes with the receipt chain." No local award, because a real vouch is a co-signed receipt.
- **Server witnessing must RE-DERIVE from independent evidence, never promote these client events.** Teach-back and correct-her must not become aura-bearing at witness time without an independent second-human/adjudication signal — otherwise they collapse to "anyone can click / any LLM can type."

Files: everything routes through `aura-core.js` `award`; the AURA page renders the `by`-source breakdown; new signals are just more `award(kind, weight)` calls from existing UI events. Teach-back is a new free-write step in auma.js; correct-her is a flag/edit affordance in chat.js.

---

## 5. The Forge — a non-destructive two-person bond

The owner's intent: "Could there be a forge between two people? … it's like crypto staking — you don't lose your AURA." A forge is the moment two real humans point at each other and say "this one is real," and the chain remembers it. Base AURA is **never lost**; both stake **forged-score** (which *can* temper down) behind each other, so a lie costs standing and a truth compounds.

### 5.1 Honest status — this is the hard one

The adversarial review is blunt: the *provisional preview* is fine and ships honestly, but the **future server-side Forge does NOT survive as designed** (`survives_as_designed: false`). Self-witnessed triangles, Fibonacci temper-farming, trust-laundering rings with one real seam, one complicit trusted human, toothless stake against disposable identities, and no automatic "proven-fake" trigger are all real. **So the Forge ships today only as an explicitly-mock, zero-award preview, and the real economics are COMING with the mitigations in §5.3 as hard requirements — not decoration.**

### 5.2 What ships today — the preview organ

`spatial/app/forge.js` — a full-screen organ `mountForge(root)`, mirroring how `aura` is wired:
- **Explainer** in aura.js's `section()` house language: what a forge IS (a bonded, witnessed link), the four states (proposed → accepted → forged → tempered/broken), what it yields (a *shared forged-score* + a weighted vouch edge — **NOT** extra base AURA you can lose).
- **Local state-machine demo** driven by a mock partner labelled **"example human · not real."** Never render a real-looking hash or witness on a local draft.
- **"Draft a forge" form** storing `status:'draft-coming'` in `state.forges[]` with an invite-code stub; every CTA carries "coming — needs a second human + a witness." **Drafting awards 0.**
- **Anti-collusion panel** that *openly states the attack* (self-forge / sybil ring) and the defenses, as first-class copy — never hidden.
- **Base-vs-forged separation in copy:** base AURA is never lost; the shared forged-score is what's staked and can temper down (so the stake means something).

Registration: add `forge:` to `ORGANS` + a `TABS.organs` row + `forge` to the fullApp gate in shell.js. Add a "Forged bonds" sub-block to aura.js (count + "The Forge →" button; empty-state "no bonds yet — forging is coming").

### 5.3 What's COMING — and the mitigations that are now hard requirements

Real forges are witnessed acts on the governed chain (AUMLOK-only writer; serve.ts stays GET-only). The lifecycle maps to receipts: `forge.proposed` → `forge.accepted` (co-signed by the second human's key) → `forge.forged` (only on a witness condition) → `forge.tempered` / `forge.broken`. The derived forged-score is replayed read-only (a `GET /api/forge` sibling of `GET /api/aura`, reusing the `kiraSummary` previousHash walk at serve.ts:293). **These are out of our lane** — but the spec records them so the chain owner builds them right:

1. **Witness independence, formally:** a valid witness must be at minimum graph distance from *both* forgers, above a hard trust threshold, and its witnessing weight decays if it repeatedly witnesses within one cluster. (Kills the self-witnessed triangle.)
2. **Ring-decay as a HARD CAP, not a multiplier:** a bond's forged-score contribution is bounded by graph distance to the *nearest independent trusted anchor*, and total score reachable through any single seam edge is capped — so one genuine bond can't launder a clique. Decay must asymptotically dominate Fibonacci growth. (Kills temper-farming + one-real-seam laundering.)
3. **Fan-out cost + cap per human:** per-identity limit on active forges and witnessing rate, sharply diminishing forged-score for the Nth bond. (Bounds one complicit human + pre-aged sybils.)
4. **Fix the stake asymmetry:** require a minimum base-AURA cost-of-entry to propose/accept, and make temper-DOWN also penalize the *witness's* standing — so certifying fakes costs a party with something to lose. (Stake must bite the disposable side.)
5. **Automatic decay + re-attestation + challenge path:** an un-refreshed bond decays on its own; the default state of an unattended fake bond trends to zero, not compounds. Any trusted party can force re-witnessing. (Kills "no proven-fake trigger.")
6. **Active cluster detection on the derived read:** community detection, lockstep-timing correlation, shared-operator signals; down-weight/freeze dense clusters. (Ring-detection must be graph analysis, not just static distance.)
7. **Rate-limit temper accrual independent of raw act count**, tied to independently-witnessed acts — so cheap high-frequency lessons can't pump a bond.

---

## 6. Visionary Layer — AURA as living light (historical; superseded by the covenant above)

Ambient reputation made visible, all in our lane, all reusing proven machinery:
- **A glow behind the balance bignum** whose brightness/coherence is a pure function of `readAura().aura` — brighter as you earn, dimmer as you drift (a *display* multiplier via `decayFactor()`, never subtracting stored AURA; "derived, not set").
- **App-wide breath:** a `--aura-glow` CSS variable on the shell root, eased on each `'aura-changed'`, so the wordmark/chip briefly pulse purple on every earn — the "reverse energy" the owner asked for. Cosmetic only, never gates.
- **Seasons/streak/decay** as pure read-time derivations (`streakWeight()` Fibonacci, `seasonOf(ts)`), never stored fields.
- **The Forge constellation** rendered in the same particle engine — two auras spiraling into a bond — driven by mock data today, witnessed data COMING.

Cosmetic-only unlocks (palettes, particle shapes, a shimmering wordmark) reward presence and **never grant authority** — consistent with "AURA cannot sign or gate."

---

## 7. What ships today vs what's coming

**SHIPS TODAY (provisional/local, in our lane, honest):**
- KNVS living-canvas organ: idle curl-noise breathing + three morph targets (trefoil / creature / your-name), forking the renderer; hidden-pause discipline; the `'aura-changed'` purple ripple. Zero server change, zero AURA writes.
- `aura-core.js` single writer + all local rules + `'aura-changed'` event.
- Per-message provisional +1 at chat.js:777 with the spam/format filter, repeat filter, burst damper, and 40/day cap; lessons stay +5 first-completion-only.
- Live-updating AURA page: today-meter, per-source breakdown, the "editable on this device / means nothing until witnessed" honesty line.
- The humanity ladder's local signals (streak, teach-back, correct-her, paced challenge) — all badged provisional, none called "proof."
- Forge **preview** organ: mock partner, draft-coming form (awards 0), anti-collusion panel, base-vs-forged copy.
- Visionary glow + app-wide `--aura-glow` breath; streak/decay/season as display-only derivations.

**COMING (needs the server / receipt chain / a second human):**
- `GET /api/aura` on serve.ts: replay the receipt chain (kiraSummary pattern, serve.ts:293), sum aura-bearing receipts → a **witnessed** balance shown beside the provisional one. **Reconciliation is loss-only:** the witnessed number is the balance; the local tally is a dimmed "pending witness" delta that can only shrink to the witnessed value. Never sum them; a tampered local blob (`aura:1e9`) must still render the witnessed truth. (Add a test for exactly this.)
- Server witnessing that **re-derives** from door-side receipts and **discards** the client's provisional award events — the client tally is never promoted, only reconciled to.
- Server-authoritative anti-farm: clock-authoritative rate limits, collision-resistant content-hash dedupe on the chain (the 32-bit local hash must NOT be reused as a receipt hash), a real witness/quality predicate, aura-bearing receipts gated behind the vouching web.
- `/api/events` SSE (serve.ts:471) emitting "aura witnessed" pushes so KNVS fires a *real* ripple.
- The real Forge lifecycle + `GET /api/forge` with the §5.3 mitigations as hard requirements.
- Real vouching: co-signed-by-Aumlok-key receipts, sybil resistance bootstrapped from a hand-verified human root.
- KNVS app-substrate (a real grown app precipitating out of the field).

All of the "coming" list is **out of our lane** (the chain / serve.ts write path belong to the other engineer + AUMLOK). We ship the display half and record the requirements.

---

## 8. Build order

1. **`aura-core.js` single writer** + refactor auma.js/aura.js onto it. Everything depends on this; it kills the key-drift risk first. (M)
2. **AURA page live-update + honesty line + today-meter.** Small, high-value, fixes the mount-once staleness. (M)
3. **Per-message provisional award at chat.js:777** with the filters/damper/cap. Delivers the owner's "one aura per message" honestly. (S)
4. **KNVS living canvas** (knvs-renderer + flow-field + knvs organ + shell wiring). The wow; independent of the earning work. (M×3 + S)
5. **`'aura-changed'` ripple + app-wide `--aura-glow` breath.** Ties earning to the canvas. (S)
6. **Forge preview organ** + "Forged bonds" sub-block. Teaches the mechanic honestly; awards nothing. (L)
7. Ladder signals (streak, teach-back, correct-her, paced challenge) as follow-on `award` calls. (M)

---

## 9. Completeness check — what the facets missed (now folded in)

- **The Forge future design does not survive adversarial review** (`survives_as_designed: false`). The facets presented the server-side Forge fairly confidently; the stress report shows six distinct high-severity breaks. Folded: Forge ships today as a *zero-award mock only*, and §5.3 lists the mitigations as hard requirements the chain owner must meet before any forged-score is real.
- **The humanity signals are not "humanity-proof."** Facet 3 titled itself that; the stress report shows every local signal is theater or a weak heuristic. Folded: renamed to an *engagement ladder ordered by eventual proof-strength*, copy never says "proof," teach-back/correct-her labelled weak.
- **"Substance gate" / "anti-farming" is overclaiming.** It's a spam/format filter + burst damper. Renamed throughout (owner memory rule: never overclaim).
- **Reconciliation must be loss-only *in code*, with a test** that a tampered `aura:1e9` blob still shows the witnessed balance — the facets said "loss-only" in prose but didn't demand the test or the "never sum" rule.
- **The repeat-filter window was too shallow** (20) and trivially defeated by trailing-digit mutation. Widened to 50 + normalize-off-trailing-digits; still cosmetic.
- **The 32-bit local hash must not become the server receipt's content hash** (needs a collision-resistant hash). Recorded.
- **KNVS hidden-pause is a correctness requirement, not a nicety** — organs stay mounted and hidden via `display:none`, so a leaked rAF is the likely regression. Called out explicitly.
- **A plain "this is editable on your device / means nothing until witnessed" line** — the honesty invariant requires stating *forgeability*, not just un-witnessed-ness. Added to the AURA page.
- **shell.js:169 already includes `knvs` in the fullApp gate** — verified, so that facet edit is a no-op (saves a redundant change).

---

## 10. Tokenomics v2 — personhood × standing (deep pass, 2026-07-07)

*The owner's one-line brief: "the key is that it proves people are human — go deep." This section is that pass. It found one structural flaw in the v1 model, one numerical explosion in the locked rules, and several unpriced attacks. Server-side items remain COMING and out of our lane; the client ships the display half + the capped streak.*

### 10.1 The structural flaw: one number measuring two things

v1 AURA conflates two measurements that behave completely differently:

- **Personhood** — *is there a real human behind this identity?* Near-binary, socially established (vouches, witnessed acts with other humans), and it can go stale (accounts get sold, keys get stolen, people die). It answers the proof-of-humanity question.
- **Standing** — *what has this human done here?* Scalar, act-derived, accrues over time. It answers the reputation question.

Conflated into one number, both halves break: a prolific bot-assisted account out-auras a quiet real human, so "high AURA" stops meaning "human" — and a brand-new verified human starts at zero, so "low AURA" wrongly reads as "suspect." The fix is the standard one from mechanism design: **factor them**.

```
effective_aura(id, t) = standing(id, t) × P(id, t)
```

where `P(id, t) ∈ [0, 1]` is **personhood confidence** — derived from the vouching web and witnessed human-to-human acts, decaying without re-attestation — and `standing` is the act-derived scalar the receipt chain already defines. Everything a consumer of AURA reads (vouch weight, witness eligibility, mesh trust) reads `effective_aura` or `P` directly, never raw standing. A thousand receipts × P=0 = 0. A verified human with two receipts still *is* somebody.

Displayed exactly that way on the AURA page from today: standing (provisional, this device) and personhood (unwitnessed · 0 vouches — the chain's to grant). Two axes, never summed.

### 10.2 The north-star invariant: sybil-boundedness

Every mechanism below serves one formal target, stated once so the chain owner can test against it:

> **Subadditivity of personhood.** For any real human H controlling identities `i1..ik`:  `Σ P(ij) ≤ P*` — the total personhood confidence reachable by splitting yourself across identities never exceeds what one honest identity earns. Creating a second identity must be worth *less* than nothing (it splits your vouchers' finite weight and exposes you to slashing).

If this holds, "one aura, one human" is real: votes, allocations, and anti-spam gates weighted by `P` cannot be farmed by multiplying identities. Every §5.3 Forge mitigation and every rule in §10.3 is an enforcement lever for this single line.

### 10.3 Vouch economics — making fakes negative-EV

A vouch is the atomic unit of personhood. Its economics must make vouching for a fake a *losing trade*:

1. **Finite vouch budget.** Each identity holds a small number of active vouch slots (e.g. 8), refreshing slowly (e.g. one per 30 days). Vouching is spending, not clicking. A voucher's weight divides across their active vouches — vouching everyone means vouching no one.
2. **Weight flows through P, not standing.** `vouch_weight(A→B) ∝ P(A) / active_vouches(A)`. High standing with stale personhood vouches for nothing — which also makes *bought accounts* worthless for laundering (the buyer inherits standing but P decays the moment the real human's living graph goes quiet).
3. **Slashing with upstream propagation.** When an identity is adjudicated fake (challenge path, cluster detection), every voucher loses `λ × (P granted)`, and *their* vouchers lose `λ² × …`, with `λ ≈ 0.5` decaying up the chain. The inequality that must hold for farming to be negative-EV: `p(caught) × λ × P_staked > P_granted_to_fake` — i.e., detection probability times the stake burned must exceed what the fake gained. Detection probability is not hand-waved: it comes from the §5.3 cluster analysis, lockstep-timing correlation, and the open challenge path, and the parameters (λ, slot counts, thresholds) are tuned to keep this inequality true *by construction*, not by hope.
4. **Liveness decay + re-attestation.** `P` decays with a half-life (~90 days) unless refreshed by new witnessed human-to-human acts. Dead accounts, sold accounts, and stolen keys all trend to P→0 by default — the *unattended* state of every identity is "not provably human anymore," which is the only safe default a proof-of-humanity system can have. Standing is never deleted by decay; it just stops counting until its human shows up again (loss-only display discipline, same as §7).
5. **Bootstrap from a quorum, not a root.** Personhood paths must trace to **≥2 independent founding humans** (hand-verified, geographically/socially disjoint). One compromised root then bounds damage instead of forging the whole web; root rotation is a governance act on the chain.
6. **Privacy of the graph.** The vouch web is a social graph — publishing it doxxes relationships. On-chain, vouch edges are salted commitments (`H(voucherId ‖ voucheeId ‖ salt)`); `P` is derivable by the chain owner and disclosed as a scalar; the raw edge list is selectively disclosable by its participants only. Proof-of-humanity must not cost the humans their privacy — else honest people opt out and the web hollows.
7. **Account rental is the residual attack** (non-transferability can't stop someone lending their whole account). Priced rather than pretended away: renting out an account risks the owner's own P (slashing propagates to them personally), the renter can't refresh liveness with the owner's living social graph, and cluster detection sees the behavioral discontinuity. Rental is negative-EV for anyone whose P is worth renting.

### 10.4 The Fibonacci explosion (fixed in the locked rules)

v1 locked "+Fib(streak) once/day." Fibonacci is exponential: Fib(30) = 832,040/day at one month; Fib(300) ≈ 2×10⁶² at ten months. Three failures follow: the economy collapses to "longest streak wins" (all other acts round to zero), a clock-rolled streak becomes the single best farm in the system, and any later witnessed re-derivation inherits the explosion. **Adjustment: streak bonus = Fib(min(streak_days, 7)) — the sequence 1, 1, 2, 3, 5, 8, then +13/day forever.** Consistency still compounds early (the felt reward curve), the ceiling keeps a year-long streak worth ~⅓ of daily engaged use rather than 10⁶⁰× it, and clock-rolling caps out at +13/day of *provisional* shadow. Implemented in `aura-core.js` today (client, provisional, honest about clock-gameability); recorded here as the number the chain must also use.

### 10.5 What AURA is *for* (utility without authority)

"Reputation, not authority — never signs, unlocks, or gates" stays absolute for the *machine*: no AURA threshold ever moves a write lane; only AUMLOK does. But a proof-of-humanity signal nobody consumes is decoration. The consumption model, explicitly: **AURA never gates the machine; it weights the society.**

- **Vouch weight** — your vouch matters in proportion to your `P` (§10.3.2). The web is self-referential the way all trust is.
- **Witness eligibility (COMING)** — the chain requires witnesses above a `P` threshold at graph distance (§5.3.1). Reading, not gating: the chain owner's rule consumes the derived value.
- **Mesh legibility (COMING)** — when nodes federate, `effective_aura` is the cross-node answer to "is there a person there?" — spam pricing, one-human-one-vote surfaces, fair allocation.
- **Human-to-human signal (today)** — the Forge shows both parties' axes before a bond; people decide. The token's first utility is simply that humans can *see* each other's realness with numbers that can't be bought.

### 10.6 Client honesty (what today's code may and may not claim)

Everything in §10.3/10.5 that needs the chain stays COMING and is labelled so on the page. What ships client-side today: the two-axis display (standing provisional / personhood unwitnessed·zero), the capped-Fib streak in `aura-core.js`, and copy that states the invariant and the vouch economics as *design*, never as a live guarantee. The forgeability line stays on the page verbatim. No local signal is called proof — the ladder discipline of §4 is unchanged.

---

## 11. Open Weave reconciliation — the political-scale vision vs the build (2026-07-07)

*The owner shared the current Open Weave revision (now at `docs/OPEN_WEAVE.md`, superseding `docs/archive/OPEN_WEAVE_V2.md`): AURA at political scale — value as circulation on a manifold, governance as sheaf coherence, extraction as topological sinks, cross-referenced with GHP. This section is the honest reconciliation: what the build already embodies, where the vision genuinely corrects the build, and what each correction means concretely. The vision is the destination; §§1–10 are the scaffold; nothing below relaxes the honesty rails.*

### 11.1 What already aligns (name the convergences, don't re-derive them)

| Open Weave claim | Where the build already is |
|---|---|
| "Aura is a fingerprint of passage — unique, non-transferable, legible only to the topology" | Non-transferable, earned-only, derived-never-stored (§1, §3) |
| Aura is **path-dependent** (the α form integrates along paths, never a potential) | The hash-chained receipt ledger IS a path record — the balance is literally an integral along your history; the scalar is a projection of the path, not the object itself |
| "The change is locally witnessed — by the nodes that were touched" | The vouching web + witness predicate (§10.3); witnesses at graph distance (§5.3.1) |
| Circulation, not accumulation — "flow or fade" | Personhood liveness decay (§10.3.4): unattended identities trend to "not provably human" |
| Authority from coherence, never from office | §10.5's line holds at both scales: AURA never gates the machine (AUMLOK only); it weights the society. Open Weave's "influence flows to coherent nodes" is the society-weighting claim at full political scale — same invariant, larger radius |
| The five power-invariants (capital-legislation loop, information asymmetry, accountability sinks…) | The receipt chain is decision provenance; loopback-first + owner-readable state is the information-symmetry posture; the sink diagnostic below is the anti-accountability-sink instrument |

### 11.2 The three genuine corrections (the vision is right; the build must move)

**1. Acts vs shape-change — the Goodhart correction.** Open Weave's sharpest engineering claim: *"Aura doesn't attach to the act; it attaches to the changed shape. You can perform care, but if the topology didn't change, there's no trace."* Today's earning loop counts acts (+1 message, +5 lesson) — exactly the "counting care" trap the doc names, and independently the same failure our adversarial review found (a bot types; performance of care outcompetes care). **Correction, recorded as a chain-side hard requirement:** the witness predicate must score **graph-observable change**, not act counts — did someone unreachable become reachable, did information flow improve, did neighborhood cohesion rise (betweenness/component deltas on the interaction+vouch graph). This converges with the sybil work: cluster detection (§10.3.3) and shape-change measurement are the *same* graph analysis. Client act-counting remains what §3 already says it is — a motivational scaffold, discarded at witness time. Corollary for the client today: the "+N" toasts are the map-eats-territory risk in miniature — keep them small and ambient, never leaderboards, never per-act totals as targets.

**2. Accumulation vs circulation — the hoarding correction.** Open Weave: hoarded Aura should deform your local geometry until *"the network routes around you."* v2 standing accrues monotonically forever — personhood decays, standing never does. **Correction (COMING, read-time derivation, never a stored field):** effective weight gets flow-tempered. The doc's own fixed point (§A.12) gives the shape: a node's give:receive care-ratio in a healthy community sits near φ; outside the band **[1/φ, φ]** effective weight tempers — receiving without giving reads as hoarding (curvature), giving without receiving reads as depletion (burnout), and both are flagged as *structural* conditions, not moral ones. Alongside it, the **sink diagnostic**: divergence of aura-flow at a node as a first-class chain read (`flow in ≫ flow out` = extraction made visible as geometry, per §A.8). Both are derivations over the same receipts — no new storage, no new authority.

**3. The scalar is a view, never the substrate — the fungibility correction.** Open Weave: *"it can't be a token: tokens are fungible, but each care-trace is specific to the wound it healed."* The build's answer, now stated as a rule: **what is stored and witnessed is always the specific trace (the receipt, with its who/why/what-changed); every scalar — standing, personhood, effective aura — is a lossy projection computed at read time for legibility.** Any consumer that needs the richness reads the traces (under the §10.3.6 privacy commitments), never the number. No protocol decision may be made *only* expressible on the scalar if the traces contradict it.

### 11.3 What stays scaffold vs what the appendix licenses

Open Weave's appendix is explicitly SCAFFOLD-not-THEOREM (its §A.15), and this spec inherits that discipline: the Fisher-metric, sheaf-cohomology and thermodynamic framings are *design compasses* — they tell us which observables to build (graph deltas, flow divergence, give/receive ratios) — not proofs that the mechanisms work socially. Where Open Weave and GHP are conjectural, the build stays conservative: everything in §11.2 lands as read-time derivations over witnessed receipts, reversible by re-derivation, gated behind the same chain the rest of Aukora trusts. The GHP cross-references stay in the GHP lane's canon; this spec only consumes the analogy.

---

## 12. The representation rule — coherence is a resonance, not a number (2026-07-07)

*Resolves the question the owner raised: "maybe AURA shouldn't be counted in numbers — but then how do we register coherence?" The full synthesis (metals, Platonic solids, the icosahedron→sphere snap, cymatics, the φ/π split) lives in `docs/COHERENCE_GLYPH.md`; this section is the operational rule it produces.*

**Three consumers, three representations — and only one of them is ever a published number:**

1. **The protocol** (witness eligibility, vouch weights, sybil detection) consumes **predicates and orderings**, not scores: *"is P above the witness threshold?"* (yes/no), *"does this vouch outweigh that one?"* (an ordering). Numbers exist transiently *inside* those computations — the Fisher/KL machinery of §A is numeric, unavoidably — but they are instrument readings, never persisted balances and never displayed. (Voltages run your neurons; nobody publishes them.)
2. **Other humans** consume **legibility**, and here a number actively poisons the well: a visible score invites ranking and optimization-toward-the-metric — the exact "performance of care" failure of §11.2.1. The honest rendering is the **coherence glyph** (`spatial/app/coherence-glyph.js`): a cymatic figure whose gold nodal lines and living flow read as coherence the way a face or a chord reads. Its imprecision is the anti-Goodhart *feature* — you cannot grind toward a target you cannot read a number off. (Precedent: PageRank was always an internal float; the one time it shipped as a 0–10 toolbar number it spawned an SEO-gaming industry, so the display was killed and the computation kept. Compute inside, render as figure outside.)
3. **The person themselves** consumes **felt feedback**: the figure sharpens, the field brightens, a bond's constellation tightens. No "+1". (This is why the earn-toasts stay ambient, never leaderboards — §11.2.1.)

**The load-bearing invariant, now stated as a rule:**

> **The scalar is a view, never the substrate** (this is §11.2.3, sharpened). What is stored and witnessed is always the specific **trace** (the receipt, with its who/why/what-changed). Every scalar — standing, personhood, effective aura — is a lossy projection computed at read time for a *machine* that needs a comparison. **No coherence number is ever published to a human.** Humans get the trace (on dispute) or the figure (at a glance). And there is a maximum meaningful resolution to any such figure (the "icosahedral limit," `COHERENCE_GLYPH.md` §2): pushing for more precision than a resonant figure carries is not just Goodhart-unwise, it is geometrically incoherent — squaring the circle. Beyond that resolution the only honest representation is the lived flow itself.

**Client status today:** the AURA hero renders the glyph from a **provisional** coherence (local activity breadth + streak liveness — a labelled stand-in) and a stable per-device signature. The witnessed glyph is drawn from the chain's coherence-topology (the graph-shape-change observables of §11.2.1) and is COMING with it. The provisional standing tally is demoted to a small, honestly-badged figure beside the glyph — kept only because §3's spam-damper needs *something* to accrue; it is never the headline and never called coherence.

---

*Everything above is buildable in `spatial/app/*` today except the explicitly-labelled COMING items, which belong to the governed chain and the other engineer's lane. The honest posture holds end to end: the canvas renders and never witnesses; the counter accrues and never mints; the truth is always the chain's to speak.*