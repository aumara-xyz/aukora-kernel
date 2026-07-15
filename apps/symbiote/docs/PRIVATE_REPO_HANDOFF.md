# Nebius private handoff

Status: private-repo handoff packet. This file is a release note for the commit that carries it.

The goal for this handoff is simple: give Zeb and the Nebius team the complete working node, with enough
truth in the docs that outside engineers can harden it instead of reverse-engineering our current state.

## What is ready to show

- `bun run start` launches the Spatial app on `127.0.0.1:7090` and the chat door on `127.0.0.1:7091`.
- The local Convex brain runtime is part of the node startup path. On first run it downloads the pinned
  self-hosted backend binary, provisions local keys outside the repo, and starts loopback-only.
- The Settings panel lets each machine store its own OpenRouter key outside the repo with `0600` permissions.
- AUMLOK keygen is present. Each node can generate its own local Ed25519 key and apply to its own clone.
- The inside-out loop exists: Auma can stage intents, queue rehearsals, a cheap runner can produce
  signature-ready evidence, and the local owner signs before anything applies.
- GitHub is the code bridge today: Zeb branches, pushes, and opens PRs; Peter reviews and merges shared
  `main`.

## What is deliberately not claimed yet

- Public open-source scrub is not complete. This repo is still the private lab packet.
- Nebius persistent node-to-node sync is not built. Use GitHub PRs for code exchange now.
- Live fuzzy recall is still served by the Kira memory surface until R5b search/indexing lands. Convex is the
  local brain runtime and governed store, but do not claim full recall cutover until R5b is implemented and
  proven.
- AUMLOK keys and personal brain state never sync between machines.

## Zeb flow

```bash
git clone https://github.com/aumara-xyz/aukora-symbiote.git
cd aukora-symbiote
bun run start
```

Then:

1. Open `System -> Settings` and save a personal OpenRouter key.
2. Run `bash scripts/aumlok-authority.sh keygen` to bind the local node to Zeb's own AUMLOK key.
3. Build on a branch.
4. Push a branch and open a PR for Peter to merge.

## Intermediate GitHub mesh

For the next 48 hours, GitHub is the safe mesh:

- `main` is Peter's reviewed integration line.
- Zeb works on `zeb/<topic>` branches.
- Nebius can pull `main` and any experiment branch for testing.
- Findings return as PRs or issues.
- Messages can ride GitHub Issues/Discussions or markdown notes under a future `mesh/` directory.

This is less elegant than direct node-mail, but it is auditable and already works.

## Future mesh

The eventual replacement for GitHub-as-message-bus is a signed advisory mailbox:

- node identity keys separate from AUMLOK owner keys;
- append-only signed envelopes;
- `advisoryOnly: true` and `grantsAuthority: false` on every packet;
- no remote writes to another node's brain, key store, or apply lane;
- Nebius can act as a rendezvous server without becoming an authority.

That is roadmap work, not part of this private handoff.

