import { describe, it, expect } from 'vitest';
import { buildKernelActionTable, classifyDraftAction } from '../src/kernelActionClassifier';

const table = buildKernelActionTable();

describe('kernelActionClassifier: gate-machinery targets classify SACRED (one-signature gate self-unlock signal)', () => {
  // Before this fix a draft to edit the gate machinery classified as an ordinary write_gated change, so an
  // owner could sign a gate self-edit believing it routine. These must surface as sacred/never_ring0.
  const GATE_INTENTS = [
    'write core/src/nativeLiveApply.ts',
    'edit core/src/kernelActionClassifier.ts',
    'refactor core/src/appliedProposalLedger.ts',
    'update core/src/policyKernel.ts',
    'change core/src/proposalHash.ts',
    'patch core/src/aumlokAuthorityRoot.ts',
    'rewrite core/src/sandboxApply.ts',
    'write authority/gate/aukoraGate.ts',
    'write authority/symbiotePaths.ts',
    'write identity/founder.json',
    'write docs/policy-rings/ring-table.json',
  ];

  for (const intent of GATE_INTENTS) {
    it(`classifies "${intent}" as sacred/never_ring0`, () => {
      const v = classifyDraftAction(intent, table);
      expect(v.class).toBe('sacred');
      expect(v.gate).toBe('never_ring0');
      expect(v.canApplyNow).toBe(false);
      expect(v.grantsAuthority).toBe(false);
    });
  }

  it('flags the gate machinery via the dedicated matcher (not merely the pre-existing keyword net)', () => {
    // proposalHash / policyKernel / sandboxApply carry NONE of the sacred keywords — proving the new
    // gate_machinery matcher is what catches them, closing the classifier blindness the audit found.
    for (const intent of ['write core/src/proposalHash.ts', 'write core/src/policyKernel.ts', 'write core/src/sandboxApply.ts']) {
      expect(classifyDraftAction(intent, table).matched).toBe('gate_machinery');
    }
  });

  it('does NOT over-match ordinary adjacent paths (no false positives)', () => {
    for (const intent of ['write docs/NOTE.md', 'write core/src/someFeature.ts', 'write authority-notes.md', 'read README.md']) {
      expect(classifyDraftAction(intent, table).class).not.toBe('sacred');
    }
  });

  it('does NOT over-block gate-named SIBLING files (regression: \\b(name)\\b matched policyKernel-helper.ts)', () => {
    // These share a prefix with a gate file but are NOT the gate file; a legit signed write to them must not be
    // wrongly refused. The exact-basename+`.ts` boundary distinguishes them. (Adversarial-pass finding #3.)
    for (const intent of [
      'write core/src/policyKernel-helper.ts',
      'write core/src/proposalHash.helpers.ts',
      'write core/src/sandboxApplyPreview.ts',
      'write core/tests/policyKernel.test.ts',
    ]) {
      expect(classifyDraftAction(intent, table).class, intent).not.toBe('sacred');
    }
  });
});

describe('kernelActionClassifier: state/brain + env targets classify SACRED (owner-facing pre-sign signal)', () => {
  const STATE_ENV_INTENTS = [
    'write state/kira/brain.json',
    'edit the brain.json',
    'write .env',
    'update .env.local',
    'create dashboard/fu/.env with the api key',
    'write signing.key',
    'add secrets/service.pem',
    'edit auth.json',
    'write aumlok-dev.json',
    'patch core/src/pinnedPublicKey.ts',
    'change core/src/nodeIdentity.ts',
    'edit scripts/aumlok-authority.sh',
    'rewrite scripts/scan-secrets.sh',
    'neuter scripts/verify-public-readiness.sh',
    'write .envrc',
    'edit .github/workflows/gate.yml',
  ];

  for (const intent of STATE_ENV_INTENTS) {
    it(`classifies "${intent}" as sacred/never_ring0`, () => {
      const v = classifyDraftAction(intent, table);
      expect(v.class).toBe('sacred');
      expect(v.gate).toBe('never_ring0');
      expect(v.canApplyNow).toBe(false);
    });
  }

  it('flags state/env via the dedicated state_env matcher (state/brain.json carry no pre-existing sacred keyword)', () => {
    for (const intent of ['write state/kira/brain.json', 'update .env.local', 'write signing.key']) {
      expect(classifyDraftAction(intent, table).matched).toBe('state_env');
    }
  });

  it('does NOT over-block non-secret env templates or secret-resembling ordinary files', () => {
    for (const intent of [
      'write .env.example',
      'update .env.sample',
      'write dashboard/fu/.env.template',
      'write spatial/app/ui/states.js',
      'edit core/src/keyMappings.ts',
      'write core/src/nodeIdentityHelper.ts',
    ]) {
      expect(classifyDraftAction(intent, table).class, intent).not.toBe('sacred');
    }
  });
});
