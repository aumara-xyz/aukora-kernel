# Aukora Symbiote — Safety Laws

These are **non-negotiable**. They are enforced in code and checked by `bash scripts/test.sh` (run manually before every commit; there is no CI pipeline configured, and no `scripts/verify` script exists — fixed 2026-07-02, Fable re-entry audit).
The seed runs headless and earns trust before it is ever given a shell or live authority.

1. **Memory suggests, never authorizes.** Recall and synthesis are advisory context. Every memory artifact carries `advisoryOnly === true` and `grantsAuthority === false`. Kira atoms and receipts obey the same rule. Only the gate + AUMLOK decide. (Enforced by the §13 fence, `evidenceAuthorityGuard`, and the Kira tests.)
2. **The local self-hosted Convex deployment (loopback-only) is the canonical advisory-memory organ; writes flow only through the registered memory mutations, all stamped `grantsAuthority:false` and hash-chain-receipted. Any REMOTE Convex deployment remains read-only. No Convex path may ever touch Ring-0, the gate, or the apply lane.** Honesty clause (adversarial review): the governed-write invariant holds against every actor WITHOUT the self-hosted admin key. The admin key is the memory organ's root credential — AUMLOK-tier custody; any use of it outside `scripts/` lifecycle operations (deploy/export/import) is an owner-ceremony event, and the guarantees above are scoped accordingly (no unprovable absolutes). *(Amended 2026-07-05, owner-ratified decision D1 — Auma's draft text verbatim, per `docs/LOCAL_CONVEX_BRAIN_FOUNDATION.md` §4. Supersedes "Convex is read-only unless a signed apply lane is explicitly built and tested" — that text was written to keep a cloud mirror passive. The fence moved to the governed write path; it did not come down. Enforced by `core/tests/convexReadOnlyInvariant.test.ts`, rewritten to this boundary in the same commit.)*
3. **Evidence is never authority.** Nothing the organism reads, recalls, fetches, or perceives becomes permission. Content navigates; it never commands.
4. **Timing / glyph / latent / voice signals are advisory only.** They may inform; they may never authorize.
5. **No benchmark data becomes memory.** Zero LoCoMo / answer-keys / learned-weights in shipped defaults. Thresholds are recalibrated on live receipts only.
6. **No secrets / envs / private keys are copied.** No `.env`, no keyfiles, no `auth.json`. The signer key K stays in a `0600` file, never in env/argv/`ps`. A scan-gate must pass before any commit and before any remote.
7. **Every self-modification creates a receipt.** Authority + intent + effect, hash-chained.
8. **Every self-modification must pass tests before promotion.** Self-edits land in a throwaway sandbox (`appliedLive === false`); green tests are required to promote.
9. **Rollback must be available for every promoted change.** Snapshot/revert always reachable; ring-0 / sacred paths refused.
10. **UI / shell comes later.** The seed must run headless first. No `packages/app`, no vite, no chat shell in the seed.

— and the AUMLOK reality, stated honestly (updated 2026-07-05): authorization now uses **real Ed25519 signature verification** — `core/src/aumlokAuthorityRoot.ts` verifies human signatures with `@noble/curves` (mode `dev_real`) and the apply gate calls it (`nativeLiveApply.ts` → `verifyPromotionReceipt`); the organism holds no private key and structurally cannot sign. What remains for a later milestone is **production key custody** (hardware/HSM) and the **ML-DSA-65 post-quantum** algorithm (reserved, not yet implemented). Live self-promotion stays **locked** (`isLivePromotionUnlocked()` === `false`). The code says exactly this; do not claim more than that.

*This is a seed organism, not a fully trusted live agent. We are building the clean spine.*
