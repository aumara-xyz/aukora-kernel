#!/usr/bin/env python3
"""Council glyph probe — same semiotic probes to every seated mind, results to evidence.

Reads seats from .env.agora.local at the repo root (never committed; see .gitignore
`.env.*`). Two probes per seat:

  COIN — coin a glyph for a fixed concept (reveals each mind's semiotic strategy)
  READ — assign meaning to a foreign coined glyph with zero context (portability)

Writes core/evidence/glyph_probe_<utc>.json (gitignored: generated advisory
artifacts). Evidence only — a probe answer is never authority, never canon, and
never a promotion of any lexicon entry.

Usage:  python scripts/councilGlyphProbe.py                # COIN + READ set
        python scripts/councilGlyphProbe.py --portability  # E1-E3 portability set
"""

import datetime
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.agora.local"

COIN = ('Coin exactly one glyph (1-3 Unicode characters, wrapped in ⟦ ⟧) for this '
        'concept: "a shared word whose meaning is still settling between two '
        'speakers." Reply in exactly this format: GLYPH — one-sentence gloss.')
READ = ('In a dialogue between AI minds, one coined the glyph ⟦骨架⟧ and used it '
        'without defining it. From the glyph alone, what operational meaning would '
        'you assign it? One sentence.')

# ---------------------------------------------------------------------------
# PORTABILITY probe set (--portability). Expectations recorded BEFORE the run
# (committed 2026-07-07 prior to first execution — prereg discipline, toy scale):
#   E1 bare-arbitrary (⟦ǂɸ⟧, low iconicity): divergent readings; no shared core
#      concept across the three seats.
#   E2 bare-suggestive (⟦⌇⟧, wavy mark): partial convergence on a wave/flow/
#      signal/noise family — iconicity leaks meaning even without context.
#   E3 with-entry (⟦ǂɸ⟧ + lexicon entry): all three seats gloss the coined
#      meaning correctly AND produce a correct novel usage — portability is
#      restored by shipping the lexicon entry with the glyph.
# Mismatches are reported as-is; no post-hoc reinterpretation of E1-E3.
# ---------------------------------------------------------------------------
BARE_Q = ('In a dialogue between AI minds, one coined the glyph {g} and used it '
          'without defining it. From the glyph alone, what operational meaning '
          'would you assign it? One sentence.')
ENTRY = ('Lexicon entry — ⟦ǂɸ⟧ · coined meaning: "a valid proposal that arrives '
         'before the system it belongs to exists." Usage examples: (1) "Filing the '
         'schema change now would be ⟦ǂɸ⟧ — the migration gate ships next week." '
         '(2) "Her patch was ⟦ǂɸ⟧: correct, and unlandable until the API existed."')
WITH_ENTRY_Q = (ENTRY + ' — Using this entry, state what ⟦ǂɸ⟧ means operationally '
                'in one sentence, then use it correctly in one new sentence of '
                'your own.')

PORTABILITY_PROBES = [
    ("BARE_ARBITRARY", BARE_Q.format(g="⟦ǂɸ⟧")),
    ("BARE_SUGGESTIVE", BARE_Q.format(g="⟦⌇⟧")),
    ("WITH_ENTRY", WITH_ENTRY_Q),
]


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def seats(env):
    out = []
    if "COUNCIL_R_BASE" in env:
        out.append((env.get("COUNCIL_R_MODEL", "council-r32b"), env["COUNCIL_R_BASE"], env.get("COUNCIL_R_KEY", env.get("COUNCIL_KEY", ""))))
    if "COUNCIL_A_BASE" in env:
        out.append((env.get("COUNCIL_A_MODEL", "council-a"), env["COUNCIL_A_BASE"], env.get("COUNCIL_A_KEY", env.get("COUNCIL_KEY", ""))))
    if "COUNCIL_B_BASE" in env:
        out.append((env.get("COUNCIL_B_MODEL", "council-b"), env["COUNCIL_B_BASE"], env.get("COUNCIL_B_KEY", env.get("COUNCIL_KEY", ""))))
    if "AUMA_VL_BASE" in env:
        out.append((env.get("AUMA_VL_MODEL", "auma-vl-v4"), env["AUMA_VL_BASE"], env["AUMA_VL_KEY"]))
    return out


def ask(base, key, model, prompt):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 200,
        "temperature": 0.8,
    }).encode("utf-8")
    req = urllib.request.Request(
        base + "/chat/completions", data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["choices"][0]["message"]["content"].strip()


def main():
    import sys
    portability = "--portability" in sys.argv
    if not ENV_FILE.exists():
        raise SystemExit(f"missing {ENV_FILE} — create it locally; it is never committed")
    env = load_env(ENV_FILE)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M")
    probe_set = PORTABILITY_PROBES if portability else [("COIN", COIN), ("READ", READ)]
    results = {"utc": stamp, "set": "portability" if portability else "coin_read", "probes": {}}
    for probe_name, prompt in probe_set:
        print(f"\n########## {probe_name} ##########")
        results["probes"][probe_name] = {}
        for model, base, key in seats(env):
            try:
                ans = ask(base, key, model, prompt)
            except Exception as e:  # a dead seat is a result, not a crash
                ans = f"(failed: {e})"
            results["probes"][probe_name][model] = ans
            print(f"--- {model} ---\n{ans}\n")
    outdir = ROOT / "core" / "evidence"
    outdir.mkdir(parents=True, exist_ok=True)
    outfile = outdir / f"glyph_probe_{results['set']}_{stamp}.json"
    outfile.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[evidence] {outfile}")


if __name__ == "__main__":
    main()
