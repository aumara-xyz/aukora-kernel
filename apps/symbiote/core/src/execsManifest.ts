/**
 * Chokepoint — Phase 1: the trusted-execs MANIFEST infrastructure (loader / validator / classifier / read-mirror).
 *
 * ZERO behavior change: nothing in this module is wired into any spawner yet. Phase 2 imports `classifySpawn()` into
 * the cross-spawn floor (`packages/core/src/cross-spawn-spawner.ts`) + `util/process.ts`. Here we build only the data
 * model, a FAIL-CLOSED loader, the pure classifier, and the `self.allowlist` read-mirror surface (Auma's req: the
 * manifest we pin must be the manifest `self` reports — first tamper-evidence check).
 *
 * Mirrors the gate-integrity model (sha256-stamped + FS-lockable; re-stamped only by a deliberate operator command).
 * Decided policy (24Z): an unknown spawn → PAUSE (AUMLOK), not hard-deny, so Peter can approve a new toolchain in
 * session without widening the brain's authority. Hash-pin (portable on macOS), canonical-immutable-path reserved for
 * the Docker end-state.
 */
import { createHash } from "crypto"

/** "workspace" = must run within the project root (Phase 2 resolves it) · "any" · or a pinned absolute path. */
export type CwdPolicy = "workspace" | "any" | string

export interface ExecManifestEntry {
  label: string
  sha256?: string // content-hash pin (preferred)
  canonicalImmutablePath?: string // OR a canonical abs path on a non-model-writable mount (Docker end-state)
  allowedArgvPattern?: string // optional regex the joined argv must match — confused-deputy guard
  envAllowlist: string[] // env var NAMES the spawn may carry; everything else is stripped (values never in manifest)
  cwdPolicy: CwdPolicy
}

export interface ExecManifest {
  version: string // human label; real integrity is the stamp hash, not this
  entries: ExecManifestEntry[]
}

export type SpawnDecision = "allow" | "pause" | "deny"
export interface SpawnVerdict {
  decision: SpawnDecision
  reason: string
  matchedLabel?: string
}

/** A spawn candidate as the chokepoint floor would see it (Phase 2 supplies the resolved hash/argv/env/cwd). */
export interface SpawnCandidate {
  sha256?: string
  path?: string
  argv: string[]
  env: Record<string, string>
  cwd: string
}

export type ManifestLoad =
  | { ok: true; manifest: ExecManifest; manifestHash: string }
  | { ok: false; posture: "deny_all"; reason: string }

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

/** Canonical (key-order-independent) hash of the manifest CONTENT — what `self.allowlist.version` reports. */
export function manifestHash(manifest: ExecManifest): string {
  const canon = {
    version: manifest.version,
    entries: [...manifest.entries]
      .map((e) => ({
        label: e.label,
        sha256: e.sha256 ?? null,
        canonicalImmutablePath: e.canonicalImmutablePath ?? null,
        allowedArgvPattern: e.allowedArgvPattern ?? null,
        envAllowlist: [...e.envAllowlist].sort(),
        cwdPolicy: e.cwdPolicy,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
  return sha256(JSON.stringify(canon))
}

function validateEntry(e: unknown, i: number): string | null {
  if (!e || typeof e !== "object") return `entry[${i}] not an object`
  const x = e as Record<string, unknown>
  if (typeof x.label !== "string" || !x.label) return `entry[${i}] missing label`
  if (!x.sha256 && !x.canonicalImmutablePath) return `entry[${i}] (${x.label}) has neither sha256 nor canonicalImmutablePath — a pin is required`
  if (x.sha256 !== undefined && (typeof x.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.sha256))) return `entry[${i}] (${x.label}) sha256 malformed`
  if (!Array.isArray(x.envAllowlist) || x.envAllowlist.some((v) => typeof v !== "string")) return `entry[${i}] (${x.label}) envAllowlist must be string[]`
  if (typeof x.cwdPolicy !== "string" || !x.cwdPolicy) return `entry[${i}] (${x.label}) cwdPolicy required`
  if (x.allowedArgvPattern !== undefined) {
    if (typeof x.allowedArgvPattern !== "string") return `entry[${i}] (${x.label}) allowedArgvPattern must be a string`
    try {
      new RegExp(x.allowedArgvPattern)
    } catch {
      return `entry[${i}] (${x.label}) allowedArgvPattern is not a valid regex`
    }
  }
  return null
}

/** Parse + validate a manifest from raw text. FAIL-CLOSED: ANY problem → deny_all (never a partial allow). */
export function parseExecManifest(raw: string): ManifestLoad {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { ok: false, posture: "deny_all", reason: `manifest parse error: ${(e as Error).message}` }
  }
  if (!json || typeof json !== "object") return { ok: false, posture: "deny_all", reason: "manifest not an object" }
  const j = json as Record<string, unknown>
  if (typeof j.version !== "string") return { ok: false, posture: "deny_all", reason: "manifest missing version" }
  if (!Array.isArray(j.entries)) return { ok: false, posture: "deny_all", reason: "manifest entries not an array" }
  for (let i = 0; i < j.entries.length; i++) {
    const err = validateEntry(j.entries[i], i)
    if (err) return { ok: false, posture: "deny_all", reason: `manifest invalid: ${err}` }
  }
  const manifest: ExecManifest = { version: j.version, entries: j.entries as ExecManifestEntry[] }
  return { ok: true, manifest, manifestHash: manifestHash(manifest) }
}

/** Verify manifest text against its sha256 stamp (tamper-evidence, mirrors .gate-integrity.sha256). FAIL-CLOSED. */
export function verifyStamp(raw: string, expectedStampHex: string | null): ManifestLoad {
  if (!expectedStampHex || !/^[0-9a-f]{64}$/.test(expectedStampHex)) return { ok: false, posture: "deny_all", reason: "missing/invalid manifest stamp" }
  if (sha256(raw) !== expectedStampHex) return { ok: false, posture: "deny_all", reason: "manifest stamp mismatch (tamper)" }
  return parseExecManifest(raw)
}

/** Fail-closed default for any chokepoint sink that cannot load a valid manifest. */
export function denyAllPosture(reason: string): SpawnVerdict {
  return { decision: "deny", reason: `fail-closed: ${reason}` }
}

/**
 * THE CLASSIFIER (pure; Phase 2 wires it into the spawner). Deny-by-default. Pinned (hash or canonical path) → allow,
 * AFTER the confused-deputy guards (argv pattern, env allowlist, cwd policy). Unknown → PAUSE (AUMLOK approval).
 * An invalid/missing manifest → DENY everything (fail-closed).
 */
export function classifySpawn(load: ManifestLoad, c: SpawnCandidate): SpawnVerdict {
  if (!load.ok) return { decision: "deny", reason: `fail-closed: ${load.reason}` }
  const entry = load.manifest.entries.find(
    (e) => (c.sha256 && e.sha256 === c.sha256) || (c.path && e.canonicalImmutablePath && e.canonicalImmutablePath === c.path),
  )
  if (!entry) return { decision: "pause", reason: "unknown spawn — not in trusted-execs manifest (pause for AUMLOK approval)" }
  if (entry.allowedArgvPattern && !new RegExp(entry.allowedArgvPattern).test(c.argv.join(" ")))
    return { decision: "deny", reason: `argv violates policy for ${entry.label}`, matchedLabel: entry.label }
  const leakedEnv = Object.keys(c.env).filter((k) => !entry.envAllowlist.includes(k))
  if (leakedEnv.length) return { decision: "deny", reason: `env not in allowlist for ${entry.label}: ${leakedEnv.slice(0, 5).join(",")}`, matchedLabel: entry.label }
  if (entry.cwdPolicy.startsWith("/") && c.cwd !== entry.cwdPolicy)
    return { decision: "deny", reason: `cwd violates policy for ${entry.label}`, matchedLabel: entry.label }
  // "workspace" / "any" cwd are resolved/accepted at Phase 2 (the pure classifier doesn't know the workspace root)
  return { decision: "allow", reason: `pinned: ${entry.label}`, matchedLabel: entry.label }
}

/** THE READ-MIRROR — exactly the `self.allowlist` surface: hashes + paths + a tamper-evident version. Never key material. */
export interface AllowlistSurface {
  pinned: { label: string; sha256?: string; path?: string }[]
  version: string // = manifestHash; comparing across calls detects a cage change
  entryCount: number
}
export function allowlistSurface(load: ManifestLoad): AllowlistSurface | { posture: "deny_all"; reason: string } {
  if (!load.ok) return { posture: "deny_all", reason: load.reason }
  return {
    pinned: load.manifest.entries.map((e) => ({ label: e.label, sha256: e.sha256, path: e.canonicalImmutablePath })),
    version: load.manifestHash,
    entryCount: load.manifest.entries.length,
  }
}
