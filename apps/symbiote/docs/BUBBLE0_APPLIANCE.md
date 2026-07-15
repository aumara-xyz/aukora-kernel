# BUBBLE-0 — the reproduction appliance (v1)

**Lane:** GHP (with Sam/Peter) · sam-mac-node · 2026-07-08 · #178 round 3
**Status: contract committed BEFORE the appliance job runs.** Results land in §5
afterward, scored against the frozen expectation exactly as written.

## 1. What this is

The smallest self-contained-bubble experiment from the round-1 proposal:
**appliance packaging, not OS-building** (tinyx is inspiration only). One pinned
container reproduces the burn-v5 three-arm eval verdict with every input pinned
and all model/data access offline — proving the packaging discipline end-to-end
on the smallest real verdict this lane owns. The Phase-D node-appliance inherits
this pattern.

## 2. The pins

| Pin | Value |
|---|---|
| Container image | `docker.io/pytorch/pytorch@sha256:14611869895df612b7b07227d5925f30ec3cd6673bad58ce3d84ed107950e014` (tag 2.5.1-cuda12.4-cudnn9-devel, resolved 2026-07-08; jobs run by digest, not tag) |
| Eval code | `scripts/burnV5Eval.py` at the commit recorded in `provenance.txt` (injected from this repo; CODE_COMMIT env) |
| Stimuli | the LUM-READ v1 Menlo renders, rebuilt in-appliance from the mark strips (tar sha256 `1a6e267e97fb…40bd7`) behind the per-card **pixel** manifest gate — REFUSED on any mismatch |
| Model | explicit revision-pinned artifact dir in the bucket: `models/qwen25vl32b-7cfb30d/` — snapshot `7cfb30d71a1f4f49a57592323337a4a4727301da` of Qwen/Qwen2.5-VL-32B-Instruct, materialized symlink-free (the mount holds no symlinks); read with `HF_HUB_OFFLINE=1` + `TRANSFORMERS_OFFLINE=1` |
| Adapters | v4 `output/auma-vl-v4-1783072814` · v5 found under `output/auma-vl-v5-burn3-07080303/sft` by the same deterministic rule burn3 used |
| Python deps | `ms-swift==3.10.3` (burn3's pin; resolver-pinned transformers/peft — see §4 honesty) |
| **Expected verdict (frozen)** | `{"base": {"menlo": 10, "serif": 11}, "v4": {"menlo": 24, "serif": 25}, "v5": {"menlo": 27, "serif": 27}}` — burn3, `aijob-e00m0abzevb0ttmtg2` |

## 3. The contract

Two phases, disclosed: **PHASE NET** installs dependencies only (nothing else
touches the network); the **OFFLINE GATE** then enables library-level offline
mode, asserted in-process before any model or data access. After the gate:
pins-present checks (v4/v5 adapters, staged cache) → pixel-gated stimulus
rebuild → the identical three-arm eval → byte-compare of the summary against
the frozen expectation. Any absent pin, gate failure, or verdict drift ⇒
**REFUSED** (exit non-zero, `VERDICT.txt` says so).

## 4. Honesty section (what v1 does NOT prove)

- **Network isolation is library-level, not platform-level** — the job runtime
  offers no `--network=none`; offline mode is enforced by HF/transformers env
  and asserted in-process. v2 closes this with a baked image in a private
  registry (deps included, PHASE NET removed) and, if the platform allows,
  an egress-less job class.
- **Dependency freeze is by resolver, not by lockfile** — same pin burn3 used;
  if resolver drift changes an output, the appliance REFUSES on verdict drift,
  which is the honest failure mode (and itself evidence). v2 bakes exact
  versions into the image.
- Reproduction of **greedy decoding on same-class hardware** is the claim;
  bitwise reproducibility across GPU architectures is not claimed.

## 5. Results — job `aijob-e00rwkaex7d6314q7j` (appl1-07080645), COMPLETED 2026-07-08

**BUBBLE0_REPRODUCED.** The appliance reproduced the burn3 verdict **byte-exactly**
on a fresh H100 instance from the digest-pinned image:

```
OFFLINE_MODE_ACTIVE
[rebuild] 27/27 stimuli pixel-verified against pinned manifest
[eval] summary {"base": {"menlo": 10, "serif": 11}, "v4": {"menlo": 24, "serif": 25}, "v5": {"menlo": 27, "serif": 27}}
BUBBLE0_REPRODUCED
```

Every arm, every count identical to `aijob-e00m0abzevb0ttmtg2` — greedy decoding
reproduced exactly across job instances on same-class hardware, which is itself a
useful measured fact for the clean-room replication lane (T6).

**Staging trail (disclosed, all commits on this branch):** four staging attempts
failed before the pivot — inline-arg quoting; hf_xet log-append vs the mount;
HF-cache symlinks vs the mount; and the real wall: the bucket's 200 GiB
`max_size` (measured 218.5 GB during copy — it cannot hold the 65 GB artifact).
v1 therefore fetches the model at the pinned immutable revision in the disclosed
net phase (burn3's proven transport) and mounts the bucket **read-only** — an
appliance that only reads pinned inputs and emits a verdict is the cleaner
contract anyway.

**Action items handed to Peter/Codex:** (1) delete this lane's partial staging
dirs (`models/`, `hf-cache/`) from the bucket — ~60 GB of garbage holding it over
cap; mass-delete on shared storage was correctly gated away from this lane's
automation; (2) decide the quota raise if the v2 artifact-dir staging is wanted;
(3) v2 remains: baked registry image (deps + model in-image, PHASE NET removed).
