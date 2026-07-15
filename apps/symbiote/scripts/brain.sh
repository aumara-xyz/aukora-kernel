#!/usr/bin/env bash
# brain.sh — the LOCAL Convex brain as a boring, inspectable managed service (Brick W3c).
#
#   scripts/brain.sh provision   # generate instance-secret + admin key into the custody dir (once)
#   scripts/brain.sh start       # preflight, then boot the backend loopback-only in the background
#   scripts/brain.sh status      # binary identity + health + custody + row/version
#   scripts/brain.sh stop        # stop the managed backend
#
# All DECISIONS (paths, argv, preflight, custody) come from core/src/convexBackendManager.ts via
# scripts/brainCli.ts — this script only spawns/kills/inspects. Loopback only. Keys live at
# ${AUKORA_CONVEX_KEY_DIR:-~/.aukora-symbiote/convex} at mode 0600 and NEVER enter git/logs/env-files.
# Env overrides (for a container/Nebius twin or a throwaway proof): AUKORA_CONVEX_BACKEND_BIN (required),
# AUKORA_CONVEX_PORT, AUKORA_CONVEX_STATE_DIR, AUKORA_CONVEX_KEY_DIR, AUKORA_CONVEX_INSTANCE_NAME.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
export AUKORA_REPO_ROOT="$REPO"

BIN="${AUKORA_CONVEX_BACKEND_BIN:-}"
PORT="${AUKORA_CONVEX_PORT:-3210}"
KEY_DIR="${AUKORA_CONVEX_KEY_DIR:-$HOME/.aukora-symbiote/convex}"
STATE_DIR="${AUKORA_CONVEX_STATE_DIR:-$REPO/state/convex}"
INSTANCE_NAME="${AUKORA_CONVEX_INSTANCE_NAME:-aukora-brain}"
URL="http://127.0.0.1:${PORT}"
PIDFILE="$STATE_DIR/.brain.pid"
LOGFILE="$STATE_DIR/brain.log"
ADMIN_KEY="$KEY_DIR/admin-key.txt"
INSTANCE_SECRET="$KEY_DIR/instance-secret.txt"

fail() { echo "✗ $*" >&2; exit 1; }
ok()   { echo "✓ $*"; }
cli()  { bun "$REPO/scripts/brainCli.ts" "$@"; }

need_bin() { [ -n "$BIN" ] || fail "set AUKORA_CONVEX_BACKEND_BIN to the pinned convex-local-backend binary"; [ -x "$BIN" ] || fail "backend binary not executable at: $BIN"; }
# Trust the pidfile only if that pid is actually OUR backend (guards PID-reuse: refusing boot for, or
# killing, an unrelated process that inherited the number).
pid_is_backend() { [ -n "${1:-}" ] && ps -p "$1" -o command= 2>/dev/null | grep -q 'convex-local-backend'; }
# 127.0.0.1 and [::1] are both loopback; anything else is a real exposure.
is_loopback_bind() { case "$1" in 127.0.0.1:*|"[::1]:"*) return 0;; *) return 1;; esac; }

case "${1:-}" in
  provision)
    need_bin
    mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
    if [ -f "$INSTANCE_SECRET" ]; then ok "instance secret already present ($INSTANCE_SECRET) — not overwriting"; else
      ( umask 177; openssl rand -hex 32 > "$INSTANCE_SECRET" ); chmod 600 "$INSTANCE_SECRET"; ok "instance secret written (0600)"; fi
    SEC="$(tr -d '[:space:]' < "$INSTANCE_SECRET")"
    if [ -f "$ADMIN_KEY" ]; then ok "admin key already present ($ADMIN_KEY) — not overwriting"; else
      KEY="$("$BIN" keygen admin-key --instance-name "$INSTANCE_NAME" --instance-secret "$SEC" | tail -1 | tr -d '[:space:]')"
      [ -n "$KEY" ] || fail "keygen produced no admin key"
      ( umask 177; printf '%s' "$KEY" > "$ADMIN_KEY" ); chmod 600 "$ADMIN_KEY"; ok "admin key written (0600)"; fi
    echo "custody dir: $KEY_DIR (keys are 0600, outside the repo, never committed)"
    ;;

  start)
    need_bin
    [ -f "$INSTANCE_SECRET" ] && [ -f "$ADMIN_KEY" ] || fail "not provisioned — run: scripts/brain.sh provision"
    if [ -f "$PIDFILE" ]; then P="$(cat "$PIDFILE")"; if pid_is_backend "$P"; then ok "brain already running (pid $P)"; exit 0; else rm -f "$PIDFILE"; fi; fi
    echo "── preflight ──"; cli preflight || fail "preflight refused (see problems above)"
    mkdir -p "$STATE_DIR"
    # bash 3.2 (macOS default) has no `mapfile` — read the one-arg-per-line output portably.
    ARGV=(); while IFS= read -r _line; do ARGV+=("$_line"); done < <(cli argv) || true
    [ "${#ARGV[@]}" -gt 0 ] || fail "could not build boot argv (is the instance secret provisioned?)"
    ID_SHA="$(cli identity | grep -o '"sha256": *"[0-9a-f]*"' | grep -o '[0-9a-f]\{64\}')"
    echo "starting backend  bin=$BIN  sha256=${ID_SHA:-?}  url=$URL  data=$STATE_DIR"
    # Fully detach the daemon's stdio (stdin /dev/null, stdout+stderr to the log) so it never holds
    # this script's inherited pipe open — otherwise a caller reading our stdout blocks forever.
    ( cd "$STATE_DIR" && exec env DISABLE_BEACON=true "$BIN" "${ARGV[@]}" ) </dev/null >"$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    disown 2>/dev/null || true
    for i in $(seq 1 60); do curl -sf "$URL/version" >/dev/null 2>&1 && break; kill -0 "$(cat "$PIDFILE")" 2>/dev/null || { tail -5 "$LOGFILE"; fail "backend died on boot"; }; sleep 0.5; done
    curl -sf "$URL/version" >/dev/null 2>&1 || fail "backend did not answer on $URL"
    # Enforce loopback on EVERY listener the backend opened (api + site-proxy), not just the first.
    NONLOOP=""
    for b in $(lsof -nP -iTCP:"$PORT" -iTCP:"$((PORT+1))" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}'); do
      is_loopback_bind "$b" || NONLOOP="$NONLOOP $b"
    done
    if [ -n "$NONLOOP" ]; then
      # the guard that exists to catch a non-conforming binary must actually ACT — kill + clean, not just warn.
      kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"
      fail "backend bound NON-loopback ($NONLOOP) — killed and refused (loopback is law)"
    fi
    ok "brain up (pid $(cat "$PIDFILE")), all listeners loopback — proven"
    ;;

  status)
    echo "── binary ──"; [ -n "$BIN" ] && cli identity || echo "  (AUKORA_CONVEX_BACKEND_BIN unset)"
    echo "── custody ──"
    for f in "$INSTANCE_SECRET" "$ADMIN_KEY"; do
      if [ -f "$f" ]; then M="$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f" 2>/dev/null)"; echo "  $f  mode=$M"; else echo "  $f  MISSING"; fi
    done
    echo "── process/health ──"
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "  pid $(cat "$PIDFILE") alive"; else echo "  no managed pid"; fi
    if curl -sf "$URL/version" >/dev/null 2>&1; then
      BIND="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -1 | awk '{print $9}')"
      ok "healthy at $URL (bound $BIND)"
    else echo "  not answering at $URL"; fi
    ;;

  stop)
    if [ -f "$PIDFILE" ]; then
      P="$(cat "$PIDFILE")"
      if pid_is_backend "$P"; then kill "$P" 2>/dev/null && ok "stopped pid $P" || echo "  pid $P would not die"; else echo "  pid $P is not our backend (PID reused?) — not killing"; fi
      rm -f "$PIDFILE"
    else echo "  no pidfile"; fi
    ;;

  *) echo "usage: scripts/brain.sh <provision|start|status|stop>"; exit 2;;
esac
