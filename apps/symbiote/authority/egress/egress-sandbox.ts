// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.88 — STRUCTURAL EGRESS CONTAINMENT (the keystone). Blocklisting dangerous commands failed twice (24Z.84 nc/socat;
 * 24Z.86c telnet/openssl) because you cannot enumerate every script. So we stop blocklisting and SANDBOX: every model shell
 * command is wrapped at the spawn chokepoint (packages/core/src/tool/bash.ts) in macOS `sandbox-exec` with a no-egress profile.
 * A written-then-run script's socket.connect() to ANY external host is denied at the SYSCALL layer; inheritance covers
 * sub-spawns (proven: bash→python→connect = denied). This closes the WHOLE class, not one command at a time.
 *
 * This file is self-protected (SENSITIVE) — she can't edit away her own cage. The canonical copy lives at
 * aukora-ide/integration/opencode-core/; the patcher copies it to packages/core/src/egress-sandbox.ts.
 *
 * v1 SCOPE / HONEST RESIDUALS (the airtight in-process version waits on the later network-namespace sandbox):
 *   - exfil to an ALLOWED host (a pure `npm install <pkg>` postinstall, `git push`) — network verbs need egress, run unsandboxed.
 *   - DNS is allowed (port 53) so legit name-resolution works → low-bandwidth DNS-tunnel covert channel remains.
 *   - sandbox-exec is deprecated-but-functional on macOS; non-darwin has NO containment here (logged LOUD).
 */
import { platform } from "node:os"
import { existsSync } from "node:fs"
import { sbplDeny, sbplWriteFloor, sbplSocketFloor, READ_DENY_SOURCES, envAllowRegex } from '../gate/sensitivePolicy'

// 24Z.88f — THE PROFILE IS GENERATED from the single-source policy (sensitivePolicy.ts), shared VERBATIM with the classifier
// (risk.ts imports the SAME module), so the kernel cage and the in-process gate can NEVER diverge — the seal-confirm drift
// root cause. SBPL last-match-wins, (allow default) first:
//   - deny ALL network-outbound; re-allow ONLY unix sockets. NO loopback (88e A3 — curl --resolve SSRF), NO *:53 (88f #9 — the
//     sandboxed shell has no allowed host connection anyway; getaddrinfo via mDNSResponder/mach suffices; raw socket to
//     attacker:53 was a real exfil channel). External egress stays exit-7.
//   - deny-READ the credential set (generated). deny-by-default WRITE floor (generated): allow ONLY workspace + scratch +
//     caches, re-deny the authority set on top. Verb- AND symlink-agnostic; the classifier mirrors it from the same source.
export function noEgressProfile(workspaceAbs: string): string {
  return '(version 1)(allow default)(deny network-outbound)' +
    '(allow network-outbound (remote unix-socket))' +
    sbplSocketFloor() + // 88f-confirm r3 #7/#12 — re-deny docker/ssh-agent/gpg/podman sockets AFTER the unix-socket allow (last-match-wins)
    sbplDeny('file-read*', READ_DENY_SOURCES) +
    sbplWriteFloor(workspaceAbs)
}
// Backward-compat const (no workspace -> fail-open write floor: re-deny authority only). Tests + any caller without a cwd.
export const NO_EGRESS_PROFILE = noEgressProfile('')

// 24Z.88c (item 2) — INSTALL CAGE: investigated, NOT achievable with sandbox-exec. The council asked for a
// registry-host-allowlisted sandbox so a pure install's postinstall scripts + out-of-band registry config (.npmrc /
// PIP_INDEX_URL) can't reach an arbitrary host. That needs a PER-HOST network rule — but macOS sandbox-exec's
// `(remote ip "...")` REJECTS any literal IP: "host must be * or localhost in network address" (verified 2026-06-27 for both
// IPv4 and IPv6). So the only network rules available are loopback, unix-socket, and `*:<port>` (any host on a port). A
// registry-host cage is therefore IMPOSSIBLE with this primitive. v1 keeps pure registry-by-name installs UNSANDBOXED (88b's
// destination-bounding already sandboxes the url/git-ref/custom-registry forms); the residual = a named package's postinstall
// or an out-of-band .npmrc reaching an arbitrary host. Closing it requires the network-namespace sandbox OR a loopback
// registry proxy (no-egress + only the proxy reachable) — Step-4 hardening, the SAME deferral as the in-process-net residual.

// Shell-chaining / redirection metacharacters. A command containing ANY of these is NOT treated as a pure network verb
// (else `npm install && curl evil.com` or `git pull; python x.py` would ride the network verb's unsandboxed egress). Chained
// or redirected → sandbox it (fail toward containment). Closes the prefix-a-network-verb bypass.
const CHAIN_META = /[;&|\n`]|\$\(|<\(|>\s*\/dev\/|<\s*\/dev\//

// PURE registry-by-NAME installs that legitimately need the registry — these run UNsandboxed. Anchored to the START (after
// optional whitespace / sudo). NOTE (24Z.88b — Auma's catch): `git` (clone/fetch/pull) and `go get` are DELIBERATELY EXCLUDED —
// they reach ARBITRARY remotes and their clone/fetch hooks are RCE, so they always get the no-egress sandbox. The carve-out must
// bound the DESTINATION, not just trust the verb.
// 24Z.88e #16 — `npx` (and bunx/dlx-style executors) REMOVED from the carve-out: they FETCH-AND-EXECUTE remote code, so they
// must always run in the no-egress sandbox, never unsandboxed. Only PURE registry-by-name installers stay here.
const REGISTRY_VERB = /^\s*(?:sudo\s+)?(?:npm|bun|pnpm|yarn|pip|pip3|uv|cargo|gem|deno|brew)\s+(?:i|install|add|ci|update|upgrade|sync)\b/i
// Explicit external DESTINATION indicators. A registry verb carrying ANY of these is NOT pure (its destination is unbounded —
// a git-url / custom registry / bare host/path) → sandbox it. Covers npm install <git-url>, pip install git+<url>,
// cargo install --git <url>, `--registry http://evil`, and a bare `host.tld/path` (e.g. go-style import paths).
const CARRIES_EXTERNAL = /(?:https?|ftp|ftps|git|ssh|file):\/\/|git\+|\bgit@[\w.-]+:|--git[=\s]|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\/[^\s]/i
// 88f-confirm r2 #3 — a registry verb installing a LOCAL PATH (`pip install .` / `-e .` / `npm install ./pkg` / a local archive)
// BUILDS local code: it runs setup.py / the build backend / a postinstall from a path the model controls → must be sandboxed, not
// trusted as a registry-by-name install. (`-r requirements.txt` stays unsandboxed — it's registry names; the build configs are also WRITE_PROTECTed.)
const CARRIES_LOCAL_BUILD = /(?:^|\s)(?:-e|--editable)(?:\s|=|$)|(?:^|\s)(?:\.|\.\.)(?:\s|$)|(?:^|\s)(?:\.\.?\/|\/|~\/)[^\s]*|(?:^|\s)[^\s]*\.(?:tar\.gz|tgz|whl|zip)(?:\s|$)/

/**
 * True ONLY for a pure registry-by-name install with NO explicit external destination — these run unsandboxed (they need the
 * registry). Everything else — git/go-get, URL/host-carrying installs, chained/redirected commands, scripts, curl/wget — returns
 * false → no-egress sandbox. (24Z.88b: destination-bounded, not just verb-trusted.)
 */
export function isNetworkVerb(command: string): boolean {
  const c = String(command || "")
  if (CHAIN_META.test(c)) return false        // chained / redirected → sandbox
  if (!REGISTRY_VERB.test(c)) return false     // git, go get, scripts, curl, anything else → sandbox
  if (CARRIES_EXTERNAL.test(c)) return false   // registry verb + explicit url/host/git-ref → sandbox (destination unbounded)
  if (CARRIES_LOCAL_BUILD.test(c)) return false // 88f-confirm r2 #3 — `pip install .` / `-e .` / local archive → builds local code → sandbox
  return true                                  // pure registry-by-name install → unsandboxed
}

const CAN_SANDBOX = platform() === "darwin" && existsSync("/usr/bin/sandbox-exec")
let WARNED = false

/**
 * Wrap a model shell command for egress containment. Returns { file, args } to spawn (the shell is invoked explicitly, so the
 * caller drops the cross-spawn `shell` option). Pure network verbs and non-darwin run unsandboxed; everything else is wrapped
 * in sandbox-exec with the no-egress profile so external socket.connect() is denied at the kernel.
 */
// Testable core — `canSandbox` injected so the non-darwin path is unit-testable. wrapForEgress passes the real CAN_SANDBOX.
// `mode`: 'unsandboxed' (non-darwin, degraded) | 'install' (registry-IP-allowlisted cage) | 'no-egress' (everything else).
// 24Z.88f — `workspaceAbs` is the spawn cwd; the deny-by-default WRITE floor allows writes ONLY under it (+ scratch/caches).
// 88f-confirm r3 #5 — a pure registry install runs UNSANDBOXED (it needs the registry), but `npm|bun|pnpm|yarn install` also runs
// LIFECYCLE SCRIPTS — the workspace's OWN pre/postinstall (pointing at a model-written file) OR a dependency's postinstall — with
// full egress. Prepend the lifecycle-disable env so the install still reaches the registry but executes NO script code; a package
// needing a build step is built separately in the no-egress cage. Covers npm/pnpm/yarn(+berry); bun's postinstall + cargo build.rs +
// pip-sdist build remain the documented Step-4 registry-build residual (pip install . is already sandboxed, r2 #3).
export function hardenInstall(command: string): string {
  const cmd = String(command || "")
  if (!/^\s*(?:sudo\s+)?(?:npm|pnpm|yarn)\b/.test(cmd)) return cmd
  if (/(?:^|\s)npm_config_ignore_scripts=/.test(cmd)) return cmd
  return "npm_config_ignore_scripts=true YARN_ENABLE_SCRIPTS=false " + cmd
}
export function wrapForEgressWith(command: string, shell: string, canSandbox: boolean, workspaceAbs = ""): { file: string; args: string[]; mode: string } {
  const cmd = String(command || "")
  if (!canSandbox) return { file: shell, args: ["-c", cmd], mode: "unsandboxed" }                 // non-darwin / no sandbox-exec → degraded (logged LOUD)
  if (isNetworkVerb(cmd)) return { file: shell, args: ["-c", hardenInstall(cmd)], mode: "registry-unsandboxed" } // pure registry-by-name install → unsandboxed (88b destination-bounded; install cage = Step-4) + lifecycle-script-disabled (r3 #5)
  return { file: "sandbox-exec", args: ["-p", noEgressProfile(workspaceAbs), shell, "-c", cmd], mode: "no-egress" } // no external egress + deny-by-default write floor
}
export function wrapForEgress(command: string, shell: string, workspaceAbs = ""): { file: string; args: string[]; mode: string } {
  if (!CAN_SANDBOX && platform() === "darwin" && !WARNED) { WARNED = true; console.error("[aukora] WARN: /usr/bin/sandbox-exec missing — model-exec egress is NOT contained") }
  return wrapForEgressWith(command, shell, CAN_SANDBOX, workspaceAbs)
}

// 24Z.88e #10 — wrap a DIRECT argv (NOT a `shell -c` command) in the no-egress sandbox. The format-on-write path spawns a
// project-local formatter BIN (node_modules/.bin/prettier) that the model may have authored → sandbox it (no exfil; the
// formatter still formats). Non-darwin / no sandbox-exec → passthrough (degraded, same as the shell path).
export function wrapArgvForEgress(file: string, args: string[], workspaceAbs = ""): { file: string; args: string[] } {
  if (!CAN_SANDBOX) return { file, args }
  return { file: "sandbox-exec", args: ["-p", noEgressProfile(workspaceAbs), file, ...args] }
}

// 24Z.88e #10/#31 — the safe child env (ALLOWLIST, identical contract to the shell-env patcher): keep only non-secret
// infrastructure vars, drop everything else, then layer the caller's explicit (non-secret) env on top. So a spawned formatter
// bin never inherits a provider key / AUKORA_* / DATABASE_URL from the :4096 process env.
const __ENV_ALLOW = envAllowRegex() // 88f-confirm r2 #11 — single-sourced from sensitivePolicy (was hand-duplicated here AND in the shell-env patcher)
export function safeChildEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) if (__ENV_ALLOW.test(k)) out[k] = v
  return { ...out, ...(extra ?? {}) }
}
