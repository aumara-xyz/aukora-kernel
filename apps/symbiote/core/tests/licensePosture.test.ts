// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the AGPL-3.0-or-later posture is reconciled and stays that way — the root LICENSE is
// real AGPLv3, package.json declares the SPDX id, and source headers agree. Plus the dependency-license
// classifier is correct both ways.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  isAgplLicenseText, packageDeclaresChosenLicense, headerSpdxIdentifier, evaluateLicensePosture,
  classifyDependencyLicense, CHOSEN_SPDX,
} from '../../scripts/licensePosture';

const REPO = path.resolve(__dirname, '..', '..');

describe('the real repository license posture is reconciled (AGPL-3.0-or-later)', () => {
  const licenseText = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf-8');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf-8'));
  const headerSamples = ['core/src/index.ts', 'scripts/licensePosture.ts', 'convex/schema.ts']
    .map((p) => { try { return fs.readFileSync(path.join(REPO, p), 'utf-8').slice(0, 200); } catch { return ''; } })
    .filter(Boolean);

  it('root LICENSE is the canonical GNU AGPLv3 (incl. §13 Remote Network Interaction)', () => {
    expect(isAgplLicenseText(licenseText)).toBe(true);
  });
  it('package.json declares license = AGPL-3.0-or-later', () => {
    expect(packageDeclaresChosenLicense(pkg)).toBe(true);
    expect(pkg.license).toBe(CHOSEN_SPDX);
  });
  it('sampled source headers carry the same SPDX identifier', () => {
    for (const h of headerSamples) {
      const id = headerSpdxIdentifier(h);
      if (id) expect(id).toBe(CHOSEN_SPDX);
    }
  });
  it('the three declarations agree — no posture problems', () => {
    const report = evaluateLicensePosture({ licenseText, pkg, sampleHeaderTexts: headerSamples });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('evaluateLicensePosture catches a mismatch (negative fixtures)', () => {
  it('flags a non-AGPL LICENSE, a wrong package license, and a conflicting header', () => {
    const r = evaluateLicensePosture({
      licenseText: 'MIT License\n\nPermission is hereby granted...',
      pkg: { license: 'MIT' },
      sampleHeaderTexts: ['// SPDX-License-Identifier: Apache-2.0'],
    });
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBe(3);
  });
});

describe('classifyDependencyLicense — AGPL-compatibility', () => {
  it('permissive + GPL-family are compatible', () => {
    for (const l of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', 'GPL-3.0-or-later', 'AGPL-3.0-only']) {
      expect(classifyDependencyLicense(l)).toBe('compatible');
    }
  });
  it('SPDX OR-expressions are compatible if any operand is', () => {
    expect(classifyDependencyLicense('(MIT OR Apache-2.0)')).toBe('compatible');
  });
  it('known one-way-incompatible licenses are flagged', () => {
    expect(classifyDependencyLicense('GPL-2.0-only')).toBe('incompatible');
    expect(classifyDependencyLicense('CDDL-1.0')).toBe('incompatible');
  });
  it('undeclared / custom / unknown → review (human call), never a silent pass', () => {
    for (const l of ['', 'UNLICENSED', 'SEE LICENSE IN LICENSE', 'Weird-Custom-1.0', undefined]) {
      expect(classifyDependencyLicense(l)).toBe('review');
    }
  });
});
