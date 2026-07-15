// Issue #34/Round 6: opt-in raw Fusion Council reply capture — off by default, zero effect on a normal
// run; only writes when AUKORA_FUSION_CAPTURE=1, and even then never throws into the caller.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { captureRawFusionReply } from '../src/fusionCaptureLog';

let testHome: string;
let prevHome: string | undefined;
let prevCapture: string | undefined;
beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-fusion-capture-'));
  prevHome = process.env.AUKORA_SYMBIOTE_HOME;
  process.env.AUKORA_SYMBIOTE_HOME = testHome;
  prevCapture = process.env.AUKORA_FUSION_CAPTURE;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = prevHome;
  if (prevCapture === undefined) delete process.env.AUKORA_FUSION_CAPTURE; else process.env.AUKORA_FUSION_CAPTURE = prevCapture;
  fs.rmSync(testHome, { recursive: true, force: true });
});

describe('fusionCaptureLog: opt-in only, off by default', () => {
  it('writes nothing when AUKORA_FUSION_CAPTURE is unset', () => {
    delete process.env.AUKORA_FUSION_CAPTURE;
    captureRawFusionReply('org/model', 'STANCE:⊕ ...');
    expect(fs.existsSync(path.join(testHome, 'fusion-captures'))).toBe(false);
  });

  it('writes nothing when AUKORA_FUSION_CAPTURE is set to anything other than the literal "1"', () => {
    process.env.AUKORA_FUSION_CAPTURE = 'true';
    captureRawFusionReply('org/model', 'STANCE:⊕ ...');
    expect(fs.existsSync(path.join(testHome, 'fusion-captures'))).toBe(false);
  });

  it('persists the raw reply VERBATIM under fusion-captures/<timestamp>-<sanitized-slug>.txt when enabled', () => {
    process.env.AUKORA_FUSION_CAPTURE = '1';
    const raw = 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.2,exploit=0.3,verify=0.4,abstain=0.1) HYP:"real captured reply"';
    captureRawFusionReply('deepseek/deepseek-v4-pro', raw, '2026-07-02T10:00:00.000Z');

    const dir = path.join(testHome, 'fusion-captures');
    const written = fs.readdirSync(dir);
    expect(written.length).toBe(1);
    expect(written[0]).toBe('2026-07-02T10-00-00-000Z-deepseek_deepseek-v4-pro.txt');
    expect(fs.readFileSync(path.join(dir, written[0]), 'utf-8')).toBe(raw); // byte-identical, never reformatted
  });

  it('a slug with path-hostile characters (../../etc/passwd) never traverses outside fusion-captures/', () => {
    process.env.AUKORA_FUSION_CAPTURE = '1';
    captureRawFusionReply('../../etc/passwd', 'x');
    const dir = path.join(testHome, 'fusion-captures');
    // The safety property: every '/' is replaced, so the sanitized slug can never be interpreted as a
    // path segment boundary — '..' surviving as mere CHARACTERS inside one filename (never as an actual
    // path segment, since there's no '/' left) does not traverse. Confirmed two ways: no slash in the
    // written filename, AND the file landed exactly one level under dir (readdirSync would not see it
    // otherwise — a real traversal would have escaped this directory entirely).
    const written = fs.readdirSync(dir);
    expect(written.length).toBe(1);
    expect(written[0]).not.toContain('/');
    expect(path.dirname(fs.realpathSync(path.join(dir, written[0])))).toBe(fs.realpathSync(dir));
  });

  it('a disk-write failure never throws into the caller — best-effort, advisory only', () => {
    process.env.AUKORA_FUSION_CAPTURE = '1';
    // Force the fusion-captures dir itself to collide with an existing FILE, so mkdirSync throws inside.
    fs.writeFileSync(path.join(testHome, 'fusion-captures'), 'not a directory');
    expect(() => captureRawFusionReply('org/model', 'x')).not.toThrow();
  });
});
