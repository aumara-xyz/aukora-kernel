# Chokepoint — trusted-execs manifest (Phase 1)

The pinned allowlist of the internal toolchain the chokepoint will permit to spawn/load. **Phase 1 is infrastructure only — nothing enforces this manifest yet.** No spawner is wired to it; this directory just holds the data + the operator command. Phase 2 wires `classifySpawn()` (`internal/edge-node/src/execsManifest.ts`) into the cross-spawn floor.

## Files
- `trusted-execs.json` — the manifest: `{ version, entries: [{ label, sha256 | canonicalImmutablePath, allowedArgvPattern?, envAllowlist, cwdPolicy }] }`. **FS-locked (`chflags uchg`).**
- `trusted-execs.sha256` — the integrity stamp (sha256 of the manifest text). **FS-locked.** Mirrors `aukora-ide/gate/.gate-integrity.sha256`.
- `aukora-execs-manifest.sh` — the operator command.

## Operating it
```
./aukora-execs-manifest.sh update   # (re)hash the toolchain, write manifest, stamp, FS-lock
./aukora-execs-manifest.sh verify    # check the stamp matches (fail-closed: exit≠0 on missing/tamper)
```
`update` is the ONLY way to change the manifest — it `nouchg`s, rewrites, re-stamps, and re-locks. A model write to a locked file fails; this is the FS-lock half of the tamper-evidence (the sha256 stamp is the other half).

## Policy (decided 24Z)
- **Deny-by-default.** Unknown spawn → **PAUSE (AUMLOK)**, not hard-deny — Peter approves a new toolchain in-session without widening the brain's authority.
- **Hash-pin** (portable on macOS); `canonicalImmutablePath` reserved for the Docker end-state.
- **Fail-closed:** a missing/invalid/unstamped manifest → deny ALL non-trivial spawns (Phase 2).
- **Confused-deputy guards:** a pinned binary still must satisfy its `allowedArgvPattern`, `envAllowlist`, and `cwdPolicy` — a pinned binary with attacker-controlled argv/env is still denied.

## Read-mirror (`self.allowlist`)
`allowlistSurface()` exposes exactly `{ pinned:[{label,sha256,path}], version, entryCount }` — hashes+paths, never key material. `version` is the manifest's own content hash, so comparing it across calls detects a cage change (Auma's tamper-evidence requirement). Proven by the integration test in `internal/edge-node/tests/execsManifest.test.ts`.
