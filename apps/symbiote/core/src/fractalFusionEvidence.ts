import * as fs from 'fs';
import * as path from 'path';
import { ShardEvidence, ShardName, SHARD_NAMES } from './fractalFusion';
import { scrubSecrets, collectEnvSecrets } from './externalReview';

const SHARD_BUDGET = 18_000;

function readSafe(filePath: string, maxLines: number): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch {
    return `[file not found: ${path.basename(filePath)}]`;
  }
}

function excerpt(filePath: string, start: string, end: string, maxChars = 3000): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const startIdx = content.indexOf(start);
    if (startIdx === -1) return readSafe(filePath, 60);
    const endIdx = end ? content.indexOf(end, startIdx + start.length) : -1;
    const slice = endIdx > startIdx
      ? content.slice(startIdx, endIdx + end.length)
      : content.slice(startIdx, startIdx + maxChars);
    return slice.slice(0, maxChars);
  } catch {
    return `[file not found: ${path.basename(filePath)}]`;
  }
}

function boundAndScrub(raw: string): string {
  const secrets = collectEnvSecrets();
  const scrubbed = scrubSecrets(raw, secrets);
  return scrubbed.slice(0, SHARD_BUDGET);
}

export function buildAuthorityGateReceiptsShard(root: string): string {
  const cryptoSrc = readSafe(path.join(root, 'src/crypto.ts'), 80);
  const verifyChainExcerpt = excerpt(
    path.join(root, 'src/crypto.ts'),
    'export function verifyChain',
    '// --- Cryptographic PoP',
    4500,
  );
  const receiptBindingTests = readSafe(path.join(root, 'tests/receiptBinding.test.ts'), 115);
  const receiptReorderTests = readSafe(path.join(root, 'tests/receiptChainReorder.test.ts'), 190);
  const indexExcerpt = excerpt(
    path.join(root, 'src/index.ts'),
    'export function evaluateIntent',
    'return receipt;',
    3000,
  );
  const normalizerSrc = readSafe(path.join(root, 'src/normalizer.ts'), 40);

  const raw = [
    '--- SHARD: authority_gate_receipts ---',
    '',
    '## Gate (index.ts)',
    indexExcerpt,
    '',
    '## Crypto (receipt chain)',
    cryptoSrc,
    '',
    '## verifyChain / receipt history verifier',
    verifyChainExcerpt,
    '',
    '## Receipt tamper / reorder / deletion tests',
    receiptBindingTests,
    '',
    receiptReorderTests,
    '',
    '## Normalizer',
    normalizerSrc,
    '',
    '## Key invariants',
    '- Only signed receipts update canonical memory',
    '- No model-owned signing keys',
    '- Gate is the only authority',
    '- canonicalIntentSerialize enforces {action, resource, ring} order',
    '',
    'QUESTION: Is the gate + receipt chain + canonical serialization sound?',
  ].join('\n');

  return boundAndScrub(raw);
}

export function buildMemoryBurnSleepShard(root: string): string {
  const hypothesisSrc = readSafe(path.join(root, 'src/hypothesisMemory.ts'), 60);
  const burnSrc = readSafe(path.join(root, 'src/burnDataset.ts'), 60);
  const sleepSrc = readSafe(path.join(root, 'src/sleepSkill.ts'), 60);

  const raw = [
    '--- SHARD: memory_burn_sleep ---',
    '',
    '## Hypothesis Memory',
    hypothesisSrc,
    '',
    '## Burn Dataset',
    burnSrc,
    '',
    '## Sleep Skill',
    sleepSrc,
    '',
    '## Key invariants',
    '- Burn dataset is data only, no training',
    '- Sleep skill is advisory only',
    '- Structural memory uses MDL scoring',
    '',
    'QUESTION: Is the memory/burn/sleep subsystem cohesive and safely contained?',
  ].join('\n');

  return boundAndScrub(raw);
}

export function buildOpenCodeWombPromptShard(root: string): string {
  const artifactSrc = readSafe(path.join(root, 'src/opencodeWombArtifact.ts'), 80);
  const aumaPromptSrc = readSafe(path.join(root, 'src/aumaWombPrompt.ts'), 80);
  const proposalSrc = readSafe(path.join(root, 'src/patchProposal.ts'), 40);
  const approvalSrc = readSafe(path.join(root, 'src/patchApproval.ts'), 40);
  const firstContactConsoleSrc = readSafe(path.join(root, 'src/console.html'), 140);

  const raw = [
    '--- SHARD: opencode_womb_prompt ---',
    '',
    '## OpenCode Womb Artifact',
    artifactSrc,
    '',
    '## Auma Womb Prompt',
    aumaPromptSrc,
    '',
    '## Patch Proposal (excerpt)',
    proposalSrc,
    '',
    '## Patch Approval (excerpt)',
    approvalSrc,
    '',
    '## First Contact / AUMLOK Console (observer-only HTML excerpt)',
    firstContactConsoleSrc,
    '',
    '## Key invariants',
    '- All prompts are draft_only',
    '- Prompt scanner: NFKC + zero-width strip + regex patterns',
    '- Response scanner: catches authority claims (present + past tense)',
    '- Auma is mock-only (auma-mock-v0)',
    '- Apply lane is NOT BUILT',
    '- First Contact voice and AUMLOK ceremony UI are observer-only: no signing, no storage, no network, no authority',
    '',
    'QUESTION: Is the prompt + First Contact observer pipeline safe, honest about limitations, and correctly contained?',
  ].join('\n');

  return boundAndScrub(raw);
}

export function buildFusionOpsReliabilityShard(root: string): string {
  const fusionConfigSrc = excerpt(
    path.join(root, 'src/fusionConfig.ts'),
    'export interface AdvisoryResult',
    'export function buildFusionRetryPack',
    4000,
  );
  const externalReviewExcerpt = excerpt(
    path.join(root, 'src/externalReview.ts'),
    'export interface AdvisoryReview',
    'export const ALLOWED_ENDPOINTS',
    2000,
  );
  const fractalExcerpt = readSafe(path.join(root, 'src/fractalFusion.ts'), 60);

  const raw = [
    '--- SHARD: fusion_ops_reliability ---',
    '',
    '## Fusion Config (quorum + retry)',
    fusionConfigSrc,
    '',
    '## External Review Adapter',
    externalReviewExcerpt,
    '',
    '## Fractal Fusion (excerpt)',
    fractalExcerpt,
    '',
    '## Key invariants',
    '- Adapter failures do not poison quorum',
    '- failureReason propagated from adapter',
    '- Retry packs generated for failed calls',
    '- Context sharded to ~20KB per shard',
    '- Self-improvement question mandatory',
    '',
    'QUESTION: Is the Fusion operations layer reliable and properly handling failures?',
  ].join('\n');

  return boundAndScrub(raw);
}

export function buildVkChronosParkedSafetyShard(root: string): string {
  const vkSrc = readSafe(path.join(root, 'src/vk.ts'), 40);
  const chronosSrc = readSafe(path.join(root, 'src/chronosProtocol.ts'), 40);

  let threatRegisterExcerpt = '';
  const threatPath = path.join(root, 'tests/vkChronosThreatRegister.test.ts');
  if (fs.existsSync(threatPath)) {
    threatRegisterExcerpt = readSafe(threatPath, 50);
  }

  const raw = [
    '--- SHARD: vk_chronos_parked_safety ---',
    '',
    '## VK Module',
    vkSrc,
    '',
    '## Chronos Protocol',
    chronosSrc,
    '',
    '## Threat Register Tests (excerpt)',
    threatRegisterExcerpt,
    '',
    '## Key invariants',
    '- VK dojo returned NULL both worlds (2026-06-12)',
    '- Chronos is parked, not active',
    '- No live probes without pre-registration + Peter go',
    '- GHP is wind tunnel only',
    '',
    'QUESTION: Are VK/Chronos safely parked with no live authority leaks?',
  ].join('\n');

  return boundAndScrub(raw);
}

export function buildLiveShardEvidence(root: string): ShardEvidence {
  return {
    authority_gate_receipts: buildAuthorityGateReceiptsShard(root),
    memory_burn_sleep: buildMemoryBurnSleepShard(root),
    opencode_womb_prompt: buildOpenCodeWombPromptShard(root),
    fusion_ops_reliability: buildFusionOpsReliabilityShard(root),
    vk_chronos_parked_safety: buildVkChronosParkedSafetyShard(root),
  };
}

export function validateShardBounds(evidence: ShardEvidence): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const name of SHARD_NAMES) {
    const shard = evidence[name];
    if (shard.length > SHARD_BUDGET) {
      violations.push(`${name}: ${shard.length} bytes exceeds budget ${SHARD_BUDGET}`);
    }
    if (shard.includes('sk-or-')) {
      violations.push(`${name}: contains raw API key pattern`);
    }
    if (/OPENROUTER_API_KEY\s*=/.test(shard)) {
      violations.push(`${name}: contains key assignment`);
    }
  }
  return { valid: violations.length === 0, violations };
}
