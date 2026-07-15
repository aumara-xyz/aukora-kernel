# dashboard/ — the Builder Console (dev tooling)

**Two different things live behind this one local server — labeled honestly, not both read-only:**

- **`/console`, `/anatomy`, `/first-contact`** — a small, genuinely **read-only** split-screen view of
  the project: Singularity Path / Inbox / Laws / live status, and the graphify meaning-graph. Pure
  read of repo files + the generated graph, no build step, no external network at view time. Ships
  nothing into `core/ authority/ memory/`.
- **`/` (the default landing page)** — the **Workbench chat**, which is NOT read-only: every command
  routes through the same governed pipeline the CLI scripts use (propose → sandbox → test → Fusion
  review), and `apply signed proposal` is a real path to the live repo, gated entirely by an Ed25519
  signature the owner produces themselves in their own terminal — never automatic, never silent.

The seed stays headless (SAFETY_LAWS 10); none of this is the organism's own UI.

**Run:**
```bash
bash scripts/console.sh          # builds the brain graph if needed, then serves
# → http://localhost:7070        (set AUKORA_CONSOLE_PORT to change)
```

**Read-only panels** (`/console`):
- **Left — source of truth.** Tabs: **Path** (the Singularity Path milestones), **Inbox** (your
  captured tangents — throw me ideas, they land in `docs/INBOX.md` and show up here), **Laws**
  (SAFETY_LAWS), **Status** (live `scripts/status.sh`).
- **Right — the Brain.** The graphify import-graph (`graphify-out/graph.html`). Click modules, see
  what touches what. Regenerate with `graphify update .`.
