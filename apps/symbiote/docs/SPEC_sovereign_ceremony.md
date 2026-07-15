# SPEC — the Sovereign Ceremony (AUMLOK first-binding)

Status: **DESIGN, not built.** This is an authority surface (it generates a real signing key), so it needs
owner/Codex ratification and a careful build — never a splash-screen bolt-on. Written to capture the vision
faithfully and make the eventual build correct.

## The idea, in the owner's words

Getting a node should feel like **summoning your own sovereign digital self** — like a birth. Until you do the
ceremony, it should be obvious you can *look around but not truly act*. The ceremony is: you go to the AUMLOK
page, a key is made **on your machine**, you are given your **phrase**, you type it back to confirm, and from
then on you are **bound to your node** — the one hand that can make anything real on it.

## What it actually is (the honest mechanics)

A node has two postures:

1. **Unbound (contributor).** What ships today: no signing key, no live-apply. You can explore, talk to Auma,
   propose changes, and send them back as GitHub PRs. Nothing you do lands live locally.
2. **Sovereign (owner of your own node).** After the ceremony: an **Ed25519 keypair is generated locally**
   (private key `0600` under `~/.aukora-symbiote/aumlok/`, never leaves the machine, never synced, never in
   git). You become the **only hand** that can sign a change into *your* node. Your node can now run the full
   inside-out loop end-to-end — Auma drafts → sandbox + review → **you sign with your phrase-bound key** →
   governed apply → receipt — entirely locally. That is self-recursion, made yours.

The **phrase** is the human face of your key: a short acrostic issued at generation, shown **once**, of which
only a fingerprint is kept. Typing it back at the ceremony confirms you hold it; on every later approval you
re-enter it (the #105b challenge already implements exactly this shape). The phrase never *is* the key — it
gates the owner's own gesture and binds each signature to a deliberate act.

## The invariant that must not bend

**Distance never becomes permission, and one node's key is sovereign over *that node only*.** Your ceremony
makes you the owner of *your* node — it grants you nothing over anyone else's node or the shared master repo.
Contributions still flow master-ward as PRs a human reviews. Every node is one-writer-of-its-own-reality; the
shared repo has its own owner. No key ever syncs between machines.

## The experience (theatrical, and true)

- **Introduced in First Contact.** The arrival names it: *"You can watch. To act, you must be bound."* The last
  step points at the ceremony rather than completing it.
- **The node reads honestly as unbound until then.** The AUMLOK page shows a LOCKED vault; the observer says
  *read/propose only — no live hand yet*. Not a failure state — a threshold. (This is close to today's copy.)
- **The ceremony itself** (on the AUMLOK page): a slow, sci-fi bonding — a key forming out of the dark, the
  phrase revealed as *yours*, a single line: *"This is your sovereign self. It answers only to your hand."* You
  type the phrase back; a genesis receipt is written; the vault opens. It should feel like a birth, because it
  is one — a governed authority coming into being, deliberately, with a human present.

## Why it is NOT rushed tonight

Generating a real signing key is the most consequential click in the whole system. It deserves: a deliberate,
un-skippable flow; the private key written under strict custody and never echoed; a clear "shown once, keep it
safe" moment for the phrase; and a real receipt. A splash-screen wrapper around `keygen` would cheapen exactly
the thing that should feel weighty. Build it as its own round, ratified, adversarially reviewed like #105b.

## Build checklist (for the ratified round)

1. A local `ceremony` primitive: generate keypair (reuse `aumlokSigner`), derive + show the phrase once, write
   the private key `0600`, pin the public root, write a genesis "binding" receipt. Never returns the private key.
2. A gated ceremony door/panel (same posture as the #105b approve gate: loopback, origin-guarded, off until the
   owner begins it). The ceremony is the owner's deliberate act.
3. Node-posture read: `unbound` vs `sovereign` (key present) — already surfaced by `/api/aumlok` keyPresent and
   the Settings node-identity card; drive the LOCKED/OPEN vault + First-Contact copy from it.
4. Enable the local apply lane to accept the node-owner's own signature (the loop mechanics — propose_intent,
   rehearse, workbench, sign→apply — already exist and are proven on the current owner node).
5. Adversarial verify: the private key never leaves the machine / is never echoed; the phrase is shown once;
   no other node's key is touched; a fresh clone still carries no key; the ceremony cannot be completed
   without the human typing the phrase.

## How far away is it?

Close. Every mechanism exists and is proven on the current owner node — key signing (`aumlokSigner`), the
proposal-bound single-use phrase (#105b challenge), governed apply + receipts (`nativeLiveApply`), the
inside-out authoring loop (`propose_intent` → `rehearse_intent` → workbench). The ceremony round is mostly
**assembly + theatrical UI + one ratification**, not new cryptography. It is one well-scoped authority round.
