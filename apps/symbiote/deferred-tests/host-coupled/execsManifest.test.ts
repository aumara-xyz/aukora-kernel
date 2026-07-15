import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { parseExecManifest, verifyStamp, classifySpawn, allowlistSurface, manifestHash, denyAllPosture, type ExecManifest } from "../src/execsManifest"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const baseEntry = { label: "node", sha256: HASH_A, envAllowlist: ["PATH", "HOME"], cwdPolicy: "workspace" }
const goodRaw = JSON.stringify({ version: "t1", entries: [baseEntry] })

describe("Chokepoint Phase 1 — trusted-execs manifest infra (loader/validator/classifier/read-mirror)", () => {
  it("parses a valid manifest and hashes its CONTENT stably (key-order independent)", () => {
    const a = parseExecManifest(goodRaw)
    expect(a.ok).toBe(true)
    if (a.ok) {
      // a re-ordered-but-equivalent manifest hashes the SAME (canonicalized)
      const reordered: ExecManifest = { version: "t1", entries: [{ cwdPolicy: "workspace", envAllowlist: ["HOME", "PATH"], sha256: HASH_A, label: "node" } as never] }
      expect(manifestHash(reordered)).toBe(a.manifestHash)
    }
  })

  it("FAIL-CLOSED on every malformation → deny_all (never a partial allow)", () => {
    const bad = [
      "not json{",
      JSON.stringify({ entries: [] }), // missing version
      JSON.stringify({ version: "x", entries: {} }), // entries not array
      JSON.stringify({ version: "x", entries: [{ label: "p", envAllowlist: [], cwdPolicy: "workspace" }] }), // no pin
      JSON.stringify({ version: "x", entries: [{ label: "p", sha256: "nothex", envAllowlist: [], cwdPolicy: "workspace" }] }), // bad hash
      JSON.stringify({ version: "x", entries: [{ label: "p", sha256: HASH_A, envAllowlist: "no", cwdPolicy: "workspace" }] }), // env not array
      JSON.stringify({ version: "x", entries: [{ label: "p", sha256: HASH_A, envAllowlist: [], cwdPolicy: "workspace", allowedArgvPattern: "(" }] }), // bad regex
    ]
    for (const raw of bad) {
      const load = parseExecManifest(raw)
      expect(load.ok).toBe(false)
      if (!load.ok) expect(load.posture).toBe("deny_all")
    }
  })

  it("verifyStamp — correct stamp loads; tampered/missing → deny_all (tamper-evidence)", () => {
    const { createHash } = require("crypto")
    const stamp = createHash("sha256").update(goodRaw).digest("hex")
    expect(verifyStamp(goodRaw, stamp).ok).toBe(true)
    expect(verifyStamp(goodRaw + " ", stamp).ok).toBe(false) // one byte changed → mismatch
    expect(verifyStamp(goodRaw, null).ok).toBe(false)
    expect(verifyStamp(goodRaw, "short").ok).toBe(false)
  })

  it("classifySpawn — pinned → allow, unknown → PAUSE (not deny), invalid manifest → DENY (fail-closed)", () => {
    const load = parseExecManifest(goodRaw)
    expect(classifySpawn(load, { sha256: HASH_A, argv: ["node", "x.js"], env: { PATH: "/usr/bin" }, cwd: "/w" }).decision).toBe("allow")
    expect(classifySpawn(load, { sha256: HASH_B, argv: ["evil"], env: {}, cwd: "/w" }).decision).toBe("pause") // unknown → pause for AUMLOK
    expect(classifySpawn(parseExecManifest("broken{"), { sha256: HASH_A, argv: [], env: {}, cwd: "/w" }).decision).toBe("deny")
  })

  it("classifySpawn — confused-deputy guards: argv pattern, env allowlist, abs cwd policy all DENY a pinned binary", () => {
    const argvPinned = parseExecManifest(JSON.stringify({ version: "x", entries: [{ label: "node", sha256: HASH_A, envAllowlist: ["PATH"], cwdPolicy: "workspace", allowedArgvPattern: "^node " }] }))
    expect(classifySpawn(argvPinned, { sha256: HASH_A, argv: ["bash", "-c", "rm"], env: { PATH: "/" }, cwd: "/w" }).decision).toBe("deny") // argv violates
    expect(classifySpawn(argvPinned, { sha256: HASH_A, argv: ["node", "x"], env: { PATH: "/", SECRET: "k" }, cwd: "/w" }).decision).toBe("deny") // env leak
    const cwdPinned = parseExecManifest(JSON.stringify({ version: "x", entries: [{ label: "node", sha256: HASH_A, envAllowlist: ["PATH"], cwdPolicy: "/only/here" }] }))
    expect(classifySpawn(cwdPinned, { sha256: HASH_A, argv: ["node"], env: { PATH: "/" }, cwd: "/elsewhere" }).decision).toBe("deny") // cwd violates
    expect(classifySpawn(cwdPinned, { sha256: HASH_A, argv: ["node"], env: { PATH: "/" }, cwd: "/only/here" }).decision).toBe("allow")
  })

  it("allowlistSurface (self.allowlist read-mirror) — lists pins + a tamper-evident version", () => {
    const load = parseExecManifest(goodRaw)
    const surface = allowlistSurface(load)
    expect("pinned" in surface && surface.pinned.map((p) => p.label)).toEqual(["node"])
    if ("version" in surface && load.ok) expect(surface.version).toBe(load.manifestHash)
    // tamper-evidence: a changed manifest yields a different version
    const mutated = parseExecManifest(JSON.stringify({ version: "t1", entries: [{ ...baseEntry, sha256: HASH_B }] }))
    if (mutated.ok && load.ok) expect(mutated.manifestHash).not.toBe(load.manifestHash)
    expect(allowlistSurface(parseExecManifest("x{"))).toEqual({ posture: "deny_all", reason: expect.stringContaining("parse error") })
  })

  it("denyAllPosture is a hard deny", () => {
    expect(denyAllPosture("no manifest")).toEqual({ decision: "deny", reason: "fail-closed: no manifest" })
  })

  it("INTEGRATION (Auma #2) — the REAL pinned+stamped+locked manifest is exactly what self.allowlist reports", () => {
    const dir = path.resolve(__dirname, "../../../aukora-ide/chokepoint")
    const raw = fs.readFileSync(path.join(dir, "trusted-execs.json"), "utf8")
    const stamp = fs.readFileSync(path.join(dir, "trusted-execs.sha256"), "utf8").trim()
    const load = verifyStamp(raw, stamp) // the stamp on disk must verify the manifest on disk
    expect(load.ok).toBe(true)
    const surface = allowlistSurface(load)
    if ("pinned" in surface) {
      expect(surface.pinned.map((p) => p.label).sort()).toEqual(["bun", "git", "node"])
      expect(surface.version).toMatch(/^[0-9a-f]{64}$/) // the mirror reports the manifest's own content hash
      expect(surface.pinned.every((p) => /^[0-9a-f]{64}$/.test(p.sha256 ?? ""))).toBe(true) // real hashes, never key material
    }
  })
})
