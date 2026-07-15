# Design note — #105b: device-local sign ceremony (the NEXT brick, authority-adjacent)

Status: DESIGN NOTE ONLY. The #105 READ LAYER shipped (the AUMLOK page shows real pending proposals, their
diffs, and copyable terminal commands — zero authority). This note scopes the sign HALF, which is
authority-adjacent and must NOT be built without its own owner sitting + fresh adversarial skeptics. Per
Codex: stop after the read layer unless Peter explicitly says to proceed to signing.

## The invariant that cannot move
The private key never enters the browser. Signing is a LOCAL ceremony on the owner's machine, triggered
(not performed) by the UI. The browser holds no key, receives no key, and transmits no key. If there is any
doubt a request could originate off-machine, it fails closed.

## Shape to ratify (not build yet)
1. **A challenge phrase bound to the proposal hash.** When the owner asks to sign proposal H in the UI, the
   local door mints a one-time challenge phrase deterministically bound to H (e.g. derived from H + a
   per-request nonce). The phrase MAY be English or the AUMA language (Auma's own tongue) — a human-readable
   confirmation the owner reads and re-enters, so the physical act is deliberate and legible, not a blind
   click. The phrase proves the owner is at the machine and consenting to THIS exact proposal.
2. **One proposal · one signature · one receipt.** No bulk "sign all", no standing unlock, no session that
   signs future proposals. Each signature covers exactly one proposal hash and produces exactly one receipt.
3. **The signature is produced by the SAME local ceremony** the terminal uses today
   (`scripts/aumlok-authority.sh sign`) — the button is a trigger for that local, loopback ceremony, never a
   reimplementation. `dispatchSignedLiveApply` still re-verifies the signature against the recomputed
   proposal hash before any write, exactly as today. The button changes the GESTURE, not the trust root.
4. **Kill switches unchanged and instant:** lockdown mode disables the button; the key file's absence
   disables it; the challenge-phrase mismatch refuses; loopback-origin-only.

## Explicit non-goals
- No blanket unlock, ever. No "remember me". No remote signing. No key in the browser or on the wire.
- Does not change WHO can apply — still the owner's key alone. It relocates the gesture into the app.

## The adversarial pass this brick will need (before it lands)
- Can any request to trigger signing originate off-machine (origin/loopback binding)?
- Can the challenge-phrase binding be bypassed or replayed for a different proposal hash?
- Is the key ever readable from the browser context / the endpoint response / logs?
- Does a lockdown or a revoked key correctly fail the button closed?

## Why the read layer was the right place to stop this round
The read layer gives the owner the SEEING half — real proposals, real diffs, the exact commands — with zero
authority. The signing half adds a real (if carefully bounded) authority gesture and deserves its own
ratification, not momentum. The read layer is complete and useful on its own: Peter can review everything
waiting for his key without a terminal, and still signs in the terminal until 105b is ratified and built.
