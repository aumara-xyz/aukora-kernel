# AGI · ARC 3 — Auma's General Reasoning Organ

**Status:** live v1 (2026-07-08) · **Owner lane:** ARC 3 workstream
**Where:** the Spatial app → Apps → *AGI · ARC 3*

Auma plays **ARC-AGI-3** — the open interactive-reasoning benchmark at
[three.arcprize.org](https://three.arcprize.org) — **blind**: no per-game
knowledge anywhere in the decision path. She earns the controls, finds her own
body on the board, names the wall materials, plans routes, and every action
carries a one-line reason that is ALSO submitted in the platform's official
`reasoning` field — so the public scorecard itself holds her receipts.

This organ descends from Kimi's 2026-05 solver campaign
(`ARC_AGI_3_SOLVER_SPEC.md`, `AUMA_ARC_CANONICAL_EXTRACTION.md`, the
"AR3 Destroyer" package) and keeps its hardest-won law:

> **No replay, no solved claim. No observed delta, no lesson.
> Enthusiasm is a bug. The honest failure log outranks the win log.**

Where Kimi's system won by *reading game source code* (source-aware, ~80% of
its wins), this engine deliberately refuses that lane: the point is **general
reasoning from pixels**, the thing the benchmark actually measures.

---

## 1. Anatomy

```
spatial/app/arc3/engine.js       the mind (pure ESM: no DOM, no fetch, no timers)
spatial/app/arc3/mock-arcade.js  onboard arcade: 3 worlds, FrameResponse contract
spatial/app/arc3/arc3.js         the organ UI (boards, sense overlay, accordion receipts)
spatial/app/arc3/arc3.css        the look
spatial/arc3-serve.ts            the ARC door :7093 (key custody, cookies, pacing; 7092 = voice sidecar)
spatial/arc3-pulse.ts            MK·PULSE — the node itself as a world (read-only probes)
core/tests/arc3Engine.test.ts    15 pins, incl. blind wins + receipt honesty
```

The door is a separate loopback process (like the chat door) because
`spatial/serve.ts` is structurally GET-only. `bun run start` now boots all
three: read surface :7090, chat door :7091, ARC door :7093 (7092 stays the Auma Live voice sidecar).

### The loop (each turn)

**SENSE** → connected color regions, diff vs previous frame.
**ORIENT** → which region moves when I act (self), what each action does
(direction vectors from lived displacement), which colors stop me (blocker
votes at every bump, exonerated forever once traversed).
**HYPOTHESIZE** → a ledger with evidence grades from the canon:
`di` (watched it happen) / `intu` (consistent inference) / `moga` (untested).
**ACT** → model-based route reading (BFS on the pixel grid using only earned
physics) → door instinct (*"walls don't come in door-sized pieces for no
reason"*) → graph-walk escape to unexplored ground (A*-biased toward the
believed goal) → click saliency → calibrated exploration.
**VERIFY** → a receipt per action: world-hash before/after, effective-change
count, noop flag, novelty, level count **as the platform reports it**.

### Chrome masking (the real-benchmark unlock)

Real games carry HUD cells (step counters, score bars) that change on every
action. Unmasked, they poison everything: no noop is ever seen, every state
hashes "novel", walls are never learned. Each cell keeps a change-EWMA;
relentless flickerers (≈12+ consecutive changes) are declared **dashboard,
not world**, and drop out of state identity and noop judgment. Live, on LS20,
she said it herself: *"25 cells flicker no matter what I do — that is the
game's dashboard; I stop reading it as state."* The threshold is deliberately
strict so her own moving body is never masked (a walking body flips a given
cell only on enter/leave).

### The onboard arcade

Four local worlds speak the exact FrameResponse contract, with **controls
scrambled per seed** so nothing can be memorized: MK·MAZE (routes + walls),
MK·EMBER (the budget world — every move burns fuel, explorers die broke; the
ls20 lesson in miniature), MK·GLYPHS (click toggles), MK·FORGE (a door that
must be discovered by clicking). Mazes are solvable **by construction**
(generation BFS-checks the exact movement rules; ember boards are winnable on
one tank by construction). These are practice proofs for CI — never benchmark
claims. The UI labels them accordingly.

---

## 2. Honest results ledger

Tier language follows the canonical extraction (T1 = watched locally,
T2 = through the live API with platform-counted levels).

| Date | Arena | Game | Result | Receipt |
|---|---|---|---|---|
| 2026-07-08 | onboard | MK·MAZE ×3 levels | WON, 102 acts, 3 noops | CI test, deterministic |
| 2026-07-08 | onboard | MK·GLYPHS ×2 | WON | CI test |
| 2026-07-08 | onboard | MK·FORGE ×2 | WON, 62 acts (door found by reasoning) | CI test |
| 2026-07-08 | **LIVE** | **ft09 L1** | **WON at action 142, blind** (`levels_completed=1`, platform truth) | scorecard `d7127e27-1b05-4d77-a1a5-7d33299b7c8c` |
| 2026-07-08 | LIVE | ls20 | 0/7 — honest failure: fuel limit (~21 moves/life) kills explorers; chrome mask verified live | scorecard `d5e9234d-…` |
| 2026-07-08 | LIVE | cd82 | 0/6 — honest failure; but earned: ACTION5=up in this game, walls=color-0, a 95-cell live button | scorecard `78a676d3-…` |
| 2026-07-07 | LIVE | ft09 | 0/6 this run (new box, fresh random seed) — 370 acts, 210 noops, 5 lives; earned: only ACTION6 offered, a 38-cell live button near (47,39), no-new-states→click-sweep switch; never identified a body | scorecard `f3f9be10-3919-4124-b7b2-2c7ef243ca04` |
| 2026-07-07 | **LIVE** | **lp85 L1** | **WON blind at action 78** (baseline 17) — platform-verified: `levels_completed=1`, level_scores[0]=4.75 | scorecard `1df39b13-840d-45e6-90c0-aec3263b65ef` (read back through the API) |
| 2026-07-07 | LIVE | lp85 | L1 **won again** (reproducible), L2 0/5 lives — 551 acts total; budget sense fired live: drain-watch caught a color-14 gauge (intu), commit mode engaged (di) | scorecard `7fe94b3d-e104-488c-8979-cda991c883d2` (read-back pending a backend re-roll) |
| 2026-07-07 | onboard | MK·EMBER ×2 levels | WON — dies broke once, learns the exact budget from the death (di), commits, wins on the next tank | CI test, deterministic |
| 2026-07-07 | LIVE | ls20 (with budget sense) | 0/7 still — but the collapse mode is GONE: full 600-action run, 73 noops (ft09 burned 210 in 370), body found (color-12), all four directions earned, walls named, gauge caught (color-11, intu), death-ledger measured **132-move lives** (the old ~21 estimate was wrong), commit mode engaged. She plays it competently; the level-1 puzzle itself is the wall now | scorecard `ba0369cb-4efa-476e-b72b-28ca55349676` |
| 2026-07-07 | LIVE (lab) | ft09 ×2 (with odd-one-out) | 0/6 both — the deviant-first prior is NOT ft09's key (237 noops each); budgets measured 86–88/life, gauge color-12 caught both runs. Verdict: ft09 needs **relations between pieces**, not anomaly-spotting → roadmap rung 2 | cards `33f21fc6-…`, `d68b63ad-…` |
| 2026-07-07 | **LIVE (lab)** | **lp85 L1** | **won again, headless** — third L1 win in three attempts today across two drivers (organ UI ×2, lab bench ×1); 600 acts, L2 unreached, budget 134/life, gauge color-14 | scorecard `dee71537-79bd-4df3-87bf-6423f40089d8` |
| 2026-07-07 | onboard | MK·ODDBALL ×2 levels | WON in <60 acts across seeds — she names "the odd one out" in the receipt BEFORE it pays off | CI test, deterministic |
| 2026-07-07 | **LIVE (lab)** | **ft09 L1** | **WON blind at 420 acts** — first ft09 level on sam-mac, via the harmonize sense ("making the framed block agree with its closest twin"); the enabling diff was a half-side bbox fix caught by testing perception on a LIVE frame | scorecard `1e14d4c5-bc48-4c3f-9e85-9821dd305f0c` |
| 2026-07-07 | LIVE (lab) | lp85 L1 | won a FOURTH straight time (600 acts, L2 unreached) — L1 is fully reproducible across both drivers | scorecard `a0e1b049-d183-49f8-8f35-9a4f2ae401a3` |
| 2026-07-07 | infra | (door crash) | one ft09 + one ls20 run lost to the door process dying mid-campaign (simultaneous socket errors; platform was up); door relit, runs replayed — logged as infrastructure, not game losses | lab JSON `2026-07-08T01-32-…` |
| 2026-07-07 | onboard | MK·MIRROR / MK·RAIL / MK·EMBER | MIRROR won (framed-block consensus), RAIL won (path-locked + turn-then-step), EMBER now won on the FIRST tank every seed (34 acts — the goal-picker no longer chases the fuel gauge) | CI tests, deterministic |
| 2026-07-07 | LIVE (lab) | ls20 | 0/7 still — but play keeps cleaning up: 127 noops in 600 acts (was 285, and total collapse before budget sense); gauge + budget caught as always. The level-1 puzzle is a relations problem, not a survival problem | scorecard `7372bad0-89b4-43db-9ce7-b9afca97c475` |
| 2026-07-07 | **LIVE (lab)** | **ls20 L1** | **WON blind at 353 acts** — the courier sense closed it: picked up the key ("the color-9 piece moves exactly with me — I am carrying it"), wanted its sibling, delivered to the lock. L2 reached (same dance, longer floor, new teleporter-like tiles), lives ran out there | scorecard `8a130597-ca3c-4aaa-8b34-578edf0e561a` |
| 2026-07-07 | LIVE (lab) | lp85 L1 | won a SIXTH straight time; L2 frame banked by the lab's eyes: a flow-routing relations board (ports, crossings, two ring-marked junctions) | scorecard `75f13ffc-261d-47b6-8f8b-81df9942ba64` |
| 2026-07-07 | onboard | MK·COURIER ×2 levels | WON — notices the attachment mid-walk, then delivers; the same seed went from 1500 steps of never touching the parcel (the farther-is-better scoring bug) to a 72-step delivery | CI test, deterministic |

Anonymous-key note: runs are real but unowned. Register at
three.arcprize.org and drop the key in `ARC_API_KEY` or
`~/.aukora-symbiote/arc3/api-key.txt` to claim scorecards; the door prefers a
configured key and falls back to the platform's guest lane
(`GET /api/games/anonkey`) exactly like the official toolkit.

### Platform facts learned the hard way (2026-07-08)

- **Backend affinity:** each ARC backend hosts a *subset* of games; a
  cookieless RESET rolls the load-balancer dice and the same `game_id` flips
  between playable and `not found`. The door retries fresh-jar RESETs (≤12)
  and then pins the session via the `AWSALB*` cookies. Measured: ls20 landed
  1/10 without retry.
- Rate limit 600 rpm; the door paces ≥120 ms/upstream call and surfaces 429s.
- Per-game roll odds vary wildly and drift (measured 2026-07-07 on Sam's box):
  cd82/ls20/tn36 landed in ≤4 rolls; ft09 exhausted three straight 12-roll
  dances before landing on the 4th; sb26 missed 12/12. A single 12-roll RESET
  is NOT a guarantee — the organ may need the ▶ pressed again.
- Closing a scorecard with zero landed environments returns upstream 404
  (benign); cards with games close 200.
- Scorecard READS are backend-affine too: `GET /api/scorecard/<id>` 404s
  unless the roll lands the card's backend (measured 2026-07-07: one card
  landed on roll 4; another missed 15/15 in a session — retry later).
- `reasoning` (≤16 KB/action) is accepted and stored — Auma's thoughts ride
  the official record.

---

## 3. Where this goes (the general-reasoning roadmap)

The engine is already game-agnostic; these are the next rungs, in order:

1. **Budget sense** — ✅ shipped 2026-07-07, three organs:
   *drain-watch* (a color whose cell count shrinks step after step is a
   gauge, not world — masked like chrome, read as fuel, grade intu),
   *death-ledger* (a watched GAME_OVER fixes moves-per-life exactly, grade
   di), *commit mode* (tight budget ⇒ no strategy rotation, no frontier
   walks, no coin-flip clicks — goal first). Proven onboard on the new
   MK·EMBER world (dies once, learns the budget, wins the next tank —
   CI-pinned) and observed firing live on lp85 (gauge caught, commit
   engaged). ls20 itself still unbeaten — the walk there needs more.
2. **Object permanence + relations** — track regions across frames as objects
   (not colors), so "the key", "the door", "the carried thing" survive
   recolor and overlap (re86/sb26 family).
3. **Per-mechanic micro-skills, learned not hardcoded** — the meta-mind
   already stores mechanic lessons keyed by action-menu fingerprint; let
   winning *policies* (not solutions) transfer: e.g. "toggle worlds: prefer
   parity-flipping click sets."
4. **Convex reactive brain** — receipts are already Convex-shaped; stream
   them into the memory brain so lessons persist across nodes and sessions,
   and the dashboard can replay any run from receipts alone.
5. **Fusion council arbitration** — when two hypotheses hold comparable
   confidence, convene the council on the receipt evidence instead of letting
   the scalar win (coherence-glyph philosophy: the number is a view, never
   the substrate).
6. **Swarm mode** — N reasoners with different seeds sharing one meta-mind
   over the door (the door already serializes under the rate limit); Kimi's
   parallel-wave architecture, minus the false-positive lane: a win only
   counts when the shared verifier replays it.

### MK·PULSE — her body as the game (Phase C rung 0, THE GREAT MERGE #178)

The door hosts one world that never travels upstream: `pulse-node`. The frame
renders THIS node's own surfaces (read surface, chat door, arc door, brain,
plus one deliberately never-served control port) as unlabeled tiles, shuffled
per session — the blind law applies to her own body too. A click is ONE real
read-only loopback status probe (the same check `bun run start` performs);
the win is naming the silent door by re-probing it. Nothing is written, no
scorecard is opened, the sign line is untouched by construction. Conflicting
probes of the same door become first-class aukora-fu Contradictions
(`tilde`/`decayShear`, reused not rebuilt) riding the frame as advisory data.
Proven 2026-07-08 on sam-mac: headless 2/2 in 27 probes; in-organ 2/2 twice
(13 and 55 actions). CI proves the whole world offline via an injected prober.

Round 5 — the game's eyes at the gate: when a pulse work order reaches the
signing screen, the owner sees EXACTLY what MK·PULSE saw when it named the
door. The draft now also writes a structured `arc3-game-receipt-v1` sidecar
(`core/src/arc3GameReceipt.ts`, keyed by intentId, same discipline as the
Fusion advisory sidecar), and the signing assistant fuses it — inline onto the
proposal card being signed ("◈ what the game saw": door, loopback URL, probe
count, level, run guid), and in a standalone "game findings awaiting a
proposal" panel before rehearsal. Display-only, fail-closed, provenance + age
visible, NEVER a gate input. Proven on sam-mac against a live gate.

Round 4 — the lawful crossing: when a finished run has NAMED a silent door,
the finding may become a `proposal-intent-v1` DRAFT through the exact ceremony
chat/voice use (`spatial/arc3-workorder.ts` → `core/src/proposalIntent.ts`,
authoredBy `arc3`). Advisory speech only: gated OFF by default
(`AUKORA_ARC3_WORKORDERS=1`), the hollow control never drafts, affected paths
stay `inferred` (the game knows the URL, never the file), drafts are
idempotent by content hash, and only the owner's AUMLOK signature — after
workbench re-verification — can ever turn one into a change. The owner signs
or ignores; nothing self-applies. (The hollow moved to port 1 — tcpmux, root-
only to bind — after :7097 got squatted within a day: structural silence
beats registry silence.)

Round 3 — latency bands: probes MEASURE now. A door reads fast (green), slow
(yellow), or silent (dark red); slow is degraded, not dead — only marking the
SILENT door wins, so slow decoys must be told apart from the dead (the whole
discrimination lives in one rule). Each probed tile wears a speed strip that
drains as its door degrades, and the probe budget itself is drawn as a
draining bar — a real gauge on her own body: CI pins that the engine's
drain-watch catches it (fuel color-13, intu) and that a watched death fixes
moves-per-life exactly (death-ledger, di). Band shifts within "answering"
(fast→slow) drain the strip but mint NO contradiction — degradation is not
negation; only up/down flips interfere (tilde). Proven again live after the
change: headless 2/2 in 27 probes; in-organ 2/2 in 25 actions.

### Field notes on the outside world

- The community leaderboard is led by non-LLM approaches — StochasticGoose
  (CNN + RL) at **12.58%**; frontier LLMs sit ~30× lower. Our lane (fast
  structured reasoning from pixels, no model calls in the loop) is the same
  species as the leaders.
- Graph-based exploration over learned state graphs is an active research
  direction (arXiv 2512.24156); our escape-to-frontier planner is that idea
  with a goal-biased cost.
- Official leaderboard is harness-free by policy; community leaderboard
  accepts self-reported harness runs — that is where organ results belong
  once a key is registered.

Sources: [ARC-AGI-3](https://arcprize.org/arc-agi/3) ·
[Docs + SDK](https://docs.arcprize.org/) ·
[Technical report](https://arcprize.org/media/ARC_AGI_3_Technical_Report.pdf) ·
[Graph-based exploration paper](https://arxiv.org/pdf/2512.24156) ·
[DataCamp overview](https://www.datacamp.com/blog/arc-agi-3)

---

## 4. Running it

```bash
bun run start            # boots :7090 app + :7091 chat door + :7093 ARC door
# open the app → Apps → AGI · ARC 3 → pick a world → ▶ Let her play
```

No key? The organ auto-uses the platform's anonymous lane when reachable and
the onboard arcade always works offline.

```bash
bun test core/tests/arc3Engine.test.ts   # 15 pins: blind wins, honesty, chrome
```
