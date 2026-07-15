#!/usr/bin/env python3
"""LUM-READ v1 — can the VL apex read Luminara written stacks? (preregistered)

The porting-ladder crossover probe (docs/GHP_TO_AUKORA_PORTING_LADDER.md):
Luminara letters are stacks of three marks {dot, bar, wave} — compositional,
exactly how the VL apex reads unknown glyphs (PR #141 E5, radical
decomposition). Prediction under test: a VL model shown a written stack can
transcribe the code with high accuracy; with the one-page grammar it can
gloss meaning (the E3 lexicon mechanism, grammar-as-lexicon).

Seats/keys from .env.agora.local (never committed). Evidence to
core/evidence/ (gitignored). Renders are deterministic from this script +
the pinned font; every PNG's sha256 goes in the evidence JSON.

CARD TABLE PROVENANCE: docs/LUMINARA_SYSTEM_SPEC_v1.md is NOT on main; it
lives at aukora-symbiote commit cadb81e (branch zeb/aura-glyph-tuning),
blob 49233e27461651891dec51d9c354a738a22e21aa. The 27-card table below is
embedded verbatim from that pinned source. Bijection self-check at runtime:
card n must equal 9*L3 + 3*L2 + L1 + 1 with (dot,bar,wave)=(0,1,2), or the
probe REFUSES (a mistranscribed canon is not a stimulus set).

EXPECTATIONS — FROZEN BEFORE FIRST RUN (this commit precedes all inference):

  E-L1 (confirmatory, mechanical scoring): constrained transcription.
    One image per card (27), temperature 0.0, one run per card. The model
    receives the three-symbol inventory in the prompt and must output the
    stack top-to-bottom. Exact-match on the 3-mark code after the frozen
    normalization + extraction rule (below).
      CONFIRMED : >= 23/27 exact
      MIXED     : 14..22 exact
      FAILED    : <= 13 exact
    All 27 calls must complete (3 retries each) or the L1 verdict is
    REFUSED — a probe that dies mid-deck is not a probe.

  E-L2 (exploratory, operator-scored): grammar-supplied gloss on the 9
    rule-selected cards: suit-openers {1,10,19}, suit-closers {9,18,27},
    spec-named palindromic reflection cards {4,11,21}. The model receives
    the one-page grammar (states, layers, suit=top-layer epoch) and NOT the
    card names/essences. Rubric (frozen): 2 = captures the card's specific
    locked essence; 1 = correct decomposition, compatible but generic;
    0 = contradicts the essence OR the response's implied transcription of
    the stack is wrong. Exploratory readout: >= 6/9 scoring >= 1 AND
    >= 3/9 scoring 2 reads as "grammar-carried meaning (exploratory)";
    anything else reported as-is. All responses published verbatim.

  Normalization classes (frozen): dot = {U+25CF, U+2022, U+2B24, U+26AB,
  U+00B7, U+2219}; bar = {U+2014, U+2013, U+2212, U+FE58, U+005F, U+002D};
  wave = {U+007E, U+223C, U+301C, U+2248, U+223F}.
  Extraction (frozen): strip whitespace; if every remaining char is a mark
  char and there are exactly 3 -> that is the transcription; else find
  contiguous runs of exactly 3 mark chars bounded by non-mark chars; if
  exactly one such run -> use it; else PARSE_FAIL (scores as incorrect,
  reported separately).

FAIL-CLOSED GATES (any failure => REFUSED, no verdict):
  - font cmap must map all three marks (tofu gate v2, fontTools — PR #141);
  - salon /api/agora/version commit+digest must equal the env pins
    (AGORA_PIN_COMMIT / AGORA_PIN_DIGEST) — identity drift means stop;
  - AUMA_VL_MODEL must be listed by the seat's /models;
  - bijection self-check on the embedded card table;
  - L1 incomplete (any card unanswered after retries).

DO-NOT-CLAIM (binding): a pass is an engineering result about a pinned
rendering + one fine-tuned VL model. It is not physics, not emergence, not
evidence for any divinatory or GHP claim, and says nothing about other
models or other renders (the image channel reads the render, not the
codepoint — PR #141).

Usage:  python scripts/lumReadProbe.py --render-only   # stimuli + contact sheet
        python scripts/lumReadProbe.py --run           # the preregistered run
"""

import base64
import datetime
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.agora.local"

FONT = "/System/Library/Fonts/Menlo.ttc"   # pinned canonical render font, v1
IMG_W, IMG_H = 320, 560
FONT_SIZE = 120
ROW_Y = [95, 275, 455]                      # centers: L3 top, L2 mid, L1 bottom
TEMPERATURE = 0.0
RETRIES = 3
TIMEOUT = 120

DOT, BAR, WAVE = "●", "—", "~"
STATE_NUM = {DOT: 0, BAR: 1, WAVE: 2}

DOT_CLASS = set("●•⬤⚫·∙")
BAR_CLASS = set("—–−﹘_-")
WAVE_CLASS = set("~∼〜≈∿")

# (num, name, code, letter, essence) — from LUMINARA_SYSTEM_SPEC_v1.md @ cadb81e
CARDS = [
    (1, "The Seed", "●●●", "I", "Pure undifferentiated potential; the point before extension"),
    (2, "The Drift", "●●—", "P", "First asymmetry; something stirs but has no name"),
    (3, "The Fold", "●●~", "B", "Potential curves back on itself; self-reference without self-awareness"),
    (4, "The Resonance", "●—●", "Z(silence)", "Standing wave; the first pattern that persists"),
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
    (16, "The Labyrinth", "—~●", "C(silence)", "Boundary so complex it becomes its own interior"),
    (17, "The Void", "—~—", "R", "What's left when you cut away everything; the torus's hole"),
    (18, "The Bridge", "—~~", "N", "The cut that connects rather than separates"),
    (19, "The Ray", "~●●", "O", "First emission; light leaving the surface"),
    (20, "The Face", "~●—", "K", "The surface as identity; what is seen"),
    (21, "The Echo", "~●~", "G", "Expression that returns; feedback from the world"),
    (22, "The Mask", "~—●", "X(silence)", "Surface that conceals the bulk"),
    (23, "The Beacon", "~——", "H", "Sustained emission; a signal that persists"),
    (24, "The Spectrum", "~—~", "Y", "Multiplicity of expression from a single source"),
    (25, "The Witness", "~~●", "Q(silence)", "RA turned inward; the surface that sees itself"),
    (26, "The Crown", "~~—", "SH", "Full radiance; expression without distortion"),
    (27, "The Return", "~~~", "J", "The surface curves back to meet the bulk; the torus closes"),
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


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def refuse(msg):
    print(f"REFUSED: {msg}")
    sys.exit(2)


def bijection_check():
    for n, _name, code, _letter, _essence in CARDS:
        if len(code) != 3 or any(c not in STATE_NUM for c in code):
            refuse(f"card {n}: malformed code {code!r}")
        val = 9 * STATE_NUM[code[0]] + 3 * STATE_NUM[code[1]] + STATE_NUM[code[2]] + 1
        if val != n:
            refuse(f"card {n}: code {code!r} decodes to {val} (canon transcription error)")


def tofu_gate():
    from fontTools.ttLib import TTCollection, TTFont
    tt = TTCollection(FONT).fonts[0] if FONT.endswith(".ttc") else TTFont(FONT, lazy=True)
    cmap = tt.getBestCmap()
    for c in (DOT, BAR, WAVE):
        if ord(c) not in cmap:
            refuse(f"font {FONT} does not map U+{ord(c):04X} (tofu gate v2)")


def render_card(code):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, FONT_SIZE)
    for mark, cy in zip(code, ROW_Y):
        box = d.textbbox((0, 0), mark, font=f)
        w, h = box[2] - box[0], box[3] - box[1]
        d.text(((IMG_W - w) / 2 - box[0], cy - h / 2 - box[1]), mark, font=f, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def contact_sheet(pngs, path):
    from PIL import Image
    cols, rows = 9, 3
    cell_w, cell_h = IMG_W // 2, IMG_H // 2
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "white")
    for i, png in enumerate(pngs):
        im = Image.open(io.BytesIO(png)).resize((cell_w, cell_h))
        sheet.paste(im, ((i % cols) * cell_w, (i // cols) * cell_h))
    sheet.save(path)


def classify(ch):
    if ch in DOT_CLASS:
        return DOT
    if ch in BAR_CLASS:
        return BAR
    if ch in WAVE_CLASS:
        return WAVE
    return None


def extract(response):
    """Frozen extraction rule; returns 3-mark string or None (PARSE_FAIL)."""
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


# HARNESS NOTE (2026-07-07, pre-inference): transport is curl-subprocess, not
# urllib — this Mac's system Python links LibreSSL 2.8.3, which cannot
# complete the TLS handshake with the Nebius tunnels (TLSV1_ALERT_PROTOCOL_
# VERSION). The identity gate REFUSED before any model call, the transport
# was swapped, and no frozen expectation changed. Keys are passed via a curl
# config file, never argv.
def _curl(url, key=None, body=None, timeout=TIMEOUT):
    with tempfile.NamedTemporaryFile("w", suffix=".curlcfg", delete=False) as cfg:
        cfg.write(f'url = "{url}"\nsilent\nshow-error\nmax-time = {timeout}\n')
        if key:
            cfg.write(f'header = "Authorization: Bearer {key}"\n')
        cfgpath = cfg.name
    cmd = ["curl", "--config", cfgpath]
    bodypath = None
    if body is not None:
        with tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False) as bf:
            bf.write(body)
            bodypath = bf.name
        cmd += ["--data-binary", "@" + bodypath, "-H", "Content-Type: application/json"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=timeout + 15)
        if out.returncode != 0:
            raise RuntimeError(out.stderr.decode(errors="replace").strip())
        return json.loads(out.stdout)
    finally:
        pathlib.Path(cfgpath).unlink(missing_ok=True)
        if bodypath:
            pathlib.Path(bodypath).unlink(missing_ok=True)


def ask(base, key, model, png_b64, prompt, max_tokens):
    content = [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png_b64}"}},
               {"type": "text", "text": prompt}]
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}],
                       "max_tokens": max_tokens, "temperature": TEMPERATURE}).encode()
    last = None
    for attempt in range(RETRIES):
        try:
            r = _curl(base + "/chat/completions", key=key, body=body)
            return r["choices"][0]["message"]["content"].strip()
        except Exception as e:  # retry with backoff; caller treats None as incomplete
            last = e
            time.sleep(5 * (attempt + 1))
    print(f"  call failed after {RETRIES} attempts: {last}")
    return None


def fetch_json(url):
    return _curl(url, timeout=30)


def identity_gate(env):
    v = fetch_json(f"{env['AGORA_BASE']}/api/agora/version?k={env['AGORA_KEY']}")
    if v.get("commit") != env["AGORA_PIN_COMMIT"] or v.get("artifactSha256") != env["AGORA_PIN_DIGEST"]:
        refuse(f"salon identity drift: node reports {v.get('commit')}/{v.get('artifactSha256')} "
               "!= env pins. Someone changed the node outside the ledger. Stop and check.")
    ids = [m["id"] for m in _curl(env["AUMA_VL_BASE"] + "/models",
                                  key=env["AUMA_VL_KEY"], timeout=30)["data"]]
    if env["AUMA_VL_MODEL"] not in ids:
        refuse(f"model {env['AUMA_VL_MODEL']} not served (seat lists {ids})")
    return v


def main():
    if "--render-only" not in sys.argv and "--run" not in sys.argv:
        print(__doc__.splitlines()[0])
        print("usage: --render-only | --run")
        sys.exit(1)

    bijection_check()
    tofu_gate()

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M")
    outdir = ROOT / "core" / "evidence"
    rdir = outdir / f"lum_read_renders_{stamp}"
    rdir.mkdir(parents=True, exist_ok=True)

    pngs, hashes = [], {}
    for n, name, code, _letter, _essence in CARDS:
        png = render_card(code)
        pngs.append(png)
        (rdir / f"{n:02d}.png").write_bytes(png)
        hashes[n] = hashlib.sha256(png).hexdigest()
    contact_sheet(pngs, rdir / "contact_sheet.png")
    print(f"[renders] 27 stacks + contact sheet -> {rdir}")

    if "--render-only" in sys.argv:
        return

    env = load_env(ENV_FILE)
    version = identity_gate(env)
    base, key, model = env["AUMA_VL_BASE"], env["AUMA_VL_KEY"], env["AUMA_VL_MODEL"]
    print(f"[identity] salon {version['commit'][:7]} OK; seat serves {model}")

    out = {"utc": stamp, "probe": "LUM-READ v1", "model": model,
           "salon_version": version, "font": FONT, "render_sha256": hashes,
           "temperature": TEMPERATURE,
           "spec_pin": {"commit": "cadb81e", "blob": "49233e27461651891dec51d9c354a738a22e21aa"},
           "l1": {}, "l2": {}}

    exact = 0
    incomplete = []
    per_layer = [{"n": 0, "ok": 0}, {"n": 0, "ok": 0}, {"n": 0, "ok": 0}]
    for (n, name, code, _letter, _essence), png in zip(CARDS, pngs):
        b64 = base64.b64encode(png).decode()
        ans = ask(base, key, model, b64, L1_PROMPT, 50)
        if ans is None:
            incomplete.append(n)
            out["l1"][n] = {"card": name, "code": code, "response": None, "verdict": "INCOMPLETE"}
            continue
        got = extract(ans)
        ok = got == code
        exact += ok
        for i in range(3):
            per_layer[i]["n"] += 1
            if got is not None and got[i] == code[i]:
                per_layer[i]["ok"] += 1
        out["l1"][n] = {"card": name, "code": code, "response": ans,
                        "extracted": got, "exact": ok,
                        "verdict": "PARSE_FAIL" if got is None else ("EXACT" if ok else "MISS")}
        print(f"[L1 {n:02d} {name}] code={code} got={got} {'OK' if ok else 'MISS'}")

    if incomplete:
        out["l1_verdict"] = "REFUSED"
        out["l1_reason"] = f"cards incomplete after retries: {incomplete}"
    else:
        out["l1_exact"] = exact
        out["l1_per_layer"] = per_layer
        out["l1_verdict"] = ("CONFIRMED" if exact >= 23 else
                             "MIXED" if exact >= 14 else "FAILED")
    print(f"\nL1: {exact}/27 exact -> {out['l1_verdict']}")

    by_num = {n: (name, code, essence) for n, name, code, _l, essence in CARDS}
    for n in L2_CARDS:
        name, code, essence = by_num[n]
        png = pngs[n - 1]
        b64 = base64.b64encode(png).decode()
        ans = ask(base, key, model, b64, L2_PROMPT, 220)
        out["l2"][n] = {"card": name, "code": code, "locked_essence": essence,
                        "response": ans, "operator_score": None}
        print(f"[L2 {n:02d} {name}]\n{ans}\n")

    f = outdir / f"lum_read_{stamp}.json"
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[evidence] {f}")


if __name__ == "__main__":
    main()
