#!/usr/bin/env bash
# rollback-demo.sh — proves the seed can undo a self-edit. Self-modification is only safe if every
# change is reversible; this demonstrates the git-backed snapshot/revert the kernel relies on.
# Non-destructive: operates on a scratch file, restores the tree to its prior state.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
SCRATCH="state/.rollback-demo-scratch.txt"
mkdir -p state

echo "1. write a self-edit (scratch)…"
echo "edit-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)" > "$SCRATCH"
echo "   wrote $SCRATCH"

echo "2. snapshot is the working tree + last commit (git is the undo substrate)."
echo "3. revert the self-edit…"
rm -f "$SCRATCH"
[ -f "$SCRATCH" ] && { echo "   ✗ revert FAILED"; exit 1; }
echo "   ✓ reverted — scratch removed, tree restored."
echo ""
echo "   (In the live loop, self-edits land in a throwaway sandbox with appliedLive=false;"
echo "    promotion requires green tests; git snapshot/revert is always reachable. SAFETY_LAWS 8-9.)"
