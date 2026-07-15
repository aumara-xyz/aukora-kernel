#!/usr/bin/env bash
# aukora-execs-manifest.sh — Chokepoint Phase 1 operator command for the trusted-execs manifest.
#
# Mirrors the gate-integrity model: the manifest is sha256-STAMPED + FS-LOCKED (chflags uchg), and re-stamped ONLY by a
# deliberate operator running `update`. Phase 1 is INFRASTRUCTURE ONLY — nothing enforces this manifest yet (no spawner
# is wired to it). Phase 2 wires `classifySpawn()` (internal/edge-node/src/execsManifest.ts) into the cross-spawn floor.
#
#   ./aukora-execs-manifest.sh update   # (re)hash the toolchain, write manifest, stamp, FS-lock
#   ./aukora-execs-manifest.sh verify    # check the stamp matches (fail-closed on missing/tamper)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/trusted-execs.json"
STAMP="$HERE/trusted-execs.sha256"

sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# The internal toolchain we pin (present on this machine). Phase 2 adds the bundled LSP/formatter/snapshot-git binaries.
TOOLCHAIN=(node git bun)

cmd_update() {
  [ -e "$MANIFEST" ] && chflags nouchg "$MANIFEST" 2>/dev/null || true
  [ -e "$STAMP" ] && chflags nouchg "$STAMP" 2>/dev/null || true

  local entries="" first=1 tool path h
  for tool in "${TOOLCHAIN[@]}"; do
    path="$(command -v "$tool" 2>/dev/null || true)"
    [ -z "$path" ] && { echo "skip: $tool not found on PATH" >&2; continue; }
    h="$(sha "$path")"
    [ $first -eq 0 ] && entries+=","
    first=0
    entries+="
    { \"label\": \"$tool\", \"sha256\": \"$h\", \"envAllowlist\": [\"PATH\",\"HOME\",\"TMPDIR\",\"LANG\",\"LC_ALL\"], \"cwdPolicy\": \"workspace\" }"
  done

  cat > "$MANIFEST" <<JSON
{
  "version": "phase1-$(date +%Y%m%d)",
  "entries": [${entries}
  ]
}
JSON

  sha "$MANIFEST" > "$STAMP"
  chflags uchg "$MANIFEST" "$STAMP"
  echo "updated + stamped + FS-locked: $MANIFEST"
  echo "stamp: $(cat "$STAMP")"
}

cmd_verify() {
  [ -e "$MANIFEST" ] || { echo "FAIL-CLOSED: manifest missing" >&2; exit 2; }
  [ -e "$STAMP" ] || { echo "FAIL-CLOSED: stamp missing" >&2; exit 2; }
  local actual expected
  actual="$(sha "$MANIFEST")"
  expected="$(cat "$STAMP")"
  if [ "$actual" = "$expected" ]; then
    echo "OK: stamp matches ($actual)"
  else
    echo "TAMPER: manifest $actual != stamp $expected" >&2
    exit 3
  fi
}

case "${1:-verify}" in
  update) cmd_update ;;
  verify) cmd_verify ;;
  *) echo "usage: $0 {update|verify}" >&2; exit 1 ;;
esac
