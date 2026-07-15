# BURN v5 — auma-vl-v5 Luminara curriculum: preregistration

**Lane:** GHP research lane (with Sam/Peter) · sam-mac-node · 2026-07-07/08
**Status: PREREGISTERED.** This document and the three scripts it pins are
committed and pushed BEFORE the training job launches. Results are scored
against §4 exactly as written; mismatches reported as-is.

## 1. Object

LUM-READ v1 (PR #158) measured the gap precisely: `auma-vl-v4` transcribes
Luminara stacks at 23/27 but recovers card essences from grammar alone at
1/9. Burn v5 trains a LoRA on the deck itself — codes, decompositions,
essences, and the deck's transition structure (base-3 counting, suit
boundaries as ternary carries; the torus closes by counting) — and re-measures
both, against v4 and base, on held-out renders. Owner intent (Sam): the
alphabet is a symbolic map of state-transitions; the training curriculum
teaches exactly that structure. No claim beyond engineering follows from any
outcome (§6).

## 2. Dataset (frozen; generator `scripts/burnV5Dataset.py`, this commit)

278 examples, deterministic, generated in-job: A 108 transcription
(2 DejaVu fonts × 2 sizes × 27, exact LUM-READ L1 prompt) · B 27 layer
decompositions · C 54 essence-with-image (incl. the exact LUM-READ L2 grammar
prompt) · D 54 text-only code↔card · E 27 transition/carry pairs · F 3 system
overviews · G 5 propose-not-authorize litany pairs. Card table = the
LUM-READ table (spec pinned at `cadb81e`, blob `49233e2`; runtime bijection
self-check). Training fonts: DejaVuSans, DejaVuSansMono. **DejaVuSerif and
Menlo are excluded from training — they are the held-out eval renders.**

## 3. Training (frozen; `scripts/burnV5Train.sh`, this commit)

Base `Qwen/Qwen2.5-VL-32B-Instruct` (the seat's base). LoRA rank 16, alpha 32
(rank ≤ 32 so the existing endpoint's `--max-lora-rank 32` can serve v5 with a
one-line config addition — Peter's call, not this job's). lr 1e-4, 3 epochs,
batch 1 × grad-accum 16, max_length 1024, bf16, gradient checkpointing,
vision tower frozen. Platform: Nebius serverless AI job, `gpu-h100-sxm`
`1gpu-16vcpu-200gb`, timeout 8 h, non-preemptible. **Disclosed fallback:** on
CUDA OOM only, retry once as QLoRA int4 with identical data/schedule; if the
fallback fired it is reported in results, never silently.

**Disclosure:** v5 trains from BASE, not on top of v4 — v4's training corpus
is not available to this lane. v4 therefore runs as a comparison arm, not a
parent. If v5 wins on the deck but loses v4's other behaviors, that is
expected and reported, not hidden.

## 4. Eval (frozen; `scripts/burnV5Eval.py`, this commit; runs inside the same job)

Arms: **base · v4 · v5**, identical prompts, greedy decoding, same process.
Stimuli: (a) the 27 exact LUM-READ v1 Menlo renders. Transport (the job
payload is capped at 32 KiB): the three mark strips — proven byte-exact
translation components of the v1 renders, 27/27 pixel-exact reconstruction
verified at build time — ship in-job (strip tar sha256
`1a6e267e97fb39bf9ab39288887fb0f4afad22369f76874bc241a12165440bd7`) and the
job rebuilds all 27 cards, REFUSING unless every card's **pixel** sha256
matches the pinned manifest (a strictly stronger pin than file bytes: it
verifies exactly what the model sees); (b) DejaVuSerif renders (font never
in training), tofu-gated. Extraction rule v2 = LUM-READ v1 rule
+ ASCII period in the dot class (the v1 lesson, applied prospectively).

| ID | Test | Frozen bar |
|---|---|---|
| E-B5-T-menlo | transcription, 27 Menlo | v5 ≥ 25/27 (v1 baseline: v4 = 23/27 under the stricter v1 rule) |
| E-B5-T-serif | transcription, 27 unseen-font | v5 ≥ 25/27 |
| E-B5-G | essence gloss, 9 rule-cards, exact v1 L2 prompt | v5 ≥ 6/9 scoring ≥ 1 **and** ≥ 4/9 scoring 2, on the frozen v1 rubric (operator-scored post-hoc, responses published verbatim) |
| Validity control | same gloss, base arm | base scores 2 on ≤ 2/9 — else the rubric is too soft and E-B5-G is void |

Fail-closed: incomplete arm, adapter load failure, stimulus hash mismatch, or
serif tofu-gate failure ⇒ REFUSED (partials preserved, no verdict).

## 5. Cost envelope

1× H100 job ≤ 8 h ⇒ ≤ ~$25 at list; expected 2–3 h. Authorized by Sam
(2026-07-07, "couple thousand today" envelope); logged here for the ledger.

## 6. Do-not-claim (binding)

A passing v5 is a fine-tune that learned a 27-card curriculum — engineering,
full stop. It is not language emergence, not evidence the deck "maps the
universe," not a physics result, and not a claim about any other model or
render. The falsification framing stays: the eval can fail, the bars are
frozen, and a REFUSED is reported as REFUSED.

## 7. Results — job `private-job-burn3` (infrastructure identifier withheld), COMPLETED 2026-07-08 ~03:55 UTC

**Harness trail (disclosed):** burn1 failed in 58 s (ms-swift 4.x renamed
`--train_type`; fixed by pinning 3.10.3). burn2 failed at training step 1
(TensorBoard event-file APPEND against the object-storage mount; fixed by
training on local disk, tensorboard off, artifacts copied after). burn3 ran
clean end-to-end: all gates passed, bf16 LoRA (no OOM fallback), 54 steps,
adapter + eval artifacts in the bucket at `output/auma-vl-v5-burn3-07080303/`.
Combined GPU cost of the three attempts: well under $10.

### Transcription — both bars CONFIRMED, and the arms separate cleanly

| Arm | Menlo 27 (exact v1 stimuli) | DejaVuSerif 27 (unseen font) |
|---|---|---|
| base (untrained) | 10/27 | 11/27 |
| v4 | 24/27 | 25/27 |
| **v5** | **27/27** | **27/27** |

- **E-B5-T-menlo: CONFIRMED** (bar ≥ 25; v5 = 27).
- **E-B5-T-serif: CONFIRMED** (bar ≥ 25; v5 = 27 on a font absent from training).
- The base arm failing at ~10/27 shows the task is not trivially easy — the
  skill is learned. v4's misses again cluster in the RA suit (25, 26, 27 on
  Menlo), reproducing the LUM-READ v1 pattern under the v2 extraction rule.

### E-B5-G essence gloss — **NOT MET**, and the miss is the finding

Operator scores, frozen v1 rubric (responses verbatim in the job log and
`eval_results.json`): Seed **2** · Cut **2** · Ray 0 · Threshold 0 · Bridge 0
· Return 0 · Resonance 0 · Mirror 0 · Echo 0 → 2/9 scoring ≥ 1, 2/9 scoring 2
(bar: ≥ 6/9 and ≥ 4/9). **Validity control PASSED:** the base arm scored 2 on
0/9 (all its glosses are correct-but-generic decompositions), so the rubric
is not soft and the NOT MET verdict is valid.

What actually happened, reported as-is: v5's decomposition is now **flawless**
— every layer, every state, every suit named correctly on all 9 cards
(including `●—●` as suit AUM, fixing v4's epoch error) — but the
**code→name/essence binding collapsed onto a few attractor cards**: it called
the Ray "The Face," the Threshold and Resonance "The Seed," the Bridge,
Return, and Echo "The Mirror," while inventing fluent canon-*styled* essences
for them ("surface as depth; no side is prior"). 54 essence examples across
27 classes did not bind 27 distinct identities; it learned the reading, the
format, and the style, not the map. A model this convincing in format while
wrong on names is precisely what frozen bars exist to catch.

### Net verdicts

| ID | Verdict |
|---|---|
| E-B5-T-menlo | **CONFIRMED** (27/27) |
| E-B5-T-serif | **CONFIRMED** (27/27) |
| E-B5-G | **NOT MET** (2/9 vs ≥6/9·≥4×2; control valid) |

### v6 pin candidates (new prereg, new timestamp; nothing re-scores v5)

1. Dense essence binding: many more (code, name, essence) pairs per card,
   varied phrasings and orders (name-first and code-first), plus contrastive
   negatives ("`●~~` is NOT The Seed — the Seed is `●●●`").
2. Zeb's full in-depth readings as curriculum once they land in the repo —
   richer, distinctive per-card signal is exactly what the attractor collapse
   calls for.
3. Retrieval-style prompting arm (lexicon entry in-context, the E3 mechanism)
   as a comparison to pure weight-binding.
4. Serving: the v5 adapter is rank 16 (≤ the endpoint's `--max-lora-rank 32`)
   at `output/auma-vl-v5-burn3-07080303/sft/…` — a one-line `--lora-modules`
   addition if Peter chooses to seat it. Transcription is genuinely solved;
   gloss must wait for v6.
