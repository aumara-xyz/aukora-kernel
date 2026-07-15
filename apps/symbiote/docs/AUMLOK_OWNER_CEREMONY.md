# AUMLOK Owner Ceremony — a plain-language guide

**Read this before you run anything.** It explains the three different things that all sound similar,
where your key lives, and the exact commands — run only when you're actually ready.

This document does not run anything for you, and nothing in this repo generates or holds your real
private key. That step is yours alone.

---

## The three things that are NOT the same thing

It's easy to conflate these. They are deliberately separate:

1. **First Contact boundary rehearsal (UI, in the browser).** Typing the seven AUMLOK words at
   `/first-contact` and clicking "Form boundary" is a **local shape check** — it confirms the seven
   fields are internally consistent (anchor word + six matching echoes). It runs entirely in
   JavaScript in your browser tab. It never touches a real key, never leaves your machine, and grants
   no authority. It exists to make the *ceremony* legible, not to *be* the ceremony.

2. **AUMLOK cryptographic rehearsal (terminal, real Ed25519 key).** Running
   `scripts/aumlok-authority.sh keygen / sign / rehearse` in your terminal generates a real key, signs
   a real authorization, and writes a real signed receipt. This is the actual cryptographic act — proof
   that *you*, holding *your* key, authorized *something*. But it still does not execute anything.
   `promotionExecuted` is always `false` in the receipt, and it always will be from this script.

3. **Live promotion (not built).** The organism actually applying a self-modification for real. This
   does not exist yet. `isLivePromotionUnlocked()` in `core/src/aumlokAuthorityRoot.ts` is a
   literal-typed function that always returns `false` — not a runtime flag that could be flipped, a
   type-level guarantee. Building this is a separate, future, deliberately-paced milestone. Nothing in
   this document changes that.

**Doing #1 or #2 does not create #3.** You can rehearse the boundary and even complete the
cryptographic rehearsal, and the live gate stays exactly as locked as it was before.

---

## What `keygen`, `sign`, and `rehearse` actually do

```
scripts/aumlok-authority.sh keygen
scripts/aumlok-authority.sh sign <proposal-artifact.json>      # re-derives the hash + prints goal/files before signing
scripts/aumlok-authority.sh rehearse <signed-receipt.json>
```

- **`keygen`** — generates a fresh Ed25519 keypair. The private key is written to
  `~/.aukora-symbiote/aumlok/authority-ed25519.key` (or `$AUKORA_SYMBIOTE_HOME/aumlok/` if you've set
  that env var), with file permissions `0600` (only you can read it), and it is **never written inside
  this repo** — it's outside the git tree entirely, and the directory it lives in is gitignored as a
  second layer of protection. Only the **public** key is printed to your terminal, for you to note down
  or pin. If a key already exists, `keygen` refuses to overwrite it — you'd need a deliberate
  revoke/rotate to replace it, not an accidental re-run.
- **`sign`** — takes a **proposal-artifact JSON file** — the one the workbench wrote to
  `~/.aukora-symbiote/aumlok/pending-proposals/<hash>.json` — re-derives its canonical hash from the
  artifact's own goal + files, prints the goal and each file so you see **exactly** what you're
  authorizing, and signs an authorization envelope bound to that exact content. Prints the signed
  envelope to stdout as JSON (redirect it to a file, e.g. `> /tmp/signed-<hash>.json`). A signature can
  only ever authorize the byte-identical content it was signed over — never a substituted payload.
- **`rehearse`** — takes that signed envelope, verifies it against your *pinned public key* (never the
  private key — the organism's verifier code physically cannot read a private key; see
  `core/src/aumlokAuthorityRoot.ts`, which imports no signing capability at all), and writes a durable,
  hash-chained receipt to `~/.aukora-symbiote/aumlok/receipts/`. This receipt records that your
  signature verified successfully — it does not execute anything. `promotionExecuted: false` and
  `rehearsalOnly: true` are baked into the receipt's type; no input, forged or otherwise, can flip them.

## After you sign: `rehearse` vs. `apply signed proposal` (two different endings)

A signed envelope can feed one of two paths — they are NOT the same:

- **`rehearse <signed-receipt.json>`** — verifies the signature against your pinned public key and writes
  a hash-chained receipt. **It executes nothing.** `promotionExecuted: false`, `rehearsalOnly: true`. This
  is the safe "prove the key works" ending.
- **`apply signed proposal <signed-receipt.json>`** (typed in the workbench, not this script) — the ONLY
  path that actually writes the proposed files to the live repo and makes a real git commit, via
  `dispatchSignedLiveApply`. It re-verifies everything from disk first (content re-hash match against the
  signature, pinned Ed25519 root, consume-once replay ledger, sacred-path refusal) and refuses on any
  mismatch. This is the real per-proposal live apply — currently the intended path for the first #35
  self-recursion rehearsal, and only to be run when you mean it.

Both require a real signature over the **exact** proposal content. Neither is reachable from the browser,
the chat, or the model — only from your own terminal / the owner-driven workbench.

## Where the private key lives, and what never to do with it

- **Location:** `~/.aukora-symbiote/aumlok/authority-ed25519.key` (or under `$AUKORA_SYMBIOTE_HOME` if
  you've customized that). Never inside `aukora-symbiote/` itself.
- **Permissions:** `0600` — readable only by you.
- **Never commit it.** The directory is gitignored, but don't override that.
- **Never paste it anywhere** — not into a chat with Claude, not into an issue, not into a file you
  might later share, not into a screenshot. Nobody building this system, including the AI doing the
  building, ever needs to see it. The whole point of the signer/verifier split
  (`aumlokSigner.ts` vs `aumlokAuthorityRoot.ts`) is that the organism structurally cannot sign — it
  only verifies a public key. There is no legitimate reason for the private key to ever leave your
  terminal.
- **If you ever suspect it leaked:** use the signed revoke/rotate lifecycle
  (`applyVerifiedLifecycleToRoot` in `core/src/aumlokAuthorityRoot.ts`) rather than manually deleting
  files — it's the tested, auditable path.

## What the rehearsal proves — and what it doesn't

After a successful `rehearse`, you have a receipt that proves: *a human, holding a real private key,
signed a real authorization, and the organism verified it against the pinned public key.* That's a real,
meaningful cryptographic fact.

It does **not** prove or cause: live promotion, a wired self-modification path, or any change to
`isLivePromotionUnlocked()`. That function returns `false` before, during, and after this ceremony,
by construction — not by convention.

## The double-click question

**No double-click launcher exists for this ceremony, and none should be built yet.** A double-click
wrapper is appropriate for First Contact (opening a page has no stakes). It is not appropriate here: key
generation and signing are exactly the kind of action that deserves a deliberate terminal session, not a
one-click convenience that could be triggered by an accidental double-click, muscle memory, or someone
else at your machine. If a safe wrapper is ever justified — e.g., one that only ever calls `rehearse` on
an already-signed file you provide, never `keygen` — it would need its own explicit safety review before
being built. Until then: run the commands above yourself, in your own terminal, when you mean to.

## Run only when ready

There's no urgency here. First Contact works today with none of this. This ceremony is yours to do
whenever it actually feels right — not because a round asked for it.
