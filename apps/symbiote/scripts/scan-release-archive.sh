#!/usr/bin/env bash
# Scan the CONTENTS of a release archive, not the current working tree.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/scan-release-archive.sh <archive.tar|archive.tar.gz|archive.tgz|archive.zip>" >&2
  exit 2
fi

ARCHIVE="$1"
if [ ! -f "$ARCHIVE" ]; then
  echo "archive not found: $ARCHIVE" >&2
  exit 2
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aukora-release-scan.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

case "$ARCHIVE" in
  *.tar.gz|*.tgz) tar -xzf "$ARCHIVE" -C "$TMP" ;;
  *.tar) tar -xf "$ARCHIVE" -C "$TMP" ;;
  *.zip)
    if ! command -v unzip >/dev/null 2>&1; then
      echo "unzip is required to scan zip archives" >&2
      exit 2
    fi
    unzip -q "$ARCHIVE" -d "$TMP"
    ;;
  *)
    echo "unsupported archive type: $ARCHIVE" >&2
    exit 2
    ;;
esac

SCAN_ROOT="$TMP"
TOP_COUNT="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' ')"
TOP_ONE="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d -print | sed -n '1p')"
if [ "$TOP_COUNT" = "1" ] && [ -n "$TOP_ONE" ] && [ -f "$TOP_ONE/scripts/verify-public-readiness.sh" ]; then
  SCAN_ROOT="$TOP_ONE"
fi

if [ ! -f "$SCAN_ROOT/scripts/verify-public-readiness.sh" ]; then
  echo "archive does not contain scripts/verify-public-readiness.sh at its root (or single top-level directory)" >&2
  exit 2
fi

(cd "$SCAN_ROOT" && AUKORA_PUBLIC_READINESS_ALLOW_FIND=1 bash scripts/verify-public-readiness.sh)
