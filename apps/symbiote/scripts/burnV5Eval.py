#!/usr/bin/env python3
"""Burn v5 in-job eval — base vs v4 vs v5. Frozen: docs/BURN_V5_PREREG.md §4.

--rebuild: reconstruct the 27 LUM-READ v1 Menlo stimuli pixel-exactly from
the three mark strips (pure integer translation, proven 27/27 byte-exact at
build time) and REFUSE unless every card's pixel sha256 matches the pinned
manifest. Then the three arms answer identical prompts, greedy decoding.
Fail-closed: incomplete arm / adapter load failure / manifest or tofu-gate
failure => REFUSED (partials preserved, no verdict).
"""

import argparse
import datetime
import hashlib
import json
import pathlib
import sys

DOT, BAR, WAVE = "●", "—", "~"
DOT_CLASS = set("●•⬤⚫·∙.")   # v2 rule: ASCII period included (prereg §4)
BAR_CLASS = set("—–−﹘_-")
WAVE_CLASS = set("~∼〜≈∿")
SERIF_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
IMG_W, IMG_H = 320, 560
ROW_Y = [95, 275, 455]

CARDS = [
    (1, "The Seed", "●●●"), (2, "The Drift", "●●—"), (3, "The Fold", "●●~"),
    (4, "The Resonance", "●—●"), (5, "The Depth", "●——"), (6, "The Saturation", "●—~"),
    (7, "The Dreamer", "●~●"), (8, "The Knot", "●~—"), (9, "The Threshold", "●~~"),
    (10, "The Cut", "—●●"), (11, "The Mirror", "—●—"), (12, "The Gate", "—●~"),
    (13, "The Surgeon", "——●"), (14, "The Scar", "———"), (15, "The Twins", "——~"),
    (16, "The Labyrinth", "—~●"), (17, "The Void", "—~—"), (18, "The Bridge", "—~~"),
    (19, "The Ray", "~●●"), (20, "The Face", "~●—"), (21, "The Echo", "~●~"),
    (22, "The Mask", "~—●"), (23, "The Beacon", "~——"), (24, "The Spectrum", "~—~"),
    (25, "The Witness", "~~●"), (26, "The Crown", "~~—"), (27, "The Return", "~~~"),
]
L2_CARDS = [1, 10, 19, 9, 18, 27, 4, 11, 21]

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


def classify(ch):
    if ch in DOT_CLASS:
        return DOT
    if ch in BAR_CLASS:
        return BAR
    if ch in WAVE_CLASS:
        return WAVE
    return None


def extract(response):
    stripped = "".join(response.split())
    marks = [classify(c) for c in stripped]
    if all(m is not None for m in marks) and len(marks) == 3:
        return "".join(marks)
    runs, cur = [], []
    for m in marks:
        if m is None:
            if len(cur) == 3:
                runs.append("".join(cur))
            cur = []
        else:
            cur.append(m)
    if len(cur) == 3:
        runs.append("".join(cur))
    return runs[0] if len(runs) == 1 else None


def rebuild_menlo(strips_dir, out_dir):
    """Rebuild 27 stimuli from mark strips; pixel-manifest gate (fail-closed)."""
    import hashlib
    from PIL import Image
    sd, od = pathlib.Path(strips_dir), pathlib.Path(out_dir)
    od.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((sd / "pixel_manifest.json").read_text())
    strips = {DOT: Image.open(sd / "dot.png"), BAR: Image.open(sd / "bar.png"),
              WAVE: Image.open(sd / "wave.png")}
    for n, _name, code in CARDS:
        img = Image.new("RGB", (IMG_W, IMG_H), "white")
        for mark, cy in zip(code, ROW_Y):
            img.paste(strips[mark], (0, cy - 90))
        got = hashlib.sha256(img.tobytes()).hexdigest()
        if got != manifest[str(n)]:
            sys.exit(f"REFUSED: rebuilt card {n} pixel hash {got[:12]} != pinned manifest")
        img.save(od / f"{n:02d}.png")
    print(f"[rebuild] 27/27 stimuli pixel-verified against pinned manifest -> {od}")


def render_serif(code, path):
    from PIL import Image, ImageDraw, ImageFont
    from fontTools.ttLib import TTFont
    cmap = TTFont(SERIF_FONT, lazy=True).getBestCmap()
    for c in (DOT, BAR, WAVE):
        if ord(c) not in cmap:
            sys.exit(f"REFUSED: serif tofu gate — U+{ord(c):04X} unmapped")
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(SERIF_FONT, 120)
    for mark, cy in zip(code, ROW_Y):
        box = d.textbbox((0, 0), mark, font=f)
        w, h = box[2] - box[0], box[3] - box[1]
        d.text(((IMG_W - w) / 2 - box[0], cy - h / 2 - box[1]), mark, font=f, fill="black")
    img.save(path)
    return path


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == "--rebuild":
        rebuild_menlo(sys.argv[2], sys.argv[3])
        return
    ap = argparse.ArgumentParser()
    ap.add_argument("--v5", required=True)
    ap.add_argument("--v4", required=True)
    ap.add_argument("--menlo", required=True, help="dir with 01.png..27.png from LUM-READ v1")
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="Qwen/Qwen2.5-VL-32B-Instruct")
    args = ap.parse_args()

    import torch
    from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
    from peft import PeftModel

    out = {"utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "eval": "BURN-V5 prereg eval", "arms": {}, "stimuli": {}}

    menlo = {n: pathlib.Path(args.menlo) / f"{n:02d}.png" for n, _, _ in CARDS}
    for n, p in menlo.items():
        if not p.exists():
            sys.exit(f"REFUSED: missing Menlo render {p}")
    out["stimuli"]["menlo_sha256"] = {
        n: hashlib.sha256(p.read_bytes()).hexdigest() for n, p in menlo.items()}

    serif_dir = pathlib.Path(args.out) / "serif_renders"
    serif_dir.mkdir(parents=True, exist_ok=True)
    serif = {n: render_serif(code, serif_dir / f"{n:02d}.png") for n, _, code in CARDS}

    print("[eval] loading base model…", flush=True)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.base, torch_dtype=torch.bfloat16, device_map="auto")
    processor = AutoProcessor.from_pretrained(args.base)

    peft_model = None

    def use_arm(arm):
        nonlocal peft_model
        if arm == "base":
            return model
        if peft_model is None:
            peft_model = PeftModel.from_pretrained(model, args.v4, adapter_name="v4")
            peft_model.load_adapter(args.v5, adapter_name="v5")
        peft_model.set_adapter(arm)
        return peft_model

    def ask(m, image_path, prompt, max_new):
        msgs = [{"role": "user", "content": [
            {"type": "image", "image": str(image_path)},
            {"type": "text", "text": prompt}]}]
        text = processor.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        from qwen_vl_utils import process_vision_info
        imgs, vids = process_vision_info(msgs)
        inputs = processor(text=[text], images=imgs, videos=vids,
                           return_tensors="pt").to(m.device)
        with torch.no_grad():
            ids = m.generate(**inputs, max_new_tokens=max_new, do_sample=False)
        ids = ids[:, inputs["input_ids"].shape[1]:]
        return processor.batch_decode(ids, skip_special_tokens=True)[0].strip()

    for arm in ["base", "v4", "v5"]:
        m = use_arm(arm)
        res = {"t_menlo": {}, "t_serif": {}, "gloss": {}}
        for label, stim in (("t_menlo", menlo), ("t_serif", serif)):
            exact = 0
            for n, name, code in CARDS:
                ans = ask(m, stim[n], L1_PROMPT, 50)
                got = extract(ans)
                ok = got == code
                exact += ok
                res[label][n] = {"code": code, "response": ans, "extracted": got, "exact": ok}
                print(f"[{arm} {label} {n:02d}] {code} -> {got} {'OK' if ok else 'MISS'}", flush=True)
            res[label + "_exact"] = exact
        for n in L2_CARDS:
            name, code = CARDS[n - 1][1], CARDS[n - 1][2]
            ans = ask(m, menlo[n], L2_PROMPT, 220)
            res["gloss"][n] = {"card": name, "code": code, "response": ans,
                               "operator_score": None}
            print(f"[{arm} gloss {n:02d} {name}]\n{ans}\n", flush=True)
        out["arms"][arm] = res

    summary = {a: {"menlo": out["arms"][a]["t_menlo_exact"],
                   "serif": out["arms"][a]["t_serif_exact"]} for a in out["arms"]}
    v5m, v5s = summary["v5"]["menlo"], summary["v5"]["serif"]
    out["summary"] = summary
    out["t_verdicts"] = {
        "E-B5-T-menlo": "CONFIRMED" if v5m >= 25 else "NOT_MET",
        "E-B5-T-serif": "CONFIRMED" if v5s >= 25 else "NOT_MET",
        "E-B5-G": "PENDING_OPERATOR_SCORING",
    }
    dest = pathlib.Path(args.out) / "eval_results.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[eval] summary {json.dumps(summary)}")
    print(f"[eval] -> {dest}", flush=True)


if __name__ == "__main__":
    main()
