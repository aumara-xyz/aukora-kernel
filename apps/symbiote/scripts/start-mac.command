#!/usr/bin/env bash
# Double-click this in Finder to start your Aukora node (macOS).
# First time: right-click → Open (macOS blocks double-clicking downloaded scripts until you allow it once).
cd "$(dirname "$0")/.." || exit 1
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun isn't installed yet."
  echo "Install it once by pasting this in a terminal:"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo "Then restart your terminal and double-click this again."
  read -n1 -r -p "Press any key to close..."
  exit 1
fi
exec bun run start
