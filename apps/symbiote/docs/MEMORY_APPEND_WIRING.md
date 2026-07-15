# memoryAppend live wiring — the smallest missing bridge (Brick W3b)

Status: transport LANDED + live-proven on a throwaway backend, 2026-07-05 (Fable).
NO live capture, NO migration, NO organism callers. This doc is the wiring contract
Codex asked for: where the invoke lives, where the key lives, how custody is checked,
how failures surface — plus the recorded live proof and the named remaining work.

## 1. The wiring-gap verification (exact, from disk)

The OLD adapter (`core/src/kernelAdapter.ts`) is NOT the bridge and must not be mistaken
for it. Verified gaps, by line, at commit `353b342`:

| gap | where | fact |
|---|---|---|
| donor cwd | `kernelAdapter.ts:20` | `NODE_TEMPLATE_DIR = resolve(__dirname, '../../../node-template')` — runs the CLI from the aukora-os donor tree, not this repo |
| retired key path | `kernelAdapter.ts:21` | `~/aukora-convex-backend/admin-key.txt` — the OLD backend's key (the one whose 0644 mode and 0.0.0.0 bind are the plan's documented failure modes) |
| silent null | `kernelAdapter.ts:62,72` | missing key → `return null`; ANY error → `return null` — the exact "fails silently" hole the plan's review flagged |
| unvendored target | `kernelAdapter.ts:77` | calls `aukoraDevReceipt:mintHostApplyReceipt`, a function S1a deliberately did not vendor — on the new backend this path can never succeed |
| donor registry entry | `convexTopology.ts:93` | the `:3220` donor-lab backend is still in the fail-closed registry; `:3210` (`:109`) still describes the retired instance |

`kernelAdapter.ts` stays untouched this round (it serves the old host-apply receipt lane);
its retirement/repoint rides the deploy-lifecycle brick below.

## 2. The new transport (landed)

`core/src/memoryKernelTransport.ts` — the admin-authenticated invoke behind
`memoryAppend`'s injected `invoke` dependency.

- **Where the invoke lives:** `createGovernedInvoke(cfg)` spawns the pinned `convex` CLI
  (`npx convex run`, argv list, no shell) with `CONVEX_SELF_HOSTED_URL` +
  `CONVEX_SELF_HOSTED_ADMIN_KEY` + `CI=1` — the S1a-proven mechanism, from an EXPLICIT
  app root (`transport_app_root_required`; the wrong root silently targets zero functions,
  see convex/README.md).
- **Where the key lives:** `~/.aukora-symbiote/convex/admin-key.txt`
  (`ADMIN_KEY_PATH`). AUMLOK-tier custody, NOT AUMLOK-colocated. Never in the repo, never
  in env files, never logged.
- **How custody is checked (every call, at use time):** `readAdminKeyStrict` —
  must exist (`admin_key_missing`), be a regular file (`admin_key_not_regular_file`),
  not a symlink (`admin_key_symlink_refused`), carry **zero group/other permission bits**
  (`admin_key_permissions_open` — 0600/0400 only, enforced not advised), be non-empty
  (`admin_key_empty`), single-line (`admin_key_malformed`).
- **How failures surface:** typed `MemoryKernelTransportError` THROWS — loud, once, no
  retry, no fallback write anywhere. `memoryAppend` maps every throw to a refused
  `advisoryOnly:true / grantsAuthority:false` envelope carrying the kernel's reason.
  Error messages are scrubbed against the loaded key (`[admin-key redacted]`).
- **Scope guards:** loopback-only URL (same `isLoopbackUrl` as the read door); the ONLY
  invocable function path is `aumlokMemory:aumlokMemoryWrite` (defense in depth with
  memoryAppend's own pin).

Hermetic tests: `core/tests/memoryKernelTransport.test.ts` (16) — every custody violation,
every guard, key-scrubbing, one-attempt, and the composed memoryAppend+transport refusal
envelopes.

## 3. Live proof (recorded run, 2026-07-05)

`bash scripts/prove_memory_bridge_live.sh` with `AUKORA_CONVEX_BACKEND_BIN` pointing at the
pinned S0 binary (`precompiled-2026-06-09-b6aaa1a`). Throwaway `mktemp` dir, destroyed on
exit; the live organism untouched. Results, all green:

1. Backend bound `127.0.0.1:3231` (lsof-verified — the loopback flag is mandatory and proven,
   not assumed). Admin key minted by the local `keygen admin-key` subcommand, no account.
2. Kernel deployed from a clean app root; `npx convex function-spec` CONFIRMS the governed
   mutation is live (the silent-zero-functions footgun is guarded, not hoped away).
3. **Public door shut:** unauthenticated `POST /api/mutation` on
   `aumlokMemory:aumlokMemoryWrite` → "could not find" — internal functions are invisible
   without the admin credential.
4. **Custody bites live:** a 0644 copy of the real key → refused
   `admin_key_permissions_open` before any spawn.
5. **The bridge is real and the gate held:** through the 0600 key + real CLI transport, the
   INTERNAL mutation executed and refused the garbage manifest —
   `aumlok_mft_version_unsupported` at `consumeManifestUseCore` (aumlokManifests.ts:322),
   surfaced verbatim inside a refused no-authority envelope. Reaching the refusal proves
   admin transport works; the refusal itself proves authority is still manifest-gated.
6. **Nothing written:** `aukora_memory` holds zero probe rows afterwards.

## 4. Remaining work, named (NOT smuggled into this brick)

- **Deploy lifecycle under `scripts/`** (real backend home `state/convex/`, pm2
  `spatial-brain`, permanent app root, export/backup cadence) — the D3 fresh-instance
  ceremony; owner-visible, its own brick.
- **`isSecretOrEnvBasename` hardening** (add `admin-key.txt` / `instance-secret` basenames)
  lives inside byte-pinned `core/src/nativeLiveApply.ts:169` → gate-integrity re-pin in the
  same commit → queued for Codex/owner ratification, deliberately not touched unilaterally.
- **convexTopology registry** repoint (retire `:3220` donor entry, re-describe `:3210`) +
  `kernelAdapter.ts` retirement — ride the deploy-lifecycle brick.
- **Ring promotions to ratify:** `core/src/memoryAppend.ts`, `core/src/memoryKernelTransport.ts`
  (write-boundary clients), plus the earlier-flagged `aukoraToken`/`aumlokManifests`/`popResolver`.
- **First REAL write** requires a provisioned owner root + delegation manifest + subject PoP
  (the B2 ceremony) — that is M2/M4-adjacent work and stays behind content-binding per the
  standing order: delete button before ledger.
