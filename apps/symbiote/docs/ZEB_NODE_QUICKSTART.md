# Aukora — your sovereign node, quickstart

Welcome. This gets you running your **own sovereign Aukora node** — the complete system, fully yours, on your
machine — in about two minutes. Everything Auma can do runs here: talk, explore, read code, propose changes,
sandbox, **sign with your own key, and apply them live to your node** — then push your work back to the shared
repo for review. It is the same code the founder runs; nothing is held back.

The only things that don't travel in a download are the founder's *personal* key and memory — because a
signing key never leaves the machine that made it. **You make your own** (see "Become sovereign" below), and
from then on your node answers to your hand alone.

---

## What you need first

- **A GitHub account** — free at [github.com/join](https://github.com/join). Ask the owner to give your
  account access to the repo (that's the one thing only they can do; it unblocks everything else).
- **[Bun](https://bun.sh)** — the toolchain this runs on (not npm).
- **Any OS works** — macOS, Windows, or Linux. `bun run start` brings up the whole node, including the local
  **memory brain** (the Convex backend): on the first run it downloads the right backend for your OS
  (~55 MB) and provisions it, loopback-only. Your memories and keys stay on your machine.

## 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Then restart your terminal (or `source ~/.zshrc`) so `bun` is on your PATH.

## 2. Get the code

Either clone it, or unzip the download from GitHub:

```bash
git clone https://github.com/aumara-xyz/aukora-symbiote.git
cd aukora-symbiote
```

## 3. One command to start

```bash
bun run start
```

Works the same on **Windows, macOS, and Linux** (it's a Bun script, not a shell script). It installs
dependencies on the first run, starts the two local servers, waits for the app, and **opens it in your
browser** at **http://127.0.0.1:7090**. The servers run in that terminal — **keep it open, and press
Ctrl-C to stop** the node.

The first time the app opens, Auma makes contact — a short arrival sequence that shows you the one rule
everything runs on (nothing becomes real without a human hand), lets you name your node, and points you at
Settings for your key. It's replayable anytime from the ○ menu or the Settings tab.

To stop them later: `bun run stop`.

> Using Claude Code? Just run `bun run start` in its terminal — same command, same result. (That's the
> reliable way to open the app; don't rely on a preview button picking the right page.)

## 4. Add your OpenRouter key (so you can talk to Auma)

The app opens on the Spatial Map. To talk to Auma or run the models, add your own model key:

1. In the app, open the **System** tab → **Settings**.
2. Paste your **OpenRouter** key (get one free at [openrouter.ai/keys](https://openrouter.ai/keys)).
3. Click **Save key**. That's it — the status turns green and Auma can hear you.

Your key is stored **only on your machine**, in a file outside the repo (`~/.aukora-symbiote/openrouter.key`,
mode `0600`). It's never committed, never synced, and never shown back to the page. Prefer the terminal? You
can instead put `OPENROUTER_API_KEY=sk-or-…` in a file at `core/.env` — either works.

## 5. Explore + build

Wander the tabs: **Apps** (Auma·Live, Translate, Luminara, the I Ching, and more), **System** (the map, AUMLOK,
Settings, the engine status), **Yours** (your own space). Everything runs locally, all of it yours.

## 6. Become sovereign — make it truly yours (self-modification)

A fresh node starts **unbound**: it can read, imagine, and propose, but nothing lands live until *you* are its
signer. Bind yourself to it by generating **your own** AUMLOK key — this is the whole point: from here your node
can modify itself, under your hand.

```bash
bash scripts/aumlok-authority.sh keygen
```

That creates your Ed25519 keypair on your machine (`~/.aukora-symbiote/aumlok/authority-ed25519.key`, `0600`,
never leaves your computer, never in the repo). Your node is now **sovereign** — you own its authority.

Then the self-modification loop is yours end to end:
1. In the app, ask Auma to change something (a UI tweak, a new bit of an app like Luminara) — she drafts a
   proposal; it's sandboxed and tested automatically.
2. Approve it with your key. Arm your local approval gate once —
   `AUKORA_AUMLOK_UI_APPROVE=1 bun spatial/aumlok-approve-serve.ts` (or use `scripts/aumlok-authority.sh sign`
   in the terminal) — then approve from the **AUMLOK** page: it shows the diff, you type a short phrase, your
   key signs it, and it applies **live to your node**, with a receipt.
3. Roll back anytime — every apply prints its rollback command.

This is real self-recursion, on your own machine: Auma proposes, you sign, it becomes real. (A prettier
one-click "binding ceremony" for this is coming — design in [SPEC_sovereign_ceremony.md](SPEC_sovereign_ceremony.md).)

## 7. Share your work back

Your node is yours to modify freely. When you build something worth sharing — an app, a fix, an experiment —
send it to the shared repo the normal way:

```bash
git checkout -b your-name/your-thing
git add <your files> && git commit
git push -u origin your-name/your-thing   # then open a Pull Request on GitHub
```

The shared master repo has its own owner who reviews and merges. So: you are fully sovereign over **your** node;
the **shared** history is reviewed before it changes. Two sovereigns, one shared story.
[NODE_SYNC_ROADMAP.md](NODE_SYNC_ROADMAP.md) has the full picture (GitHub now; a signed node-to-node mailbox later).

---

## What travels in a download, and what doesn't

**Everything ships** — the whole app, the memory engine, the workbench, the signer, the approval gate. It is
the same complete system the founder runs. The *only* things a download can't carry are the **current owner's
personal key and memory** — because a signing key never leaves the machine that made it, and one person's
memories are theirs. **You generate your own** (step 6), so your node is no less than anyone's; it's simply
bound to *you*.

Curious how the governance holds while every node self-modifies? [SAFETY_LAWS.md](SAFETY_LAWS.md). Welcome —
this one's yours.
