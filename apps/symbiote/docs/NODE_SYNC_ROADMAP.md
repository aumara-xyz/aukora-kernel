# Node sync — how nodes share, now and later

Short version: **code flows through GitHub; authority never flows at all.** This doc is the honest map of
how two (or more) Aukora nodes stay in touch today, and where node-to-node is headed. It is advisory — it
builds nothing and grants nothing.

---

## The one invariant, through every phase

**Distance never becomes permission.** No channel — not GitHub, not a shared cloud box, not a future message
bus — ever carries the AUMLOK signing key, the owner's memory/brain, or the ability to apply a change. Ideas
can travel freely between nodes; the only thing that makes an idea *real* is the owner's signature, at the
owner's own terminal. Every phase below preserves that.

There is **one writer of reality** (the owner's local node). Everything else — every other node, every cloud
mirror — is a *reader and a proposer*.

---

## Now (built, proven): GitHub is the loop

This works today and is the right long-term channel for code:

1. You work on your own sovereign node, on a branch.
2. They push the branch and open a **pull request**.
3. The owner reviews it and merges into the master repo by hand.

Code flows out fast (`git pull` a commit); proposals flow back gated through the owner's eyes. It's free,
auditable, and **the review step is the security model.** Keep this as the code channel indefinitely.

For **messages** between people in the near term: GitHub **Issues / Discussions** work fine, or a small
`mesh/` directory of plain markdown notes exchanged via PRs so messages ride the same reviewed channel as
code. It's not elegant — threads don't want a merge step — but it needs zero new infrastructure.

## Next (mirror / lab): Nebius as a shadow, not an authority

A shadow-node pipeline (snapshot → scrub → encrypt → bucket) exists in design and has run once in batch;
**no persistent shadow exists yet.** What an always-on box is genuinely good for:

- **A neutral rendezvous / experiment lab.** Both nodes spawn shadow clones from the same commit, run
  experiments, and return results as PRs. Useful precisely because neither person has to be online at the
  same time.
- It must **never** hold AUMLOK keys or write `main`. It is a reader/proposer like everything else.

## Later (when it's real): signed advisory message packets

The first true node-to-node organ is a tiny **governed mailbox**:

- Each message is a **signed envelope** (verifiable sender identity), **append-only**, **advisory-only** —
  never an instruction that applies anything.
- Each node **polls its own inbox**; delivery is a read, never a write to another node's authority.
- Receipts record what arrived. The Nebius box is the natural place to host it, since it's running anyway.

That is the moment "node-to-node" becomes real rather than GitHub-with-extra-steps. It is **not built this
round** — it's the roadmap.

---

## What never syncs (say it plainly)

Every node is a **complete sovereign node** — the whole system, self-modification and all, once its owner
generates their key. What never crosses machines is anything *personal or master-level*:

- A node owner's **AUMLOK signing key** — lives only on the machine that made it, forever. Each person makes
  their own; no key ever copies between nodes.
- A node owner's **memory / brain** — their private local state, outside the repo.
- **Authority over the *shared* repo and over *other* nodes** — your key is sovereign over *your* node only.
  It grants nothing over the master history (which its owner reviews) or over anyone else's node.

So: everyone is fully sovereign on their own machine, and the *shared* story changes only through review. Two
sovereigns, one reviewed history. That symmetry is the design.
