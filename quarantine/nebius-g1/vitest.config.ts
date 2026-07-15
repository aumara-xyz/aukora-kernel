// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Bundle-local vitest config so the quarantined G1 bundle is testable IN-TREE without inheriting the Kernel
 * root's config (the bundle was standalone in Round-22). Scoped strictly to this directory's own tests.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    watch: false,
  },
});
