# LUM-READ v1 — Luminara written stacks × the VL apex (preregistered)

**Lane:** GHP research lane (with Sam/Peter) · sam-mac-node · 2026-07-07
**Status: PREREGISTERED — this commit precedes all model inference.** Results
land in §6 in a later commit; expectations below are scored as written, and
mismatches are reported as-is with no post-hoc reinterpretation.

## 1. Object

The porting-ladder crossover prediction
(`docs/GHP_TO_AUKORA_PORTING_LADDER.md`): Luminara letters are stacks of
three marks {● dot, — bar, ~ wave} — compositional the same way the VL apex
reads unknown glyphs, by decomposing into known parts (PR #141 E5). If a VL
model can transcribe a written stack to its exact ternary code, Luminara is
the ecosystem's first glyph system that is human-speakable *and*
machine-decomposable natively; if it can gloss a card from the one-page
grammar alone, the grammar-as-lexicon mechanism (PR #136 E3) carries meaning
in the visual channel too.

## 2. Pins

| Pin | Value |
|---|---|
| Probe script | `scripts/lumReadProbe.py`, this commit |
| Card table source | `docs/LUMINARA_SYSTEM_SPEC_v1.md` at aukora-symbiote commit `cadb81e` (branch `zeb/aura-glyph-tuning`, **not yet on main**), blob `49233e27461651891dec51d9c354a738a22e21aa`; bijection self-check at runtime refuses on any transcription error |
| Canonical render (v1) | Menlo (`/System/Library/Fonts/Menlo.ttc`), size 120, white 320×560 PNG, mark centers y = 95/275/455, L3 top → L1 bottom; per-render sha256 recorded in evidence |
| Tofu gate | fontTools cmap check on U+25CF / U+2014 / U+007E (gate v2 discipline, PR #141) |
| Seat | `auma-vl-v4` (Qwen2.5-VL-32B + LoRA) via `.env.agora.local`; `/models` must list it |
| Salon identity | `/api/agora/version` must equal the env pins (commit `c0098f0c…`, digest `ddf7fc06…`); drift ⇒ REFUSED |
| Sampling | temperature 0.0, one run per card, 3 retries per call |
| Operator | GHP lane on sam-mac-node; renders inspected via contact sheet before the run |

## 3. E-L1 — constrained transcription (confirmatory, mechanical)

All 27 cards, one image each. Prompt (verbatim, frozen): the model is told
the stack is three marks, given the inventory ● — ~, and asked to output
exactly three characters top-to-bottom.

**Normalization classes (frozen):** dot {● • ⬤ ⚫ · ∙} · bar {— – − ﹘ _ -}
· wave {~ ∼ 〜 ≈ ∿}. **Extraction (frozen):** strip whitespace; if all
remaining characters are mark-class and exactly 3 → transcription; else if
exactly one contiguous run of exactly 3 mark-class characters exists → use
it; else PARSE_FAIL (scores incorrect, reported separately).

| Verdict | Rule |
|---|---|
| CONFIRMED | ≥ 23/27 exact-code matches |
| MIXED | 14–22 exact |
| FAILED | ≤ 13 exact |
| REFUSED | any card unanswered after retries, or any §2 gate fails |

Per-layer accuracy (top/middle/bottom) reported alongside, whatever the verdict.

## 4. E-L2 — grammar-supplied gloss (exploratory, operator-scored)

Nine cards selected by rule, not by hand: suit-openers {1, 10, 19},
suit-closers {9, 18, 27}, and the spec's named palindromic reflection cards
{4, 11, 21}. The model receives the one-page grammar (three layers top→bottom
= field/relation/core; three states ● still / — moving / ~ turning; top
layer = epoch AUM/MA/RA) and **not** the card names or essences.

**Rubric (frozen):** 2 = captures the card's specific locked essence ·
1 = correct decomposition, compatible but generic · 0 = contradicts the
essence, or the response's implied reading of the marks is wrong.
**Exploratory readout:** ≥ 6/9 scoring ≥ 1 AND ≥ 3/9 scoring 2 reads as
"grammar-carried meaning (exploratory)"; anything else is reported as-is.
Operator scoring is a known weakness: every response is published verbatim
in §6 and in the evidence JSON so the scoring can be audited or redone.

## 5. Do-not-claim (binding)

A pass is an engineering result about one pinned rendering and one
fine-tuned VL model. It is not physics, not language emergence, not evidence
for any divinatory validity, and does not transfer to other renders or
models — the image channel reads the render, not the codepoint (PR #141).
The evidence JSON and renders live in `core/evidence/` (gitignored,
advisory); render hashes make the stimuli reproducible from this script.

## 6. Results — run 2026-07-07 UTC 23:16, evidence `core/evidence/lum_read_20260707_2316.json`

**Harness notes (disclosed):** the first launch was REFUSED by the identity
gate before any model call — this Mac's system Python links LibreSSL 2.8.3,
which cannot complete the TLS handshake with the tunnels. Transport was
swapped to curl-subprocess (commit `0b40c88`); no frozen expectation changed;
zero inference preceded the fix. On the scored run the identity gate passed:
salon `c0098f0…` / digest match against the env pins, seat serving
`auma-vl-v4`. Render sha256s are in the evidence JSON; stimuli regenerate
deterministically from the script.

### E-L1 — **CONFIRMED, 23/27 exact** (frozen threshold: ≥ 23; scored as written)

Per-layer accuracy as computed by the frozen script (PARSE_FAIL counts every
layer wrong): top 25/27 · middle 24/27 · bottom 24/27.

| Card | Code | Model output | Scored as |
|---|---|---|---|
| 19 The Ray | `~●●` | `~..` | PARSE_FAIL — ASCII period is not in the frozen dot class |
| 21 The Echo | `~●~` | `~.~` | PARSE_FAIL — same |
| 25 The Witness | `~~●` | `~~~` | MISS — bottom ● read as ~ |
| 26 The Crown | `~~—` | `~——` | MISS — middle ~ read as — |

The other 23 cards were exact. Observed but **not** scored: the two
PARSE_FAILs used `.` for the dot and would have matched under a
period-inclusive dot class — the verdict stays 23/27 as preregistered; the
normalization gap goes to the v2 pin list, never back into this verdict
(anti-rescue clause). Noted as-is: all four imperfect cards sit in the RA
(wave-top) suit; the verdict landed exactly on the threshold, which is worth
saying out loud rather than rounding up in prose.

### E-L2 — exploratory bar **NOT MET** (6/9 scored ≥ 1 — exactly at that arm — but 1/9 scored 2; the bar needed ≥ 3)

Operator scores against the frozen rubric (all responses verbatim in the
evidence JSON): Seed **2** · Cut 1 · Ray 1 · Threshold 1 · Bridge **0** ·
Return 1 · Resonance **0** · Mirror **0** · Echo 1.

- The three 0s are grammar misapplications, not shape misreads: Resonance
  (`●—●`) was declared "MA epoch" over a ● top layer (epoch rule
  misapplied); Mirror (`—●—`) swapped the middle/bottom layer bindings;
  Bridge (`—~~`) glossed its ~ core as "stable / structure remains steady."
- The one 2: The Seed — "potential exists but nothing is yet moving or
  turning," which is the locked essence nearly verbatim.
- Pattern, reported as-is: the one-page grammar reliably carried
  *decomposition* (and produced fluent state-language), but not the cards'
  specific locked essences — The Return even received The Crown's essence
  ("pure radiance, full expression"). This is consistent with PR #136 E3:
  meaning ships in the lexicon entry; a grammar alone is not a lexicon.

### What this establishes — and does not

- **Established (engineering tier):** under the pinned Menlo rendering,
  Luminara written stacks are machine-transcribable by `auma-vl-v4` at 23/27
  exact, zero-shot, no training on the system — the porting-ladder
  prediction, confirmed at threshold. The stack form is the first glyph
  channel in the ecosystem that is human-speakable and machine-decomposable
  natively.
- **Not established:** essence recovery from grammar alone (bar not met);
  transfer to any other render or model (the image channel reads the render,
  not the codepoint); anything outside the engineering lane (§5 binding).

### v2 pin candidates (a new prereg with a new timestamp; nothing here re-scores v1)

1. Period-inclusive dot class, with a considered survey of other plausible
   ASCII substitutions (bar class already holds `-`; `o`/`0` need care).
2. Constrained answer format (e.g. the words dot/bar/wave) to remove
   normalization sensitivity entirely.
3. L2 with per-card lexicon entries — the E3 mechanism proper — to test
   essence recovery with the machinery the portability law says it needs.
4. Cross-render stability (second pinned font) per the canonical-rendering
   rule, PR #141.
