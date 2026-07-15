# Friend-node readiness — checklist + honest state

**What this is:** the packaging checklist for handing this repo to another **trusted friend** — someone who
will clone it, run their own node, enter their own key, and contribute back by PR. This is the
**trusted-lab share**, not the public open-source release: experimental material (GHP, Auma Lingwa,
specs, research notes, TIER-2 codenames) travels with it on purpose. The line that must hold is simpler
and harder: **no private state leaves the owner's machine.** No keys, no memories, no `.env`, no local
Convex data, no transcripts.

Run this checklist before any new person gets the repo. Last full pass: **2026-07-07** (zeb-windows-node,
results at the bottom).

---

## Quickstart for the friend (the 2-minute version)

The full walkthrough is [ZEB_NODE_QUICKSTART.md](ZEB_NODE_QUICKSTART.md); the README front page is the
same thing shorter. The whole of it:

```bash
# once: install Bun (the toolchain — not npm)   https://bun.sh
git clone https://github.com/aumara-xyz/aukora-symbiote.git
cd aukora-symbiote
bun run start        # installs, brings up the brain, opens http://127.0.0.1:7090
```

Then in the app: **System → Settings → paste your own OpenRouter key → Save.** That's a running node.

| Piece | Where |
|---|---|
| Spatial app | `http://127.0.0.1:7090` |
| Chat door (where Auma answers) | `127.0.0.1:7091` |
| Convex memory brain | `127.0.0.1:3210`, **loopback-only** |
| Stop | Ctrl-C in the start terminal, or `bun run stop` |
| Update later | `git pull` then `bun run start` |

## What this node includes

- The complete app + engine: Spatial shell, chat door, apps (Auma·Live, Translate, Luminara, I Ching …),
  the Kira memory engine, the workbench, the AUMLOK signer/approval gate, the local Convex brain runtime.
  It is the same code the founder runs; nothing is held back.
- The lab: GHP research hub, Auma Lingwa canon, specs, roadmaps, round reports, `docs/MESH_INBOX.md`.
  Messy on purpose — this is a working lab repo, not a polished product.

## What this node does NOT include (and never may)

- **The owner's AUMLOK private key** — a signing key never leaves the machine that made it.
- **The owner's memories** — no `brain.json`, no Convex database rows, no `state/`, no transcripts.
- **Anyone's OpenRouter key** — each machine stores its own, outside the repo.
- **Any `.env` values** — only `dashboard/fu/.env.example` (placeholders) is tracked.

A fresh clone starts **unbound and empty**: no key, no memory, no model access, until its new owner adds
their own. That is the design, not a gap.

## Your key, your custody

- **OpenRouter key** — paste it in **System → Settings** in the app. It lands in
  `~/.aukora-symbiote/openrouter.key` (mode `0600`, outside the repo), is never committed, never synced,
  never echoed back to the page. Terminal alternative: `OPENROUTER_API_KEY=sk-or-…` in `core/.env`
  (gitignored).
- **AUMLOK key** — `bash scripts/aumlok-authority.sh keygen` (Git Bash on Windows) creates your own
  Ed25519 keypair in `~/.aukora-symbiote/aumlok/` (`0600`). **It is local. Do not share it, do not
  commit it, do not send it to anyone — including the repo owner.** Every node signs with its own hand.
- **Convex brain** — `bun run start` provisions the local backend under `~/.aukora-symbiote/convex/`,
  loopback-only on `:3210`. **Your brain data is yours alone; nothing syncs from the owner's node and
  nothing of yours syncs back.** GitHub moves code, never memories.

## Contributing back

Never push to `main`. The loop is:

```bash
git checkout -b your-name/your-thing
# … build …
bash scripts/scan-secrets.sh            # leak gate — must end TIER 1 CLEAN
git add <your files> && git commit
git push -u origin your-name/your-thing # then open a PR on GitHub
```

The repo owner reviews and merges. Add a short mesh report under `docs/mesh/YYYY-MM-DD/` with
`bun scripts/mesh-entry.ts`; avoid editing [MESH_INBOX.md](MESH_INBOX.md) for routine reports because it is a shared hot file.
Include your branch, PR link, summary, and action items. Mesh reports are advisory only;
nothing in them grants authority.

---

## The readiness checklist (run before each share)

From a clean checkout of the `main` being shared:

1. **Leak gate:** `bash scripts/scan-secrets.sh` → must print `TIER 1 CLEAN`. Note: the owner-private
   PII/slug vectors live in `scripts/scan-vectors.local.sh` (gitignored, owner's machine only) — the
   full TIER-1 PII sweep only runs where that file exists, so the owner should run the gate too, not
   only the packager.
2. **Nothing secret-shaped tracked:**
   `git ls-files | grep -iE '(^|/)\.env|\.pem$|\.key$|(^|/)state/|openrouter|sqlite|brain\.json|auth\.json|aumlok-dev'`
   → only tests/examples may appear (e.g. `dashboard/fu/.env.example`, `core/tests/openrouterKeyFile.test.ts`).
3. **Fresh-clone integrity:** `bun scripts/verify-release-package.ts` → every Spatial shell import
   exists and is tracked (catches "works here because of an untracked file").
4. **Spine:** `bash scripts/status.sh` → `HEADLESS_READY`, gate byte-pin `VERIFIED`.
5. **Fence rehearsal** (deeper, occasional): the fresh-clone drill in
   [ZEB_NODE_RELEASE_CHECK.md](ZEB_NODE_RELEASE_CHECK.md) — isolated home + alternate ports, confirm no
   key/memory/state present in the clone and the key save→clear flow never echoes the key.

## Results of the 2026-07-07 pass (zeb-windows-node)

All four checks green on `main` @ `1272f73`:

- Scan: **TIER 1 CLEAN** (owner-private vectors absent on this machine — those specific checks skipped;
  see note in step 1). TIER 2 worklist unchanged and expected for a trusted-lab share (research-lane
  codenames, provider names, owner first name; the 122 "paladin" hits per Auma-Lingwa canon file are the
  conlang's own vocab set, not the research-lane codename).
- Tracked-set greps: clean. `state/` empty in git, `identity/` is a README only, `convex/` tracks only
  source/tests (no database files), no `.env`, no key material.
- Release-package guard: **OK** — 16 tracked app modules.
- `status.sh`: **HEADLESS_READY**, 14-file gate byte-pin verified (runs fine on Windows Git Bash).

**One finding, documented not fixed** (canon-lane owns those files):
`GHP/canon/GHP_BOUNDARY_PROGRAM.md` and `GHP/canon/GHP_RESEARCH_LEDGER.md` quote a stale absolute path
that contains the owner's real full name (`/Users/<owner full name>/EPSILON/`, in the P-002a audit
record). Fine for a trusted friend; on the scrub list before anything public. Fixing it means editing
GHP canon text, which is reconciled from a source outside this repo — Peter/GHP lane should decide how
(e.g. `~/EPSILON/`), rather than a packaging PR silently rewriting canon.

## Honest limits (so nobody over-promises to the friend)

- **Convex capture/recall is not fully wired.** The brain runtime starts and the governed write path
  exists in code, but the voice lane writes no memory to Convex yet (`/api/brain` truthfully reports
  `capture.wired: false`) and live fuzzy recall is still served from local Kira `brain.json` until R5b
  lands. Saying "the Convex brain remembers your chats" would be overclaiming — today it is
  runtime + contract, not the living memory.
- **The AUMLOK ceremony is not in-app yet.** Binding a node is a terminal step
  (`bash scripts/aumlok-authority.sh keygen`); the app shows state and commands but cannot generate the
  key itself ([AUMLOK_APP_CEREMONY_SPEC.md](AUMLOK_APP_CEREMONY_SPEC.md) is still a proposal).
- **The full behavior gate needs Node.js.** `scripts/test.sh` runs vitest under `node`; on a bun-only
  machine the gate honestly reports it cannot run the behavior suite. A friend who wants green
  rehearsals locally should install Node LTS alongside Bun.
- **A fresh node is unbound** until its owner runs keygen — it can read, imagine, and propose, but
  nothing applies live. That is the covenant working, not a bug.
