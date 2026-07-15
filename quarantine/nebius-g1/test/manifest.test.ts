// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** R23 blocker 8: the sealed manifest must cover every material input AND cover itself. */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { verifyManifest, materialFiles } from '../src/manifest';

const BUNDLE_ROOT = path.resolve(__dirname, '..');

describe('R23#8 self-covering manifest', () => {
  it('the on-disk MANIFEST.json is complete, untampered, and self-covering', () => {
    const r = verifyManifest(BUNDLE_ROOT);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('covers the previously-omitted material inputs (package-lock.json + audit doc)', () => {
    const mats = materialFiles(BUNDLE_ROOT);
    expect(mats).toContain('package-lock.json');
    expect(mats).toContain('G1_READY_FOR_CODEX_AUDIT.md');
  });
});
