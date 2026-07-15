# Aukora FU — Fusion Under-the-Hood

**FU = Fusion / Fusion Under-the-Hood.** A local Fusion Council runner plus browser observer.
It calls models through OpenRouter, writes validated `fusion-run-v1` artifacts into `runs/`,
then the browser visualizes the council: consensus, per-model votes, divergence, contrarian model,
and run history.

## What it is (and is not)
- ✅ Local advisory Fusion engine: `bun run council`.
- ✅ Browser observer: `bun run start` then open `http://127.0.0.1:9900`.
- ✅ Demo/sample mode with no API key: `bun run sample`.
- ✅ Loopback-only UI (`127.0.0.1:9900`). No microphone, no camera.
- ✅ **Read-only server**: writes nothing, deletes nothing, runs no tool; guards path traversal to `runs/`.
- ❌ NOT a kernel organ. It does **not** live in `core/src` and imports **nothing** from the kernel.
- ❌ It never signs, unlocks, promotes, authorizes, writes memory, or affects a gate verdict.

The governance boundary is non-negotiable: FU can review and visualize. It cannot authorize.
Inside full Aukora, the governed source of truth remains `aukora-symbiote`; this private repo is a
portable/private Fusion lab.

## Quick Start

1. Install Bun:

       https://bun.sh

2. Start the browser observer:

       bun run start

3. Open:

       http://127.0.0.1:9900

4. In a second terminal, prove the engine writes a run:

       bun run sample

5. For a real model council run, add an OpenRouter key:

       cp .env.example .env
       # edit .env and set OPENROUTER_API_KEY
       bun run council

The page refreshes when a new run lands. Generated `runs/*.json` are local output and are gitignored.

## Review Another Folder

By default, FU reviews itself. To point the council at another local project:

    FUSION_TARGET=/absolute/path/to/project COUNCIL_BUDGET=10 bun run council

Useful knobs:

    COUNCIL_BUDGET=10          # max model calls
    COUNCIL_CONCURRENCY=3      # max simultaneous calls, clamped 1..8
    FUSION_MODELS=a,b,c        # comma-separated OpenRouter model slugs

Endpoints (all read-only): `/api/runs`, `/api/run/latest`, `/api/run/:id`, and SSE `/api/stream`
(live-refresh when a new run lands).

## Private Lab Warning

This is private early tech. Do not publish without a release/legal/patent review. Do not commit `.env`
or generated `runs/*.json`.
