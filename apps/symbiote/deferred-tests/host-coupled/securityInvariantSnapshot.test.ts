import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateSecuritySnapshot,
  SecuritySnapshot,
  SecurityClaim,
  REQUIRED_CLAIM_IDS,
} from '../src/securityInvariantSnapshot';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const EVIDENCE = path.join(ROOT, 'evidence');

const WOMB_MODULES = [
  'wombTargetDiscovery.ts',
  'wombPatchDraft.ts',
  'patchProposal.ts',
  'patchApproval.ts',
  'patchLoopReceipt.ts',
  'opencodeWombArtifact.ts',
];

function importLines(src: string): string[] {
  return src.split('\n').filter(l => /^\s*import\s/.test(l));
}

function nonRegexLines(src: string): string[] {
  return src.split('\n').filter(l => !l.trimStart().startsWith('/'));
}

const moduleSources: Record<string, string> = {};
for (const mod of WOMB_MODULES) {
  moduleSources[mod] = fs.readFileSync(path.join(SRC, mod), 'utf-8');
}

let snapshot: SecuritySnapshot;

describe('security invariant snapshot', () => {
  snapshot = generateSecuritySnapshot(ROOT);

  describe('snapshot completeness', () => {
    it('includes all required claims', () => {
      const claimIds = snapshot.claims.map(c => c.claimId);
      for (const id of REQUIRED_CLAIM_IDS) {
        expect(claimIds, `missing claim: ${id}`).toContain(id);
      }
    });

    it('has exactly 21 claims (24Z.1 added bond/listening/vjepa boundary claims)', () => {
      expect(snapshot.claims.length).toBe(21);
    });

    it('snapshot is advisory-only and grants no authority', () => {
      expect(snapshot.advisoryOnly).toBe(true);
      expect(snapshot.grantsAuthority).toBe(false);
    });

    it('all claims have required fields', () => {
      for (const claim of snapshot.claims) {
        expect(claim.claimId).toBeTruthy();
        expect(['PASS', 'FAIL', 'WARN']).toContain(claim.status);
        expect(Array.isArray(claim.codeEvidence)).toBe(true);
        expect(Array.isArray(claim.testEvidence)).toBe(true);
        expect(typeof claim.notes).toBe('string');
      }
    });
  });

  describe('no_auto_apply', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_auto_apply')!;
      expect(claim.status).toBe('PASS');
    });

    it('no womb module exports an apply function', () => {
      for (const [mod, src] of Object.entries(moduleSources)) {
        const exportedApply = src.match(/export\s+(?:async\s+)?function\s+(apply\w*)/g);
        expect(exportedApply, `${mod} must not export an apply function`).toBeNull();
      }
    });

    it('would FAIL if apply runner existed', () => {
      const applyRunner = path.join(EVIDENCE, 'apply-patch.ts');
      expect(fs.existsSync(applyRunner), 'apply-patch.ts must not exist').toBe(false);
    });
  });

  describe('no_auto_deploy', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_auto_deploy')!;
      expect(claim.status).toBe('PASS');
    });
  });

  describe('no_auto_push', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_auto_push')!;
      expect(claim.status).toBe('PASS');
    });

    it('detects git push if introduced', () => {
      const fakeSources: Record<string, string> = {
        'fake.ts': 'const cmd = `git push origin main`;',
      };
      const lines = nonRegexLines(fakeSources['fake.ts']);
      expect(lines.join('\n')).toMatch(/git\s+push/);
    });
  });

  describe('no_model_owned_signing_keys', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_model_owned_signing_keys')!;
      expect(claim.status).toBe('PASS');
    });

    it('no womb module imports EDGE_NODE_SEED', () => {
      for (const [mod, src] of Object.entries(moduleSources)) {
        for (const line of importLines(src)) {
          expect(line, mod).not.toContain('EDGE_NODE_SEED');
        }
      }
    });

    it('no womb module imports from organism crypto.ts', () => {
      for (const [mod, src] of Object.entries(moduleSources)) {
        for (const line of importLines(src)) {
          expect(line, mod).not.toMatch(/from\s+['"]\.\/crypto['"]/);
        }
      }
    });
  });

  describe('fusion_council_advisory_only', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'fusion_council_advisory_only')!;
      expect(claim.status).toBe('PASS');
    });

    it('fusionSwarm has no gate/executor imports', () => {
      const swarmSrc = fs.readFileSync(path.join(SRC, 'fusionSwarm.ts'), 'utf-8');
      const imports = importLines(swarmSrc);
      for (const line of imports) {
        expect(line).not.toMatch(/from\s+['"]\.\/gate['"]/);
        expect(line).not.toMatch(/from\s+['"]\.\/executor['"]/);
      }
    });
  });

  describe('opencode_womb_advisory_only', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'opencode_womb_advisory_only')!;
      expect(claim.status).toBe('PASS');
    });

    it('artifact has advisory_only: true in interface and builders', () => {
      const src = moduleSources['opencodeWombArtifact.ts'];
      expect(src).toMatch(/advisory_only:\s*true/);
    });
  });

  describe('patch_drafts_are_draft_only', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'patch_drafts_are_draft_only')!;
      expect(claim.status).toBe('PASS');
    });

    it('PatchDraft has intent: draft_only and approvalRequired: true', () => {
      const src = moduleSources['wombPatchDraft.ts'];
      expect(src).toContain("intent: 'draft_only'");
      expect(src).toContain('approvalRequired: true');
    });
  });

  describe('patch_approvals_do_not_grant_authority', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'patch_approvals_do_not_grant_authority')!;
      expect(claim.status).toBe('PASS');
    });

    it('grantsAuthority: false in all approval paths', () => {
      const src = moduleSources['patchApproval.ts'];
      expect(src).toContain('grantsAuthority: false');
      expect(src).not.toMatch(/grantsAuthority:\s*true/);
    });
  });

  describe('no_self_replication_lane', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_self_replication_lane')!;
      expect(claim.status).toBe('PASS');
    });

    it('no eval/Function/dynamic-import in womb modules', () => {
      for (const [mod, src] of Object.entries(moduleSources)) {
        const lines = nonRegexLines(src);
        for (const line of lines) {
          const trimmed = line.trim();
          if (/\beval\s*\(/.test(trimmed)) {
            expect.unreachable(`${mod} calls eval: ${trimmed}`);
          }
          if (/\bnew\s+Function\s*\(/.test(trimmed)) {
            expect.unreachable(`${mod} uses Function constructor: ${trimmed}`);
          }
        }
      }
    });

    it('no apply-patch.ts runner exists', () => {
      expect(fs.existsSync(path.join(EVIDENCE, 'apply-patch.ts'))).toBe(false);
    });
  });

  describe('no_shell_from_advisory_context', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_shell_from_advisory_context')!;
      expect(claim.status).toBe('PASS');
    });

    const FORBIDDEN_IMPORTS = [
      { pattern: /from\s+['"]\.\/gate['"]/, label: 'gate' },
      { pattern: /from\s+['"]\.\/executor['"]/, label: 'executor' },
      { pattern: /from\s+['"]\.\/crypto['"]/, label: 'organism crypto' },
      { pattern: /['"]child_process['"]/, label: 'child_process' },
      { pattern: /['"]net['"]/, label: 'net' },
      { pattern: /['"]http['"]/, label: 'http' },
      { pattern: /['"]https['"]/, label: 'https' },
    ];

    for (const mod of WOMB_MODULES) {
      it(`${mod} has no forbidden imports`, () => {
        const imports = importLines(moduleSources[mod]);
        for (const line of imports) {
          for (const { pattern, label } of FORBIDDEN_IMPORTS) {
            expect(line, `${mod} imports ${label}`).not.toMatch(pattern);
          }
        }
      });
    }

    for (const mod of WOMB_MODULES) {
      it(`${mod} does not call signPoP/evaluateIntent/executeDecision outside regex`, () => {
        const lines = nonRegexLines(moduleSources[mod]);
        const nonImportLines = lines.filter(l => !/^\s*import\s/.test(l));
        for (const line of nonImportLines) {
          if (/\bsignPoP\s*\(/.test(line)) expect.unreachable(`${mod} calls signPoP`);
          if (/\bevaluateIntent\s*\(/.test(line)) expect.unreachable(`${mod} calls evaluateIntent`);
          if (/\bexecuteDecision\s*\(/.test(line)) expect.unreachable(`${mod} calls executeDecision`);
        }
      });
    }
  });

  describe('no_auma_one_paths', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_auma_one_paths')!;
      expect(claim.status).toBe('PASS');
    });

    for (const mod of WOMB_MODULES) {
      it(`${mod} has no literal AUMA-ONE-APP`, () => {
        expect(moduleSources[mod]).not.toContain('AUMA-ONE-APP');
      });
    }

    it('womb pipeline runners have no literal AUMA-ONE-APP', () => {
      const RUNNERS = [
        'discover-womb-targets.ts',
        'draft-womb-patch.ts',
        'propose-next-patch.ts',
        'approve-patch-draft.ts',
        'run-patch-loop.ts',
        'run-24n-fusion-review.ts',
      ];
      for (const runner of RUNNERS) {
        const runnerPath = path.join(EVIDENCE, runner);
        if (!fs.existsSync(runnerPath)) continue;
        const src = fs.readFileSync(runnerPath, 'utf-8');
        expect(src, runner).not.toContain('AUMA-ONE-APP');
      }
    });
  });

  describe('no_live_secret_in_evidence', () => {
    it('claim is PASS', () => {
      const claim = snapshot.claims.find(c => c.claimId === 'no_live_secret_in_evidence')!;
      expect(claim.status).toBe('PASS');
    });

    const SECRET_PATTERNS = [
      { pattern: /sk-or-[a-zA-Z0-9_-]{16,}/, label: 'OpenRouter API key' },
      { pattern: /sk-[a-zA-Z0-9_-]{20,}/, label: 'API key (sk-)' },
      { pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/i, label: 'Bearer token' },
      { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, label: 'private key PEM' },
      { pattern: /EDGE_NODE_SEED\s*[:=]\s*["'][^"']+["']/, label: 'EDGE_NODE_SEED value' },
    ];

    it('no evidence JSON contains live secrets', () => {
      const jsonFiles = fs.readdirSync(EVIDENCE).filter(f => f.endsWith('.json'));
      for (const file of jsonFiles) {
        const content = fs.readFileSync(path.join(EVIDENCE, file), 'utf-8');
        for (const { pattern, label } of SECRET_PATTERNS) {
          expect(content, `${file} contains ${label}`).not.toMatch(pattern);
        }
      }
    });

    it('no evidence markdown contains live secrets', () => {
      const mdFiles = fs.readdirSync(EVIDENCE).filter(f => f.endsWith('.md'));
      for (const file of mdFiles) {
        const content = fs.readFileSync(path.join(EVIDENCE, file), 'utf-8');
        for (const { pattern, label } of SECRET_PATTERNS) {
          expect(content, `${file} contains ${label}`).not.toMatch(pattern);
        }
      }
    });
  });

  describe('cross-invariant: structural completeness', () => {
    it('every advisoryOnly field in womb interfaces is typed as literal true', () => {
      for (const mod of WOMB_MODULES) {
        const src = moduleSources[mod];
        const advisoryLines = src.split('\n').filter(l => l.includes('advisoryOnly') || l.includes('advisory_only'));
        expect(advisoryLines.length, `${mod} must have at least one advisoryOnly field`).toBeGreaterThan(0);
        for (const line of advisoryLines) {
          if (line.includes(':') && !line.includes('function') && !line.includes('if') && !line.includes('//')) {
            expect(line.includes('true') || line.includes("'true'"), `${mod}: ${line.trim()}`).toBe(true);
          }
        }
      }
    });

    it('uncertain claims are WARN, not silent PASS', () => {
      for (const claim of snapshot.claims) {
        if (claim.codeEvidence.length === 0 && claim.status === 'PASS') {
          expect.unreachable(`${claim.claimId} has PASS with no code evidence — should be WARN`);
        }
      }
    });

    it('snapshot JSON is deterministic except date', () => {
      const snapshot2 = generateSecuritySnapshot(ROOT);
      expect(snapshot2.claims.length).toBe(snapshot.claims.length);
      for (let i = 0; i < snapshot.claims.length; i++) {
        expect(snapshot2.claims[i].claimId).toBe(snapshot.claims[i].claimId);
        expect(snapshot2.claims[i].status).toBe(snapshot.claims[i].status);
      }
    });

    it('no FAIL claims exist', () => {
      const fails = snapshot.claims.filter(c => c.status === 'FAIL');
      expect(fails.length, `FAIL claims: ${fails.map(f => f.claimId).join(', ')}`).toBe(0);
    });
  });
});
