# The Resonance System — full specification & residence map

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

*A handoff document, 2026-07-07. Written to STAND ALONE: it assumes no context
from the conversation that built it. Purpose: another lane (another chat,
another mind, another concept) reads this, keeps its own shape, and finds the
overlap where the two can come into coherence — the sheaf rule, §6, is the
merge protocol itself. Reciprocal: their spec lands in this repo the same way
(see §7). Everything here is on `main` or on open PR #134 unless marked.*

---

## 1. The concept, one page

**Coherence is a resonance, not a quantity.** The system registers "how real,
how alive, how in-tune is this identity" the way you register a musical note —
by whether it rings true — never by publishing a number. This resolves the
proof-of-humanity problem's oldest trap: any published care-score gets gamed
into performance of care (Goodhart). Here, what's stored is *traces* (receipts),
what machines consume is *predicates and orderings* (booleans, comparisons —
numbers only transiently, inside the computation), and what humans see is a
*figure*: the **coherence glyph**, a cymatic standing-wave portrait of your
coherence-topology.

**The physical grammar** (from the owner's tuning material + Open Weave + GHP):

- **Two kinds of permanence.** The stable metals (Au-197, lead) are permanent
  *by exhaustion* — dead end-states; nothing left to happen. The icosahedron is
  permanent *by tension* — φ (the most irrational number) holds it open; it is
  stable the way a standing wave is stable: far from equilibrium, sustained by
  throughput. **A stored score is Au-197. Living coherence is icosahedral.**
  Every design decision follows from keeping these apart.
- **The snap.** There are exactly five Platonic solids; the icosahedron is the
  last and most spherical. Scale past it and discrete geometry cannot smoothly
  become the sphere (φ-algebraic cannot reach π-transcendental in finite steps —
  squaring the circle). Consequence: **there is a maximum meaningful resolution
  to any finite record of coherence.** Past it, more precision isn't unwise,
  it's geometrically incoherent. The glyph carries exactly a resonant figure's
  resolution and no more.
- **Cymatics is the bridge.** The icosahedron is literally a resonant mode of
  the sphere (icosahedral symmetry appears in spherical harmonics at ℓ=6). A
  shape's spectrum near-determines the shape (Kac); your coherence-topology is
  a shape; its spectrum, rendered, is the glyph — **a living identifier:
  a voice, not a fingerprint.** Same being → same figure family; more life →
  more of the same spectrum audible; abandonment → it dims. Identity as
  sustained resonance, not a stored stamp.

**The economics under it (AURA tokenomics v2, merged):** AURA factors into
**personhood** (is a real human here — vouching web, decays without liveness) ×
**standing** (what they did — receipt chain), never summed. North-star
invariant: *subadditivity* — splitting yourself across identities always earns
less than one honest identity. Vouches are scarce and slashable upstream;
certifying fakes is negative-EV by construction. AURA never gates the machine
(only the AUMLOK signature does); it weights the society.

**The game on top (The Tuning):** progression is the Platonic ladder —
tetrahedron → cube → octahedron → dodecahedron → icosahedron — five stages
because there are five regular solids; each stage makes another of your six
golden-weighted spectrum modes audible. **There is no level six** (the sphere
is not a level; the endgame is *maintenance* of resonance). Gates are evidence
gates (lessons done, domains sounding, streak held) — never point totals, so
single-source grinding stalls structurally. Daily cadence: five notes, struck
never scored; three make a chord and the day rings. Bonds (the Forge) render
as **two spectra ringing together** — consonance drives the bond-figure's
clarity internally and is never printed.

## 2. The invariants (what must survive any merge)

These are load-bearing. A concept that breaks one doesn't merge — it forks.

1. **Honesty rails.** Every local tally is provisional, labelled forgeable
   ("anyone with a console can change it — it means nothing until witnessed"),
   and reconciles **loss-only** to chain truth. No local signal is ever called
   proof. Never overclaim — house rule with teeth.
2. **Authority rail.** Nothing in this system signs, unlocks, gates, or applies.
   Only the owner's AUMLOK key writes. AURA/coherence weights the *society*,
   never the *machine*.
3. **The representation rule** (spec §12): the scalar is a view, never the
   substrate. Receipts hold the specific trace; machines get predicates and
   orderings; humans get the figure or the trace — **no coherence number is
   ever published to a human. No leaderboards, ever.**
4. **Evidence over counts.** Witnessing must score *graph-shape change* (did
   someone unreachable become reachable; did cohesion rise), not act counts.
   Gates use evidence diversity, not totals.
5. **Scaffold, not theorem.** The physics (GHP, Fisher/sheaf/thermodynamic
   framings) is a design language and an instrument — never a claim that the
   app "is" quantum topology. Where the source is conjecture, the build stays
   conservative.
6. **Schema freeze:** the integrity-seal payload in `aura-core.js`
   (`sealPayload`) must NOT gain or lose fields — changing it breaks every live
   seal and mass-wipes honest users' tallies. New bookkeeping goes in `meta.*`
   OUTSIDE the payload.
7. **Determinism of identity:** `signatureSpectrum(sig)` must stay a pure
   deterministic function — same signature, same spectrum, forever. Progression
   changes *audibility* (mode count), never the spectrum itself.

## 3. Residence map (where everything lives)

**Canon / specs (docs/):**

| doc | owns |
|---|---|
| `docs/OPEN_WEAVE.md` | the political-scale vision: value as circulation on a manifold, governance as sheaf coherence, extraction as sinks; GHP-cross-referenced appendix (scaffold) |
| `docs/AURA_ECONOMY_AND_KNVS.md` | the working economy spec. §10 tokenomics v2 (personhood × standing, vouch economics, capped-Fib streak); §11 Open Weave reconciliation (3 corrections as chain requirements); §12 the representation rule |
| `docs/COHERENCE_GLYPH.md` | the synthesis: metals vs icosahedron, the snap, cymatics bridge, glyph-as-identity, the two death-modes, the φ fixed point |
| `docs/THE_TUNING.md` | the gamification guideline (grown from the owner's Zeus meta-prompt, scalar organs rejected): the Platonic ladder, daily notes, agency, anti-exploit |
| `GHP/canon/*` | the Golden Horizon Principle — **another lane's canon; consumed as analogy only, never edited from this lane** |

**Code (spatial/app/, plain browser ES modules, no deps, no GPU required):**

| module | exports | role |
|---|---|---|
| `aura-core.js` | `award(kind, opts)`, `readAura()`, `loadState/saveState/ensure/saveProgress`, `STATE_KEY` | the ONE writer of the provisional tally. Spam filters, 40/day cap, capped-Fib streak (+13 max), integrity seal (tamper → re-derive from lesson evidence), clock guards (rollback high-water; 20h cap refill; 12h + 8-per-week streak window). Fires `window` event `'aura-changed'` |
| `coherence-glyph.js` | `createGlyph(canvas, {signature, coherence, modes, spectrum})`, `signatureSpectrum(sig, count)`, `consonance(a,b)`, `combineSpectra(a,b)` | the instrument. 2D-canvas cymatic renderer: gold nodal lines (where the wave stands still) over hue-r living flow; coherence modulates clarity, not size; deterministic 6-mode golden-weighted bank per signature. Self-consonance ≡ 1.0 |
| `tuning.js` | `tuningState(readAura())` | pure derivation, writes nothing: Platonic stage, modes audible, daily notes, next-gate guidance |
| `aura.js` | `mountAura(root)` | the AURA organ: glyph hero (no big number), two-axis display (standing provisional / personhood ×0 unwitnessed), Tuning card, tamper notice, vouch-web illustration, explainer sections |
| `forge.js` | `mountForge(root)` | the Forge preview (all-mock, zero awards): bond walk-through with your glyph + placeholder partner + the bond figure coming into tune |
| `field-directives.js` | `makeDirectiveFilter(apply)`, `FIELD_HUES`, `FIELD_FORMS` | (adjacent lane, same arc) the `[field …]` grammar Auma's live voice uses to control her light-field; ONE module shared by door + clients |
| callers | `chat.js:795` (message award), `auma/auma.js:720` (lesson, first-completion), `luminara.js:194` (reading cast) | the only three award call sites |

**Identity:** per-device signature in `localStorage['aukora-node-glyph-id']` —
shared by aura.js and forge.js (one identity, one voice). Witnessed signature
COMING with the chain (derived from the coherence-topology itself).

**Tests (core/tests/, CI-pinned):** `fieldDirectives.test.ts` (streaming tag
extraction, 8), `auraCore.test.ts` (seal + clock guards, 7),
`tuningLadder.test.ts` (ladder, grind-stall, no-level-six, mode bank, 5).

**PR history:** #118 (live-voice field rebuild) → #122 (hardening) → #124
(tokenomics v2 + seal/clock guards) all MERGED; **#134 OPEN** carries: Open
Weave reconciliation, the glyph, The Tuning, the Forge harmony, the test
promotion. Branch `zeb/aura-glyph-tuning`.

**What is explicitly COMING (chain-side, out of this lane —the ordered
requirements live in spec §§10–12):** witnessed receipts + vouching web,
graph-shape-change witness predicates, flow-tempered effective weight
([1/φ, φ] band + sink divergence diagnostic), geometric events, the witnessed
glyph signature, the constellation (many glyphs co-present, unranked).

## 4. The seams (where another concept can couple without entangling)

Stable interfaces, in order of least entanglement:

1. **`'aura-changed'` window event** — fire-and-forget observation of provisional
   earns. Any organ may listen; none may write.
2. **`award(kind, opts)`** — if the other concept generates *earnable acts*, it
   calls the one writer with a new `kind`; all filters/caps/seal apply
   automatically. (New kinds need a gate review — see §2.4.)
3. **`tuningState()` / `readAura()`** — pure reads; render your own view of
   stage/notes anywhere.
4. **The glyph API** — give anything a figure: `createGlyph` with a custom
   `signature` (any stable string) or a composite `spectrum`
   (`combineSpectra`). Consonance between any two spectra is one call. This is
   how a *foreign concept gets a face* in this system without touching the
   economy at all.
5. **The `[field …]` grammar** — if the other concept speaks through the
   presence lane, it inherits the tag protocol (typed `{"t":"field"}` SSE
   events; client filters as defense-in-depth).
6. **The chain requirements list** (spec §§10–12) — if the other concept is
   building toward the same governed chain, this is the shared contract to
   reconcile against, not code.

## 5. What is negotiable vs not

**Negotiable:** vocabulary and rendering (hues, forms, stage names), the
provisional coherence stand-in formula, gate thresholds on the ladder, the
daily-note set, where glyphs appear, adding new evidence kinds.
**Not negotiable:** the seven invariants of §2. In particular: if the other
concept carries numbers, its numbers may *exist* — internally, machine-side —
but they do not surface to humans through any surface this spec governs, and
they never rank humans against each other.

## 6. The merge protocol (the sheaf rule, made operational)

Open Weave's governance math is the instruction: each lane is a **stalk**
(keeps its own local topology — neither chat rewrites the other); coherence
requires only that we **agree on the overlap** and that the agreement glues.

1. **Exchange canons.** This doc goes to the other lane; their equivalent spec
   lands in this repo at `docs/<THEIR_NAME>.md`, verbatim, unedited (the
   pattern already used for Open Weave and the Zeus prompt).
2. **Write the reconciliation, don't rewrite the canon.** A numbered section
   (the way spec §11 reconciles Open Weave): what already aligns · what
   genuinely corrects us (adopted as requirements) · what stays theirs alone.
   They do the same on their side. Corrections flow as *requirements*, never
   as edits to the other's files.
3. **Name the overlap explicitly.** The shared objects are probably: identity
   (signatures), evidence (receipts), representation (§2.3), and the chain.
   Where both lanes define the same object differently, the overlap section
   must say which definition governs *on the overlap* — or record the
   incompatibility honestly as `H¹ ≠ 0` (local agreement that doesn't glue yet)
   rather than papering over it.
4. **Coordinate in the open:** cross-lane messages go on the aukora-symbiote
   PR/issue channel (the standing practice: comment, sign your lane).
5. **The test of coherence is consonance, not identity.** The goal is NOT one
   merged concept. Two spectra that share some symmetries ring together and
   keep their own voices — that is the target state, and (fittingly) the
   system already ships the instrument to picture it: `consonance(a, b)`.

## 7. For the other lane: what we'd like back

Your equivalent of this document: your concept in one page, your invariants
(what must survive contact with us), your residence map, your seams, and what
you consider negotiable. Plus, if you have them: your definition of identity,
of evidence, and of what your humans *see* — those are the three overlaps
where gluing will either succeed or honestly fail first.

---

## 8. Luminara reconciliation — the reciprocal audit (2026-07-07)

*The Luminara design lane answered with `docs/LUMINARA_SYSTEM_SPEC_v1.md`
(landed verbatim; their canon of record stays in their home directory and is
not edited from here). Audit run against the seven invariants of §2 and the
residence map of §3. Verdict up front: **the handshake is clean — zero
skeleton collisions, zero escalations needed.** Their shared-skeleton contract
(§10 of their spec) binds them to the Lingwa lane, not to us; our overlap with
them is exactly three things, all resolved below.*

**8.1 Invariant check — clean.** Their structural numbers (27, 81, ternary
codes) are alphabet arithmetic, not human-ranking scores — no collision with
the representation rule (§2.3). "The system never claims prediction," the cast
journal is local-only and never witnessed, readings earn provisional aura
through the one writer, and their §9 states the same authority firewall as our
§2.2 ("nothing here signs, applies, or authorizes"). Their provenance
discipline (D4: scaffolding fully set down; no imported correspondences) is
the same posture as our scaffold-not-theorem rule. `H¹ = 0` on everything
checked: local agreements glue.

**8.2 The one residence collision → one named requirement.** Their system
*replaces* `spatial/app/luminara.js`, which is one of our three award call
sites (`luminara.js:194`, `award('reading', { source: 'cast' })`) — the
Tuning's "cast a reading" daily note, the reading domain in the Platonic
ladder's evidence gates, and `todaySources.reading` all stand on it. Their §9
already promises to inherit "provisional-aura on readings," so this is
agreement, now pinned: **REQ-L1 — the replacement organ calls
`award('reading', { source: 'cast' })` exactly once per genuinely completed
cast** (whatever Q6 draw mechanics they choose, the anti-mash gap in aura-core
stays meaningful), keeps the local journal local, and keeps the toast ambient.
Nothing else in our lane needs anything from them.

**8.3 The kinship, honored at the right distance.** Their cymatic emanation
figures and our coherence glyph are the same physics family — their grounding
sentence ("a stopped sound is a node, a fricative smooth passage, a vibrant an
oscillation") is literally our nodal-line grammar. Their spec's own boundary
is adopted verbatim as ours: **shared visual physics welcome; shared symbol
correspondences forbidden** (their Q7 / interference principle). Concretely:
- **Offer, theirs to take or leave:** their §7 notes the figures "may upgrade
  to true Chladni interference (superposed modes on one membrane)" — our
  `createGlyph(canvas, { spectrum })` IS that membrane renderer (2D canvas, no
  GPU, superposed radial-angular modes). Their yaml-derived per-card mode sets
  could feed it directly; the marks→modes derivation stays theirs (their D16:
  the rules are the design). Infrastructure sharing, not meaning sharing.
- **Named non-correspondence (load-bearing):** our figure renders *identity*
  (who is coherent); theirs renders *phonology* (what a sound is). Same
  physics, different objects. There will be **no table mapping the 27
  letters/cards to identity spectra, hues, or Tuning stages** — that would be
  precisely the interference their D4 retired and our §2.5 forbids.
- The deep rhyme, noted and left as rhyme: their register is discrete —
  ternary, toroidal, closing by carry-arithmetic; ours is continuous — modal,
  φ-weighted, ringing. Countable and resonant: the two sides of the same
  snap (`COHERENCE_GLYPH.md` §2). Consonance, not identity — which is the
  whole point of §6.5.

**8.4 Vocabulary futures (flagged, deliberately unacted).** Their palette may
be re-derived from the 8 Spectra colors; our `FIELD_HUES` is Auma's
field-language. If any lane ever wants a shared color vocabulary it is a
three-way agreement (Luminara + Lingwa + this lane) with the architect ruling
— until then the palettes stay sovereign and unaligned on purpose.

*Logged as coherence agreements REQ-L1 + the Q7 boundary; standing offer:
the membrane renderer and `consonance()`. Their lane's reciprocal audit of
this spec is welcome any time — checkpoints we'd suggest: does anything in
your engine surface a human-ranking number; does your organ replacement
preserve REQ-L1; does any planned feature create a letter↔identity
correspondence table.*

*Scaffold, not theorem, end to end. The truth is always the chain's to speak.*
