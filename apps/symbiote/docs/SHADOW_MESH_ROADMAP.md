# Shadow Mesh Roadmap — handoff for Fable / engineering

**2026-07-03.** Written the night the first synthetic shadow-Kira ran on Nebius. This is the scaffolding so the next builder starts from the milestone, not from scratch.

## What is PROVEN (real, tonight)
- **Full snapshot→cloud pipeline:** `kira.sh backup` (read-only export, live brain untouched, SHA-verified) → scrub (repo forbidden-field patterns, provably-clean residual) → AES-256 encrypt (key stays LOCAL) → private Nebius bucket + export receipt. Artifacts: `state/kira/backups/`, bucket `arc3-auma-strict-burn/shadow_snapshots/`.
- **Mind-substrate on metal:** a defanged `oven/bun` Nebius box, given only `core/src` + a synthetic brain, ran `createEmptyBrain → ingestMemory → recall("sky")` and returned **cited hits, `grantsAuthority:false`, `advisoryOnly:true`**, verify.ok=true, then self-terminated. Bootstrap + scripts in `.launch/shadow_bootstrap.sh`, scratchpad `gen-synthetic-brain.ts` / `recall-stub.ts`.
- **Key fact:** recall needs NO Convex, NO network — the brain is local JSON, `kiraBrain.ts` imports only crypto/fs/path. Convex is the *mirror/database* layer (Layer 2), optional for the recall proof.

## What is NOT yet done (be honest in the writeup)
- Tonight ran the **Kira memory/governance substrate**, NOT Auma. The *mind* (Auma 32B LLM) is a separate endpoint and is **not yet plugged into** the shadow. That wiring is the next milestone.
- No persistent/interactive shadow (tonight was a batch proof). A standing shadow needs a VM + tunnel (Phase 1.5).
- No real (scrubbed) memory booted — the scrubber over-strips (redacts integrity hashes + `tokens`), so a *bootable* real brain needs a refined scrubber that whitelists non-secret hashes.

## The architecture invariant (do NOT violate, even when it's tempting)
**weights = stance · memory = tools · gate = conscience — THREE things, coupled, never fused.**
- The model learns *stance* from accumulated experience (periodic LoRA burns; MDL process-memory lane).
- The brain (Convex/JSON) holds *facts/receipts*.
- The gate governs; memory is advisory, never authority (`grantsAuthority:false`).
- "Symbiotic being" = the three staying distinct-but-coupled. Fusing model into brain DESTROYS the auditability + authority firewall. Don't.

## The sovereignty invariant
ONE sovereign (local) is canonical because its loop is unbroken (continuity is a *dynamic* invariant, not topological). Shadows are labs, never the workshop. Code flows local→GitHub→shadow (one-way, fast). Proposals flow shadow→PR/patch/issue→owner→local (gated). No shadow writes `main`. No AUMLOK keys on any shadow.

## Roadmap (priority order)
1. **Plug Auma into the shadow (the real "living in it").** Wire the Auma-32B endpoint as the reasoning layer that consults Kira recall on the box. Proves mind+memory+governance together on metal. *This is the headline next build.*
2. **Two-node drift experiment (the council-of-selves in miniature).** Boot two shadow-Kiras from one snapshot; feed each a different stream (e.g. DMRG results vs KAM finding); score divergence: recall overlap, write/witness/release choices, time-to-first-disagreement. Engineering-lane OP 164.
3. **Refined snapshot scrubber** (repo tool, uses canonical `forbiddenContent.ts` primitives; whitelists integrity hashes + `tokens`) so a REAL scrubbed brain boots and verifies.
4. **The core router model** — a small local model that handles most turns and escalates to Auma/GPT/council on demand. North star: small enough to live anywhere, smart enough to route.
5. **Experience→burn loop** — nodes accumulate receipts → sovereign aggregates → periodic LoRA burn improves stance → land via the gate. Weights and brain stay separate.
6. **Persistent shadow (VM + tunnel)** with kill-switch canary + TTL + own scoped bucket/credential.

## Honest framing to preserve in any pitch
This is a governed, portable, authority-separated agent organism — a better *body/nervous-system/conscience* for rented frontier intelligence. It is NOT a frontier model and NOT AGI. Its value is the governance + memory + portability discipline that almost nobody builds, wrapped in a falsification-first method. Never claim engineering success is physics/AGI evidence.

## Context for Fable
DMRG β + SYK ν land ~tomorrow (verdict scripts armed: `verdict_v3.py`, `syk_verdict_v3.py`). GHP canon is at `GOLDEN HORIZON PRINCIPLE 🔱/{GHP_CORE_v2.md, GHP_BOUNDARY_PROGRAM.md, CANON.md}`. Engineering handoff (Nebius ops + traps) in the inception prompt / `docs/NEBIUS_SHADOW_NODE_PLAN.md`.
