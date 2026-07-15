# Sovereign node — fresh-clone release check

A rehearsal of exactly what a friend does: download the repo from GitHub, run one command, add a key, make
contact. Run from a clean clone of the pushed `main`, in a scratch directory, with an **isolated home and
alternate ports** so the owner's live node is never touched.

**Last release-prep sweep:** the commit that carries this file. The gate now includes a release-package
guard that fails if the Spatial shell imports an app module that is missing or untracked — the exact
clean-clone class that would make a friend's node open to a broken screen. The launcher is a cross-platform
**Bun** script — it runs the same on **Windows, macOS, and Linux** (no bash / lsof / `open`); verified on
macOS here, and it has no known Windows blocker (Bun 1.3 + `cmd /c start`).

## What was verified (all green)

| # | Check | Result |
|---|-------|--------|
| 1 | Fresh `git clone` of the pushed HEAD | ✓ clones clean |
| 2 | **Fence** — no private state tracked in the clone (no AUMLOK key, brain.json, `.env`, `openrouter.key`, approve gate, `.claude/`) | ✓ none present |
| 3 | `bun install` from scratch (the `@noble/curves` phantom-dep fix) | ✓ exit 0, `ed25519.js` resolves |
| 4 | Servers start (spatial + chat door) on the isolated home/ports | ✓ both up |
| 5 | Spatial shell serves; **First Contact** intro present; **Settings** organ present | ✓ all served |
| 6 | OpenRouter key: save → stored `0600` **outside the repo** → status flips → garbage rejected (400) → clear removes it; key **never** echoed in any response | ✓ full flow, no leak |
| 7 | With no key, Auma degrades gracefully ("Add yours in the System → Settings tab") | ✓ (in `spatial/presenceLane.ts`) |
| 8 | The owner's real home/node is untouched by the check | ✓ no key written, live node running |
| 9 | Release package guard: every Spatial shell app import exists and is tracked | ✓ part of `scripts/test.sh` |

## The exact commands a contributor runs

```bash
# once: install Bun (the toolchain — not npm)
curl -fsSL https://bun.sh/install | bash

# get the code (after the owner grants your GitHub account repo access)
git clone https://github.com/aumara-xyz/aukora-symbiote.git
cd aukora-symbiote

# one command: installs, starts the servers, opens the app at http://127.0.0.1:7090
bun run start

# then, in the app: System → Settings → paste your OpenRouter key → Save
# stop later with:  bun run stop
```

Any OS — `bun run start` also brings up the local *memory brain* (Convex backend), downloading the right
build for the OS on first run. See
[ZEB_NODE_QUICKSTART.md](ZEB_NODE_QUICKSTART.md) and [NODE_SYNC_ROADMAP.md](NODE_SYNC_ROADMAP.md).

## How to re-run this check

Clone into a scratch dir, then start with an isolated home + alternate ports so a live node is untouched:

```bash
git clone <repo> /tmp/zeb-rc && cd /tmp/zeb-rc/core && bun install
cd /tmp/zeb-rc
AUKORA_SYMBIOTE_HOME=/tmp/zeb-rc-home HOME=/tmp/zeb-rc-home \
  AUKORA_SPATIAL_PORT=7295 AUKORA_SPATIAL_CHAT_PORT=7296 \
  bun run spatial/serve.ts &   # + spatial/chat-serve.ts
# curl 127.0.0.1:7295 (shell), /app/onboarding.js (First Contact), /app/settings.js (Settings)
# curl 127.0.0.1:7296/api/settings/openrouter  (GET status; POST {key}; DELETE)
```
