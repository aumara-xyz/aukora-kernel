#!/usr/bin/env bash
# BUBBLE-0 — reproduction appliance runner (v1). Contract: docs/BUBBLE0_APPLIANCE.md.
# Reproduces the burn-v5 three-arm eval verdict from pinned parts, with all model
# and data access in library-level OFFLINE mode. REFUSES on any absent pin or any
# verdict drift. This file is committed BEFORE the appliance job runs.
set -euxo pipefail

: "${TAG:?}" ; : "${STRIPS_SHA:?}" ; : "${STRIPS_B64:?}" ; : "${CODE_COMMIT:?}"
# Bucket is mounted READ-ONLY (it is at its 200GiB cap; also: an appliance that
# only reads its pinned inputs and emits a verdict is the cleaner contract).
# All outputs live on job-local disk and stream to the job log.
OUT=/work/out/bubble0-$TAG
V4=/mnt/out/output/auma-vl-v4-1783072814
B5=/mnt/out/output/auma-vl-v5-burn3-07080303
# Frozen expected verdict — burn3 (aijob-e00m0abzevb0ttmtg2), byte-compared below.
EXPECTED='{"base": {"menlo": 10, "serif": 11}, "v4": {"menlo": 24, "serif": 25}, "v5": {"menlo": 27, "serif": 27}}'

mkdir -p /work/strips /work/menlo "$OUT"

# ---- PHASE NET (disclosed): dependency install + model fetch at a PINNED immutable
# revision. The bucket cannot hold the 65GB artifact (200GiB cap, measured full at
# 218.5GB during staging — quota raise is Peter's call, tracked for v2 alongside the
# baked registry image). Same transport burn3 used; the eval itself runs offline.
apt-get update -qq && apt-get install -y -qq fonts-dejavu-core fonts-dejavu-extra >/dev/null
pip install -q "ms-swift==3.10.3" qwen-vl-utils pillow fonttools
export HF_HOME=/work/hf HF_HUB_DISABLE_XET=1
MODEL_REV=7cfb30d71a1f4f49a57592323337a4a4727301da
MODEL_DIR=$(python3 - "$MODEL_REV" <<'PY'
import sys
from huggingface_hub import snapshot_download
print(snapshot_download('Qwen/Qwen2.5-VL-32B-Instruct', revision=sys.argv[1], max_workers=8))
PY
)

# ---- OFFLINE GATE: from here on, hub access is disabled at the library level.
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
python3 - <<'PY'
from huggingface_hub.constants import HF_HUB_OFFLINE
import os
assert HF_HUB_OFFLINE, "REFUSED: offline mode not active"
assert os.environ.get("TRANSFORMERS_OFFLINE") == "1", "REFUSED: transformers offline not active"
print("OFFLINE_MODE_ACTIVE")
PY

# ---- Pins present? (fail-closed before any compute)
test -f "$V4/adapter_config.json" || { echo "REFUSED: v4 adapter absent"; exit 2; }
V5=$(dirname "$(find "$B5/sft" -name adapter_config.json | sort | tail -1)")
test -n "$V5" -a -f "$V5/adapter_config.json" || { echo "REFUSED: v5 adapter absent"; exit 2; }
test -f "$MODEL_DIR/config.json" -a -f "$MODEL_DIR/model.safetensors.index.json" \
  || { echo "REFUSED: staged model artifact absent"; exit 2; }

# ---- Stimuli: pixel-exact rebuild behind the pinned manifest (same gate as burn3).
printf %s "$STRIPS_B64" | base64 -d > /work/strips.tgz
echo "$STRIPS_SHA  /work/strips.tgz" | sha256sum -c -
tar xzf /work/strips.tgz -C /work/strips
python3 /work/burnV5Eval.py --rebuild /work/strips /work/menlo

# ---- The reproduction: identical eval, identical prompts, greedy, from mounts only.
echo "code commit: $CODE_COMMIT" | tee "$OUT/provenance.txt"
python3 /work/burnV5Eval.py --v5 "$V5" --v4 "$V4" --menlo /work/menlo --out "$OUT" --base "$MODEL_DIR" 2>&1 | tee "$OUT/eval.log"

# ---- Verdict: the summary must byte-match the frozen expectation.
python3 - "$OUT" "$EXPECTED" <<'PY'
import json, pathlib, sys
out, expected = pathlib.Path(sys.argv[1]), json.loads(sys.argv[2])
got = json.loads((out / "eval_results.json").read_text())["summary"]
if got == expected:
    (out / "VERDICT.txt").write_text("BUBBLE0_REPRODUCED\n")
    print("BUBBLE0_REPRODUCED", json.dumps(got))
else:
    (out / "VERDICT.txt").write_text("BUBBLE0_REFUSED: verdict drift\n")
    print("BUBBLE0_REFUSED drift: got", json.dumps(got), "expected", json.dumps(expected))
    sys.exit(3)
PY
echo "BUBBLE0_DONE_${TAG}"
