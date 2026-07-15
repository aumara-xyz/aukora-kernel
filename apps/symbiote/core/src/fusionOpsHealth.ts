import * as fs from 'fs';
import * as path from 'path';
import { resolveApiKey, PRIME_MODELS } from './fusionConfig';
import type { OpenCodeAdvisoryArtifact } from './opencodeWombArtifact';

export interface FusionOpsHealthReport {
  keySource: string | null;
  enabledModels: string[];
  adapterFailureRate: number | null;
  latestFusionArtifactPath: string | null;
  pendingRetryPacks: number;
  canRunLive: boolean;
  blockers: string[];
  advisoryOnly: true;
  grantsAuthority: false;
}

export function checkFusionOpsHealth(rootDir?: string): FusionOpsHealthReport {
  const root = rootDir ?? path.resolve(__dirname, '..');
  const evidenceDir = path.join(root, 'evidence');
  const artifactPath = path.join(evidenceDir, 'opencode-womb-advisory.json');
  const blockers: string[] = [];

  const keyResult = resolveApiKey();
  const keySource = keyResult ? keyResult.source : null;
  if (!keySource) blockers.push('no API key found (checked process.env.OPENROUTER_API_KEY, .env, FUSION_ENV_FILE)');

  let adapterFailureRate: number | null = null;
  let pendingRetryPacks = 0;
  let latestFusionArtifactPath: string | null = null;

  if (fs.existsSync(artifactPath)) {
    latestFusionArtifactPath = artifactPath;
    try {
      const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as OpenCodeAdvisoryArtifact;
      if (raw.current_fractal_fusion_sweep) {
        const sweep = raw.current_fractal_fusion_sweep;
        const totalShards = sweep.shardSummaries?.length ?? 0;
        const totalModels = PRIME_MODELS.length;
        const expectedCalls = totalShards * totalModels;
        if (typeof sweep.adapterFailureCount === 'number' && expectedCalls > 0) {
          adapterFailureRate = sweep.adapterFailureCount / expectedCalls;
        }
      }
    } catch {
      blockers.push(`failed to parse artifact at ${artifactPath}`);
    }
  } else {
    blockers.push(`womb artifact not found at ${artifactPath}`);
  }

  if (adapterFailureRate !== null && adapterFailureRate > 0.5) {
    blockers.push(`high adapter failure rate: ${(adapterFailureRate * 100).toFixed(0)}%`);
  }

  return {
    keySource,
    enabledModels: [...PRIME_MODELS],
    adapterFailureRate,
    latestFusionArtifactPath,
    pendingRetryPacks,
    canRunLive: blockers.length === 0,
    blockers,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}
