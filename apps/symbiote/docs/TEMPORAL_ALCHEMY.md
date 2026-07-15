# Temporal Alchemy — the Crucible: identity that hardens with time

*2026-07-07, AURA lane. Extends `RESONANCE_SPEC.md` / AURA spec §§10–12 with the
missing physical leg of the witness problem: **elapsed sequential time** (evidence
that time passed — never, alone or with anything else, proof of a human), made
cryptographic with a VDF chain and the drand beacon, and made legible as the
oldest story we have — lead transmuting to gold. Discipline unchanged:
scaffold-not-theorem; chain-side items are COMING requirements for the
governed chain (AUMLOK stays the only write authority); nothing here publishes
a coherence number to a human.*

---

## 1. The gap this fills

The sybil economics of spec §10 stand on one leg: the **social** leg (vouches,
slashing, cluster detection). Strong, but every social signal can in principle
be farmed slowly by patient humans. The un-farmable resource — the only input
no attacker can buy more of, parallelize, or fake — is **sequential time**.
A thousand machines can do a thousand things at once; they cannot make one
second happen faster. Proof-of-humanity needs a physics leg, and time is the
physics we get for free.

Two instruments make elapsed time cryptographic:

- **drand** (the League of Entropy beacon): publicly verifiable randomness,
  a BLS threshold signature over each round number, published on a fixed
  cadence. Round R's value is **unpredictable before publication and
  unforgeable after** — so any record embedding beacon R provably came into
  existence *after* time T(R). A free, decentralized, watermark of "not
  before."
- **VDF** (verifiable delay function — Wesolowski/Pietrzak class): a function
  requiring T *inherently sequential* steps to evaluate, verifiable in
  milliseconds. A VDF output is a **proof that wall-clock time actually
  passed** between its input and its output — more hardware does not help.

drand answers *when did this start*; the VDF answers *how much time has truly
passed since*. Together they turn identity age into a physical quantity.

## 2. The mechanism

**Genesis anchor.** An identity is born by binding its public key to the
beacon: `genesis = H(pubkey ‖ drand_sig(R₀))`. Provably created after T(R₀) —
no identity can ever claim to be older than its birth round.

**The life chain.** Per epoch (say daily), the identity's node extends a VDF
chain, injecting fresh beacon entropy each step:
`vᵢ₊₁ = VDF(vᵢ ‖ drand_sig(Rᵢ) ‖ receiptsHead ᵢ, T)`.
Each link proves: real sequential time passed, after a public moment, over a
specific state of the receipt chain. Backdating is dead — and so is every
clock-game the client guards can only dampen today (spec §3.3): a streak, a
liveness claim, a "this act happened Tuesday" all become beacon-pinned facts.

**Honest limit — why the VDF alone is not personhood.** VDF chains are cheap
to run in parallel: a farmer could age 10,000 empty chains for a year and mint
"old" sybils. Age alone proves only age. The design therefore multiplies, never
adds: **temporal mass** `m(id) = ∫ witnessedLiveness(t) dt` — sequential time
weighted by *witnessed human aliveness during it* (vouches refreshed, acts
witnessed, graph-shape change observed, each receipt beacon-pinned). Aging an
empty chain accrues nothing (P = 0 multiplies it away); aging a vouched
identity requires **fooling real humans continuously for the whole duration**.
That product — social × temporal — is the thing whose forgery cost grows
monotonically with every passing day. This is the precise sense of "more
unhackable over time": the attack cost is denominated in the one currency
nobody can print, *lived time under witness*.

## 3. The alchemical ladder (witness-depth of a record)

The two-permanences doctrine (`COHERENCE_GLYPH.md` §1) says living coherence
must stay icosahedral — but **records SHOULD be metal**: inert, immortal,
finished. The receipt chain is supposed to be Au-197. So the metals return,
exactly where they belong — as the witness-depth of a record:

| tier | metal | state of the record | today |
|---|---|---|---|
| 0 | **LEAD (Pb)** | local, provisional, forgeable — where unwitnessed claims end up (lead is where decay chains terminate) | ships (the honest local tally) |
| 1 | **BRONZE (Cu)** | sealed + evidence-consistent — integrity seal, clock guards, derived from lessons actually done | ships (spec §3.3 hardening) |
| 2 | **SILVER (Ag)** | vouched — first human light reflected on it; personhood > 0 (silver, the mirror metal: you exist in others' light) | COMING (vouching web) |
| 3 | **GOLD (Au)** | chain-witnessed: AUMLOK-signed receipt, drand-anchored, VDF-aged; immortal | COMING (the chain) |

A record climbs; it never descends (append-only). What decays is never the
gold itself but its *weight* in living personhood (liveness decay, §10.3.4) —
records are immortal, relevance is icosahedral. And the rendering rule follows:
**in the glyph, the nodal lines — the standing structure — wear the metal of
the record's tier**, transmuting lead → bronze → silver → gold as witnessing
deepens, while the flow between the nodes stays living light. Everyone starts
leaden. The Work is real. (Implemented: `coherence-glyph.js` `transmute` ∈
[0,1]; the live page sits at bronze — sealed evidence, unwitnessed — until the
chain exists. The gold is earned, not default.)

## 4. The AUMLOK ties (identity tech, not authority creep)

AURA still never gates the machine. These are the four honest couplings:

1. **The key wears a face.** `signatureSpectrum(H(aumlok_pubkey))` gives the
   owner's signing key its own glyph — rendered on every ceremony surface.
   Key substitution attacks become *perceptually* detectable: a swapped key is
   a stranger's face where a familiar one should be. (The figure is a
   recognition AID; machines verify the actual hash — the glyph is never the
   verification root. Glyph near-collisions exist in principle; stated
   honestly, defended by keeping the hash authoritative.)
2. **Gold means signed + pinned.** Tier-3 records are AUMLOK-signed receipts
   carrying a drand round — the ceremony transcript proves "the owner signed
   this after T(R)." (PQC note: the repo already carries ML-KEM/PQC signer
   modules; gold-tier signatures should go hybrid before the chain freezes its
   format. drand's BLS is not post-quantum: treat beacon anchors as *time
   evidence*, and tlock secrecy as horizon-limited.)
3. **Timelock recovery (drand tlock).** Encrypt AUMLOK recovery material to a
   future beacon round. Refreshing the ceremony postpones the round; going
   silent lets it open to the designated quorum. A dead-man's switch with no
   trusted party — time itself is the executor. The same primitive gives the
   Forge an anti-coercion cooling period: a vouch commits now, opens at R+Δ,
   cancellable before it rings.
4. **Ceremony ambience.** Signing surfaces show the current beacon round
   pulsing and the key's glyph breathing — the sci-fi that is also literally
   the security model, visible.

## 5. The Luminara convergence (offers only — their Q7 boundary holds)

Infrastructure, never symbols:

- **drand as the ritual die (their open Q6).** Draw mechanics from the beacon:
  a cast at round R is provably un-rigged, un-pre-seen, and timestamped — the
  world's dice, verifiable by anyone, ownable by no one. It even dignifies the
  ritual: the randomness is genuinely cosmic-grade.
- **Sealed readings (tlock).** A reading encrypted to a future round — the
  letter to your future self; a Silence that literally cannot speak before its
  time. Their sovereignty whether any of this enters canon.

## 6. What we're still missing (the honest list)

1. **Recovery vs. continuity** — keys are lost; humans persist. Social
   recovery through the vouch web + tlock switches is designed; the
   *continuity ceremony* (the web recognizing a re-keyed human, the glyph
   easing the recognition) needs its own spec.
2. **The verifier economy** — who runs the VDF evaluators and drand relays for
   friend-nodes; cost envelope unknown (small, but must be measured).
3. **Glyph collision honesty** — perceptual uniqueness is not cryptographic
   uniqueness; the hash stays the root, forever. Written into §4.1.
4. **Consent & capture** — beacon-pinning receipts makes timelines *very*
   legible; the salted-commitment privacy discipline (§10.3.6) must extend to
   time-anchors (round-granularity coarsening for private acts).
5. **Cross-lane time** — if Luminara casts and AURA receipts both pin to
   drand, the two lanes share a clock without sharing a symbol. Worth one line
   in both canons; nothing more.

*The one-line thesis: make time itself the crucible. drand proves when the
Work began; the VDF proves the fire never went out; the witnesses prove a
human was in it. What comes out the far side is gold — and no one can speedrun
a crucible.*
