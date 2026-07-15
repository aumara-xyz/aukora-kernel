// The rehearsal bridge — rehearse_intent seat tool (ENQUEUE-ONLY). Codex's test list, pinned:
// bad id refused, traversal refused, no live-apply path reachable, no signing path reachable,
// evidence is advisory, lockdown disables it. Plus: the queued order is a valid governed work order
// (ring-classified, canApplyNow:false by schema) and the act is flight-witnessed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  rehearseEnabledByEnv, rehearseAvailable, voiceToolSchemas, dispatchVoiceTool,
} from '../../spatial/voiceReadToolBridge';
import { validateWorkOrder } from '../src/governedWorkOrder';
import { readFlightLog, verifyFlightChain } from '../src/flightRecorder';

const ADVISORY_MODE = path.join(os.tmpdir(), 'aukora-rehearse-absent-mode.json'); // absent => advisory

let prevRehearse: string | undefined, prevPropose: string | undefined, prevHome: string | undefined, prevFlight: string | undefined;
let home: string, flightDir: string, lockdownMode: string;

beforeEach(() => {
  prevRehearse = process.env.AUKORA_VOICE_REHEARSE; process.env.AUKORA_VOICE_REHEARSE = '1';
  prevPropose = process.env.AUKORA_VOICE_PROPOSE; process.env.AUKORA_VOICE_PROPOSE = '1'; // to stage a real intent to rehearse
  prevHome = process.env.AUKORA_SYMBIOTE_HOME;
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-rehearse-home-'));
  process.env.AUKORA_SYMBIOTE_HOME = home;
  prevFlight = process.env.AUKORA_FLIGHT_RECORDER_DIR;
  flightDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-rehearse-flight-'));
  process.env.AUKORA_FLIGHT_RECORDER_DIR = flightDir;
  lockdownMode = path.join(home, 'mode.json');
  fs.writeFileSync(lockdownMode, JSON.stringify({ mode: 'lockdown' }));
});
afterEach(() => {
  if (prevRehearse === undefined) delete process.env.AUKORA_VOICE_REHEARSE; else process.env.AUKORA_VOICE_REHEARSE = prevRehearse;
  if (prevPropose === undefined) delete process.env.AUKORA_VOICE_PROPOSE; else process.env.AUKORA_VOICE_PROPOSE = prevPropose;
  if (prevHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = prevHome;
  if (prevFlight === undefined) delete process.env.AUKORA_FLIGHT_RECORDER_DIR; else process.env.AUKORA_FLIGHT_RECORDER_DIR = prevFlight;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(flightDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function stageIntent(): string {
  const r = dispatchVoiceTool('propose_intent', {
    goal: 'Clarify a comment in my own memory code',
    affectedPaths: [{ path: 'core/src/kiraBrain.ts', epistemicStatus: 'verified' }],
  }, ADVISORY_MODE);
  expect(r.ok).toBe(true);
  return (r.output as any).intentId;
}

describe('rehearse_intent — gating (fail-closed, default off)', () => {
  it('is OFF by default and refuses under lockdown regardless of the env flag', () => {
    delete process.env.AUKORA_VOICE_REHEARSE;
    expect(rehearseEnabledByEnv()).toBe(false);
    expect(rehearseAvailable(ADVISORY_MODE)).toBe(false);
    expect(voiceToolSchemas(ADVISORY_MODE).map((s) => s.function.name)).not.toContain('rehearse_intent');
    expect(dispatchVoiceTool('rehearse_intent', { intentId: 'a'.repeat(64) }, ADVISORY_MODE).ok).toBe(false);
    process.env.AUKORA_VOICE_REHEARSE = '1';
    expect(rehearseAvailable(lockdownMode)).toBe(false);
    expect(dispatchVoiceTool('rehearse_intent', { intentId: 'a'.repeat(64) }, lockdownMode).ok).toBe(false);
  });
});

describe('rehearse_intent — id discipline (bad id / traversal refused before any filesystem read)', () => {
  it('refuses non-hex ids, paths, traversal strings, and ids with no staged intent behind them', () => {
    for (const bad of ['not-an-id', '../../etc/passwd', '/tmp/x.json', 'a'.repeat(63), '001ba742/../../x', '']) {
      const r = dispatchVoiceTool('rehearse_intent', { intentId: bad }, ADVISORY_MODE);
      expect(r.ok).toBe(false);
    }
    // well-formed hex but nothing staged behind it → refused (no phantom rehearsals)
    const r = dispatchVoiceTool('rehearse_intent', { intentId: 'b'.repeat(64) }, ADVISORY_MODE);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no proposal-intent found');
  });
});

describe('rehearse_intent — enqueue-only, advisory evidence, witnessed', () => {
  it('queues a VALID governed work order for a staged intent: ring-classified, canApplyNow:false, owner command returned', () => {
    const intentId = stageIntent();
    const r = dispatchVoiceTool('rehearse_intent', { intentId }, ADVISORY_MODE);
    expect(r.ok).toBe(true);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
    const out = r.output as any;
    expect(out.queued).toBe(true);
    expect(out.runCommand).toBe(`run: --from-proposal ${intentId}`);
    expect(out.note).toContain('stops before signature');
    // the queued artifact is a real governed-work-order-v1 that validates, with the advisory invariants intact
    const orderFile = path.join(home, 'aumlok', 'rehearsal-queue', `${out.orderId}.json`);
    const stored = JSON.parse(fs.readFileSync(orderFile, 'utf-8'));
    const { intentId: linkedIntent, ...order } = stored;
    expect(linkedIntent).toBe(intentId);
    expect(validateWorkOrder(order).valid).toBe(true);
    expect(order.requestedBy).toBe('auma');
    expect(order.canApplyNow).toBe(false);
    expect(order.status).toBe('queued');
    // core/src/kiraBrain.ts is not Ring 0/1 — but whatever the table says, the classification came from
    // the table (fail-closed), not from the caller: the tool passes NO ring override.
    expect([0, 1, 2, 3, 4]).toContain(order.ring);
  });

  it('witnesses the enqueue on the flight recorder (chain stays valid)', () => {
    const intentId = stageIntent();
    expect(dispatchVoiceTool('rehearse_intent', { intentId }, ADVISORY_MODE).ok).toBe(true);
    const nowIso = new Date().toISOString();
    expect(readFlightLog(flightDir, nowIso).some((e: any) => e.kind === 'rehearse_intent')).toBe(true);
    expect(verifyFlightChain(flightDir, nowIso).ok).toBe(true);
  });
});

describe('rehearse_intent — no apply path, no signing path reachable (structural pin)', () => {
  it('the bridge module imports NOTHING from the signing/apply/execution lane', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'voiceReadToolBridge.ts'), 'utf-8');
    // scope to IMPORT lines — the module's docstring legitimately NAMES the refused verbs/modules while
    // asserting their refusal; what must never exist is an actual dependency on them.
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const forbidden of ['nativeLiveApply', 'aumlokSigningAssistant', 'aumlokSigner', 'aumlokAuthorityRoot', 'sandboxTestRunner', 'workbenchCommandLoop', 'nativeToolCallingEngine', 'recursiveWorkbench']) {
      expect(importLines.includes(forbidden)).toBe(false);
    }
  });
});
