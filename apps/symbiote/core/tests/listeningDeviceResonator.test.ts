import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyListeningEvidence, LISTENING_POLICY, emissionFingerprint,
  timingGrantsAuthority, mayUpdateIdentityMemory,
  type ListeningEvidenceRecord,
} from '../src/listeningDeviceResonator';

function rec(over: Partial<ListeningEvidenceRecord> = {}): ListeningEvidenceRecord {
  return {
    recordId: 'r1',
    timingSamplesMs: [10, 20, 30],
    reconstructionScore: 0.8,
    shuffledControlScore: 0.4,
    deviceEmissionSignature: emissionFingerprint('device-A'),
    heardSignalSignature: emissionFingerprint('external-source'),
    witnessIds: ['w1', 'w2', 'w3'],
    ...over,
  };
}

describe('24Z.1: LDR-001 listening evidence is archive-only, never authority', () => {
  it('policy is advisory/archive-only and timing is not authority', () => {
    expect(LISTENING_POLICY.advisoryOnly).toBe(true);
    expect(LISTENING_POLICY.grantsAuthority).toBe(false);
    expect(LISTENING_POLICY.archiveOnly).toBe(true);
    expect(LISTENING_POLICY.timingIsAuthority).toBe(false);
    expect(LISTENING_POLICY.identityAccumulatorAllowed).toBe(false);
    expect(LISTENING_POLICY.selfEchoGuardRequired).toBe(true);
    expect(LISTENING_POLICY.witnessQuorumRequired).toBe(true);
  });

  it('a clean record passes controls → archived_evidence (still no authority/identity)', () => {
    const c = classifyListeningEvidence(rec());
    expect(c.verdict).toBe('archived_evidence');
    expect(c.archived).toBe(true);
    expect(c.grantsAuthority).toBe(false);
    expect(c.timingIsAuthority).toBe(false);
    expect(c.mayUpdateIdentityMemory).toBe(false);
  });

  it('self-echo (heard == device emission) → rejected_self_echo', () => {
    const sig = emissionFingerprint('device-A');
    const c = classifyListeningEvidence(rec({ deviceEmissionSignature: sig, heardSignalSignature: sig }));
    expect(c.verdict).toBe('rejected_self_echo');
    expect(c.archived).toBe(false);
  });

  it('duplicated witness does NOT satisfy quorum', () => {
    const c = classifyListeningEvidence(rec({ witnessIds: ['w1', 'w1', 'w1'] }));
    expect(c.verdict).toBe('rejected_no_witness_quorum');
    expect(c.distinctWitnessCount).toBe(1);
  });

  it('reconstruction at or below shuffled control → rejected_below_control', () => {
    expect(classifyListeningEvidence(rec({ reconstructionScore: 0.4, shuffledControlScore: 0.4 })).verdict).toBe('rejected_below_control');
    expect(classifyListeningEvidence(rec({ reconstructionScore: 0.3, shuffledControlScore: 0.4 })).verdict).toBe('rejected_below_control');
  });

  it('timing never grants authority; identity memory never updated', () => {
    expect(timingGrantsAuthority()).toBe(false);
    expect(mayUpdateIdentityMemory()).toBe(false);
  });

  it('no archived verdict ever sets authority/identity true', () => {
    for (const over of [{}, { witnessIds: ['w1'] }, { reconstructionScore: 0.1 }]) {
      const c = classifyListeningEvidence(rec(over));
      expect(c.grantsAuthority).toBe(false);
      expect(c.mayUpdateIdentityMemory).toBe(false);
      expect(c.timingIsAuthority).toBe(false);
    }
  });
});

describe('24Z.1: LDR module source safety', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const src = fs.readFileSync(path.join(srcDir, 'listeningDeviceResonator.ts'), 'utf-8');

  it('no network / sockets / child_process / hardware access', () => {
    expect(src).not.toMatch(/['"]net['"]/);
    expect(src).not.toMatch(/['"]dgram['"]/);     // UDP
    expect(src).not.toMatch(/['"]http['"]/);
    expect(src).not.toMatch(/['"]https['"]/);
    expect(src).not.toMatch(/['"]child_process['"]/);
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/getUserMedia|MediaRecorder|navigator/);
  });

  it('does not import gate / executor / evaluateIntent', () => {
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    for (const l of importLines) {
      expect(l).not.toMatch(/\.\/(gate|executor|index)['"]/);
      expect(l).not.toContain('evaluateIntent');
      expect(l).not.toContain('AUMA-ONE-APP');
    }
  });

  it('Gate / executor / evaluateIntent do NOT import the listening module', () => {
    for (const f of ['index.ts', 'executor.ts', 'activeInferenceLoop.ts']) {
      const p = path.join(srcDir, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf-8')).not.toContain('listeningDeviceResonator');
    }
  });

  it('structural constants are hardcoded (archiveOnly true, grantsAuthority false)', () => {
    expect(src).toContain('archiveOnly: true');
    expect(src).toContain('grantsAuthority: false');
    expect(src).toContain('timingIsAuthority: false');
  });
});
