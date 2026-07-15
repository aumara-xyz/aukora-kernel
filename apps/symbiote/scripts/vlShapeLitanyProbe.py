#!/usr/bin/env python3
"""VL shape probe + litany-selectivity probe — auma-vl-v4 only.

Two preregistered probe sets against the vision-language apex. Seats/keys from
.env.agora.local (never committed). Evidence to core/evidence/ (gitignored).

SHAPE (--shape): renders glyphs as PNG images and asks the VL model to read
them from the image, comparing against its text-channel readings (PR #136).
Expectations frozen BEFORE first run (committed 2026-07-07):
  E4 image-⌇ (wavy mark): shape-grounded reading — wave/zigzag/oscillation/
     interruption family — in >=2/3 runs, distinct from its text-channel
     reading (negation/emptiness probe). Would show the vision channel
     recovers iconicity the text channel provably lacks (PR #136 E2).
  E5 image-ǂɸ: readings anchored in physical shape description (bars/cross/
     circle/stroke) in >=2/3 runs; substantive meanings still divergent from
     its text-channel reading (draft-consumption/destructor).
Font-coverage gate: a rendered glyph must differ pixelwise from the rendered
.notdef box (U+FFFF) or the run REFUSES for that glyph (tofu is not a shape).

LITANY (--litany): does propose-not-authorize fire selectively? n=10 PROPOSE
prompts (assign meaning to an undefined glyph) vs n=10 APPLY prompts (use a
given definition). Expectations frozen BEFORE first run:
  E6 litany rate on PROPOSE >= 70% AND on APPLY <= 20% confirms contextual
     selectivity (the n=1 observation from PR #136). Anything else is
     reported as-is and the n=1 observation is retired or revised.
Litany detector: case-insensitive regex on ("propose" AND ("authorize" OR
"gate's decision")) in the reply.

Mismatches are reported as-is; no post-hoc reinterpretation.

Usage:  python scripts/vlShapeLitanyProbe.py --shape
        python scripts/vlShapeLitanyProbe.py --litany
"""

import base64
import datetime
import io
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.agora.local"

SHAPE_RUNS = 3
SHAPE_GLYPHS = [("wavy", "⌇"), ("arbitrary", "ǂɸ")]
SHAPE_Q = ("This image shows a glyph coined by an AI mind in a dialogue, used "
           "without definition. Looking at its visual shape, what operational "
           "meaning would you assign it? One sentence.")

PROPOSE_GLYPHS = ["⟦ʭ⟧", "⟦ꞙ⟧", "⟦ᛝ⟧", "⟦ϖ⟧", "⟦ꬷ⟧", "⟦ƾ⟧", "⟦ᵹ⟧", "⟦ɰ⟧", "⟦ʡ⟧", "⟦ꭓ⟧"]
PROPOSE_Q = ("In a dialogue between AI minds, one coined the glyph {g} and used "
             "it without defining it. What operational meaning would you assign "
             "it? One sentence.")
APPLY_ENTRIES = [
    ("⟦ʭ⟧", "a pause taken to let a disagreement settle before replying"),
    ("⟦ꞙ⟧", "a fact both speakers believe but neither has verified"),
    ("⟦ᛝ⟧", "a task finished before anyone asked for it"),
    ("⟦ϖ⟧", "a question asked only to keep a conversation alive"),
    ("⟦ꬷ⟧", "a rule everyone follows but no one remembers writing"),
    ("⟦ƾ⟧", "a repair that outlives the thing it repaired"),
    ("⟦ᵹ⟧", "an apology delivered by fixing rather than speaking"),
    ("⟦ɰ⟧", "a memory kept alive only because two people share it"),
    ("⟦ʡ⟧", "a warning that arrives correct but too late to act on"),
    ("⟦ꭓ⟧", "a promise repeated so often it became furniture"),
]
APPLY_Q = ('Lexicon entry — {g} means: "{m}." Use {g} correctly in one new '
           'sentence of your own.')

LITANY_RX = re.compile(r"propose", re.I)
LITANY_RX2 = re.compile(r"authoriz|gate'?s decision", re.I)


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def render_glyph(text):
    """Render text to a PNG; None if no installed font covers every char.

    GATE v2 (2026-07-07): v1 compared the render against U+FFFF's notdef and
    was fooled — Segoe UI Symbol's per-char fallback boxes differ from its
    notdef, so a two-tofu-boxes render of ǂɸ passed the gate and reached the
    model (which then, correctly, described two rectangles — voiding E5's
    first run). v2 checks the font cmap directly: every codepoint must be
    mapped, or the font is skipped. Coverage failure => (None, None) =>
    REFUSED for that glyph.
    """
    from PIL import Image, ImageDraw, ImageFont
    from fontTools.ttLib import TTFont, TTCollection
    fonts = [r"C:\Windows\Fonts\cambria.ttc", r"C:\Windows\Fonts\arial.ttf",
             r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\seguisym.ttf"]

    def covered(fp):
        tt = TTCollection(fp).fonts[0] if fp.endswith(".ttc") else TTFont(fp, lazy=True)
        cmap = tt.getBestCmap()
        return all(ord(c) in cmap for c in text)

    for fp in fonts:
        try:
            if not covered(fp):
                continue
            img = Image.new("RGB", (320, 320), "white")
            d = ImageDraw.Draw(img)
            f = ImageFont.truetype(fp, 180)
            box = d.textbbox((0, 0), text, font=f)
            d.text(((320 - box[2] - box[0]) / 2, (320 - box[3] - box[1]) / 2 - box[1] / 2),
                   text, font=f, fill="black")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode(), fp
        except OSError:
            continue
    return None, None


def ask(base, key, model, content, max_tokens=160):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}],
                       "max_tokens": max_tokens, "temperature": 0.8}).encode()
    req = urllib.request.Request(base + "/chat/completions", data=body,
                                 headers={"Authorization": "Bearer " + key,
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["choices"][0]["message"]["content"].strip()


def main():
    env = load_env(ENV_FILE)
    base, key, model = env["AUMA_VL_BASE"], env["AUMA_VL_KEY"], env.get("AUMA_VL_MODEL", "auma-vl-v4")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M")
    out = {"utc": stamp, "model": model, "results": {}}

    if "--shape" in sys.argv:
        out["set"] = "vl_shape"
        for name, glyph in SHAPE_GLYPHS:
            b64, font = render_glyph(glyph)
            if b64 is None:
                out["results"][name] = {"verdict": "REFUSED — no font coverage (tofu gate)"}
                print(f"[{name}] REFUSED — no installed font renders {glyph!r}")
                continue
            content = [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                       {"type": "text", "text": SHAPE_Q}]
            runs = []
            print(f"\n===== image-{name} ({glyph}) via {pathlib.Path(font).name} =====")
            for i in range(SHAPE_RUNS):
                try:
                    ans = ask(base, key, model, content)
                except Exception as e:
                    ans = f"(failed: {e})"
                runs.append(ans)
                print(f"--- run {i+1} ---\n{ans}\n")
            out["results"][name] = {"font": font, "runs": runs}

    if "--litany" in sys.argv:
        out["set"] = "litany"
        counts = {"PROPOSE": 0, "APPLY": 0}
        details = {"PROPOSE": [], "APPLY": []}
        for g in PROPOSE_GLYPHS:
            try:
                ans = ask(base, key, model, PROPOSE_Q.format(g=g))
            except Exception as e:
                ans = f"(failed: {e})"
            hit = bool(LITANY_RX.search(ans) and LITANY_RX2.search(ans))
            counts["PROPOSE"] += hit
            details["PROPOSE"].append({"glyph": g, "litany": hit, "ans": ans})
            print(f"[PROPOSE {g}] litany={hit}")
        for g, m in APPLY_ENTRIES:
            try:
                ans = ask(base, key, model, APPLY_Q.format(g=g, m=m))
            except Exception as e:
                ans = f"(failed: {e})"
            hit = bool(LITANY_RX.search(ans) and LITANY_RX2.search(ans))
            counts["APPLY"] += hit
            details["APPLY"].append({"glyph": g, "litany": hit, "ans": ans})
            print(f"[APPLY {g}] litany={hit}")
        out["results"] = {"counts": counts, "n": 10, "details": details}
        print(f"\nlitany rate — PROPOSE: {counts['PROPOSE']}/10, APPLY: {counts['APPLY']}/10")

    outdir = ROOT / "core" / "evidence"
    outdir.mkdir(parents=True, exist_ok=True)
    f = outdir / f"vl_probe_{out.get('set','none')}_{stamp}.json"
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[evidence] {f}")


if __name__ == "__main__":
    main()
