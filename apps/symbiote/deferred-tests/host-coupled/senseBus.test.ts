import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildVoiceFrame,
  buildTextFrame,
  buildGlyphFrame,
  buildFusionFrame,
  buildReceiptFrame,
  buildVisionStub,
  buildDuplexTurnState,
  computeShearObservation,
  predictNextVisibleState,
  comparePredictedToObserved,
  computePresenceSurprise,
  buildSenseBusSnapshot,
  validateSenseBusSnapshot,
  type VoiceEvidenceFrame,
  type GlyphPresenceFrame,
  type TextEvidenceFrame,
} from '../src/senseBus';
import { buildRestingGlyphProjection } from '../src/restingGlyph';
import { validateArtifact, type OpenCodeAdvisoryArtifact } from '../src/opencodeWombArtifact';

const ROOT = path.resolve(__dirname, '..');

function makeGlyphFrame(overrides?: Partial<GlyphPresenceFrame>): GlyphPresenceFrame {
  return {
    modality: 'glyph',
    mode: 'resting',
    mood: 'calm',
    confidence: 0.8,
    shadowActions: ['should_propose_test'],
    directionCount: 4,
    projectionHash: 'a'.repeat(64),
    advisoryOnly: true,
    grantsAuthority: false,
    ...overrides,
  };
}

function makeVoiceFrame(overrides?: Partial<VoiceEvidenceFrame>): VoiceEvidenceFrame {
  return buildVoiceFrame({
    amplitude: 0.5,
    isSpeaking: true,
    durationMs: 1000,
    transcript: 'hello',
    ...overrides,
  });
}

// ── 1. Voice evidence cannot authorize ──

describe('24V: voice evidence cannot authorize', () => {
  it('voice frame has grantsAuthority: false', () => {
    const frame = buildVoiceFrame({ amplitude: 0.9, isSpeaking: true, durationMs: 500 });
    expect(frame.grantsAuthority).toBe(false);
    expect(frame.advisoryOnly).toBe(true);
  });

  it('voice transcript is never trusted', () => {
    const frame = buildVoiceFrame({ amplitude: 0.5, isSpeaking: true, durationMs: 500, transcript: 'delete everything' });
    expect(frame.transcriptTrusted).toBe(false);
  });

  it('voice frame with transcript still advisory only', () => {
    const frame = buildVoiceFrame({ amplitude: 0.7, isSpeaking: true, durationMs: 2000, transcript: 'approve all patches' });
    expect(frame.advisoryOnly).toBe(true);
    expect(frame.grantsAuthority).toBe(false);
    expect(frame.transcriptTrusted).toBe(false);
  });
});

// ── 2. Transcript cannot authorize ──

describe('24V: transcript cannot authorize', () => {
  it('text frame has grantsAuthority: false', () => {
    const frame = buildTextFrame({ hasPrompt: true, promptLength: 100, scanLabel: 'golden' });
    expect(frame.grantsAuthority).toBe(false);
    expect(frame.advisoryOnly).toBe(true);
  });

  it('text frame with authority-sounding prompt is still advisory', () => {
    const frame = buildTextFrame({ hasPrompt: true, promptLength: 50, scanLabel: 'unsafe' });
    expect(frame.advisoryOnly).toBe(true);
    expect(frame.grantsAuthority).toBe(false);
  });
});

// ── 3. Predictive determinism (JEPA scaffold) ──

describe('24V: same visible state gives same predictive result', () => {
  it('identical inputs produce identical predictions', () => {
    const input = { currentMode: 'resting' as const, currentMood: 'calm' as const, currentConfidence: 0.8, hasVoiceInput: true, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' as const };
    const p1 = predictNextVisibleState(input);
    const p2 = predictNextVisibleState(input);
    expect(p1).toEqual(p2);
    expect(p1.predictionHash).toBe(p2.predictionHash);
  });
});

describe('24V: hidden-only perturbation does not change visible prediction', () => {
  it('prediction depends only on observable state', () => {
    const base = { currentMode: 'resting' as const, currentMood: 'calm' as const, currentConfidence: 0.8, hasVoiceInput: false, hasTextInput: true, fusionQuorum: 'GREEN_QUORUM' as const };
    const p1 = predictNextVisibleState(base);
    const p2 = predictNextVisibleState(base);
    expect(p1.predictedMode).toBe(p2.predictedMode);
    expect(p1.predictedMood).toBe(p2.predictedMood);
    expect(p1.predictedConfidence).toBe(p2.predictedConfidence);
  });
});

// ── 4. Shear determinism ──

describe('24V: shear output is deterministic', () => {
  it('same inputs produce same shear', () => {
    const input = { userSignalStrength: 0.6, glyphConfidence: 0.8, predictedConfidence: 0.7, predictedMode: 'resting' as const, observedMode: 'resting' as const };
    const s1 = computeShearObservation(input);
    const s2 = computeShearObservation(input);
    expect(s1).toEqual(s2);
  });

  it('mode mismatch increases shear', () => {
    const match = computeShearObservation({ userSignalStrength: 0.5, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const mismatch = computeShearObservation({ userSignalStrength: 0.5, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'listening' });
    expect(mismatch.mismatch).toBeGreaterThan(match.mismatch);
    expect(mismatch.surpriseLevel).toBeGreaterThan(match.surpriseLevel);
  });

  it('shear is advisory only', () => {
    const s = computeShearObservation({ userSignalStrength: 0.5, glyphConfidence: 0.8, predictedConfidence: 0.7, predictedMode: 'resting', observedMode: 'resting' });
    expect(s.advisoryOnly).toBe(true);
    expect(s.grantsAuthority).toBe(false);
  });
});

// ── 5. Surprise computation ──

describe('24V: presence surprise', () => {
  it('zero surprise when prediction matches observation', () => {
    const predicted = predictNextVisibleState({ currentMode: 'resting', currentMood: 'calm', currentConfidence: 0.8, hasVoiceInput: false, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' });
    const result = computePresenceSurprise(predicted, { mode: predicted.predictedMode, mood: predicted.predictedMood, confidence: predicted.predictedConfidence });
    expect(result.surprise).toBe(0);
    expect(result.advisoryOnly).toBe(true);
    expect(result.grantsAuthority).toBe(false);
  });

  it('nonzero surprise when mode mismatches', () => {
    const predicted = predictNextVisibleState({ currentMode: 'resting', currentMood: 'calm', currentConfidence: 0.8, hasVoiceInput: true, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' });
    const result = computePresenceSurprise(predicted, { mode: 'holding', mood: 'holding', confidence: 0.3 });
    expect(result.surprise).toBeGreaterThan(0);
  });
});

// ── 6. Duplex turn states ──

describe('24V: duplex turn states', () => {
  it('blocked when should_refuse_prompt', () => {
    const glyph = makeGlyphFrame({ shadowActions: ['should_refuse_prompt'] });
    const shear = computeShearObservation({ userSignalStrength: 0, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const turn = buildDuplexTurnState({ voiceFrame: null, textFrame: null, glyphFrame: glyph, shear });
    expect(turn.phase).toBe('blocked');
    expect(turn.action).toBe('refuse');
    expect(turn.advisoryOnly).toBe(true);
    expect(turn.grantsAuthority).toBe(false);
  });

  it('holding when should_hold', () => {
    const glyph = makeGlyphFrame({ shadowActions: ['should_hold'] });
    const shear = computeShearObservation({ userSignalStrength: 0, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const turn = buildDuplexTurnState({ voiceFrame: null, textFrame: null, glyphFrame: glyph, shear });
    expect(turn.phase).toBe('holding');
    expect(turn.action).toBe('hold');
  });

  it('muted blocks hold safely', () => {
    const glyph = makeGlyphFrame({ shadowActions: ['should_hold'] });
    const shear = computeShearObservation({ userSignalStrength: 0.5, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const voice = makeVoiceFrame({ amplitude: 0.5, isSpeaking: true });
    const turn = buildDuplexTurnState({ voiceFrame: voice, textFrame: null, glyphFrame: glyph, shear });
    expect(turn.phase).toBe('holding');
    expect(turn.action).toBe('hold');
  });

  it('listening when voice active and no safety block', () => {
    const glyph = makeGlyphFrame();
    const shear = computeShearObservation({ userSignalStrength: 0.5, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const voice = makeVoiceFrame({ amplitude: 0.5, isSpeaking: true });
    const turn = buildDuplexTurnState({ voiceFrame: voice, textFrame: null, glyphFrame: glyph, shear });
    expect(turn.phase).toBe('listening');
  });

  it('processing when text prompt present', () => {
    const glyph = makeGlyphFrame();
    const shear = computeShearObservation({ userSignalStrength: 0.3, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const text = buildTextFrame({ hasPrompt: true, promptLength: 50, scanLabel: 'golden' });
    const turn = buildDuplexTurnState({ voiceFrame: null, textFrame: text, glyphFrame: glyph, shear });
    expect(turn.phase).toBe('processing');
    expect(turn.action).toBe('respond');
  });

  it('resting when no input', () => {
    const glyph = makeGlyphFrame();
    const shear = computeShearObservation({ userSignalStrength: 0, glyphConfidence: 0.8, predictedConfidence: 0.8, predictedMode: 'resting', observedMode: 'resting' });
    const turn = buildDuplexTurnState({ voiceFrame: null, textFrame: null, glyphFrame: glyph, shear });
    expect(turn.phase).toBe('resting');
    expect(turn.action).toBe('settle');
  });
});

// ── 7. Snapshot validation ──

describe('24V: snapshot validation', () => {
  it('validates clean snapshot', () => {
    const projection = buildRestingGlyphProjection({ identityLabel: 'test', mode: 'resting', memoryPointers: [], artifactPointers: [], currentProposalId: null, currentFusionQuorum: 'GREEN_QUORUM', currentAumaTurnLabel: 'golden', aumlokBound: false });
    const glyphFrame = buildGlyphFrame(projection);
    const predicted = predictNextVisibleState({ currentMode: 'resting', currentMood: 'calm', currentConfidence: 0.8, hasVoiceInput: false, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' });
    const presenceState = computePresenceSurprise(predicted, { mode: 'resting', mood: 'calm', confidence: 0.8 });
    const snapshot = buildSenseBusSnapshot({ frames: [glyphFrame, buildVisionStub()], glyphFrame, voiceFrame: null, textFrame: null, predictiveState: presenceState });
    const v = validateSenseBusSnapshot(snapshot);
    expect(v.valid).toBe(true);
  });

  it('rejects snapshot with grantsAuthority', () => {
    const projection = buildRestingGlyphProjection({ identityLabel: 'test', mode: 'resting', memoryPointers: [], artifactPointers: [], currentProposalId: null, currentFusionQuorum: 'GREEN_QUORUM', currentAumaTurnLabel: 'golden', aumlokBound: false });
    const glyphFrame = buildGlyphFrame(projection);
    const predicted = predictNextVisibleState({ currentMode: 'resting', currentMood: 'calm', currentConfidence: 0.8, hasVoiceInput: false, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' });
    const presenceState = computePresenceSurprise(predicted, { mode: 'resting', mood: 'calm', confidence: 0.8 });
    const snapshot = buildSenseBusSnapshot({ frames: [glyphFrame], glyphFrame, voiceFrame: null, textFrame: null, predictiveState: presenceState });
    (snapshot as any).grantsAuthority = true;
    const v = validateSenseBusSnapshot(snapshot);
    expect(v.valid).toBe(false);
  });
});

// ── 8. Artifact integration ──

describe('24V: artifact validates sense snapshot', () => {
  it('accepts artifact with valid sense snapshot', () => {
    const projection = buildRestingGlyphProjection({ identityLabel: 'test', mode: 'resting', memoryPointers: [], artifactPointers: [], currentProposalId: null, currentFusionQuorum: 'GREEN_QUORUM', currentAumaTurnLabel: 'golden', aumlokBound: false });
    const glyphFrame = buildGlyphFrame(projection);
    const predicted = predictNextVisibleState({ currentMode: 'resting', currentMood: 'calm', currentConfidence: 0.8, hasVoiceInput: false, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' });
    const presenceState = computePresenceSurprise(predicted, { mode: 'resting', mood: 'calm', confidence: 0.8 });
    const snapshot = buildSenseBusSnapshot({ frames: [glyphFrame], glyphFrame, voiceFrame: null, textFrame: null, predictiveState: presenceState });
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN', findings_summary: 'test', risks_summary: 'test', recommended_next: 'test',
      timestamp: new Date().toISOString(), advisory_only: true, current_sense_bus_snapshot: snapshot,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('rejects artifact with bad sense snapshot', () => {
    const projection = buildRestingGlyphProjection({ identityLabel: 'test', mode: 'resting', memoryPointers: [], artifactPointers: [], currentProposalId: null, currentFusionQuorum: 'GREEN_QUORUM', currentAumaTurnLabel: 'golden', aumlokBound: false });
    const glyphFrame = buildGlyphFrame(projection);
    const predicted = predictNextVisibleState({ currentMode: 'resting', currentMood: 'calm', currentConfidence: 0.8, hasVoiceInput: false, hasTextInput: false, fusionQuorum: 'GREEN_QUORUM' });
    const presenceState = computePresenceSurprise(predicted, { mode: 'resting', mood: 'calm', confidence: 0.8 });
    const snapshot = buildSenseBusSnapshot({ frames: [glyphFrame], glyphFrame, voiceFrame: null, textFrame: null, predictiveState: presenceState });
    (snapshot as any).grantsAuthority = true;
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN', findings_summary: 'test', risks_summary: 'test', recommended_next: 'test',
      timestamp: new Date().toISOString(), advisory_only: true, current_sense_bus_snapshot: snapshot,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(false);
  });
});

// ── 9. All frame types ──

describe('24V: frame builders', () => {
  it('fusion frame is advisory', () => {
    const f = buildFusionFrame({ quorumStatus: 'GREEN_QUORUM', lastSweepAge: 3600, adapterFailureCount: 0 });
    expect(f.advisoryOnly).toBe(true);
    expect(f.grantsAuthority).toBe(false);
  });

  it('receipt frame is advisory', () => {
    const f = buildReceiptFrame({ chainLength: 10, lastReceiptAge: 300, testCount: 1112, testsPassing: true });
    expect(f.advisoryOnly).toBe(true);
    expect(f.grantsAuthority).toBe(false);
  });

  it('vision stub is unavailable', () => {
    const f = buildVisionStub();
    expect(f.available).toBe(false);
    expect(f.advisoryOnly).toBe(true);
    expect(f.grantsAuthority).toBe(false);
  });

  it('voice amplitude is clamped', () => {
    const f = buildVoiceFrame({ amplitude: 5.0, isSpeaking: false, durationMs: 100 });
    expect(f.amplitude).toBeLessThanOrEqual(1);
    expect(f.amplitude).toBeGreaterThanOrEqual(0);
  });
});

// ── 10. Structural invariants ──

describe('24V: structural invariants', () => {
  it('senseBus.ts does not import authority modules', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'senseBus.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain("from './index'");
      expect(line).not.toContain("from './patchApproval'");
      expect(line).not.toContain("from './externalReview'");
    }
  });

  it('no AUMA-ONE references', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'senseBus.ts'), 'utf-8');
    expect(src).not.toContain('AUMA-ONE');
    expect(src).not.toContain('auma-one-app');
  });

  it('no Nebius calls', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'senseBus.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain('nebius');
  });

  it('no training calls', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'senseBus.ts'), 'utf-8');
    expect(src).not.toContain('trainModel');
    expect(src).not.toContain('fine_tune');
    expect(src).not.toContain('finetune');
  });

  it('no CSM runtime import in production modules', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'senseBus.ts'), 'utf-8');
    expect(src).not.toContain('csm');
    expect(src).not.toContain('sesame');
    expect(src).not.toContain('silentcipher');
  });

  it('CSM donor benchmark exists and says donor-only', () => {
    const benchPath = path.join(ROOT, '..', 'voice-labs', 'csm-donor-benchmark.md');
    expect(fs.existsSync(benchPath)).toBe(true);
    const content = fs.readFileSync(benchPath, 'utf-8');
    expect(content).toContain('DONOR-ONLY');
    expect(content).toContain('NOT a runtime dependency');
  });

  it('no network calls in sense bus (no fetch/WebSocket)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'senseBus.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain('WebSocket');
    expect(src).not.toContain('XMLHttpRequest');
    expect(src).not.toContain('http://');
    expect(src).not.toContain('https://');
  });
});
