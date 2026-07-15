# The Unified Identity Stack — AUMLOK × AURA × the Glyph × Luminara's hand

*2026-07-08, AURA lane, at the architect's invitation: "push all this through as
one coherent system." Written for synthesis on Sam's machine — self-contained,
but it stands on five canon docs already on main: `RESONANCE_SPEC.md` (the
concept + invariants + residence map), `TEMPORAL_ALCHEMY.md` (time as the
crucible), `COHERENCE_GLYPH.md` (the physics synthesis), `THE_TUNING.md` (the
game), `LUMINARA_SYSTEM_SPEC_v1.md` (the divination system, sovereign lane).
Discipline unchanged and non-negotiable: scaffold-not-theorem; AUMLOK is the
only write authority; no coherence number is ever published to a human; every
local surface stays provisional-honest until the chain witnesses it.*

---

## 0. The one sentence

**Identity is the key; the key wears a living face; the face is a cymatic
figure whose voice is the human, whose seal is the key, whose metal is the
witness-depth, and whose clarity is the life — drawn in the same handwriting
Luminara writes with, saying no word.**

Everything below is the engineering of that sentence.

## 1. The stack (seven layers, bottom-up)

```
L6  CEREMONY     signing · recovery · succession — where the human touches the key
L5  REPRESENTATION  the composite face: spectrum + metal + clarity + modes + sigil
L4  SOCIETY      personhood — the vouch web; effective = standing × personhood
L3  EVIDENCE     receipts — witnessed acts, beacon-pinned, climbing the metal ladder
L2  TIME         drand genesis + VDF life-chain — temporal mass, un-parallelizable
L1  KEY          AUMLOK keypair (Ed25519 → hybrid PQC) — the ONLY thing that signs
L0  HUMAN        the living person — the only layer that cannot be specified
```

Authority flows ONLY at L1 (AUMLOK signs; nothing above it gates the machine).
Meaning flows upward: the key accrues time, time accrues evidence, evidence
accrues society, and the whole column is *rendered* — never summed — at L5.

## 2. The two anchors — the design call that makes the merge coherent

An identity carries **two stable identifiers with different lifetimes**, and
keeping them apart is what makes recovery, succession, and the face all work:

- **`genesis_id`** — minted once at birth: `H(pubkey₀ ‖ drand_sig(R₀))`.
  Never changes, survives every re-key. **This seeds the SPECTRUM** — the
  six golden-weighted modes of the coherence glyph (`signatureSpectrum`).
  *The voice is the human.* Your figure is recognizably you for life.
- **`current_key`** — the live AUMLOK keypair. Changes on rotation/recovery.
  **This seeds the SIGIL** — the single-stroke seal (§4). *The seal is the
  current pen.* Re-key, and the seal changes while the voice persists —
  identity continuity with an honest scar, visible at a glance.

Succession is a receipt: `{genesis_id, old_key, new_key, quorum_cosigs,
drand_R}` co-signed by the vouch web above threshold. The face after
succession: same spectrum, new sigil, metal tier preserved (records are
immortal), clarity briefly dimmed until liveness re-attests. Nothing about
who you *are* is stored in the key; the key is only ever the pen in the hand.

## 3. The face — one composite, five inputs (L5)

The evolving cymatic pattern, composited in one renderer
(`spatial/app/coherence-glyph.js`, extended):

| channel | source | already built? |
|---|---|---|
| **spectrum** (the modes — who) | `signatureSpectrum(genesis_id)` | ✅ (seed swap: device-id → genesis_id when chain lands) |
| **modes audible** (how much of you sounds) | The Tuning's Platonic ladder | ✅ |
| **clarity/coherence** (how alive) | provisional stand-in today → witnessed liveness + graph-shape observables | ✅ scaffold / chain COMING |
| **metal** (how witnessed) | the ladder: lead→bronze→silver→gold via `transmute` | ✅ |
| **sigil** (whose pen) | NEW — the key-seal, drawn by Luminara's stroke grammar (§4) | to build (small) |

Composition (matches Luminara's own face grammar, deliberately): cymatic
field behind · sigil in front · nothing else. The bond variant (Forge) stays:
two spectra combined, consonance driving clarity, silver at *forged*.

## 4. The Luminara merge — shared hand, no shared words (Q7, resolved)

The standing boundary (RESONANCE_SPEC §8.3, adopted from Luminara's own Q7):
*shared visual physics welcome; shared symbol correspondences forbidden.* The
architect has now invoked exactly the merge that boundary anticipated, so here
is its precise resolution — **what is shared is the HAND, never the WORDS**:

**Shared (extract to one module — `spatial/app/mark-forms.js`, both lanes
consume it):**
- **The three marks** — the dot (stillness/node), the bar (flow), the wave
  (turning) — as stroke vocabulary (D17). These are physics: node, passage,
  oscillation — the same trinity as the glyph's standing-wave grammar.
- **The sigil derivation machinery** (D18's rules as *rules*): a single-stroke
  path through a 3×3 grid, drawn rising core→relational→field, columns
  still/moving/turning, the stroke wearing its mark at each station, knockout
  under-stroke, vertex-mean centering.
- The cymatic membrane renderer itself (already offered; `createGlyph`).

**Not shared, ever (the firewall that keeps both systems true):**
- **The identity sigil is NOT a letter.** It is derived from
  `H(current_key)` — nine hash-driven stations through the same grid, wearing
  the same marks, but its path lives in key-space (2²⁵⁶), not letter-space
  (27). By construction it will almost never coincide with any letter of the
  alphabet, and if a collision occurs it is *meaningless* and undeclared. The
  seal is in Luminara's handwriting but **says no word** — a signature, not a
  syllable. No table maps letters↔identities, cards↔people, Silences↔states
  of a person. (A Silence is unsigned in Luminara because what cannot be
  sounded cannot sign; an identity sigil always signs because a key always
  can — the two systems even disagree *harmoniously*.)
- Luminara's deck, positions, essences, Silences, 81 texts: sovereign,
  untouched, upstream of nothing here.
- REQ-L1 stands: the portal keeps `award('reading', {source:'cast'})` once
  per genuine cast.

**Shared infrastructure (both lanes, from `TEMPORAL_ALCHEMY.md`):** drand as
the ritual die (Luminara's Q6 — provably un-rigged casts) and as the receipt
watermark (AURA); tlock for sealed readings (theirs) and recovery ceremonies
(ours). Two lanes, one clock, zero shared symbols.

## 5. The ceremonies (L6 — where AUMLOK becomes visible identity)

1. **Signing.** Every ceremony surface renders: the current beacon round
   (pulsing), the key's sigil, the owner's glyph. A swapped key = a changed
   seal on a familiar voice — perceptually alarming *before* cryptographically
   checked. The hash remains the root; the face is recognition, never proof.
2. **Recovery (tlock).** Recovery material encrypted to future drand rounds;
   refreshing postpones, silence opens it to the quorum. Time is the executor.
3. **Succession** (§2). The web co-signs; the voice persists; the pen changes.
4. **The Forge** (existing): vouches with tlock cooling periods; the bond
   figure transmutes to silver at *forged*.

## 6. Implementation order (for Sam's synthesis)

Everything client-side lands in `spatial/app/*`; chain-side items are the
ordered COMING list the specs already carry (§§10–13 of
`AURA_ECONOMY_AND_KNVS.md`). Recommended sequence:

1. **`mark-forms.js`** — extract the three marks + sigil path machinery as a
   shared module (Luminara portal is live on main; coordinate on the PR
   channel, sign your lane; their rendering must not change pixel-wise).
2. **Key sigil** — `sigilFromHash(h)` → 9-station path; render into
   `createGlyph` composition (new `opts.sigil`). Seed from a local key stub
   today (honestly labelled), `current_key` when ceremonies land.
3. **Face assembly** — AURA hero + ceremony surfaces render the full
   composite; `genesis_id` seed swap behind a feature check (device-id until
   the chain mints genesis receipts).
4. **Chain-side** (Peter/AUMLOK lane): genesis receipts (key ‖ beacon) →
   drand pins on receipts → vouch web → succession receipts → VDF life-chain
   → witnessed clarity. Each step upgrades one face channel from provisional
   to witnessed — the face *literally transmutes* as the stack beneath it
   solidifies.
5. **Tests**: pin sigil determinism (same key → same seal), letter-space
   non-correspondence (sigil paths ∉ the 27 letter paths, statistically),
   spectrum stability across re-key (genesis_id), and REQ-L1. (Note: repo
   tests are vitest now, post-Convex-cutover.)

## 7. Invariants (consolidated — the merge changes none of them)

The seven of `RESONANCE_SPEC.md §2` hold verbatim (honesty rails; AUMLOK-only
authority; scalar-is-a-view / no published coherence numbers / no
leaderboards; evidence over counts; scaffold-not-theorem; seal-payload schema
freeze; signature determinism) — plus three this spec adds:

8. **Two anchors, two lifetimes:** spectrum from `genesis_id` (immortal),
   sigil from `current_key` (rotatable). Never swap these seeds.
9. **The hand, never the words:** mark grammar and membrane physics are
   shared modules; symbol correspondences across lanes remain forbidden. Any
   future exception is an architect-level canon change in BOTH lanes.
10. **The face is never the root:** every perceptual channel (spectrum,
    sigil, metal, clarity) is recognition-grade only; verification is always
    the hash, the signature, the chain.

---

*The column, read top to bottom, is one thing: a living human, holding a key,
accruing elapsed time no one can re-run, witnessed by other humans, wearing it
all as a figure of light that anyone can recognize — sealed in a handwriting
borrowed from the oracle, saying no word, because it doesn't need one. No layer
of it proves a person; together, they witness one.*
