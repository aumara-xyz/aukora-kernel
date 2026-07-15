// R5-accelerator — the propose_intent seat tool: the ONE authoring capability Auma gains, and it gains
// her HANDS (draft a proposal-intent), never AUTHORITY (nothing writes the repo, signs, or applies).
// These tests pin: fail-closed gating (default off + lockdown), advisory-only persistence to the
// owner-readable pending-intents dir, bounded/validated inputs, and — the load-bearing property — the
// tool CANNOT write into the repo or grant authority no matter what the model sends.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  proposeEnabledByEnv, proposeAvailable, voiceToolSchemas, dispatchVoiceTool,
} from '../../spatial/voiceReadToolBridge';
import { readProposalIntentById } from '../src/proposalIntent';
import { readFlightLog, verifyFlightChain } from '../src/flightRecorder';

const ADVISORY_MODE = path.join(os.tmpdir(), 'aukora-propose-absent-mode.json'); // absent => 'advisory'
// A lockdown mode file: capabilityMode.ts reads 'lockdown' from it, which must disable the tool.
let lockdownMode: string;

let prevPropose: string | undefined;
let prevHome: string | undefined;
let prevFlight: string | undefined;
let home: string;
let flightDir: string;

beforeEach(() => {
  prevPropose = process.env.AUKORA_VOICE_PROPOSE; process.env.AUKORA_VOICE_PROPOSE = '1';
  // pending-intents live under $AUKORA_SYMBIOTE_HOME/aumlok/pending-intents — isolate it to a temp home.
  prevHome = process.env.AUKORA_SYMBIOTE_HOME;
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-propose-home-'));
  process.env.AUKORA_SYMBIOTE_HOME = home;
  prevFlight = process.env.AUKORA_FLIGHT_RECORDER_DIR;
  flightDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-propose-flight-'));
  process.env.AUKORA_FLIGHT_RECORDER_DIR = flightDir;
  lockdownMode = path.join(home, 'mode.json');
  fs.writeFileSync(lockdownMode, JSON.stringify({ mode: 'lockdown' }));
});
afterEach(() => {
  if (prevPropose === undefined) delete process.env.AUKORA_VOICE_PROPOSE; else process.env.AUKORA_VOICE_PROPOSE = prevPropose;
  if (prevHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = prevHome;
  if (prevFlight === undefined) delete process.env.AUKORA_FLIGHT_RECORDER_DIR; else process.env.AUKORA_FLIGHT_RECORDER_DIR = prevFlight;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(flightDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const validArgs = () => ({
  goal: 'Add a one-line comment to core/src/kiraBrain.ts explaining the GENESIS constant',
  rationale: 'A future reader asked what genesis means on the receipt chain',
  affectedPaths: [{ path: 'core/src/kiraBrain.ts', epistemicStatus: 'verified', note: 'I read this file' }],
  riskNotes: 'Comment-only, no behavior change',
});

describe('propose_intent seat tool — gating (fail-closed, default off)', () => {
  it('is OFF by default (env unset) even in advisory mode', () => {
    delete process.env.AUKORA_VOICE_PROPOSE;
    expect(proposeEnabledByEnv()).toBe(false);
    expect(proposeAvailable(ADVISORY_MODE)).toBe(false);
    expect(voiceToolSchemas(ADVISORY_MODE).map((s) => s.function.name)).not.toContain('propose_intent');
    // and the dispatch refuses even if called directly with the env off
    delete process.env.AUKORA_VOICE_PROPOSE;
    expect(dispatchVoiceTool('propose_intent', validArgs(), ADVISORY_MODE).ok).toBe(false);
  });

  it('appears in the offered schema ONLY when its own env gate is on', () => {
    expect(proposeAvailable(ADVISORY_MODE)).toBe(true);
    expect(voiceToolSchemas(ADVISORY_MODE).map((s) => s.function.name)).toContain('propose_intent');
  });

  it('lockdown disables it regardless of the env flag', () => {
    expect(process.env.AUKORA_VOICE_PROPOSE).toBe('1');
    expect(proposeAvailable(lockdownMode)).toBe(false);
    expect(dispatchVoiceTool('propose_intent', validArgs(), lockdownMode).ok).toBe(false);
  });
});

describe('propose_intent seat tool — advisory persistence, no authority, no repo write', () => {
  it('stages a valid, re-readable intent OUTSIDE the repo and returns the next-step, never authority', () => {
    const r = dispatchVoiceTool('propose_intent', validArgs(), ADVISORY_MODE);
    expect(r.ok).toBe(true);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
    const out = r.output as any;
    expect(out.staged).toBe(true);
    expect(out.authoredBy).toBe('voice');
    expect(out.intentId).toMatch(/^[0-9a-f]{64}$/);
    expect(out.nextStep).toContain(`--from-proposal ${out.intentId}`);
    // the intent is persisted under the temp HOME (outside the repo) and validates on read-back
    const back = readProposalIntentById(out.intentId);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.intent.authoredBy).toBe('voice');
      expect(back.intent.advisoryOnly).toBe(true);
      expect(back.intent.grantsAuthority).toBe(false);
      expect(back.intent.affectedPaths[0].path).toBe('core/src/kiraBrain.ts');
    }
    // it lives under HOME/aumlok/pending-intents, NOT anywhere in the repo
    const staged = path.join(home, 'aumlok', 'pending-intents', `${out.intentId}.json`);
    expect(fs.existsSync(staged)).toBe(true);
  });

  it('witnesses the staging on the flight recorder (hash chain stays valid)', () => {
    const r = dispatchVoiceTool('propose_intent', validArgs(), ADVISORY_MODE);
    expect(r.ok).toBe(true);
    const nowIso = new Date().toISOString();
    const log = readFlightLog(flightDir, nowIso);
    expect(log.some((e: any) => e.kind === 'propose_intent')).toBe(true);
    expect(verifyFlightChain(flightDir, nowIso).ok).toBe(true);
  });
});

describe('propose_intent seat tool — bounded + fail-closed inputs', () => {
  it('refuses an empty goal, empty paths, absolute/traversal paths, and bad epistemic labels', () => {
    expect(dispatchVoiceTool('propose_intent', { ...validArgs(), goal: '' }, ADVISORY_MODE).ok).toBe(false);
    expect(dispatchVoiceTool('propose_intent', { ...validArgs(), affectedPaths: [] }, ADVISORY_MODE).ok).toBe(false);
    expect(dispatchVoiceTool('propose_intent', { goal: 'x', affectedPaths: [{ path: '/etc/passwd', epistemicStatus: 'verified' }] }, ADVISORY_MODE).ok).toBe(false);
    expect(dispatchVoiceTool('propose_intent', { goal: 'x', affectedPaths: [{ path: '../secret', epistemicStatus: 'verified' }] }, ADVISORY_MODE).ok).toBe(false);
    expect(dispatchVoiceTool('propose_intent', { goal: 'x', affectedPaths: [{ path: 'a.ts', epistemicStatus: 'totally-sure' }] }, ADVISORY_MODE).ok).toBe(false);
  });

  it('a hostile-length goal is bounded, not rejected outright, and still stages a valid intent', () => {
    const r = dispatchVoiceTool('propose_intent', { ...validArgs(), goal: 'x'.repeat(10_000) }, ADVISORY_MODE);
    expect(r.ok).toBe(true);
    const back = readProposalIntentById((r.output as any).intentId);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.intent.goal.length).toBeLessThanOrEqual(2_000);
  });
});

// ── Brick 2.2 seat plumbing (found live 2026-07-08): she declared a lineage her tool couldn't store —
// the first chained revision arrived on disk with NO supersedes. These pin that her hands can now
// declare a chain, that a malformed link REFUSES (never silently drops), and that fresh drafts are
// unchanged.
describe('propose_intent supersedes plumbing (Brick 2.2)', () => {
  it('a declared lineage link is stored on the intent and validates', () => {
    const first = dispatchVoiceTool('propose_intent', validArgs(), ADVISORY_MODE);
    expect(first.ok).toBe(true);
    const firstId = (first.output as any).intentId as string;
    const rev = dispatchVoiceTool('propose_intent', { ...validArgs(), goal: 'attempt 2 — smaller', supersedes: firstId }, ADVISORY_MODE);
    expect(rev.ok).toBe(true);
    const revId = (rev.output as any).intentId as string;
    const read = readProposalIntentById(revId);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.intent.supersedes).toBe(firstId);
  });

  it('a malformed supersedes REFUSES the stage — a dropped link is a silently reset ladder', () => {
    const r = dispatchVoiceTool('propose_intent', { ...validArgs(), supersedes: 'a60dec3a…' }, ADVISORY_MODE);
    expect(r.ok).toBe(false);
    expect(String((r as any).reason)).toContain('supersedes');
  });

  it('omitted / empty supersedes stages a fresh draft with no lineage key', () => {
    const r = dispatchVoiceTool('propose_intent', { ...validArgs(), supersedes: '' }, ADVISORY_MODE);
    expect(r.ok).toBe(true);
    const read = readProposalIntentById((r.output as any).intentId);
    expect(read.ok && !('supersedes' in read.intent)).toBe(true);
  });
});
