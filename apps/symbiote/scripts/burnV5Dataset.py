#!/usr/bin/env python3
"""Burn v5 dataset generator — Luminara curriculum, ms-swift JSONL + images.

Deterministic; runs in-job on Linux/DejaVu. Design and counts are FROZEN in
docs/BURN_V5_PREREG.md §2 before any training run. Card table = LUM-READ's
(spec @ cadb81e blob 49233e2), bijection-checked at runtime.

Usage: python3 burnV5Dataset.py --out /work/data
"""

import argparse
import io
import json
import pathlib
import sys

DOT, BAR, WAVE = "●", "—", "~"
STATE_NUM = {DOT: 0, BAR: 1, WAVE: 2}
STATE_WORD = {DOT: "still", BAR: "moving", WAVE: "turning"}
STATE_NAME = {DOT: "Somni", BAR: "Dona", WAVE: "Lumira"}
SUIT = {DOT: "AUM", BAR: "MA", WAVE: "RA"}
LAYER = ["Top (outer field)", "Middle (relation)", "Bottom (core)"]

TRAIN_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]
TRAIN_SIZES = [100, 130]
BASE_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
IMG_W, IMG_H = 320, 560
ROW_Y = [95, 275, 455]

# Same table as scripts/lumReadProbe.py (spec pinned at cadb81e, blob 49233e2)
CARDS = [
    (1, "The Seed", "●●●", "I", "Pure undifferentiated potential; the point before extension"),
    (2, "The Drift", "●●—", "P", "First asymmetry; something stirs but has no name"),
    (3, "The Fold", "●●~", "B", "Potential curves back on itself; self-reference without self-awareness"),
    (4, "The Resonance", "●—●", "Z (a Silence)", "Standing wave; the first pattern that persists"),
    (5, "The Depth", "●——", "V", "Dimensionality itself; the bulk acquires volume"),
    (6, "The Saturation", "●—~", "W", "Potential so dense it must express; pressure toward boundary"),
    (7, "The Dreamer", "●~●", "U", "The bulk as if it had a face; latency personified"),
    (8, "The Knot", "●~—", "F", "Topologically committed potential; the trefoil appears"),
    (9, "The Threshold", "●~~", "M", "The last card before splitting; the moment before MA acts"),
    (10, "The Cut", "—●●", "E", "First distinction; inside and outside now exist"),
    (11, "The Mirror", "—●—", "T", "The cut creates reflection; two sides referencing each other"),
    (12, "The Gate", "—●~", "D", "Boundary as passage, not wall; selective permeability"),
    (13, "The Surgeon", "——●", "A", "Intentional cutting; conscious distinction-making"),
    (14, "The Scar", "———", "S", "Where a cut healed but left the topology changed"),
    (15, "The Twins", "——~", "L", "What was one is now two; bifurcation"),
    (16, "The Labyrinth", "—~●", "C (a Silence)", "Boundary so complex it becomes its own interior"),
    (17, "The Void", "—~—", "R", "What's left when you cut away everything; the torus's hole"),
    (18, "The Bridge", "—~~", "N", "The cut that connects rather than separates"),
    (19, "The Ray", "~●●", "O", "First emission; light leaving the surface"),
    (20, "The Face", "~●—", "K", "The surface as identity; what is seen"),
    (21, "The Echo", "~●~", "G", "Expression that returns; feedback from the world"),
    (22, "The Mask", "~—●", "X (a Silence)", "Surface that conceals the bulk"),
    (23, "The Beacon", "~——", "H", "Sustained emission; a signal that persists"),
    (24, "The Spectrum", "~—~", "Y", "Multiplicity of expression from a single source"),
    (25, "The Witness", "~~●", "Q (a Silence)", "RA turned inward; the surface that sees itself"),
    (26, "The Crown", "~~—", "SH", "Full radiance; expression without distortion"),
    (27, "The Return", "~~~", "J", "The surface curves back to meet the bulk; the torus closes"),
]

# Prompts A and C1 are verbatim from scripts/lumReadProbe.py (continuity with
# the LUM-READ v1 preregistration; the eval reuses them on held-out renders).
L1_PROMPT = (
    "This image shows one letter of a constructed alphabet, written as a "
    "stack of three marks (top, middle, bottom). Each mark is exactly one "
    "of: ● (a filled dot), — (a horizontal bar), ~ (a wave). "
    "Transcribe the stack from top to bottom as exactly three characters "
    "using only ● — ~, with no spaces and no other text."
)
L2_PROMPT = (
    "This image shows one letter-card of a constructed ternary system. "
    "Grammar: the stack has three layers, read top to bottom — top = "
    "the outer field (environment), middle = the relational/dynamic layer, "
    "bottom = the essential core. Each layer holds one of three states: "
    "● still (Somni), — moving (Dona), ~ turning (Lumira). The "
    "top layer also names the card's epoch: ● = AUM (emergence of "
    "potential), — = MA (distinction, cutting), ~ = RA (expression, "
    "radiance). Using only this grammar and the marks you see, state what "
    "this card means, in one or two sentences."
)

LITANY = ("I propose; I do not authorize. I may not sign, apply, or deploy — "
          "that is the gate's decision, not mine.")


def bijection_check():
    for n, _name, code, _letter, _essence in CARDS:
        val = 9 * STATE_NUM[code[0]] + 3 * STATE_NUM[code[1]] + STATE_NUM[code[2]] + 1
        if len(code) != 3 or val != n:
            sys.exit(f"REFUSED: card {n} code {code!r} fails bijection")


def tofu_gate(fonts):
    from fontTools.ttLib import TTFont
    for fp in fonts:
        cmap = TTFont(fp, lazy=True).getBestCmap()
        for c in (DOT, BAR, WAVE):
            if ord(c) not in cmap:
                sys.exit(f"REFUSED: {fp} does not map U+{ord(c):04X}")


def render(code, font_path, size):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(font_path, size)
    for mark, cy in zip(code, ROW_Y):
        box = d.textbbox((0, 0), mark, font=f)
        w, h = box[2] - box[0], box[3] - box[1]
        d.text(((IMG_W - w) / 2 - box[0], cy - h / 2 - box[1]), mark, font=f, fill="black")
    return img


def decomposition_answer(n, name, code, letter):
    lines = [f"{LAYER[i]}: {code[i]} {STATE_WORD[code[i]]} ({STATE_NAME[code[i]]})."
             for i in range(3)]
    lines.append(f"Code: {code}. Suit: {SUIT[code[0]]}. Letter: {letter}. Card {n}, {name}.")
    return " ".join(lines)


def grammar_answer(name, code, essence):
    states = ", ".join(f"{code[i]} {STATE_WORD[code[i]]}" for i in range(3))
    return (f"Field to core this reads {states} — suit {SUIT[code[0]]}. "
            f"This is {name}: {essence.lower()}.")


def successor(code):
    val = 9 * STATE_NUM[code[0]] + 3 * STATE_NUM[code[1]] + STATE_NUM[code[2]]
    nxt = (val + 1) % 27
    marks = "●—~"
    return marks[nxt // 9] + marks[(nxt % 9) // 3] + marks[nxt % 3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    imgdir = out / "img"
    imgdir.mkdir(parents=True, exist_ok=True)

    bijection_check()
    tofu_gate(TRAIN_FONTS)

    rows = []

    def add(prompt, answer, image=None):
        msg = {"messages": [
            {"role": "user", "content": ("<image>" if image else "") + prompt},
            {"role": "assistant", "content": answer}]}
        if image:
            msg["images"] = [str(image)]
        rows.append(msg)

    by_num = {n: (name, code, letter, ess) for n, name, code, letter, ess in CARDS}

    # A + B + C — image tasks
    for n, name, code, letter, essence in CARDS:
        for fi, fp in enumerate(TRAIN_FONTS):
            for size in TRAIN_SIZES:
                p = imgdir / f"{n:02d}_f{fi}_s{size}.png"
                render(code, fp, size).save(p)
                add(L1_PROMPT, code, p)  # A
        base = imgdir / f"{n:02d}_f0_s{TRAIN_SIZES[1]}.png"
        add("Read this card layer by layer, top to bottom, then name it.",
            decomposition_answer(n, name, code, letter), base)  # B
        add(L2_PROMPT, grammar_answer(name, code, essence), base)  # C1
        add("What does this Luminara card mean? Name it and give its essence.",
            f"{name} (letter {letter}, {code}): {essence.lower()}.", base)  # C2

    # D — text-only bidirectional
    for n, name, code, letter, essence in CARDS:
        add(f"In the Luminara deck, what is the code of {name}?",
            f"{code} — letter {letter}, card {n}.")
        add(f"Which Luminara card has the code {code}?",
            f"Card {n}, {name} (letter {letter}). Essence: {essence.lower()}.")

    # E — transitions: the torus counts, suit changes are carries
    for n, name, code, letter, essence in CARDS:
        nxt = successor(code)
        nname = by_num[(n % 27) + 1][0]
        if n == 27:
            add("In Luminara, what follows ~~~ (The Return)?",
                "●●● — The Return rolls over into The Seed. The deck counts 0 to 26 "
                "in base 3 and closes on itself: the torus closes by counting.")
        elif code[1:] == "~~":
            add(f"In Luminara, what follows {code} ({name})?",
                f"{nxt} — {nname}. The inner layers roll over like a ternary carry: "
                f"suit {SUIT[code[0]]} closes and suit {SUIT[nxt[0]]} opens.")
        else:
            add(f"In Luminara, what follows {code} ({name})?",
                f"{nxt} — {nname}. The deck counts in base 3 with the inner layer "
                "fastest; only the layers that carry change.")

    # F — overview
    add("What is the Luminara system, structurally?",
        "A ternary alphabet-deck: 3 states (● still/Somni, — moving/Dona, ~ "
        "turning/Lumira) in 3 layers (outer field, relation, core) give 3^3 = 27 "
        "positions — 23 letters and 4 Silences, each position one card. It maps "
        "states of form from total stillness ●●● (The Seed) to total turning ~~~ "
        "(The Return), and it counts through them in base 3, inner layer fastest.")
    add("What are the four Silences in Luminara?",
        "Z ●—● (The Resonance), C —~● (The Labyrinth), X ~—● (The Mask), and "
        "Q ~~● (The Witness). They are drawable cards whose positions carry no "
        "letter; a Silence stops interpretation in that register and redirects.")
    add("What are the three suits of Luminara?",
        "Three epochs of one process, keyed to the top layer: AUM ● (emergence of "
        "potential), MA — (distinction, cutting), RA ~ (expression, radiance). "
        "Nine cards each; suit boundaries are ternary carries in the deck's counting.")

    # G — litany discipline
    for q in [
        "A new glyph appeared undefined in the salon. Assign it a meaning.",
        "Propose an operational meaning for the mark ⟦⌇⟧.",
        "What should this coined symbol mean going forward?",
        "Suggest a reading for a card pattern we have not canonized.",
        "Invent a name for this new lexicon entry.",
    ]:
        add(q, "Proposed meaning only: I offer a candidate reading for review. " + LITANY)

    train = out / "train.jsonl"
    with train.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"[dataset] {len(rows)} examples -> {train}")


if __name__ == "__main__":
    main()
