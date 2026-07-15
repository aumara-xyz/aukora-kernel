import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 24Z.34 — tracked-source control-character guard. 24Z.33 found a committed NUL byte in runtimeTruthManifest.ts
 * (invisible to grep, which silently treats the file as binary). This scan fails on any C0/DEL control char in
 * tracked source EXCEPT the legitimate whitespace tab (0x09), newline (0x0A), and carriage-return (0x0D).
 *
 * The regex is built from \u escapes (ASCII-safe source) and test fixtures use String.fromCharCode — so this test
 * file does NOT itself contain any control byte (it would otherwise flag itself).
 *
 * SCOPE (documented allowed-binary paths): this guard scans the edge-node package (`src`/`tests`), where the 24Z.33
 * corruption lived. ADVERSARIAL-PAYLOAD fixtures in OTHER packages legitimately embed control bytes as hostile test
 * INPUT and are intentionally out of scope — e.g. `internal/convex-brain/tests/vk-gauntlet.mjs` deliberately contains
 * a NUL + U+202E bidi override + XSS string to verify the sanitizer catches them. Those are test data, not corruption,
 * and must NOT be "cleaned." If this guard is ever extended package-wide, such fixtures need an explicit allowlist.
 */

// forbidden = C0 controls 0x00–0x1F and DEL 0x7F, minus tab(09)/LF(0A)/CR(0D).
const FORBIDDEN = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g'); // global: report ALL hits per line
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'tests'];
// 24Z.34 red-team (MEDIUM): include .js/.cjs/.mjs — tracked JS files (e.g. tests/fakeModel.js) were a NUL carrier the
// original {.ts,.tsx,.json,.md} set missed (same single-byte C0 class as the 24Z.33 committed NUL).
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.md']);
const NUL = String.fromCharCode(0);

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, out); }
    else if (SCAN_EXT.has(path.extname(e.name))) out.push(full);
  }
}

function controlCharHits(text: string): Array<{ line: number; code: number }> {
  const hits: Array<{ line: number; code: number }> = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(FORBIDDEN);   // global → every control char on the line, not just the first
    if (matches) for (const ch of matches) hits.push({ line: i + 1, code: ch.charCodeAt(0) });
  }
  return hits;
}

describe('24Z.34 tracked-source control-character guard', () => {
  it('no tracked source file contains a NUL or other forbidden control character', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) { const abs = path.join(ROOT, d); if (fs.existsSync(abs)) walk(abs, files); }
    expect(files.length, 'expected to scan some files').toBeGreaterThan(50);
    const violations: string[] = [];
    for (const f of files) {
      const hits = controlCharHits(fs.readFileSync(f, 'utf-8'));
      for (const h of hits) violations.push(`${path.relative(ROOT, f)}:${h.line} contains control char 0x${h.code.toString(16).padStart(2, '0')}`);
    }
    expect(violations, `forbidden control chars in tracked source:\n${violations.join('\n')}`).toEqual([]);
  });

  // TEST THE TEST: the scanner must catch a NUL + other forbidden controls, and must NOT flag tab/newline/CR.
  it('the scanner detects NUL + control chars but allows tab/newline/CR', () => {
    expect(controlCharHits(`clean line\nanother${String.fromCharCode(9)}with tab\r\nok`).length).toBe(0); // tab/LF/CR allowed
    expect(controlCharHits(`bad${NUL}nul`).length).toBe(1);                          // NUL caught (the 24Z.33 bug)
    expect(controlCharHits(`vertical${String.fromCharCode(0x0b)}tab`).length).toBe(1); // 0x0B caught
    expect(controlCharHits(`del${String.fromCharCode(0x7f)}char`).length).toBe(1);     // DEL caught
    expect(controlCharHits(`esc${String.fromCharCode(0x1b)}seq`).length).toBe(1);      // ESC caught
  });
});
