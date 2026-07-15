// #178 round 5 — the game's eyes at the gate. When MK·PULSE drafts a work-order
// intent, it also writes a structured game receipt; the signing assistant fuses
// that receipt into its view, display-only, so a pulse work order shows exactly
// what the game saw. These pins hold the receipt module and the fused view.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildArc3GameReceipt, writeArc3GameReceipt, readArc3GameReceipt, validateArc3GameReceipt, arc3GameReceiptsDir } from '../src/arc3GameReceipt';
import { maybeDraftPulseWorkOrder } from '../../spatial/arc3-workorder';
import { buildAumlokAssistantView } from '../src/aumlokSigningAssistant';
import { buildProposalIntent, writeProposalIntent } from '../src/proposalIntent';

const homes: string[] = [];
function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'arc3-gate-home-'));
  homes.push(h);
  return h;
}
afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); });

const RID = 'a'.repeat(64);

describe('the game receipt sidecar', () => {
  it('builds, writes, and reads back a valid receipt; absence and tamper stay distinct', () => {
    const home = tmpHome();
    expect(readArc3GameReceipt(RID, home)).toEqual({ state: 'none' }); // absent → none
    const r = buildArc3GameReceipt({ intentId: RID, door: 'chat-door', url: 'http://127.0.0.1:7091/', guid: 'run-1', level: 1, probes: 3 });
    expect(validateArc3GameReceipt(r).valid).toBe(true);
    const w = writeArc3GameReceipt(r, home);
    expect(w.ok).toBe(true);
    const back = readArc3GameReceipt(RID, home);
    expect(back.state).toBe('present');
    if (back.state === 'present') { expect(back.receipt.door).toBe('chat-door'); expect(back.receipt.probes).toBe(3); }
    // tamper: corrupt the file → refused, never silently absent
    fs.writeFileSync(path.join(arc3GameReceiptsDir(home), `${RID}.json`), '{ not json');
    expect(readArc3GameReceipt(RID, home).state).toBe('refused');
  });

  it('rejects a receipt whose intentId does not match its filename (no smuggling)', () => {
    const home = tmpHome();
    const r = buildArc3GameReceipt({ intentId: RID, door: 'd', url: 'u', guid: 'g', level: 1, probes: 1 });
    fs.mkdirSync(arc3GameReceiptsDir(home), { recursive: true });
    fs.writeFileSync(path.join(arc3GameReceiptsDir(home), `${'b'.repeat(64)}.json`), JSON.stringify(r));
    expect(readArc3GameReceipt('b'.repeat(64), home).state).toBe('refused');
  });
});

describe('drafting a work order writes the receipt beside the intent', () => {
  it('a drafted pulse finding leaves a readable receipt keyed by intentId', () => {
    const home = tmpHome();
    const res = maybeDraftPulseWorkOrder(
      { surface: { name: 'chat-door', url: 'http://127.0.0.1:7091/' }, guid: 'run-77', level: 1, probes: 4 },
      { enabled: true, homeDir: home },
    );
    expect(res.drafted).toBe(true);
    if (!res.drafted) return;
    const rc = readArc3GameReceipt(res.intentId, home);
    expect(rc.state).toBe('present');
    if (rc.state === 'present') {
      expect(rc.receipt.door).toBe('chat-door');
      expect(rc.receipt.guid).toBe('run-77');
      expect(rc.receipt.probes).toBe(4);
    }
  });
});

describe('the signing assistant fuses the game finding, display-only', () => {
  it('surfaces arc3 intents in gameFindings with the receipt present', () => {
    const home = tmpHome();
    maybeDraftPulseWorkOrder(
      { surface: { name: 'chat-door', url: 'http://127.0.0.1:7091/' }, guid: 'run-9', level: 1, probes: 2 },
      { enabled: true, homeDir: home },
    );
    const view = buildAumlokAssistantView({ homeDir: home });
    expect(view.gameFindings.length).toBe(1);
    const f = view.gameFindings[0];
    expect(f.advisoryOnly).toBe(true);
    expect(f.grantsAuthority).toBe(false);
    expect(f.goal).toContain('chat-door');
    expect(f.receipt.state).toBe('present');
    if (f.receipt.state === 'present') { expect(f.receipt.door).toBe('chat-door'); expect(f.receipt.guid).toBe('run-9'); }
  });

  it('a non-arc3 intent never appears in gameFindings (scoped to the game)', () => {
    const home = tmpHome();
    const intent = buildProposalIntent({ goal: 'a voice idea', affectedPaths: [{ path: 'x', epistemicStatus: 'inferred' }], authoredBy: 'voice' });
    writeProposalIntent(intent, home);
    const view = buildAumlokAssistantView({ homeDir: home });
    expect(view.gameFindings.length).toBe(0);
  });

  it('an arc3 intent with no receipt sidecar degrades to honest absence, not an error', () => {
    const home = tmpHome();
    const intent = buildProposalIntent({ goal: "restart the 'brain' door", affectedPaths: [{ path: 'scripts/brain-setup.ts', epistemicStatus: 'inferred' }], authoredBy: 'arc3' });
    writeProposalIntent(intent, home); // intent only, no receipt written
    const view = buildAumlokAssistantView({ homeDir: home });
    expect(view.gameFindings.length).toBe(1);
    expect(view.gameFindings[0].receipt.state).toBe('none');
  });

  it('the fused finding is never an authority input — advisoryOnly holds across the whole view', () => {
    const home = tmpHome();
    maybeDraftPulseWorkOrder(
      { surface: { name: 'arc-door', url: 'http://127.0.0.1:7093/arc3/status' }, guid: 'r', level: 2, probes: 5 },
      { enabled: true, homeDir: home },
    );
    const view = buildAumlokAssistantView({ homeDir: home });
    expect(view.advisoryOnly).toBe(true);
    expect(view.grantsAuthority).toBe(false);
    for (const f of view.gameFindings) { expect(f.advisoryOnly).toBe(true); expect(f.grantsAuthority).toBe(false); }
  });
});
