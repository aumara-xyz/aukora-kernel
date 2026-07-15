// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the open-source decision docs must exist and stay clean — no secret-shaped values,
// no private paths, no false "already released/certified/licensed" claim; SECURITY.md keeps an
// owner-fill placeholder so no real contact was invented. Pure checker tested both ways.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { checkOssDoc, checkAllOssDocs, securityHasOwnerPlaceholder } from '../../scripts/ossDocsCheck';

const REPO = path.resolve(__dirname, '..', '..');
const DOCS = [
  { name: 'docs/OPEN_SOURCE_DECISION.md', path: 'docs/OPEN_SOURCE_DECISION.md' },
  { name: 'SECURITY.md', path: 'SECURITY.md' },
  { name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md' },
];

describe('the three governance docs exist and are hygienic', () => {
  const loaded = DOCS.map((d) => ({ name: d.name, text: fs.readFileSync(path.join(REPO, d.path), 'utf-8') }));

  it('all three exist', () => {
    for (const d of DOCS) expect(fs.existsSync(path.join(REPO, d.path))).toBe(true);
  });
  it('none leaks a secret, a private path, or a false release/certification claim', () => {
    const v = checkAllOssDocs(loaded);
    expect(v, JSON.stringify(v)).toEqual([]);
  });
  it('SECURITY.md keeps an owner-fill placeholder (no invented real contact)', () => {
    const sec = loaded.find((d) => d.name === 'SECURITY.md')!;
    expect(securityHasOwnerPlaceholder(sec.text)).toBe(true);
  });
  it('OPEN_SOURCE_DECISION.md states the project is NOT yet released', () => {
    const dec = loaded.find((d) => d.name === 'docs/OPEN_SOURCE_DECISION.md')!;
    expect(/NOT YET RELEASED/i.test(dec.text)).toBe(true);
  });
});

describe('checkOssDoc — the checker actually catches violations (negative fixtures)', () => {
  it('flags a secret-shaped hex value', () => {
    expect(checkOssDoc('x', 'token: ' + 'a'.repeat(48)).some((v) => v.category === 'secret-hex')).toBe(true);
  });
  it('flags a private node-home path', () => {
    expect(checkOssDoc('x', 'see ~/.aukora-symbiote/aumlok').some((v) => v.category === 'private-node-home')).toBe(true);
  });
  it('flags a false "is now open source" claim', () => {
    expect(checkOssDoc('x', 'This project is now open source and free.').some((v) => v.category === 'false-released')).toBe(true);
  });
  it('flags a real (non-placeholder) email but allows example.com', () => {
    expect(checkOssDoc('x', 'contact real.person@gmail.com').some((v) => v.category === 'invented-contact-email')).toBe(true);
    expect(checkOssDoc('x', 'contact security@example.com').some((v) => v.category === 'invented-contact-email')).toBe(false);
  });
  it('a clean doc yields no violations', () => {
    expect(checkOssDoc('x', 'A calm governance doc. Report privately. Not yet released.')).toEqual([]);
  });
});
