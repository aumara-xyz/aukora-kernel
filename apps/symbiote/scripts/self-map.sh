#!/usr/bin/env bash
# self-map.sh — the organism's view of its own body. Lists organs + live file counts (no ghosts:
# only what exists on disk is reported). This is the seed's first act of self-knowledge.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
echo "── aukora-symbiote self-map ─────────────────────────────"
for d in core/src core/tests authority/gate authority/aumlok authority/chokepoint \
         memory memory/runtime memory/embedder receiver fusion identity \
         scripts docs; do
  if [ -d "$d" ]; then
    n=$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
    printf "  %-38s %3s files\n" "$d/" "$n"
  fi
done
echo "─────────────────────────────────────────────────────────"
printf "  kernel src .ts:  %s\n" "$(ls core/src/*.ts 2>/dev/null | wc -l | tr -d ' ')"
printf "  kernel test .ts: %s\n" "$(ls core/tests/*.ts 2>/dev/null | wc -l | tr -d ' ')"
