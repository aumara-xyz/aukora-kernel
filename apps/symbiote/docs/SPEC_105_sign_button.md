# Spec — #105 AUMLOK make-contact sign button (device-local)

Status: SPEC ONLY. Authority-adjacent — touches how the owner's signature is produced. Build behind an
explicit owner review; nothing here changes who can apply (only Peter's key, ever) — it changes the
GESTURE from two terminal commands to one deliberate physical action, which is Peter's stated wish:
"making contact… a physical action on my side."

## The problem it solves
Today the owner signs in the terminal:
```
bash scripts/aumlok-authority.sh sign <pending-proposal.json> > /tmp/signed.json
bun -e "...apply signed proposal /tmp/signed.json..."
```
Proven to work (commits 03041d9, c3c316f) but clunky, and — crucially — it happens OUTSIDE the app, so
the "contact between the two observers" is mediated by a shell. The AUMLOK page (spatial/app/aumlok.js)
is today a pure OBSERVER MOCK: its own header says "there is no key field… no live apply button anywhere
here, by design… a safe device-local signing flow is planned; until it ships, the terminal is the ceremony."

## The invariant this must NOT break
The browser must never hold, receive, or transmit the AUMLOK private key. The key stays on the machine,
0600, at ~/.aukora-symbiote/aumlok/authority-ed25519.key. A button in a web page that POSTs a passphrase
to sign server-side is acceptable ONLY because the server IS the local machine (loopback) and the signer
is the SAME scripts/aumlok-authority.sh ceremony — the button is a trigger for the local ceremony, not a
new signer. If there is ANY doubt the request could originate off-machine, it fails closed.

## Design (three layers, each fail-closed)
1. READ layer (safe, buildable first, no authority): a loopback-only, read-only `GET /api/aumlok` on the
   spatial door that returns the REAL pending proposals (from ~/.aukora-symbiote/aumlok/pending-proposals/,
   metadata only: goal, targetFiles, proposalHash, createdAt, the rehearsal receipt's verdict if present)
   plus AUMLOK status (locked/unlocked, key fingerprint — NEVER the key). aumlok.js swaps its mock
   loadAumlokState()/loadProposals() seam for this. This alone makes the page show TRUTH instead of mock,
   and is the honest first increment — it grants nothing.
2. DIFF layer: for a selected proposal, a read-only endpoint returns the unified diff (goal + per-file
   before/after) so Peter SEES exactly what he's signing, in the app, rendered — not a hash he trusts blind.
3. SIGN layer (the authority-adjacent part — owner-reviewed build): a button "Sign & apply" that:
   a. is present ONLY when the request origin is loopback AND capability mode is advisory (not lockdown);
   b. on press, requires a local confirmation gesture (OS-level or a typed challenge phrase shown on the
      page) — the physical "contact" moment;
   c. triggers the SAME scripts/aumlok-authority.sh sign ceremony server-side (loopback), producing the
      signed receipt, then the SAME dispatchSignedLiveApply — i.e. it automates the two commands Peter
      runs today, nothing more. The signature is still produced by his key on his machine.
   d. streams back the receipt (commitSha, rollback command) and flips the chip to "applied".
   Kill switches unchanged: lockdown mode disables the button; the key file's absence disables it; the
   expiring-authorization + single-use-nonce discipline is unchanged.

## Explicit non-goals
- No remote signing. No key in the browser. No "sign all" bulk button in v1 (one proposal, one press).
- Does not expand WHO can apply — still Peter's key alone. It relocates the gesture into the app.
- Not required for the swarm or auto-apply; it is the ergonomics of Peter's own hand.

## Why it matters beyond ergonomics (the safety argument)
A clunky sign path tempts shortcuts (piping, aliases, leaving a signed receipt lying in /tmp). A clean,
in-app, one-press, diff-visible ceremony makes the SECURE path the EASY path. Making contact deliberate,
visible, and physical is a safety feature, not just a nicety.
