// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * D6 vendored-tree self-check (Round-22 blockers 1 + 2, runtime half).
 *
 * The parent pinned the full tracked-tree verification in d6/D6_TREE_VERIFICATION.json, including the sha256
 * of every vendored d6/evidence/*.ts file. verifyD6 READS that pin and recomputes the sha256 of each vendored
 * file with the D6 sha256 primitive; if ANY file's digest no longer matches (tamper, truncation, swap, or a
 * missing file) it returns false. The immutable controller calls this at the start of every generation and
 * REFUSES to run when it fails. (Root-owned immutability on deploy is enforced separately by deploy/seal.sh.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256Hex } from '../d6/evidence/index';

interface TreePin {
  readonly vendored_evidence_sha256: Record<string, string>;
}

export function verifyD6(bundleRoot: string): boolean {
  try {
    const pinPath = path.join(bundleRoot, 'd6', 'D6_TREE_VERIFICATION.json');
    const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8')) as TreePin;
    const map = pin.vendored_evidence_sha256;
    if (map === null || typeof map !== 'object') return false;
    const entries = Object.keys(map);
    if (entries.length === 0) return false;
    for (const rel of entries) {
      const filePath = path.join(bundleRoot, rel);
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(filePath);
      } catch {
        return false; // missing / unreadable vendored file ⇒ fail closed
      }
      const got = sha256Hex(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (got !== map[rel]) return false;
    }
    return true;
  } catch {
    return false;
  }
}
