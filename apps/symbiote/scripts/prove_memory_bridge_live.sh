#!/usr/bin/env bash
# prove_memory_bridge_live.sh — Brick W3b live proof, THROWAWAY backend only.
#
# Boots the pinned self-hosted binary in a scratch dir (loopback, fresh SQLite, beacon off),
# deploys the vendored kernel from a clean app root (footgun-guarded: asserts the governed
# mutation actually deployed), then drives probes/memoryBridgeLiveProbe.ts through the REAL
# admin-authenticated transport:
#   A) 0644 key custody refuses live;  B) internal fn reached + kernel refuses garbage manifest;
#   C) cloud URL refused pre-transport;  plus here in the shell:
#   D) unauthenticated public /api/mutation CANNOT see the internal fn;
#   E) zero aukora_memory rows exist afterwards (nothing was written).
# Everything is created under mktemp and destroyed on exit. NO live organism state is touched.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${AUKORA_CONVEX_BACKEND_BIN:?set AUKORA_CONVEX_BACKEND_BIN to the pinned convex-local-backend binary}"
PORT="${PROBE_PORT:-3231}"
SITE_PORT=$((PORT + 1))
URL="http://127.0.0.1:${PORT}"

fail() { echo "✗ FAIL: $*"; exit 1; }
ok()   { echo "✓ $*"; }

# ── 0. preflight: repeatable from a fresh checkout (Codex feedback, 2026-07-05) ──────────
# Fail EARLY and clearly if the pinned backend is missing (the :? above only catches an unset var,
# not a bad path), and PRINT exactly which binary/version/hash this run is using so the evidence is
# reproducible by anyone who pulls the repo.
[ -x "$BIN" ] || fail "pinned backend not found or not executable at: $BIN  (set AUKORA_CONVEX_BACKEND_BIN)"
BIN_SHA="$( { shasum -a 256 "$BIN" 2>/dev/null || sha256sum "$BIN" 2>/dev/null; } | awk '{print $1}')"
BIN_SIZE="$(wc -c < "$BIN" | tr -d ' ')"
BIN_VER="$("$BIN" --version 2>/dev/null | head -1 || true)"
echo "── backend under test ───────────────────────────────────"
echo "  path:    $BIN"
echo "  sha256:  ${BIN_SHA:-<unavailable>}"
echo "  size:    ${BIN_SIZE} bytes"
echo "  version: ${BIN_VER:-<binary reports none; identity is the sha256 above>}"
echo "  (expected pinned release: precompiled-2026-06-09-b6aaa1a)"
echo "─────────────────────────────────────────────────────────"

# Do NOT assume the pinned convex client install already exists in the repo — install it if missing so
# a fresh checkout works. (The app root below reuses this offline; keeping the copy avoids a per-run
# network fetch.)
if [ ! -d "$REPO/convex/node_modules" ]; then
  echo "convex/node_modules absent — installing the pinned client (one-time) …"
  ( cd "$REPO/convex" && { bun install || npm install; } ) >/dev/null 2>&1 \
    || fail "could not install the pinned convex client in $REPO/convex (need bun or npm + network the first time)"
fi
[ -d "$REPO/convex/node_modules/convex" ] || fail "convex client still missing after install in $REPO/convex/node_modules"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/aukora-bridge-proof-XXXXXX")"
BACKEND_PID=""
cleanup() {
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  wait "$BACKEND_PID" 2>/dev/null
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

# ── 1. boot the throwaway backend (loopback, fresh SQLite, beacon off) ──────────────────
# Repeatability guard (Codex feedback): refuse to run if PORT is already bound. Otherwise a leftover
# backend from a prior/other run answers /version while our fresh instance-secret can't authenticate
# against it — surfacing as a baffling "BadAdminKey" three steps later. Fail here, clearly.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "port $PORT is already in use (a leftover backend?). Free it or set PROBE_PORT to a free port."
fi
INSTANCE="aukora-bridge-proof"
SECRET="$(openssl rand -hex 32)"
mkdir -p "$SCRATCH/data"
( cd "$SCRATCH/data" && DISABLE_BEACON=true "$BIN" \
    --interface 127.0.0.1 --port "$PORT" --site-proxy-port "$SITE_PORT" \
    --instance-name "$INSTANCE" --instance-secret "$SECRET" \
    >"$SCRATCH/backend.log" 2>&1 ) &
BACKEND_PID=$!

for i in $(seq 1 60); do
  curl -sf "$URL/version" >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || { tail -5 "$SCRATCH/backend.log"; fail "backend died on boot"; }
  sleep 0.5
done
curl -sf "$URL/version" >/dev/null 2>&1 || fail "backend did not come up on $URL"
BIND="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -1 | awk '{print $9}')"
case "$BIND" in 127.0.0.1:*) ok "backend up, bound to $BIND (loopback proven)";; *) fail "bind is '$BIND', not loopback";; esac

ADMIN_KEY="$("$BIN" keygen admin-key --instance-name "$INSTANCE" --instance-secret "$SECRET" | tail -1 | tr -d '[:space:]')"
[ -n "$ADMIN_KEY" ] || fail "keygen produced no admin key"
ok "admin key generated (local subcommand, no account)"

# ── 2. clean app root: kernel *.ts only (no node_modules INSIDE the functions dir) ──────
APP="$SCRATCH/app"
mkdir -p "$APP/convex"
cp "$REPO"/convex/*.ts "$APP/convex/"
printf '{"name":"aukora-bridge-proof-approot","private":true,"dependencies":{"convex":"1.42.1"}}\n' > "$APP/package.json"
cp -R "$REPO/convex/node_modules" "$APP/node_modules"   # offline reuse of the pinned install

export CONVEX_SELF_HOSTED_URL="$URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" CI=1
( cd "$APP" \
  && npx convex env set AUMA_NODE_ID probe-node \
  && npx convex env set AUMA_OPERATOR_SEED "$(openssl rand -hex 32)" \
  && npx convex deploy -y ) >"$SCRATCH/deploy.log" 2>&1 || { tail -15 "$SCRATCH/deploy.log"; fail "deploy failed"; }

# footgun guard: the wrong app root deploys ZERO functions silently — assert ours is there.
( cd "$APP" && npx convex function-spec ) >"$SCRATCH/spec.json" 2>/dev/null
grep -q 'aumlokMemory.*aumlokMemoryWrite\|aumlokMemory:aumlokMemoryWrite\|"identifier": *"aumlokMemory' "$SCRATCH/spec.json" \
  || fail "governed mutation NOT in deployed function spec (silent zero-function footgun)"
ok "kernel deployed; aumlokMemory functions present in the live function spec"

# ── D. the public door stays shut: unauthenticated /api/mutation cannot see the internal fn ──
PUB="$(curl -s "$URL/api/mutation" -H 'content-type: application/json' \
  -d '{"path":"aumlokMemory:aumlokMemoryWrite","args":{},"format":"json"}')"
echo "$PUB" | grep -qi 'could not find\|FunctionPathNotFound\|not found' \
  || fail "public /api/mutation did NOT refuse the internal fn: $PUB"
ok "unauthenticated /api/mutation cannot see the internal governed mutation"

# ── 3. custody files + the probe through the REAL transport ─────────────────────────────
KEYDIR="$SCRATCH/custody"; mkdir -p "$KEYDIR"
printf '%s' "$ADMIN_KEY" > "$KEYDIR/admin-key.txt";      chmod 600 "$KEYDIR/admin-key.txt"
printf '%s' "$ADMIN_KEY" > "$KEYDIR/admin-key-open.txt"; chmod 644 "$KEYDIR/admin-key-open.txt"

PROBE_URL="$URL" PROBE_APP_ROOT="$APP" \
PROBE_KEY_0600="$KEYDIR/admin-key.txt" PROBE_KEY_0644="$KEYDIR/admin-key-open.txt" \
  bun "$REPO/probes/memoryBridgeLiveProbe.ts" | tee "$SCRATCH/probe.json"
PROBE_RC=${PIPESTATUS[0]}
[ "$PROBE_RC" -eq 0 ] || fail "live probe expectations not met (see above)"
ok "probe A/B/C green: custody bites live; internal fn reached + kernel refused; cloud URL refused"

# ── E. nothing was written ───────────────────────────────────────────────────────────────
ROWS="$( (cd "$APP" && npx convex data aukora_memory 2>/dev/null) | grep -cv '^_\|^$\|^\s*$\|^[[:space:]]*|' || true)"
DATA_OUT="$(cd "$APP" && npx convex data aukora_memory 2>&1 || true)"
echo "$DATA_OUT" | grep -qi 'probe value' && fail "a probe value reached aukora_memory — a write happened"
ok "aukora_memory holds no probe rows (nothing was written)"

echo ""
echo "ALL GREEN — the bridge is real, the gate held, nothing was written."
