# MEDIA PORTAL — the connected creative organ (seed)

**Status: SEED / shell only.** The UI surface exists (`spatial/app/media.js`,
registered in `spatial/app/shell.js`). Nothing generates yet — no outbound call
is wired. This is a planted seed to be finished from the inside-out, governed.

## What it is (and what it is NOT)

Media Portal is an **outbound / connected** organ — deliberately unlike the
sovereign local brain:
- Media generation reaches **Higgsfield's cloud GPUs**. That egress is inherent
  to cloud media gen and is labeled honestly in the UI footer.
- It runs on the **owner's own Higgsfield account and credits**, via the
  Higgsfield CLI installed on this machine (`@higgsfield/cli` v1.1.5).
- **No key ever lives in the browser.** Auth is the CLI's own OAuth session
  (`higgsfield auth login`), stored by the CLI on disk — the browser never sees
  a token.
- A creation is **not a memory**: it is never receipted into the Kira/Convex
  brain and grants no authority. It's an optional creative tool, clearly so.

## The real CLI surface (verified from `higgsfield --help`, v1.1.5)

Aliases: `higgsfield` | `higgs` | `hf`. Global flag `--json` for machine output.

| group | purpose | key subcommands |
|---|---|---|
| `auth` | OAuth session | `login` (browser PKCE), `token`, `logout` |
| `account` | credits | `status` (email/plan/credits), `transactions` |
| `model` | catalog | `list [--image|--video]`, `get <model>` |
| `upload` | inputs | upload local media → `upload_id` |
| `generate` (`gen`) | jobs | `create <model> --prompt … [--image <id>]`, `cost`, `get <job>`, `list`, `wait <job>` |
| `soul-id` | consistent character | train & manage Soul refs |
| `product-photoshoot` | brand images | mode-specific prompt enhancement |
| `marketing-studio` | ads/assets | Marketing Studio workflows |
| `workflow` | reusable flows | `list`, inspect params |
| `voices` | TTS / voice-change | list voices |
| `website` / `game` | ship sites/games | out of scope for the portal |

Example the CLI itself prints:
```
higgsfield generate create nano_banana_2 --prompt "studio product photo"
higgsfield generate create <model> --image <upload_id> --prompt "…"    # image→video
higgsfield generate cost  <model> --prompt "…"                         # estimate credits first
higgsfield generate wait  <job_id>                                     # poll to completion
```

## Planned inside-out wiring (NOT built here)

1. **Door route** (`spatial/mediaLane.ts`, on the 7091 chat door — loopback,
   existing CSRF guard): browser POSTs `{mode, model, prompt, options}` →
   the door shells out to `higgsfield … --json`, tracks the async job, and
   streams status/URLs back. The browser never runs the CLI or holds a token.
2. **Cost-first UX:** always `generate cost` before `create`, surface the credit
   estimate, let the owner confirm — no silent spend.
3. **Job tray + gallery:** live queue from `generate get/wait --json`; finished
   URLs render in the portal and can be pushed into KNVS (the center canvas).
4. **Auma-driven (later):** she drafts a prompt, the owner approves, it renders —
   the creative-output loop of the Everything-App. Advisory only; the owner (or
   a governed confirm) authorizes the spend, never the model alone.
5. **Multi-tenant (much later, for public nodes):** each person authenticates
   their own CLI session or supplies their own key; the portal never shares one
   account across users.

## Preconditions for wiring
- `higgsfield auth login` completed on the machine (session currently stale for
  live API calls — re-login when wiring).
- Higgsfield credits available (owner has an account; **no credits yet** at seed
  time — `generate` will fail until credited; `cost`/`model list` are the safe
  first probes).

## Non-goals
- No key entry in the browser. No shared account across users. No treating a
  creation as memory or authority. No silent spend.
