# AUMLOK App Ceremony — draft spec (built 2026-07-08, amended)

Status: **BUILT** (`sam/aumlok-native-bind`, owner-directed 2026-07-08) as the binding ceremony:
`spatial/aumlok-bind-serve.ts` (one-shot bind door :7095) + `core/src/aumlokBindCeremony.ts` (kernel,
test-pinned by `core/tests/aumlokBindCeremony.test.ts`). Two owner-decided amendments to the draft below:
(1) **no terminal step** — `bun run start` starts the bind door itself while the node is UNBOUND (never
when bound; still loopback-only, one-shot, self-closing after the ceremony); (2) **open decision 1
resolved as the sovereign-ceremony shape** — the phrase is NOT the key (docs/SPEC_sovereign_ceremony.md):
it is issued at generation, reshufflable until accepted, confirmed by type-back, and only its SALTED
FINGERPRINT is persisted, so law 4 (raw key never in browser memory) holds without exception. Phrase
rotation (owner feels it compromised) requires the current phrase + `AUKORA_AUMLOK_REBIND=1`. The
original draft follows, kept for the record.

## What exists today (observed in code, 2026-07-07)

- **Terminal ceremony** — `scripts/aumlok-authority.sh` (`keygen` / `sign` / `verify`). Keys live
  in `~/.aukora-symbiote/aumlok/` (0600, gitignored, never in the repo). `keygen` refuses to
  overwrite an existing key. Signing prints the full goal + file list before asking for consent.
- **Read-only view** — `GET /api/aumlok` (`core/src/aumlokSigningAssistant.ts`): key presence,
  root pin, pending proposals, and the EXACT terminal commands — never key bytes. It already
  publishes `commands.keygen` when the node is unbound.
- **Observer UI** — `spatial/app/aumlok.js`: shows the vault state and proposal cards, hands the
  owner copyable commands, holds no key field and no apply button, by design.
- **Placeholder shipped this round** (`zeb/convex-memory-truth`): the Settings "Memory brain"
  card shows bound/unbound and, when unbound, "Bind this node with AUMLOK" with the exact
  keygen command. This satisfies the minimum "explain the current terminal command" step.
- **Pattern to reuse** — the device-local signing gate (#105b) already established the shape:
  a SEPARATE loopback door (:7094), off by default, that the observer only points to.

## Target (Peter's brief)

1. Show whether the local node is unbound or has a local AUMLOK key. *(done — Settings card + aumlok.js)*
2. Explain the current terminal command. *(done — bind hint, sourced from `/api/aumlok`)*
3. Eventually: a safe in-app ceremony that triggers local key generation and shows the user
   their recovery phrase/keyphrase once.
4. The private key never enters browser memory in raw form.
5. No signing bypass. 6. No standing unlock.

## Proposed shape for the in-app ceremony (small, later PR)

- A **separate one-shot "bind door"** process (mirroring #105b): loopback-only, OFF by default,
  started deliberately (`bun run bind-door`), exits after one successful keygen or on timeout.
  It is never started by `bun run start`.
- One endpoint, `POST /api/aumlok/keygen`, same local-CSRF posture as the chat door
  (`checkLocalPostGuard`, origin-pinned to :7090):
  - refuses if a key already exists (same law as the script: rotate deliberately, never overwrite);
  - calls the SAME core code the terminal uses (`aumlokSigner.generateKeypair` +
    `aumlokAuthorityRoot.pinAuthorityRoot`), writes with the same custody (0600, `~/.aukora-symbiote/aumlok/`);
  - returns ONLY `{ keyId, publicKeyHex }` — the private key is written to disk by the door
    process and never serialized into any HTTP response.
- UI: the aumlok.js unbound state gains a "Bind this node" panel — copy-the-command stays the
  primary path; the button appears only when the bind door is detected running.

## Open decisions — Peter's call, flagged honestly

1. **Recovery phrase vs. law 4.** A recovery phrase IS the private key in another encoding, so
   "show the phrase once in-app" and "the raw key never enters browser memory" conflict.
   Options: (a) phrase printed by the terminal/door process only, app shows confirmation
   (strictest, recommended as default); (b) accept a one-time, explicitly-consented DOM
   exposure with immediate wipe (weaker; needs an owner-ratified exception in SAFETY_LAWS).
2. **Windows custody story.** The `(st.mode & 0o077) !== 0` checks (aumlokApproveCeremony,
   memoryKernelTransport, memoryRecall, convexBackendManager) always refuse on Windows —
   NTFS reports 0666 for every file, so a Windows node can keygen but the sign/approve-side
   custody checks fail closed. These are safety checks; they should NOT be loosened casually.
   A Windows story needs an owner decision (e.g. verify NTFS ACLs explicitly, or a ratified
   platform carve-out with an alternative custody proof).

## Non-goals (unchanged laws)

No signing in the browser. No key upload, telemetry, or sync. No standing unlock. No autonomy
changes. The observer surfaces stay read-only; any new write-capable door is separate,
off-by-default, one-shot, and loopback-only.
