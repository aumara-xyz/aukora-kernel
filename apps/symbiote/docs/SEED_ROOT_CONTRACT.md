# Seed-root / path contract (M2 serve/path preflight)

The seed runs from **its own root**. No launcher, server, or script depends on a donor repo
(`aukora-os`, `aukora-trinity`, `aukora-mega-mind`, `aukora-kernel`) or an external OpenCode shell at
runtime. This contract is pinned by `core/tests/seedRootContract.test.ts` — drift fails the gate.

## Code root (relocatable)
Every launcher derives its root from its **own file location**, never a hardcoded absolute path:
- shell scripts: `REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`
- TS servers: `join(dirname(fileURLToPath(import.meta.url)), "..")`

Move or clone the seed anywhere and the scripts still resolve. No `/Users/...` or `/home/...` repo path is
baked in.

## State root (outside the repo, one explicit path)
Mutable state lives **outside** the repo, under one explicit, env-overridable path:

    ${AUKORA_SYMBIOTE_HOME:-$HOME/.aukora-symbiote}

This is where the AUMLOK human-held key custody dir lives (`scripts/aumlok-authority.sh`,
`scripts/status.sh`). No state is written into the repo tree; no secrets / env material are copied into the
repo (PII scan vectors live in the gitignored `scripts/scan-vectors.local.sh`).

## Serving (loopback only)
Local observer servers bind **loopback only** — there is no signed/authenticated network lane yet:
- `dashboard/serve.ts` — console, `AUKORA_CONSOLE_PORT:-7070` → `hostname: "127.0.0.1"`
- `website/serve.ts` — static preview, `AUKORA_WEB_PORT:-7080` → `hostname: "127.0.0.1"`

An all-interface (`0.0.0.0`) bind is **forbidden** until a deliberate signed/network lane exists.

## The serve lane carries no authority
The console serve lane spawns **only** allowlisted seed scripts (`scripts/status.sh`,
`scripts/heartbeat.sh`) and never signs, unlocks, promotes, authorizes, or mutates live state. The heartbeat
it displays is sandbox-only (`appliedLive=false`). AUMLOK authority custody is a **separate, terminal-only**
tool (`scripts/aumlok-authority.sh`) — never reachable from a server.

## No vendored donor tool-mechanics fork
`self_edit/opencode/` (a vendored donor IDE tool fork, never a real runtime dependency) was archived
to branch `archive/self_edit-opencode-fork` and deleted from main (2026-07-02, issue #23). The
organism's own self-editing surface is `core/src/nativeToolCallingEngine.ts`, driven through the
workbench (`core/src/workbenchCommandLoop.ts`'s `agent: <goal>` command) — a from-scratch tool
surface, not an extracted fork.
