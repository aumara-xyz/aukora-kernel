#!/usr/bin/env bash
# scan-secrets.sh — the leak gate (thin entrypoint). Delegates to verify-public-readiness.sh,
# which hard-fails (TIER 1) on genuine secrets/PII/slugs/patent-IP/personal-paths and reports
# (TIER 2) the pre-public-release research-lane scrub worklist.
exec "$(dirname "${BASH_SOURCE[0]}")/verify-public-readiness.sh"
