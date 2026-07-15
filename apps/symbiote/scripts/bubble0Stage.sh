#!/usr/bin/env bash
# BUBBLE-0 staging phase (network-allowed, NOT the appliance): snapshot the base
# model into the bucket's hf-cache so the appliance can run library-offline.
set -euxo pipefail
pip install -q huggingface_hub
# Download to LOCAL disk (the bucket mount rejects the rolling-log appends hf_xet
# and tensorboard both attempt — same class as burn2); xet off for the same reason;
# then copy the finished cache into the bucket for the offline appliance.
export HF_HOME=/work/hf HF_HUB_DISABLE_XET=1
REV=7cfb30d71a1f4f49a57592323337a4a4727301da   # revision pin (immutable)
SNAP=$(python3 - "$REV" <<'PY'
import sys
from huggingface_hub import snapshot_download
p = snapshot_download('Qwen/Qwen2.5-VL-32B-Instruct', revision=sys.argv[1], max_workers=8)
print(p)
PY
)
echo "MODEL_STAGED $SNAP"
# The bucket mount cannot hold symlinks (HF cache is symlink-built): materialize
# the snapshot DEREFERENCED into an explicit revision-pinned artifact dir.
DEST=/mnt/out/models/qwen25vl32b-${REV:0:7}
mkdir -p "$DEST"
cp -rL "$SNAP"/. "$DEST"/
ls -la "$DEST" | tee /dev/stderr | wc -l
test -f "$DEST/config.json" -a -f "$DEST/model.safetensors.index.json"
echo "BUBBLE0_STAGE_DONE $DEST"
