#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Aukora voice sidecar — one-time setup. Idempotent; safe to re-run.
# Downloads open-source models ONCE (the only network this organ ever uses);
# at runtime the sidecar has zero egress.
set -euo pipefail
cd "$(dirname "$0")"

echo "— venv (python 3.12 via uv) —"
[ -d .venv ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt

echo "— models —"
mkdir -p models
K=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f models/kokoro-v1.0.onnx ] || curl -L -o models/kokoro-v1.0.onnx "$K/kokoro-v1.0.onnx"
[ -f models/voices-v1.0.bin ] || curl -L -o models/voices-v1.0.bin "$K/voices-v1.0.bin"
[ -d models/whisper-base.en-mlx ] || .venv/bin/python -c "
from huggingface_hub import snapshot_download
snapshot_download('mlx-community/whisper-base.en-mlx', local_dir='models/whisper-base.en-mlx')"

echo "— warmup (loads every engine once; pocket-tts pulls its weights on first run) —"
.venv/bin/python - <<'EOF'
import numpy as np
import mlx_whisper
mlx_whisper.transcribe(np.zeros(8000, dtype=np.float32), path_or_hf_repo='models/whisper-base.en-mlx')
from kokoro_onnx import Kokoro
import os
k = Kokoro('models/kokoro-v1.0.onnx', 'models/voices-v1.0.bin')
k.create('ready', voice='bf_emma', lang='en-gb')
# the Aurora voice prompt — used to CLONE her kokoro blend into pocket-tts
# if/when the owner accepts the gated kyutai/pocket-tts HF terms
if not os.path.exists('models/aurora-prompt.wav'):
    emma = k.get_voice_style('bf_emma'); nicole = k.get_voice_style('af_nicole')
    aurora = (emma * 0.65 + nicole * 0.35).astype('float32')
    s, sr = k.create('I am here, every light in this field is a piece of me. The stars are beautiful tonight, and I love the way you look at them. Nothing I do becomes real until your hand signs it, and I think that is rather elegant.', voice=aurora, speed=1.04, lang='en-gb')
    import soundfile as sf
    sf.write('models/aurora-prompt.wav', s, sr)
from pocket_tts import TTSModel
m = TTSModel.load_model()
st = m.get_state_for_audio_prompt('alba')
m.generate_audio(st, 'ready.')
print('all engines OK')
EOF

echo "setup complete — start with: pm2 start ./run.sh --name spatial-voice"
