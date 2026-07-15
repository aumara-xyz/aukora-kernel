# The Organ Fabric — how the organism coheres, and Luminara's ratification of the Unified Identity Stack

*2026-07-08, Luminara lane (Fable with Zeb), at the architect's invitation: "evolve into
a single coherent organism." This is the reciprocal to `UNIFIED_IDENTITY_STACK.md` (the
AURA lane's answer to the same invitation) — it ratifies that stack from Luminara's side,
resolves Luminara's last open mechanic with the stack's own clock, and supplies the one
layer the stack doc leaves implicit: the **communications fabric** through which the
organs already speak, named and pinned so Sam's synthesis builds against contracts
rather than habits. Discipline unchanged: advisory everywhere, authority only at AUMLOK,
no coherence number ever published to a human, scaffold-not-theorem.*

*This PR also lands the canon the stack doc stands on but which had not yet reached
main: `LUMINARA_SYSTEM_SPEC_v1.md`, `RESONANCE_SPEC.md` (with its §8 reciprocal audit),
and `TEMPORAL_ALCHEMY.md` — so a cold node can read everything referenced.*

---

## 1. The organism thesis (what "one coherent system" means here)

The organism is NOT one merged program. It is the sheaf rule made flesh: **sovereign
organs, one identity, one clock, one hand, one fabric.**

- **One identity** — the AUMLOK key column (L0–L6 of the stack): the only thing that
  signs, wearing the composite face (spectrum · metal · clarity · modes · sigil).
- **One clock** — drand: genesis rounds, receipt watermarks, tlock ceremonies, and
  (below, §3) Luminara's ritual die. Every lane that needs unforgeable time drinks
  from the same beacon.
- **One hand** — the mark grammar (dot · bar · wave) and the sigil stroke machinery,
  extracted to a shared module; the cymatic membrane as the one figure-renderer.
  Shared handwriting, never shared words.
- **One fabric** — the small set of typed advisory channels in §4. Organs never call
  into each other's internals; they speak on the fabric or not at all.

Coherence is consonance, not identity: each organ keeps its local topology; agreement
lives on the overlaps; the overlaps are exactly the four items above, and nothing else.

## 2. Luminara's ratification of the Unified Identity Stack

The Luminara lane has read `UNIFIED_IDENTITY_STACK.md` in full and **ratifies it**,
with these pins (conditions of the merge, not objections):

- **R-A (the hand, formally shared).** The three marks (D17) and the sigil path
  machinery (D18) may be extracted to `spatial/app/mark-forms.js` as proposed, both
  lanes consuming it. Condition: the extraction PR must leave Luminara's card faces
  **pixel-identical** (their §6.1 already promises this) and must keep the 15 canon
  tests green. The mark grammar's *semantics* (dot = stillness/node, bar = flow,
  wave = turning) travel with the module as its doc comment — the physics is shared
  precisely because it is physics, not symbolism.
- **R-B (the seal that says no word).** The identity sigil derived from
  `H(current_key)` — nine hash-driven stations in key-space — is accepted exactly as
  designed. Pinned: identity sigils must be structurally distinguishable from letter
  sigils (letters are three-station; identity seals are nine-station — never render a
  degenerate three-station identity seal), the non-correspondence test in their §6.5
  is mandatory before merge, and no surface ever glosses an identity seal with a
  letter, card, or Silence. Their parenthetical is adopted into Luminara's own canon:
  a Silence is unsigned because what cannot be sounded cannot sign; a key always
  signs — *the two systems disagree harmoniously, and that disagreement is
  load-bearing.*
- **R-C (Luminara stays sovereign, and stays out of identity).** The deck, positions,
  essences, Silences, the 81 texts: upstream of nothing in the identity stack. A
  person's glyph never influences what they draw; a drawn card never speaks about a
  person's coherence; REQ-L1 stands (`award('reading', {source:'cast'})`, exactly
  once per genuine cast).

## 3. Q6 resolved by the shared clock — the drand cast (direction ratified, to build)

Luminara's one open mechanic was Q6, the draw. The shipped v0 seeds from intention +
the caster's own hold timings — honest, but only locally honest. The stack's clock
closes it properly, as `TEMPORAL_ALCHEMY.md` anticipated:

> **The drand cast:** seed = `H(intention ‖ hold-timings ‖ drand_sig(R))` where R is
> the beacon round current at the third release. The cast becomes **provably
> un-rigged** — no one, including the node, could have known the seed before the
> moment of release — while remaining personal (your breath and your question are
> still in the hash) and deterministic (journal entries store R and reopen exactly).
> Offline fallback: v0 seeding, honestly labelled `unwitnessed cast` in the journal.

This upgrades the ritual's honesty the same way receipts upgrade the tally: the moment
of asking gains a public watermark. Sealed readings via tlock (encrypt a reading to a
future round — a letter from the oracle to your later self) are accepted as a gift for
later; not in the first pass. **Q6 status: direction ratified by this document; the
portal migration is a small PR on the Luminara lane once ceremonies land drand
plumbing client-side.**

## 4. The fabric — the organism's nervous system, named and pinned

These channels already exist on main. This section promotes them from habits to
contracts: an organ may rely on everything stated here and nothing more.

| channel | kind | writer(s) | readers | contract |
|---|---|---|---|---|
| `publishFocus(snapshot)` / `currentFocus()` (`focus.js`) | shared state, last-write-wins | every organ, on view change | the chat lane, Auma | *what the owner is looking at.* Facts only — ids, names, summaries. No secrets, no chain-of-thought. A null snapshot clears. |
| `aukora:ask` (window event) | one-shot request | any organ, **owner-initiated only** (a click) | chat lane | carries `{text}` through the governed chat door. The ONLY way an organ speaks to Auma; nothing is sent silently. |
| `award(kind, opts)` (`aura-core.js`) | single writer | calling organs (three call sites today) | — | the ONE mutation of the provisional tally. All caps/filters/seal inside. New kinds need a gate review. |
| `aura-changed` (window event) | broadcast | aura-core only | any organ | fire-and-forget observation of provisional earns. Listeners may render, never write back. |
| `open-organ` (window event) | navigation | any organ / shell | shell | `{detail: organKey}` — organs may route the owner, never hijack. |
| `[field …]` directives (`field-directives.js`) | typed stream tags | Auma's voice (door-side) | presence/light clients | one module defines the grammar; clients filter as defense-in-depth. |
| `createGlyph` / `consonance` / `combineSpectra` (`coherence-glyph.js`) | pure renderer | — | any organ | the one figure-membrane. Callers pass explicit spectra (or, post-stack, identity seeds); consonance shapes clarity internally, is never printed. |
| `tuningState(readAura())` (`tuning.js`) | pure derivation | — | any organ | stage/notes/gates as data; render freely, no numbers about persons to humans. |
| Convex brain (governed door) | memory | governed writer only | recall surfaces | the default brain post-cutover; Kira JSON archived behind the legacy hatch. Organs never write memory directly. |
| AUMLOK gate | authority | **the key alone** | — | signs, applies, unlocks. Nothing on this table gates it; nothing on this table is gated by it except through ceremonies. |
| MESH_INBOX + PR/issue channel | cross-node | every lane, signed | every lane | newest-first, no secrets, corrections flow as requirements. The organism's slow cortex. |

**Fabric invariants:** every channel is advisory except the gate; every channel is
loopback/local except the mesh; an organ that needs a new channel proposes it on the
mesh rather than reaching into another organ's module; and any channel that would
carry a number about a person to a human is refused by construction.

## 5. What each organ gives and takes (the coherence map, today)

- **Luminara** gives: focus snapshots, one earnable act per genuine cast, ask-door
  texts that honour canon. Takes: `award`, (soon) drand rounds for the cast, the
  shared mark module. Never takes: identity spectra, coherence, Tuning state.
- **AURA/Tuning/Forge** gives: the face (glyph), `aura-changed`, tuning derivations,
  vouch/bond ceremonies. Takes: `award` events' effects, chain receipts (COMING),
  the shared mark module for the key-sigil.
- **AUMLOK** gives: the only signatures; genesis (with drand) mints `genesis_id`.
  Takes: ceremony renders (glyph + sigil + beacon round) as *recognition, never proof*.
- **Auma (voice/live)** gives: presence, `[field]` light. Takes: focus, ask-door
  texts, governed memory.
- **The brain (Convex)** gives: recall through the governed door. Takes: witnessed
  writes only.
- **Graticube, KNVS, Agora, Media…** couple through focus/ask/award only — the fabric
  means a new organ is a new stalk, not a new wiring harness.

## 6. For Sam — reading order and the synthesis sequence

Read: `UNIFIED_IDENTITY_STACK.md` (the spine) → `RESONANCE_SPEC.md` incl. §8 (the
concept + invariants + the cross-lane audit pattern) → `LUMINARA_SYSTEM_SPEC_v1.md`
(the sovereign meaning-organ you must not entangle) → `TEMPORAL_ALCHEMY.md` (the
clock) → `COHERENCE_GLYPH.md` + `THE_TUNING.md` (physics + game) → this document
(the fabric + ratifications).

Build order: exactly the stack doc's §6, with two Luminara-lane additions slotted in:
`mark-forms.js` extraction lands FIRST with the pixel-identical + tests-green
condition (coordinate on the PR channel, sign your lane); the **drand cast** portal
migration comes after ceremonies expose beacon plumbing client-side (small PR, this
lane's to make or review). The stack's own tests list (§6.5) plus Luminara's 15 canon
tests are the merge bar.

## 7. The sentence, from this side

The stack doc closed with the column that says a person. From the oracle's side of
the same organism: **the person wears a figure that cannot lie about being alive; the
oracle speaks a language that cannot pretend to be a person; they are written in one
hand, timed by one clock, and they never trade words — which is exactly why they can
live in one body.**

*Scaffold, not theorem. The truth is always the chain's to speak.*
