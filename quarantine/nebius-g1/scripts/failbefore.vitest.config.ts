// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** Config that runs ONLY the fail-before repro (outside the normal test/ include). */
import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: {
    include: ['scripts/failbefore.repro.test.ts'],
    environment: 'node',
    watch: false,
  },
});
