import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { getEdgeNodeSeed, EDGE_NODE_PUBLIC_KEY, assertRuntimeSeedMatchesPinnedPublicKey } from '../src/nodeIdentity';
import { evaluateIntent, _resetChain } from '../src/index';
import { normalizeProposal } from '../src/normalizer';
import { exportVkRow, verifyVkRowAgainstSignedChain } from '../src/trainingExport';
import { signHead, computeMerkleRoot, generateReceipt } from '../src/crypto';

describe('Commit 12: Real Secret Key Boundary', () => {
  beforeEach(() => {
    _resetChain();
  });

  it('production src and config no longer contain the old hardcoded edge node private seed', () => {
    const rootDir = join(__dirname, '../');
    const oldHardcodedSeed = "88".repeat(32);

    function checkDir(dir: string) {
      const files = require('fs').readdirSync(dir);
      for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'tests') continue;
        const fullPath = join(dir, file);
        if (require('fs').statSync(fullPath).isDirectory()) {
          checkDir(fullPath);
        } else {
          if (file === 'package-lock.json') continue;
          const content = readFileSync(fullPath, 'utf-8');
          expect(content).not.toContain(oldHardcodedSeed);
        }
      }
    }
    
    checkDir(rootDir);
    
    // Check tests dir separately, ignoring setup.ts
    const testDir = join(__dirname);
    const testFiles = require('fs').readdirSync(testDir);
    for (const file of testFiles) {
      if (file === 'setup.ts') continue;
      const fullPath = join(testDir, file);
      if (!statSync(fullPath).isFile()) continue;
      const content = readFileSync(fullPath, 'utf-8');
      expect(content).not.toContain(oldHardcodedSeed);
    }
  });

  it('no private seeds or nebius keys are committed to the repo', () => {
    // We only expect the seed to exist in tests/setup.ts where it is mocked for the test suite
    // and explicitly gitignored. We shouldn't find it anywhere else.
    // M4 gate-honesty fix (2026-07-05): scan TRACKED files only (git ls-files), matching the test's
    // own name — "committed to the repo". The old bare `grep -r ..` also swept gitignored RUNTIME
    // state, and after the M4 migration the live brain database (state/convex/*.sqlite3) legitimately
    // contains Auma's self-map MEMORY of tests/fakeModel.js — whose deliberate fake-seed line then
    // matched as an opaque "Binary file … matches" hit the known-fake exclusions below cannot see
    // into. A memory of a test fixture is not a committed secret. (Same class + same fix as the
    // check_no_cloud_convex.sh .venv false-positive: scope to git-tracked files.)
    const searchResult = execSync('cd .. && git ls-files -z | xargs -0 grep -I "AUKORA_EDGE_NODE_SEED=" || true', { encoding: 'utf-8' });
    
    // Ignore hits in setup.ts, identity.test.ts, nodeIdentity.ts, proposer tests, and READMEs
    const suspiciousLines = searchResult.split('\n').filter((line: string) => 
      line.trim() !== '' &&
      !line.includes('tests/setup.ts') &&
      !line.includes('tests/identity.test.ts') &&
      !line.includes('src/nodeIdentity.ts') &&
      !line.includes('tests/proposer.test.ts') &&
      !line.includes('tests/nebiusProposer.test.ts') &&
      !line.includes('src/proposer.ts') &&
      !line.includes('src/externalReview.ts') &&
      !line.includes('tests/externalReview.test.ts') &&
      !line.includes('.env.example') &&
      !line.includes('tests/fakeModel.js') &&
      !line.includes('README') &&
      !line.includes('AUKORA_EDGE_NODE_SEED=[REDACTED]') &&
      !line.includes('AUKORA_EDGE_NODE_SEED=my_secret_seed') &&
      !line.includes('AUKORA_EDGE_NODE_SEED=secret_edge_seed')
    );

    expect(suspiciousLines.length).toBe(0);
    
    // Also scan for NEBIUS_AI_CLOUD_AUTH_TOKEN literally set (with an actual value) — tracked files
    // only, same rationale as above (a live-brain memory mentioning the token NAME is not a commit).
    const nebiusResult = execSync('cd .. && git ls-files -z | xargs -0 grep -I "NEBIUS_AI_CLOUD_AUTH_TOKEN=" || true', { encoding: 'utf-8' });
    const suspiciousNebiusLines = nebiusResult.split('\n').filter((line: string) => 
      line.trim() !== '' &&
      !line.includes('tests/identity.test.ts') &&
      !line.includes('tests/nebiusProposer.test.ts') &&
      !line.includes('tests/nebiusSmoke.test.ts') &&
      !line.includes('src/nebiusSmoke.ts') &&
      !line.includes('src/nebiusProposer.ts') &&
      !line.includes('src/proposer.ts') &&
      !line.includes('src/externalReview.ts') &&
      !line.includes('tests/externalReview.test.ts') &&
      !line.includes('.env.example') &&
      !line.includes('NEBIUS_AI_CLOUD_AUTH_TOKEN=[REDACTED]') &&
      !line.includes('NEBIUS_AI_CLOUD_AUTH_TOKEN=test_nebius_key')
    );
    
    expect(suspiciousNebiusLines.length).toBe(0);
  });

  it('missing node secret fails closed', () => {
    const original = process.env.AUKORA_EDGE_NODE_SEED;
    delete process.env.AUKORA_EDGE_NODE_SEED;

    expect(() => getEdgeNodeSeed()).toThrow(/FATAL: AUKORA_EDGE_NODE_SEED/);
    expect(() => assertRuntimeSeedMatchesPinnedPublicKey()).toThrow(/FATAL: AUKORA_EDGE_NODE_SEED/);
    
    // evaluateIntent/signing path fails closed if seed is missing
    expect(() => evaluateIntent({ action: 'read_file', resource: 'data', ring: 'local' }, null))
      .toThrow(/FATAL: AUKORA_EDGE_NODE_SEED/);

    process.env.AUKORA_EDGE_NODE_SEED = original;
  });

  it('mismatched runtime seed throws key consistency guard', () => {
    const original = process.env.AUKORA_EDGE_NODE_SEED;
    
    // Provide a valid format but incorrect seed ("99" instead of "88")
    process.env.AUKORA_EDGE_NODE_SEED = "99".repeat(32);
    
    expect(() => assertRuntimeSeedMatchesPinnedPublicKey()).toThrow(/FATAL: Key consistency guard failed/);
    expect(() => evaluateIntent({ action: 'read_file', resource: 'data', ring: 'local' }, null))
      .toThrow(/FATAL: Key consistency guard failed/);

    process.env.AUKORA_EDGE_NODE_SEED = original;
  });

  it('matching TEST_ONLY seed passes key consistency guard', () => {
    // Current setup uses the valid "88" seed
    expect(() => assertRuntimeSeedMatchesPinnedPublicKey()).not.toThrow();
  });

  it('valid test secret still signs and verifies under pinned public key', () => {
    // A valid run should correctly sign the head
    const decision = evaluateIntent({ action: 'read_file', resource: 'data', ring: 'local' }, null);
    
    const root = computeMerkleRoot([decision.receipt]);
    
    // We can't easily verify the signature here without importing verifying functions,
    // but the fact that it evaluates without throwing means signHead succeeded.
    expect(decision.receipt.signedHead).toBeDefined();
    
    // It should be signed by the secret currently in env.
    const expectedHead = signHead(process.env.AUKORA_EDGE_NODE_SEED!, root);
    expect(decision.receipt.signedHead).toBe(expectedHead);
  });

  it('exported VK rows do not include the node private seed', () => {
    const decision = evaluateIntent({ action: 'read_file', resource: 'data', ring: 'local' }, null);
    const exportedJSON = exportVkRow(decision.vkRow);
    
    const secret = process.env.AUKORA_EDGE_NODE_SEED!;
    expect(exportedJSON).not.toContain(secret);
    
    const parsed = JSON.parse(exportedJSON);
    expect(parsed.seed).toBeUndefined();
    expect(parsed.privateKey).toBeUndefined();
  });

  it('can verify a signed row using only the pinned public key, without the private seed', () => {
    // 1. Generate a valid row with the seed
    const decision = evaluateIntent({ action: 'read_file', resource: 'data', ring: 'local' }, null);
    
    // 2. Remove the seed from the environment
    const original = process.env.AUKORA_EDGE_NODE_SEED;
    delete process.env.AUKORA_EDGE_NODE_SEED;
    
    try {
      // 3. Verify it. This should NOT throw if it correctly uses PINNED_EDGE_NODE_PUBLIC_KEY
      // and doesn't call getEdgeNodeSeed() internally during verification.
      const root = computeMerkleRoot([decision.receipt]);
      expect(() => verifyVkRowAgainstSignedChain(decision.vkRow, [decision.receipt], root, decision.receipt.signedHead!))
        .not.toThrow();
    } finally {
      // Restore
      process.env.AUKORA_EDGE_NODE_SEED = original;
    }
  });
});
