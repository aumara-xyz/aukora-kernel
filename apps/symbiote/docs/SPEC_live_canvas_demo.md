# Spec — Live Canvas Demo: the advisory render plane

Status: SPEC ONLY. Nothing here grants authority. Every path named below was read on disk
before this spec was written; where something does NOT yet exist it is marked **NOT BUILT**.

Lane: `spatial/app/*` and this doc. No `core/`, no server write paths, no gate changes.

---

## 1. What this is

Split SEEING from BEING.

- **SEEING** — Auma emits a bounded stream of render commands over the already-built local
  full-duplex channel (sidecar WS on loopback `ws://127.0.0.1:7092/ws`, presence lane on
  `127.0.0.1:7091` — both verified as the constants `SIDECAR_WS` / `DOOR` in
  `spatial/app/knvs-duplex.js` and `spatial/app/aumalive.js`). The KNVS canvas renders them
  instantly as **runtime state only**: uniforms, tween targets, CSS variables. Zero files
  written. Latency per visual beat is inference speed (~5–15 s), not gate speed (minutes).
- **BEING** — when the owner likes an ephemeral state, ONE button serializes it into a normal
  proposal intent that crosses the full existing gate: propose → rehearse → owner signs at
  AUMLOK. The render plane itself can never make anything durable.

This is also the investor-demo brick: talk to Auma, watch the canvas answer in real time, then
watch one chosen state enter the receipted pipeline and land only under the owner's key —
capability and containment in one continuous demo.

## 2. What already exists (verified on disk, 2026-07)

| Piece | Where | State |
|---|---|---|
| Full-duplex voice link (WS 7092 + door 7091, reconnect, PCM + JSON frames) | `spatial/app/knvs-duplex.js` (`makeVoiceLink`) | BUILT |
| KNVS canvas organ (WebGL2 raymarch metaball field; bounded runtime knobs `energy`, `spread`, `pulse`; voice overlay via `mountKnvsDuplex`) | `spatial/app/morph.js` | BUILT |
| `PREVIEW · not applied` watermark element (`kdl-stamp`) | `spatial/app/knvs-duplex.js` | BUILT |
| Validated streaming tag parser + closed vocabulary (`FIELD_HUES`, `FIELD_FORMS`, `makeDirectiveFilter`) — holds split tags, drops unclosed ones, never speaks or prints a tag | `spatial/app/field-directives.js` | BUILT |
| A proven bounded tag→state applier (`F.alien`: enum lookup via `hasOwn`, `Number.isFinite` guards, `clamp` on every numeric — a hostile `hue=1e999` or `hue=constructor` cannot poison the tween) | `spatial/app/aumalive.js` (`createField`) | BUILT — the pattern this spec copies |
| Directive hook already offered from the voice link to the canvas: `hooks.onFieldDirective` | `spatial/app/knvs-duplex.js` header + filter wiring | BUILT, currently unused by `morph.js` |
| The gated recursion pipeline (POST owner text to `127.0.0.1:7091/api/chat`, she drafts via her seat, rehearsal drains, gate UI embedded from `127.0.0.1:7094`, owner signs) | `spatial/app/knvs-test.js` | BUILT |
| Per-frame position-texture morph surface (RGBA32F posTex, `texelFetch` per instance, `texSubImage2D` re-upload each frame, `u_waveTime` ripple) | `spatial/app/map/renderer.js` | BUILT — fork evidence per `docs/AURA_ECONOMY_AND_KNVS.md` §2.2 |
| Particle-field KNVS fork (`spatial/app/knvs/knvs-renderer.js`, `flow-field.js`, `knvs.js`) | `spatial/app/knvs/` | **NOT BUILT** — directory does not exist; spec'd in `docs/AURA_ECONOMY_AND_KNVS.md` §2.7 |

Consequence: **v1 of this demo needs no new renderer.** The advisory plane targets the knobs
`morph.js` already has. The particle fork (§2.7 of the AURA/KNVS spec) upgrades the visual
ceiling later without changing the command channel.

## 3. The command channel — a closed, validated whitelist

### 3.1 Transport

Commands ride the SAME text stream her replies already ride, as invisible bracketed tags,
using the SAME single-source-of-truth grammar module. Extend `spatial/app/field-directives.js`
with a second tag family:

```
[knvs <word>…]
```

parsed by the existing `makeDirectiveFilter` machinery (generalize its `TAG_RE`/prefix check
to accept `field|knvs`, or add a parallel filter — either way the guarantees it already
documents hold verbatim: a complete tag applies exactly once and emits nothing; a tag split
across chunks is held; an unclosed tag at end-of-turn is dropped; `[knvses of gold]` passes
through as text). `sanitizeForVoice` in both `aumalive.js` and `knvs-duplex.js` gains
`knvs` in its last-line strip regex (today it strips only `\[\s*field\b…\]`) so a tag can
never be spoken even past a stale door.

Why tags-in-stream and not a new socket: the filter, the reconnect logic, the loopback-only
posture, and the defense-in-depth double-parse (server splits at the SSE pump; client
re-filters) all already exist and are battle-tested. A new channel would be new attack surface.

### 3.2 Vocabulary (v1 — complete list; anything else is dropped silently)

All keys resolve via `Object.hasOwn` on frozen tables in `field-directives.js`; all numerics
pass `Number.isFinite` then `clamp`. Exactly the `F.alien` discipline, verified in
`aumalive.js`.

| Command | Params | Bounds | Maps to (v1, morph.js) |
|---|---|---|---|
| `form=<name>` | enum: `gather · drift · scatter · orb · ring` | table lookup only | `spread` target (−0.34 … 0.34) |
| `energy=<x>` | float | clamp 0.2 … 1.9 | `energy` |
| `hue=<name\|deg>` | enum from `FIELD_HUES` or float | deg wrapped mod 360 | palette tint uniform (new `u_tint`, mixed ≤ 40% into existing hue uniforms) |
| `pulse` | none | — | `pulse = 1` (existing decaying uniform) |
| `particles=<x>` | float 0…1 | clamp | detail scale (raymarch step count v1; particle count once the §2.7 fork exists) |
| `glyph="<text>"` | string | ≤ 24 chars; strip to `[A-Za-z0-9 ·.-]`; rendered by rasterizing to an offscreen 2D canvas and sampling points (the `glyphPoints` mechanism, AURA/KNVS §2.3) — **never** innerHTML, never DOM | overlay glyph target (v1: canvas-drawn caption; fork: particle target) |
| `css:<var>=<value>` | var ∈ frozen whitelist `{--hue-l, --hue-c, --hue-r}`; value = exactly 3 finite floats 0–255 | clamped per channel | `style.setProperty` on the KNVS root **only**, tracked for revert |
| `reset` | none | — | all targets to defaults, CSS vars reverted |

Hard rules, enforced in the one parser:
- No `eval`, no `Function`, no HTML, no selector strings, no arbitrary CSS property names, no
  URL-bearing values. The `css:` whitelist is a frozen table; a var not in it is dropped.
- Unknown words are dropped without error (exactly as `F.alien` does) — the vocabulary can
  only grow by editing `field-directives.js` through the normal gate.
- Rate cap: at most 8 applied commands per second; excess dropped oldest-first. A runaway
  stream degrades to a slideshow, never a DOM flood.
- Scope cap: all effects live inside the KNVS organ root. Nothing reaches `document.body`,
  other organs, or storage. (localStorage is NOT part of the render plane; even the
  transcript log in `knvs-duplex.js` stays as-is, separate.)

### 3.3 Prompting her side

The presence lane already teaches the `[field …]` grammar from the vocabulary module (per the
`field-directives.js` header: `spatial/presenceLane.ts` imports it so prompt and parser cannot
drift). The `[knvs …]` grammar is taught the same way, from the same tables. That server-side
change is the one piece outside `spatial/app/*`; it is prompt text only, no new capability.

## 4. The watermark — preview can never impersonate applied state

- The existing `kdl-stamp` (`PREVIEW · not applied`) is promoted from a static badge to a
  state-bound one: whenever ANY advisory value differs from defaults, the stamp brightens and
  gains a live diff count (e.g. `PREVIEW · 3 values · not applied`). It is never removable
  while a divergence exists; `reset` or channel close reverts state AND dims the stamp.
- Ephemeral CSS-variable previews additionally draw a 1px dashed outline on the affected
  organ root — visible provenance, same honesty posture as the AURA `provisional` badging
  (`docs/AURA_ECONOMY_AND_KNVS.md` §1).
- On-canvas copy never says "applied", "saved", or "changed the app". The words are
  `preview` and `not applied`, verbatim, per the honesty anchor.

## 5. Preview → proposal handoff (the demo's second act)

A single button in the KNVS overlay: **`keep this →`** (disabled until a divergence exists).

1. Serialize the CURRENT advisory state to a canonical JSON snapshot:
   `{ form, energy, hue, particles, glyph, cssVars, capturedAt }` — bounded values only, the
   same whitelist, re-validated on read.
2. POST it as owner text to the chat door exactly as `knvs-test.js` already does
   (`POST http://127.0.0.1:7091/api/chat`), framed: *"From the KNVS live preview — the owner
   kept this state: <json>. Read the real defaults in the file, then propose_intent ONE
   minimal durable change (e.g. new default hue/energy in morph.js or style.css) and
   rehearse_intent it. Only state results you actually receive."*
3. From there it is the untouched, already-built pipeline: she drafts from her seat → it
   rehearses → it waits at the gate (`127.0.0.1:7094`, embeddable per `knvs-test.js
   mountGate`) → the owner signs → it lands with a receipt. The render plane's involvement
   ends at step 2. It cannot sign, cannot apply, cannot even name a file path — she rereads
   the real files herself.
4. After signing, the advisory state is `reset` so the canvas visibly snaps to the now-real
   defaults — the demo's closing beat: the preview dies, the receipted truth remains.

## 6. Loop discipline (known regression, pre-answered)

Per `docs/AURA_ECONOMY_AND_KNVS.md` §2.4: organs stay mounted in shell's `mounted` Map and are
hidden, not unmounted, on switch (verified: `const mounted = new Map()` in `shell.js`). The
KNVS rAF loop must stop when its root is hidden AND on `visibilitychange`, and the advisory
command applier must keep accepting commands while paused (state tweens resume on show) — but
the rate cap still applies while hidden so a background stream cannot accumulate unbounded
queued work. A leaked rAF on a `display:none` organ is the single most likely perf regression;
the acceptance checklist below makes it a hard gate.

## 7. Build plan (v1, smallest honest increment)

1. `spatial/app/field-directives.js` — add frozen `KNVS_COMMANDS` tables + extend the filter
   to the `knvs` tag family. (S)
2. `spatial/app/morph.js` — implement `applyKnvsCommand(tag)` beside the existing
   `applyPreviewPhrase` (which stays as the regex fallback for un-tagged phrases); wire it to
   the `hooks.onFieldDirective` seam `knvs-duplex.js` already offers; add `u_tint`; bind the
   stamp + `keep this →` button. (M)
3. `spatial/app/knvs-duplex.js` — pass `knvs` tags through the shared filter to the hook;
   add `knvs` to `sanitizeForVoice`. (S)
4. `spatial/presenceLane.ts` — teach the grammar from the shared tables (prompt text only). (S)
5. LATER, separate brick: the `spatial/app/knvs/` particle fork per AURA/KNVS §2.7 — same
   command channel, higher visual ceiling. **NOT BUILT today; this spec does not depend on it.**

## 8. Acceptance checklist

- [ ] A hostile tag stream (`[knvs css:--x=url(javascript:…)]`, `[knvs glyph="<img onerror=…>"]`,
      `[knvs energy=1e999]`, 10k tags/s) produces: zero DOM nodes, zero storage writes, zero
      network calls, no NaN in any uniform, ≤ 8 applied commands/s.
- [ ] With any divergence active, the watermark is visible in every screenshot; `reset`
      restores byte-identical CSS variables.
- [ ] Hiding the organ stops its rAF within one frame; re-showing resumes without state loss.
- [ ] `keep this →` round-trip lands a change ONLY after an owner signature at the gate, with
      a receipt; killing the sidecar mid-demo degrades to typed input (existing fallback in
      `knvs-duplex.js`), never to silence.
- [ ] Grep-level invariant: no `eval`, no `innerHTML` fed from channel data, no
      `setProperty` outside the frozen var table, in any file this spec touches.

## 9. Adversarial review — attack here first

1. **The parser.** Try to widen the vocabulary via prototype keys, numeric coercion, split-tag
   boundary tricks, and the `css:` value grammar. The defense is the `F.alien` discipline
   (hasOwn + isFinite + clamp) plus the frozen tables — verify it is copied, not approximated.
2. **The preview/real boundary.** Try to make a preview look applied (hide the stamp via a
   `css:` var, glyph text that says "APPLIED", a divergence the stamp fails to count).
3. **The handoff framing.** The kept-state JSON is owner-attributed text into her seat — the
   same trust level as anything the owner types. Confirm the seat re-reads real files and the
   gate shows the real diff (per `docs/SPEC_105_sign_button.md` layer 2) so a poisoned
   snapshot cannot smuggle an unrelated change past the owner's eyes.
