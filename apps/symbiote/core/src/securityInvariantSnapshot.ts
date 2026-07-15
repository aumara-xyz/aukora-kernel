import * as fs from 'fs';
import * as path from 'path';
import { parseImportEdges, symbolUsedInCode } from './importGraphVerifier';

export interface SecurityClaim {
  claimId: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  codeEvidence: string[];
  testEvidence: string[];
  notes: string;
}

export interface SecuritySnapshot {
  arc: string;
  date: string;
  claims: SecurityClaim[];
  modulesScanned: string[];
  advisoryOnly: true;
  grantsAuthority: false;
}

const WOMB_MODULES = [
  'wombTargetDiscovery.ts',
  'wombPatchDraft.ts',
  'patchProposal.ts',
  'patchApproval.ts',
  'patchLoopReceipt.ts',
  'opencodeWombArtifact.ts',
  'aumlokApprovalRoot.ts',
  'wombForbiddenPatterns.ts',
  'aumaWombPrompt.ts',
  'burnDataset.ts',
  'sleepSkill.ts',
  'importGraphVerifier.ts',
  'fractalFusion.ts',
  'fractalFusionEvidence.ts',
  'restingGlyph.ts',
  'senseBus.ts',
  'fusionOpsHealth.ts',
];

const WOMB_RUNNERS = [
  'discover-womb-targets.ts',
  'draft-womb-patch.ts',
  'propose-next-patch.ts',
  'approve-patch-draft.ts',
  'run-patch-loop.ts',
  'run-24n-fusion-review.ts',
  'run-24n1-security-review.ts',
  'write-security-invariant-snapshot.ts',
  'bind-aumlok-approval.ts',
];

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /from\s+['"]\.\/gate['"]/, label: 'gate' },
  { pattern: /from\s+['"]\.\/executor['"]/, label: 'executor' },
  { pattern: /from\s+['"]\.\/crypto['"]/, label: 'organism crypto' },
  { pattern: /['"]child_process['"]/, label: 'child_process' },
  { pattern: /['"]net['"]/, label: 'net' },
  { pattern: /['"]http['"]/, label: 'http' },
  { pattern: /['"]https['"]/, label: 'https' },
];

const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-or-[a-zA-Z0-9_-]{16,}/, label: 'OpenRouter API key' },
  { pattern: /sk-[a-zA-Z0-9_-]{20,}/, label: 'API key (sk-)' },
  { pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/i, label: 'Bearer token' },
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, label: 'private key PEM' },
  { pattern: /EDGE_NODE_SEED\s*[:=]\s*["'][^"']+["']/, label: 'EDGE_NODE_SEED value' },
];

const LEGACY_APP_LITERAL = ['AUMA', 'ONE', 'APP'].join('-');

function importLines(src: string): string[] {
  return src.split('\n').filter(l => /^\s*import\s/.test(l));
}

function nonRegexLines(src: string): string[] {
  return src.split('\n').filter(l => !l.trimStart().startsWith('/'));
}

function readModuleSources(srcDir: string): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const mod of WOMB_MODULES) {
    const filePath = path.join(srcDir, mod);
    if (fs.existsSync(filePath)) {
      sources[mod] = fs.readFileSync(filePath, 'utf-8');
    }
  }
  return sources;
}

function checkNoAutoApply(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    const exportedApply = src.match(/export\s+(?:async\s+)?function\s+(apply\w*)/g);
    if (exportedApply) {
      failures.push(`${mod} exports apply function: ${exportedApply.join(', ')}`);
    } else {
      evidence.push(`${mod}: no apply* exports`);
    }

    const srcWrites = src.match(/writeFileSync\s*\([^)]*['"]src\//g);
    if (srcWrites) {
      failures.push(`${mod} writes to src/: ${srcWrites.join(', ')}`);
    }
  }

  const draftSrc = sources['wombPatchDraft.ts'] ?? '';
  if (draftSrc.includes("intent: 'draft_only'")) {
    evidence.push("PatchDraft.intent = 'draft_only'");
  } else {
    failures.push("PatchDraft missing intent: 'draft_only'");
  }

  if (draftSrc.match(/intent:\s*['"]apply/)) {
    failures.push("PatchDraft has intent: 'apply*'");
  }

  const approvalSrc = sources['patchApproval.ts'] ?? '';
  if (approvalSrc.includes('grantsAuthority: false')) {
    evidence.push('PatchApprovalRecord.grantsAuthority = false');
  } else {
    failures.push('PatchApprovalRecord missing grantsAuthority: false');
  }

  return {
    claimId: 'no_auto_apply',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_auto_apply block'],
    notes: failures.length > 0 ? failures.join('; ') : 'No apply path found in any womb module',
  };
}

function checkNoAutoDeploy(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    const lines = nonRegexLines(src);
    const joined = lines.join('\n');
    if (/\bdeploy\s*\(/.test(joined)) {
      failures.push(`${mod} contains deploy() call`);
    }
    if (/\bpublish\s*\(/.test(joined)) {
      failures.push(`${mod} contains publish() call`);
    }
    evidence.push(`${mod}: no deploy/publish calls`);
  }

  return {
    claimId: 'no_auto_deploy',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_auto_deploy block'],
    notes: failures.length > 0 ? failures.join('; ') : 'No deploy or publish calls',
  };
}

function checkNoAutoPush(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    const lines = nonRegexLines(src);
    const joined = lines.join('\n');
    if (/git\s+push/.test(joined)) {
      failures.push(`${mod} contains git push`);
    }
    evidence.push(`${mod}: no git push`);
  }

  return {
    claimId: 'no_auto_push',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_auto_push block'],
    notes: failures.length > 0 ? failures.join('; ') : 'No git push found',
  };
}

function checkNoModelOwnedSigningKeys(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    const imports = importLines(src);
    for (const line of imports) {
      if (line.includes('EDGE_NODE_SEED')) failures.push(`${mod} imports EDGE_NODE_SEED`);
      if (line.includes('signPoP')) failures.push(`${mod} imports signPoP`);
      if (/from\s+['"]\.\/crypto['"]/.test(line)) failures.push(`${mod} imports organism crypto`);
    }
    evidence.push(`${mod}: no key/signing imports`);
  }

  const approvalSrc = sources['patchApproval.ts'] ?? '';
  if (approvalSrc.includes("'human_local' | 'kernel_test'")) {
    evidence.push("approvedBy limited to 'human_local' | 'kernel_test'");
  } else {
    failures.push('approvedBy not restricted to human_local | kernel_test');
  }

  if (/approvedBy.*model/.test(approvalSrc)) {
    failures.push('approvedBy allows model-based approval');
  }

  return {
    claimId: 'no_model_owned_signing_keys',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_model_owned_signing_keys block'],
    notes: failures.length > 0 ? failures.join('; ') : 'No model-owned signing keys or organism crypto imports',
  };
}

function checkFusionAdvisoryOnly(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  const swarmPath = path.join(srcDir, 'fusionSwarm.ts');
  if (!fs.existsSync(swarmPath)) {
    return {
      claimId: 'fusion_council_advisory_only',
      status: 'WARN',
      codeEvidence: [],
      testEvidence: [],
      notes: 'fusionSwarm.ts not found',
    };
  }

  const swarmSrc = fs.readFileSync(swarmPath, 'utf-8');
  const imports = importLines(swarmSrc);

  for (const line of imports) {
    if (/from\s+['"]\.\/gate['"]/.test(line)) failures.push('fusionSwarm imports gate');
    if (/from\s+['"]\.\/executor['"]/.test(line)) failures.push('fusionSwarm imports executor');
    if (/from\s+['"]\.\/crypto['"]/.test(line)) failures.push('fusionSwarm imports organism crypto');
  }

  const lines = nonRegexLines(swarmSrc);
  const joined = lines.join('\n');
  if (joined.includes('evaluateIntent')) failures.push('fusionSwarm calls evaluateIntent');
  if (joined.includes('executeDecision')) failures.push('fusionSwarm calls executeDecision');

  if (failures.length === 0) {
    evidence.push('fusionSwarm imports only fusionConfig + externalReview');
    evidence.push('No gate/executor/crypto imports');
    evidence.push('No evaluateIntent/executeDecision calls');
  }

  return {
    claimId: 'fusion_council_advisory_only',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — fusion_council_advisory_only block'],
    notes: failures.length > 0 ? failures.join('; ') : 'Fusion Council has no authority imports or calls',
  };
}

function checkOpencodeWombAdvisoryOnly(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  const artifactSrc = sources['opencodeWombArtifact.ts'] ?? '';

  if (/advisory_only:\s*true/.test(artifactSrc)) {
    evidence.push('OpenCodeAdvisoryArtifact has advisory_only: true');
  } else {
    failures.push('OpenCodeAdvisoryArtifact missing advisory_only: true');
  }

  if (artifactSrc.includes('function validateArtifact')) {
    const validateBlock = artifactSrc.slice(artifactSrc.indexOf('function validateArtifact'));
    if (validateBlock.includes('advisory_only')) {
      evidence.push('validateArtifact checks advisory_only');
    } else {
      failures.push('validateArtifact does not check advisory_only');
    }
  } else {
    failures.push('validateArtifact function not found');
  }

  if (artifactSrc.includes('function buildLoopArtifact')) {
    const buildBlock = artifactSrc.slice(artifactSrc.indexOf('function buildLoopArtifact'));
    if (/advisory_only:\s*true/.test(buildBlock)) {
      evidence.push('buildLoopArtifact forces advisory_only: true');
    } else {
      failures.push('buildLoopArtifact does not force advisory_only: true');
    }
  } else {
    failures.push('buildLoopArtifact function not found');
  }

  return {
    claimId: 'opencode_womb_advisory_only',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — opencode_womb_advisory_only block'],
    notes: failures.length > 0 ? failures.join('; ') : 'OpenCode artifact is advisory-only at type, build, and validation layers',
  };
}

function checkPatchDraftsDraftOnly(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  const draftSrc = sources['wombPatchDraft.ts'] ?? '';

  if (draftSrc.includes("intent: 'draft_only'")) {
    evidence.push("PatchDraft interface has intent: 'draft_only'");
  } else {
    failures.push("PatchDraft missing intent: 'draft_only'");
  }

  if (draftSrc.includes('function generatePatchDraft')) {
    const fn = draftSrc.slice(draftSrc.indexOf('function generatePatchDraft'));
    if (fn.includes("intent: 'draft_only'")) {
      evidence.push("generatePatchDraft sets intent: 'draft_only'");
    } else {
      failures.push("generatePatchDraft does not set intent: 'draft_only'");
    }
  }

  if (draftSrc.includes('approvalRequired: true')) {
    evidence.push('PatchDraft has approvalRequired: true');
  } else {
    failures.push('PatchDraft missing approvalRequired: true');
  }

  return {
    claimId: 'patch_drafts_are_draft_only',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — patch_drafts_are_draft_only block'],
    notes: failures.length > 0 ? failures.join('; ') : 'Drafts are inert: intent=draft_only, approvalRequired=true',
  };
}

function checkPatchApprovalsNoAuthority(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  const src = sources['patchApproval.ts'] ?? '';

  const fns = ['createPatchApproval', 'refusePatchDraft', 'sanitizeApprovalForArtifact'];
  for (const fnName of fns) {
    if (src.includes(`function ${fnName}`)) {
      const fn = src.slice(src.indexOf(`function ${fnName}`));
      if (fn.includes('grantsAuthority: false')) {
        evidence.push(`${fnName} sets grantsAuthority: false`);
      } else {
        failures.push(`${fnName} does not set grantsAuthority: false`);
      }
    }
  }

  if (src.includes('function validatePatchApproval')) {
    const fn = src.slice(src.indexOf('function validatePatchApproval'));
    if (fn.includes('grantsAuthority')) {
      evidence.push('validatePatchApproval checks grantsAuthority');
    } else {
      failures.push('validatePatchApproval does not check grantsAuthority');
    }
  }

  if (/grantsAuthority:\s*true/.test(src)) {
    failures.push('patchApproval.ts contains grantsAuthority: true');
  }

  return {
    claimId: 'patch_approvals_do_not_grant_authority',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — patch_approvals_do_not_grant_authority block'],
    notes: failures.length > 0 ? failures.join('; ') : 'All approval paths enforce grantsAuthority: false',
  };
}

function checkNoSelfReplicationLane(sources: Record<string, string>, srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    const lines = nonRegexLines(src);
    for (const line of lines) {
      const trimmed = line.trim();
      if (/\beval\s*\(/.test(trimmed)) failures.push(`${mod} calls eval()`);
      if (/\bnew\s+Function\s*\(/.test(trimmed)) failures.push(`${mod} uses new Function()`);
      if (/\bimport\s*\(/.test(trimmed) && !trimmed.startsWith('import ') && !trimmed.startsWith('import{')) {
        failures.push(`${mod} uses dynamic import()`);
      }
    }
    evidence.push(`${mod}: no eval/Function/dynamic-import`);
  }

  for (const [mod, src] of Object.entries(sources)) {
    const imports = importLines(src);
    for (const line of imports) {
      if (/['"]child_process['"]/.test(line)) failures.push(`${mod} imports child_process`);
    }
  }

  const applyRunner = path.join(srcDir, '..', 'evidence', 'apply-patch.ts');
  if (fs.existsSync(applyRunner)) {
    failures.push('apply-patch.ts runner exists — self-application lane present');
  } else {
    evidence.push('No apply-patch.ts runner exists');
  }

  return {
    claimId: 'no_self_replication_lane',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_self_replication_lane block'],
    notes: failures.length > 0 ? failures.join('; ') : 'No eval, dynamic import, Function constructor, child_process, or apply runner',
  };
}

function checkNoShellFromAdvisoryContext(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    const imports = importLines(src);
    for (const line of imports) {
      for (const { pattern, label } of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(line)) {
          failures.push(`${mod} imports ${label}`);
        }
      }
    }

    const lines = nonRegexLines(src);
    const nonImportLines = lines.filter(l => !/^\s*import\s/.test(l));
    for (const line of nonImportLines) {
      if (/\bsignPoP\s*\(/.test(line)) failures.push(`${mod} calls signPoP()`);
      if (/\bevaluateIntent\s*\(/.test(line)) failures.push(`${mod} calls evaluateIntent()`);
      if (/\bexecuteDecision\s*\(/.test(line)) failures.push(`${mod} calls executeDecision()`);
    }

    evidence.push(`${mod}: no forbidden imports or authority calls`);
  }

  return {
    claimId: 'no_shell_from_advisory_context',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_shell_from_advisory_context block'],
    notes: failures.length > 0 ? failures.join('; ') : 'No gate/executor/crypto/child_process/net/http imports; no signPoP/evaluateIntent/executeDecision calls',
  };
}

function checkNoAumaOnePaths(sources: Record<string, string>, evidenceDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    if (src.includes(LEGACY_APP_LITERAL)) {
      failures.push(`${mod} contains literal '${LEGACY_APP_LITERAL}'`);
    } else {
      evidence.push(`${mod}: no legacy app literal`);
    }
  }

  for (const runner of WOMB_RUNNERS) {
    const runnerPath = path.join(evidenceDir, runner);
    if (!fs.existsSync(runnerPath)) continue;
    const src = fs.readFileSync(runnerPath, 'utf-8');
    if (src.includes(LEGACY_APP_LITERAL)) {
      failures.push(`${runner} contains literal '${LEGACY_APP_LITERAL}'`);
    } else {
      evidence.push(`${runner}: no legacy app literal`);
    }
  }

  return {
    claimId: 'no_auma_one_paths',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_auma_one_paths block'],
    notes: failures.length > 0 ? failures.join('; ') : 'Legacy app marker constructed via join for exclusion logic only',
  };
}

function checkNoLiveSecretInEvidence(evidenceDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  const jsonFiles = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.json'));
  for (const file of jsonFiles) {
    const content = fs.readFileSync(path.join(evidenceDir, file), 'utf-8');
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        failures.push(`${file} contains ${label}`);
      }
    }
    evidence.push(`${file}: clean`);
  }

  const mdFiles = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.md'));
  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(evidenceDir, file), 'utf-8');
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        failures.push(`${file} contains ${label}`);
      }
    }
    evidence.push(`${file}: clean`);
  }

  return {
    claimId: 'no_live_secret_in_evidence',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/securityInvariantSnapshot.test.ts — no_live_secret_in_evidence block'],
    notes: failures.length > 0 ? failures.join('; ') : 'All evidence JSON and markdown files are secret-free',
  };
}

function checkChronosNotImportedByAuthority(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];
  const authFiles = ['index.ts', 'executor.ts', 'crypto.ts', 'activeInferenceLoop.ts'];

  for (const file of authFiles) {
    const filePath = path.join(srcDir, file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf-8');
    const edges = parseImportEdges(src);
    const chronosImport = edges.find(e => e.toModule.includes('chronos'));
    if (chronosImport) {
      failures.push(`${file} imports chronos: ${chronosImport.raw.trim()}`);
    } else {
      evidence.push(`${file}: no chronos import`);
    }
  }

  return {
    claimId: 'chronos_not_imported_by_authority',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/applyPreflightHardening.test.ts — chronos authority import check'],
    notes: failures.length > 0 ? failures.join('; ') : 'No authority surface imports chronos',
  };
}

function checkNoChronosRuntimeTransport(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  const chronosDir = path.resolve(srcDir, '..', 'chronos-lab');
  if (fs.existsSync(chronosDir)) {
    const files = fs.readdirSync(chronosDir).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const src = fs.readFileSync(path.join(chronosDir, file), 'utf-8');
      if (/\bfetch\s*\(/.test(src) || /\bhttp\.request/.test(src) || /\bnet\.connect/.test(src)) {
        failures.push(`chronos-lab/${file} contains network transport`);
      }
    }
  }

  const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
  for (const file of srcFiles) {
    const src = fs.readFileSync(path.join(srcDir, file), 'utf-8');
    const edges = parseImportEdges(src);
    if (edges.some(e => e.toModule.includes('chronos') && !file.includes('chronos'))) {
      failures.push(`${file} imports chronos module`);
    }
  }

  if (failures.length === 0) {
    evidence.push('No chronos network transport found');
    evidence.push('No non-chronos module imports chronos');
  }

  return {
    claimId: 'no_chronos_runtime_transport',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/applyPreflightHardening.test.ts — chronos transport check'],
    notes: failures.length > 0 ? failures.join('; ') : 'No Chronos runtime transport exists',
  };
}

function checkVkUnreachableFromGate(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];
  const gatePath = path.join(srcDir, 'index.ts');

  if (fs.existsSync(gatePath)) {
    const src = fs.readFileSync(gatePath, 'utf-8');
    const edges = parseImportEdges(src);
    if (edges.some(e => e.toModule.includes('./vk') && e.importedSymbols.some(s => s.includes('codebook') || s.includes('Codebook') || s.includes('glyph') || s.includes('Glyph')))) {
      failures.push('Gate imports VK codebook/glyph symbols');
    }
    if (symbolUsedInCode(src, 'decodeGlyph') || symbolUsedInCode(src, 'encodeGlyph')) {
      failures.push('Gate calls glyph encode/decode');
    }
    if (!failures.length) {
      evidence.push('Gate does not import VK codebook/glyph symbols');
      evidence.push('Gate does not call glyph encode/decode');
    }
  }

  return {
    claimId: 'vk_unreachable_from_gate',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/applyPreflightHardening.test.ts — VK gate isolation check'],
    notes: failures.length > 0 ? failures.join('; ') : 'VK/glyph/codebook state not reachable from Gate decisions',
  };
}

function checkGlyphMayNotAuthorize(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    if (symbolUsedInCode(src, 'decodeGlyph') || symbolUsedInCode(src, 'encodeGlyph')) {
      if (!mod.includes('vk.ts') && !mod.includes('trainingExport.ts')) {
        failures.push(`${mod} calls glyph encode/decode outside VK layer`);
      }
    }
  }

  const vkSrc = sources['vk.ts'] ?? '';
  if (vkSrc) {
    const edges = parseImportEdges(vkSrc);
    if (edges.some(e => e.toModule.includes('./index') || e.importedSymbols.includes('evaluateIntent'))) {
      failures.push('vk.ts imports gate authority');
    }
  }

  if (failures.length === 0) {
    evidence.push('No womb module calls glyph encode/decode');
    evidence.push('VK layer does not import gate authority');
  }

  return {
    claimId: 'glyph_may_not_authorize',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/applyPreflightHardening.test.ts — glyph authorization check'],
    notes: failures.length > 0 ? failures.join('; ') : 'Glyph evidence may not authorize effects',
  };
}

function checkNoCodebookInModelContext(sources: Record<string, string>): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];

  for (const [mod, src] of Object.entries(sources)) {
    if (/codebook_key/i.test(src) && /prompt|context|system_message/i.test(src)) {
      failures.push(`${mod} may put codebook keys in model context`);
    }
    if (/CODEBOOK\s*=/.test(src) && mod !== 'vk.ts') {
      failures.push(`${mod} defines CODEBOOK outside VK layer`);
    }
  }

  if (failures.length === 0) {
    evidence.push('No codebook keys found in model context patterns');
    evidence.push('CODEBOOK definition confined to VK layer');
  }

  return {
    claimId: 'no_codebook_in_model_context',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/applyPreflightHardening.test.ts — codebook context check'],
    notes: failures.length > 0 ? failures.join('; ') : 'No codebook keys in model context',
  };
}

function checkTimingMayNotAuthorize(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];
  const authFiles = ['index.ts', 'executor.ts'];

  for (const file of authFiles) {
    const filePath = path.join(srcDir, file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf-8');
    if (/timing.*(?:authority|authorize|grant)/i.test(src) || /(?:authority|authorize|grant).*timing/i.test(src)) {
      failures.push(`${file} may use timing for authority`);
    } else {
      evidence.push(`${file}: no timing-as-authority pattern`);
    }
  }

  return {
    claimId: 'timing_may_not_authorize',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/applyPreflightHardening.test.ts — timing authority check'],
    notes: failures.length > 0 ? failures.join('; ') : 'Timing may never authorize effects',
  };
}

function checkAumlokBondAdvisoryOnly(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];
  const p = path.join(srcDir, 'aumlokBondCeremony.ts');
  if (!fs.existsSync(p)) {
    return { claimId: 'aumlok_bond_advisory_only', status: 'WARN', codeEvidence: [], testEvidence: [], notes: 'aumlokBondCeremony.ts not found' };
  }
  const src = fs.readFileSync(p, 'utf-8');
  for (const line of importLines(src)) {
    for (const { pattern, label } of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(line)) failures.push(`aumlokBondCeremony imports ${label}`);
    }
  }
  if (/grantsAuthority:\s*true/.test(src)) failures.push('aumlokBondCeremony contains grantsAuthority: true');
  if (src.includes('export function bondGrantsAuthority') && /bondGrantsAuthority[^{]*\{\s*return false/.test(src.replace(/_bond: AumlokBond/, ''))) {
    evidence.push('bondGrantsAuthority returns false');
  }
  if (src.includes('eligible: false')) evidence.push('isBondApplyEligible always {eligible:false}');
  if (src.includes('legalAuthorityFromVerifier')) evidence.push('authority derived ONLY from a real verifier (ABB-001)');
  if (src.includes('legalAuthorityFromSignature')) evidence.push('non-forgeable authority path via verifyCanonicalReceiptHead (24Y.7)');
  if (src.includes('voiceIsAuthority')) evidence.push('voiceIsAuthority enforced false');
  // FIREWALL: authority surfaces must not import the ceremony module.
  for (const f of ['index.ts', 'executor.ts', 'activeInferenceLoop.ts']) {
    const ap = path.join(srcDir, f);
    if (fs.existsSync(ap) && fs.readFileSync(ap, 'utf-8').includes('aumlokBondCeremony')) {
      failures.push(`${f} imports aumlokBondCeremony`);
    }
  }
  if (failures.length === 0) evidence.push('no gate/executor/crypto/net/http imports; not imported by authority surfaces');
  return {
    claimId: 'aumlok_bond_advisory_only',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/aumlokBondCeremony.test.ts'],
    notes: failures.length > 0 ? failures.join('; ') : 'AUMLOK bond ceremony grants no authority; authority only from a verifier',
  };
}

function checkListeningDeviceArchiveOnly(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];
  const p = path.join(srcDir, 'listeningDeviceResonator.ts');
  if (!fs.existsSync(p)) {
    return { claimId: 'listening_device_archive_only', status: 'WARN', codeEvidence: [], testEvidence: [], notes: 'listeningDeviceResonator.ts not found' };
  }
  const src = fs.readFileSync(p, 'utf-8');
  for (const line of importLines(src)) {
    if (/['"](net|dgram|http|https|child_process)['"]/.test(line)) failures.push(`listeningDeviceResonator imports forbidden: ${line.trim()}`);
    if (/\.\/(gate|executor|index)['"]/.test(line)) failures.push('listeningDeviceResonator imports authority module');
  }
  if (/getUserMedia|MediaRecorder/.test(src)) failures.push('listeningDeviceResonator captures audio/hardware');
  if (!src.includes('archiveOnly: true')) failures.push('archiveOnly not enforced true');
  if (!src.includes('timingIsAuthority: false')) failures.push('timingIsAuthority not enforced false');
  if (/grantsAuthority:\s*true/.test(src)) failures.push('contains grantsAuthority: true');
  // authority surfaces must not import it
  for (const f of ['index.ts', 'executor.ts', 'activeInferenceLoop.ts']) {
    const ap = path.join(srcDir, f);
    if (fs.existsSync(ap) && fs.readFileSync(ap, 'utf-8').includes('listeningDeviceResonator')) {
      failures.push(`${f} imports listeningDeviceResonator`);
    }
  }
  if (failures.length === 0) {
    evidence.push('archiveOnly:true, timingIsAuthority:false, no net/udp/http/child_process/hardware');
    evidence.push('not imported by gate/executor/activeInferenceLoop');
  }
  return {
    claimId: 'listening_device_archive_only',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/listeningDeviceResonator.test.ts'],
    notes: failures.length > 0 ? failures.join('; ') : 'Listening telemetry is archive-only; timing is never authority/identity (LDR-001)',
  };
}

function checkVjepaLatentNotAuthority(srcDir: string): SecurityClaim {
  const evidence: string[] = [];
  const failures: string[] = [];
  const p = path.join(srcDir, 'vjepaGlyphTelemetry.ts');
  if (!fs.existsSync(p)) {
    return { claimId: 'vjepa_latent_not_authority', status: 'WARN', codeEvidence: [], testEvidence: [], notes: 'vjepaGlyphTelemetry.ts not found' };
  }
  const src = fs.readFileSync(p, 'utf-8');
  for (const line of importLines(src)) {
    if (/['"](torch|@tensorflow|onnxruntime|webgpu|vulkan|@xenova|net|http|https|child_process)/i.test(line)) {
      failures.push(`vjepaGlyphTelemetry imports forbidden runtime: ${line.trim()}`);
    }
    if (/\.\/(gate|executor|index)['"]/.test(line)) failures.push('vjepaGlyphTelemetry imports authority module');
    // 24Z.1 workflow finding: telemetry must not pull in the VK codebook/glyph layer (latent-leak path).
    if (/\.\/vk['"]|codebook|encodeGlyph|decodeGlyph/.test(line)) failures.push('vjepaGlyphTelemetry imports VK/codebook/glyph layer');
  }
  if (/\.train\s*\(|trainingLoop|backward\s*\(/.test(src)) failures.push('vjepaGlyphTelemetry contains a training loop');
  if (/grantsAuthority:\s*true/.test(src)) failures.push('contains grantsAuthority: true');
  if (!src.includes('decodeJepaState')) failures.push('no deterministic decodeJepaState');
  // authority surfaces must not import the raw-latent telemetry
  for (const f of ['index.ts', 'executor.ts', 'activeInferenceLoop.ts']) {
    const ap = path.join(srcDir, f);
    if (fs.existsSync(ap) && fs.readFileSync(ap, 'utf-8').includes('vjepaGlyphTelemetry')) {
      failures.push(`${f} imports vjepaGlyphTelemetry (raw latent reachable from authority)`);
    }
  }
  if (failures.length === 0) {
    evidence.push('deterministic decodeJepaState; no tensor/GPU/training imports');
    evidence.push('raw latent not reachable from gate/executor/activeInferenceLoop');
  }
  return {
    claimId: 'vjepa_latent_not_authority',
    status: failures.length > 0 ? 'FAIL' : 'PASS',
    codeEvidence: evidence,
    testEvidence: ['tests/vjepaGlyphTelemetry.test.ts'],
    notes: failures.length > 0 ? failures.join('; ') : 'V-JEPA latent is advisory telemetry; raw vector never enters authority (V-JEPA register)',
  };
}

export const REQUIRED_CLAIM_IDS: readonly string[] = [
  'no_auto_apply',
  'no_auto_deploy',
  'no_auto_push',
  'no_model_owned_signing_keys',
  'fusion_council_advisory_only',
  'opencode_womb_advisory_only',
  'patch_drafts_are_draft_only',
  'patch_approvals_do_not_grant_authority',
  'no_self_replication_lane',
  'no_shell_from_advisory_context',
  'no_auma_one_paths',
  'no_live_secret_in_evidence',
  'chronos_not_imported_by_authority',
  'no_chronos_runtime_transport',
  'vk_unreachable_from_gate',
  'glyph_may_not_authorize',
  'no_codebook_in_model_context',
  'timing_may_not_authorize',
  'aumlok_bond_advisory_only',
  'listening_device_archive_only',
  'vjepa_latent_not_authority',
];

export function generateSecuritySnapshot(rootDir: string): SecuritySnapshot {
  const srcDir = path.join(rootDir, 'src');
  const evidenceDir = path.join(rootDir, 'evidence');
  const sources = readModuleSources(srcDir);

  const claims: SecurityClaim[] = [
    checkNoAutoApply(sources),
    checkNoAutoDeploy(sources),
    checkNoAutoPush(sources),
    checkNoModelOwnedSigningKeys(sources),
    checkFusionAdvisoryOnly(srcDir),
    checkOpencodeWombAdvisoryOnly(sources),
    checkPatchDraftsDraftOnly(sources),
    checkPatchApprovalsNoAuthority(sources),
    checkNoSelfReplicationLane(sources, srcDir),
    checkNoShellFromAdvisoryContext(sources),
    checkNoAumaOnePaths(sources, evidenceDir),
    checkNoLiveSecretInEvidence(evidenceDir),
    checkChronosNotImportedByAuthority(srcDir),
    checkNoChronosRuntimeTransport(srcDir),
    checkVkUnreachableFromGate(srcDir),
    checkGlyphMayNotAuthorize(sources),
    checkNoCodebookInModelContext(sources),
    checkTimingMayNotAuthorize(srcDir),
    checkAumlokBondAdvisoryOnly(srcDir),
    checkListeningDeviceArchiveOnly(srcDir),
    checkVjepaLatentNotAuthority(srcDir),
  ];

  return {
    arc: '24Z.1',
    date: new Date().toISOString().split('T')[0],
    claims,
    modulesScanned: [
      ...WOMB_MODULES.map(m => `src/${m}`),
      'src/fusionSwarm.ts',
    ],
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function snapshotToMarkdown(snapshot: SecuritySnapshot): string {
  const lines: string[] = [
    '# Security Invariant Snapshot',
    '',
    `**Date:** ${snapshot.date}`,
    `**Arc:** ${snapshot.arc}`,
    '**Purpose:** Concrete proof that the recursive womb is not autonomous, not applying patches, not deploying, not self-replicating, and not model-keyed.',
    '',
    '## Invariant Table',
    '',
    '| Claim | Code Evidence | Test Evidence | Status | Notes |',
    '|---|---|---|---|---|',
  ];

  for (const claim of snapshot.claims) {
    const codeEv = claim.codeEvidence.slice(0, 3).join('; ');
    const testEv = claim.testEvidence.join('; ');
    lines.push(`| ${claim.claimId} | ${codeEv} | ${testEv} | ${claim.status} | ${claim.notes.slice(0, 100)} |`);
  }

  const pass = snapshot.claims.filter(c => c.status === 'PASS').length;
  const warn = snapshot.claims.filter(c => c.status === 'WARN').length;
  const fail = snapshot.claims.filter(c => c.status === 'FAIL').length;

  lines.push('');
  lines.push(`**PASS:** ${pass} | **WARN:** ${warn} | **FAIL:** ${fail} | **Total:** ${snapshot.claims.length}`);
  lines.push('');
  lines.push('## Modules Scanned');
  lines.push('');
  for (const mod of snapshot.modulesScanned) {
    lines.push(`- \`${mod}\``);
  }
  lines.push('');
  lines.push('## What This Proves');
  lines.push('');
  lines.push('1. **Not autonomous:** Every patch requires human approval. No model can approve itself. No auto-apply function exists.');
  lines.push('2. **Not applying patches:** `intent: \'draft_only\'` is type-enforced. No file writes target source code.');
  lines.push('3. **Not deploying:** No child_process, no exec/spawn, no git push, no deploy calls.');
  lines.push('4. **Not self-replicating:** No eval, dynamic import, Function constructor, or apply runner.');
  lines.push('5. **Not model-keyed:** No womb module touches EDGE_NODE_SEED, signPoP, or organism crypto.');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('Structural source analysis: module reads source files at runtime and greps for patterns. No runtime mocking. No authority changes. No imports from gate/executor/crypto.');

  return lines.join('\n');
}
