import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT, '../..');

describe('VK/Chronos Threat Register — doc safety', () => {
  const registerPath = path.resolve(ROOT, 'evidence/vk-chronos-threat-register.md');
  const pathPath = path.resolve(REPO_ROOT, 'AUKORA_SINGULARITY_PATH.md');

  it('threat register exists', () => {
    expect(fs.existsSync(registerPath)).toBe(true);
  });

  it('threat register says timing may never be authority', () => {
    const content = fs.readFileSync(registerPath, 'utf-8');
    expect(content).toContain('Timing may never be authority');
  });

  it('threat register says glyphs may never authorize effects', () => {
    const content = fs.readFileSync(registerPath, 'utf-8');
    expect(content).toContain('Glyphs may never authorize effects');
  });

  it('threat register says no runtime capability added', () => {
    const content = fs.readFileSync(registerPath, 'utf-8');
    expect(content).toContain('no runtime capability added');
  });

  it('threat register says PARKED status', () => {
    const content = fs.readFileSync(registerPath, 'utf-8');
    expect(content).toContain('PARKED');
  });

  it('singularity path contains VK/Chronos parked status', () => {
    const content = fs.readFileSync(pathPath, 'utf-8');
    expect(content).toContain('VK / Chronos Safety Register');
    expect(content).toContain('PARKED');
  });

  it('singularity path contains VK glyph laws', () => {
    const content = fs.readFileSync(pathPath, 'utf-8');
    expect(content).toContain('Glyphs may never authorize effects');
    expect(content).toContain('Glyphs may never bypass typed intents');
  });

  it('singularity path contains Chronos laws', () => {
    const content = fs.readFileSync(pathPath, 'utf-8');
    expect(content).toContain('Timing may never be authority');
    expect(content).toContain('Chronos remains side-lab only');
  });

  it('no near-infinite bandwidth production claim in path docs', () => {
    const content = fs.readFileSync(pathPath, 'utf-8');
    expect(content.toLowerCase()).not.toContain('near-infinite bandwidth');
    expect(content.toLowerCase()).not.toContain('infinite bandwidth');
  });

  it('no near-infinite bandwidth production claim in evidence docs', () => {
    const evidenceDir = path.resolve(ROOT, 'evidence');
    const mdFiles = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.md'));
    for (const file of mdFiles) {
      const content = fs.readFileSync(path.join(evidenceDir, file), 'utf-8').toLowerCase();
      expect(content).not.toContain('near-infinite bandwidth');
      expect(content).not.toContain('infinite bandwidth');
    }
  });
});

describe('VK/Chronos — no runtime imports in authority paths', () => {
  const authorityModules = [
    'src/index.ts',
    'src/executor.ts',
    'src/patchApproval.ts',
    'src/aumlokApprovalRoot.ts',
  ];

  for (const mod of authorityModules) {
    it(`${mod} does not import chronos`, () => {
      const filePath = path.resolve(ROOT, mod);
      if (!fs.existsSync(filePath)) return;
      const src = fs.readFileSync(filePath, 'utf-8');
      const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line.toLowerCase()).not.toContain('chronos');
      }
    });

    it(`${mod} does not import vk glyph runtime`, () => {
      const filePath = path.resolve(ROOT, mod);
      if (!fs.existsSync(filePath)) return;
      const src = fs.readFileSync(filePath, 'utf-8');
      const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line).not.toMatch(/from\s+['"]\.\/vkGlyph/);
        expect(line).not.toMatch(/from\s+['"]\.\/glyphRuntime/);
      }
    });
  }

  it('no chronos module in womb pipeline', () => {
    const wombModules = [
      'src/wombTargetDiscovery.ts',
      'src/wombPatchDraft.ts',
      'src/patchProposal.ts',
      'src/patchApproval.ts',
      'src/patchLoopReceipt.ts',
      'src/opencodeWombArtifact.ts',
      'src/aumlokApprovalRoot.ts',
    ];
    for (const mod of wombModules) {
      const filePath = path.resolve(ROOT, mod);
      if (!fs.existsSync(filePath)) continue;
      const src = fs.readFileSync(filePath, 'utf-8');
      const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line.toLowerCase()).not.toContain('chronos');
      }
    }
  });
});
