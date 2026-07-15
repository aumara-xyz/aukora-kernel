#!/usr/bin/env bash
# Burn v5 — in-job boot script (Nebius serverless AI job, 1x H100/H200).
# Injected at /work/boot.sh. See docs/BURN_V5_PREREG.md (committed BEFORE launch).
# Fail-closed: stimulus tar must match its pinned sha256 or the job dies here.
set -euxo pipefail

: "${TAG:?TAG env required}"
: "${STRIPS_SHA:?STRIPS_SHA env required}"
OUT=/mnt/out/output/auma-vl-v5-$TAG
V4=/mnt/out/output/auma-vl-v4-1783072814
mkdir -p /work/data /work/menlo "$OUT"
export HF_HOME=/work/hf
export MPLBACKEND=Agg

apt-get update -qq && apt-get install -y -qq fonts-dejavu-core fonts-dejavu-extra >/dev/null
# ms-swift pinned to the 3.10 line: 4.x renamed --train_type (and possibly
# more) — burn1 failed on exactly that. 3.10.3 is the flag set this script
# was written against; its resolver pins compatible transformers/peft.
pip install -q "ms-swift==3.10.3" qwen-vl-utils pillow fonttools

# --- stimuli: LUM-READ v1 Menlo renders, reconstructed pixel-exactly ---
# Cloud-init caps the payload at 32 KiB, so we ship the three mark strips
# (proven byte-exact translation components) and rebuild all 27 cards
# in-job. Gate: per-card pixel sha256 manifest (prereg 4) — REFUSES on any
# mismatch. Strip tar additionally byte-pinned via STRIPS_SHA.
: "${STRIPS_B64:?}"
mkdir -p /work/strips
printf %s "$STRIPS_B64" | base64 -d > /work/strips.tgz
echo "$STRIPS_SHA  /work/strips.tgz" | sha256sum -c -
tar xzf /work/strips.tgz -C /work/strips
python3 /work/burnV5Eval.py --rebuild /work/strips /work/menlo

# --- dataset (deterministic; counts frozen in prereg 2) ---
python3 /work/burnV5Dataset.py --out /work/data 2>&1 | tee "$OUT/dataset.log"

# --- provenance: bucket layout + v4 adapter config ---
ls -la /mnt/out/output/ | tee "$OUT/bucket_listing.txt" || true
cp "$V4/adapter_config.json" "$OUT/v4_adapter_config.json" || echo "WARN: v4 adapter_config not found" | tee -a "$OUT/bucket_listing.txt"

# --- train (hyperparameters frozen in prereg 3; QLoRA fallback disclosed) ---
# Train on LOCAL disk: the bucket mount is object storage and rejects
# appends (burn2 died on TensorBoard's event-file append at step 1).
# Artifacts are copied to the bucket after training; tensorboard disabled.
SFT_ARGS=(--model Qwen/Qwen2.5-VL-32B-Instruct --train_type lora
  --dataset /work/data/train.jsonl --lora_rank 16 --lora_alpha 32
  --num_train_epochs 3 --per_device_train_batch_size 1
  --gradient_accumulation_steps 16 --learning_rate 1e-4 --max_length 1024
  --torch_dtype bfloat16 --gradient_checkpointing true --freeze_vit true
  --save_strategy epoch --logging_steps 5 --report_to none)
if ! swift sft "${SFT_ARGS[@]}" --output_dir /work/sft 2>&1 | tee "$OUT/train.log"; then
  if grep -qi "out of memory" "$OUT/train.log"; then
    echo "OOM on bf16 LoRA - retrying QLoRA int4 (disclosed fallback, prereg 3)"
    swift sft "${SFT_ARGS[@]}" --quant_bits 4 --output_dir /work/sft 2>&1 | tee "$OUT/train_qlora.log"
  else
    exit 1
  fi
fi
cp -r /work/sft "$OUT/sft"

V5=$(dirname "$(find /work/sft -name adapter_config.json | sort | tail -1)")
test -n "$V5"
echo "v5 adapter: $V5" | tee "$OUT/v5_adapter_path.txt"

# --- preregistered eval: base vs v4 vs v5, frozen stimuli, greedy ---
python3 /work/burnV5Eval.py --v5 "$V5" --v4 "$V4" --menlo /work/menlo --out "$OUT" 2>&1 | tee "$OUT/eval.log"

echo "BURN_V5_DONE_${TAG}"
