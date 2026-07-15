#!/usr/bin/env bash
# BUBBLE-0 cleanup — owner-approved (Sam, in-chat, 2026-07-08; #178 round-5 brief:
# "bucket cleanup on the owner's say-so in your chat (only your two staging dirs)").
# Removes ONLY the two directories this lane created during rounds 3-4 staging:
#   /mnt/out/models/     (partial revision-pinned artifact copies)
#   /mnt/out/hf-cache/   (partial HF cache copy from stage3)
# Everything else in the bucket is untouched. Listings before/after for the record.
set -euxo pipefail
echo "--- bucket root BEFORE ---"; ls -la /mnt/out/
du -sh /mnt/out/models /mnt/out/hf-cache 2>/dev/null || true
rm -rf /mnt/out/models /mnt/out/hf-cache
echo "--- bucket root AFTER ---"; ls -la /mnt/out/
echo "BUBBLE0_CLEANUP_DONE"
