// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * D6 vendored-tree self-check (Round-22 blockers 1 + 2, runtime half; Round-24 R23 blocker 3).
 *
 * The parent pinned the full tracked-tree verification in d6/D6_TREE_VERIFICATION.json. R23 blocker 3 was that
 * verifyD6 bound only the per-file digests, so the pin file itself could be swapped to point at a DIFFERENT D6
 * commit/tree (with self-consistent hashes) and still pass. This version binds the provenance STRONGLY, in
 * code, so the pin file is now tamper-evident against constants that ship with the controller:
 *
 *   1. pinned commit, tree object, full-tracked-tree ls-sha256, and tracked-entry count must EXACTLY equal the
 *      in-code EXPECTED_* constants (a pin that names any other commit/tree/count is refused);
 *   2. the pin's vendored_evidence_sha256 map must be EXACTLY the expected map — same key set (exact-key
 *      closed, so neither an added nor a removed vendored file slips through) and same digests;
 *   3. every vendored file on disk must recompute to the EXPECTED digest (not merely to the pin's digest — so
 *      a matched-pair swap of {file, pin entry} still fails against the code constant).
 *
 * The immutable controller calls verifyD6 at the start of every generation and REFUSES to run when it fails.
 * (Root-owned immutability on deploy is enforced separately by deploy/seal.sh.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256Hex } from '../d6/evidence/index';

/** Pinned, in-code D6 provenance for aukora-fu commit 72173be9 (public). The pin FILE is checked against these. */
export const EXPECTED_D6_COMMIT = '72173be9e491fe6a0c41007a1e6209ebd230dffb';
export const EXPECTED_D6_TREE_OBJECT = 'd3f572aed5b9c0ade3858fee36aac928f796ad21';
export const EXPECTED_D6_FULL_TRACKED_TREE_LS_SHA256 =
  '8c37bc4937688e26246d18b5063f25aa7edc1e1ed8f5b574851a0d823ce31f92';
export const EXPECTED_D6_TRACKED_ENTRY_COUNT = 38;

/** The exact vendored evidence file set and its expected sha256 digests (frozen, exact-key closed). */
export const EXPECTED_VENDORED_EVIDENCE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'd6/evidence/canonical.ts': 'c48a7b9cbfcf338237602dd44cc3fd414221137f0863d1aabb6b1f03ad0febf6',
  'd6/evidence/catalogue.ts': '718f02edeeed1405c17182be8d1d5ddc9915b9fdfa5e513bf96d0bb57595f872',
  'd6/evidence/digest.ts': 'ffac6387355fe7189f5bef288e66c7a626784c2edf326647792a34866ca67869',
  'd6/evidence/framing.ts': 'ee4a9316fe43ff0e8ba01c87de7c9f4761423b14078e2586d3856634dbab7109',
  'd6/evidence/index.ts': '02ba4c6d89b4e9f44defb92f29d107ad48ff04cf8f172f926f9932c4491f0b39',
  'd6/evidence/types.ts': '006c8a8186325cdc85114f60078ad8f01e2e3ad8be028abcb3aa03dec223d0d1',
  'd6/evidence/validate.ts': 'b21f272440519d00881feb2555d3167297ae62abf4a6f3a94da1035f4f8ef617',
});

interface TreePin {
  readonly d6_commit?: unknown;
  readonly d6_tree_object?: unknown;
  readonly d6_full_tracked_tree_ls_sha256?: unknown;
  readonly d6_tracked_entry_count?: unknown;
  readonly vendored_evidence_sha256?: unknown;
}

/** Exact-key + exact-value equality of the pin map against the frozen expected map. */
function mapExactlyExpected(map: Record<string, unknown>): boolean {
  const expectedKeys = Object.keys(EXPECTED_VENDORED_EVIDENCE_SHA256);
  const gotKeys = Object.keys(map);
  if (gotKeys.length !== expectedKeys.length) return false; // exact-key closed: no extra, no missing
  for (const k of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) return false;
    if (map[k] !== EXPECTED_VENDORED_EVIDENCE_SHA256[k]) return false;
  }
  return true;
}

export function verifyD6(bundleRoot: string): boolean {
  try {
    const pinPath = path.join(bundleRoot, 'd6', 'D6_TREE_VERIFICATION.json');
    const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8')) as TreePin;

    // 1. Strong provenance binding — the pin file must name EXACTLY the expected commit/tree/ls/count.
    if (pin.d6_commit !== EXPECTED_D6_COMMIT) return false;
    if (pin.d6_tree_object !== EXPECTED_D6_TREE_OBJECT) return false;
    if (pin.d6_full_tracked_tree_ls_sha256 !== EXPECTED_D6_FULL_TRACKED_TREE_LS_SHA256) return false;
    if (pin.d6_tracked_entry_count !== EXPECTED_D6_TRACKED_ENTRY_COUNT) return false;

    // 2. The vendored map must be exactly the expected map (exact-key closed, exact digests).
    const map = pin.vendored_evidence_sha256;
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return false;
    if (!mapExactlyExpected(map as Record<string, unknown>)) return false;

    // 3. Every vendored file must recompute to the EXPECTED digest (bind to code, not merely to the pin).
    for (const rel of Object.keys(EXPECTED_VENDORED_EVIDENCE_SHA256)) {
      const filePath = path.join(bundleRoot, rel);
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(filePath);
      } catch {
        return false; // missing / unreadable vendored file ⇒ fail closed
      }
      const got = sha256Hex(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (got !== EXPECTED_VENDORED_EVIDENCE_SHA256[rel]) return false;
    }
    return true;
  } catch {
    return false;
  }
}
