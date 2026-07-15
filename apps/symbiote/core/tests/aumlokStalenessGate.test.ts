// RAIL: staleness-guard — proposals are bound to the base content/time they were drafted against;
// applying/approving a stale proposal must REFUSE. The pure layer (stalenessCore.test.ts) and the
// pure reconstruct engines (proposalDiffReconstruct/unifiedDiff/editBlocks tests) are already pinned.
// This file pins the WIRING that was unpinned — the seams where deleting one line today breaks no test
// but silently reopens the ce0e07f-era stale-batch-approve rewind:
//   1. buildAumlokAssistantView projects the REAL stalenessVerdict onto every pending proposal
//      (aumlokSigningAssistant.ts:271 for valid artifacts, :255 flagged unknown-age for unreadable ones);
//   2. the approve door's /api/challenge routes that verdict through challengeStalenessGate with a
//      STRICT-boolean revive and refuses 409 'proposal_stale' (spatial/aumlok-approve-serve.ts:163-164 —
//      pinned structurally; the door calls Bun.serve at module top-level so it must never be imported);
//   3. propose_patch refuses a stale diff/edits form at DRAFT time via reconstructProposalFiles —
//      exact-match against the current disk bytes, wired at nativeToolCallingEngine.ts:287;
//   4. approveAndApplyProposal refuses when the disposition journal cannot be trusted, and a
//      rejected-but-unarchived artifact stays off every approval surface (no resurrection).
// Hermetic: temp homeDirs/repoRoots only; never touches ~/.aukora-symbiote, keys, or live services.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAumlokAssistantView } from '../src/aumlokSigningAssistant';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact } from '../src/selfEditProposalArtifact';
import { challengeStalenessGate, DEFAULT_DRAFT_HORIZON_MS } from '../src/stalenessCore';
import { approveAndApplyProposal } from '../src/aumlokApproveCeremony';
import { recordRejectedDisposition } from '../src/proposalDispositionWrite';
import { proposalDispositionJournalPath } from '../src/proposalDispositionRead';
import { runNativeAgent } from '../src/nativeToolCallingEngine';

const T0 = '2026-07-01T00:00:00.000Z';
const isoAfter = (baseIso: string, ms: number) => new Date(Date.parse(baseIso) + ms).toISOString();
const HOUR = 3_600_000;

let home: string;
let repo: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-stale-home-'));
  repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-stale-repo-'));
});
afterEach(() => {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/** Stage a REAL artifact (built by the real builder, stamped by the real stamper) in the temp home. */
function stageProposal(goal: string, createdAt: string, relPath = 'docs/staleness-pin.md'): string {
  const artifact = buildSelfEditProposalArtifact(goal, [{ relPath, content: 'hello\n' }], createdAt);
  writeSelfEditProposalArtifact(artifact, home);
  return artifact.proposalHash;
}
const view = (nowIso: string) => buildAumlokAssistantView({ homeDir: home, repoRoot: repo }, nowIso);

// ─── 1. the view projection the door consumes (aumlokSigningAssistant.ts:271 / :255) ──────────────

describe('the pending view carries the REAL staleness verdict — the door gates on prop.staleness, never recomputes', () => {
  it('a draft inside its stamped 72h horizon reads fresh / not flagged', () => {
    const hash = stageProposal('fresh draft', T0);
    const p = view(isoAfter(T0, 1 * HOUR)).pending.find((x) => x.proposalHash === hash);
    expect(p).toBeDefined();
    expect(p!.staleness.state).toBe('fresh');
    expect(p!.staleness.flagged).toBe(false);
    expect(p!.staleness.horizon).toBe('stamped'); // the artifact's OWN stamp, not a view-side default
  });

  it('a draft past its stamped expiresBy reads stale + flagged, with its age on the read', () => {
    const hash = stageProposal('stale draft', T0);
    const p = view(isoAfter(T0, DEFAULT_DRAFT_HORIZON_MS + HOUR)).pending.find((x) => x.proposalHash === hash);
    expect(p).toBeDefined();
    expect(p!.staleness.state).toBe('stale');
    expect(p!.staleness.flagged).toBe(true);
    expect(p!.staleness.ageLabel).toMatch(/old/); // age printed on every read — never hidden
  });

  it('an unreadable artifact projects the flagged unknown-age verdict — waking confidently wrong is worse than waking cold', () => {
    const junkHash = 'e'.repeat(64);
    fs.mkdirSync(path.join(home, 'aumlok', 'pending-proposals'), { recursive: true });
    fs.writeFileSync(path.join(home, 'aumlok', 'pending-proposals', `${junkHash}.json`), 'THIS IS NOT JSON');
    const p = view(T0).pending.find((x) => x.proposalHash === junkHash);
    expect(p).toBeDefined(); // FLAGGED, never hidden — the broken artifact is listed, not dropped
    expect(p!.valid).toBe(false);
    expect(p!.staleness.state).toBe('stale');
    expect(p!.staleness.flagged).toBe(true);
    expect(p!.staleness.horizon).toBe('unknown-age');
    expect(p!.staleness.ageLabel).toBe('age unknown');
  });
});

// ─── 2. gate composition — exactly the door's marshaling, end-to-end from the on-disk artifact ─────

describe('gate composition: a stale on-disk draft cannot mint a challenge without the owner\'s explicit revive', () => {
  it('the projected verdict of an EXPIRED artifact refuses the mint: {allow:false, reason:proposal_stale}', () => {
    const hash = stageProposal('expired', T0);
    const p = view(isoAfter(T0, DEFAULT_DRAFT_HORIZON_MS + HOUR)).pending.find((x) => x.proposalHash === hash)!;
    const decision = challengeStalenessGate(p.staleness, false); // door line 163 with revive absent
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toBe('proposal_stale');
  });

  it('the SAME expired artifact mints with reviveRequested=true — and the decision says revived', () => {
    const hash = stageProposal('expired-but-revived', T0);
    const p = view(isoAfter(T0, DEFAULT_DRAFT_HORIZON_MS + HOUR)).pending.find((x) => x.proposalHash === hash)!;
    const decision = challengeStalenessGate(p.staleness, true);
    expect(decision.allow).toBe(true);
    if (decision.allow) expect(decision.revived).toBe(true);
  });

  it('a FRESH artifact passes without any revive gesture', () => {
    const hash = stageProposal('fresh', T0);
    const p = view(isoAfter(T0, 1 * HOUR)).pending.find((x) => x.proposalHash === hash)!;
    const decision = challengeStalenessGate(p.staleness, false);
    expect(decision.allow).toBe(true);
    if (decision.allow) expect(decision.revived).toBe(false);
  });

  it('an UNREADABLE artifact\'s projected verdict refuses the mint like a stale one', () => {
    const junkHash = 'f'.repeat(64);
    fs.mkdirSync(path.join(home, 'aumlok', 'pending-proposals'), { recursive: true });
    fs.writeFileSync(path.join(home, 'aumlok', 'pending-proposals', `${junkHash}.json`), '{"schema":"nope"}');
    const p = view(T0).pending.find((x) => x.proposalHash === junkHash)!;
    const decision = challengeStalenessGate(p.staleness, false);
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toBe('proposal_stale');
  });
});

// ─── 3. STRUCTURAL door pins — the door starts Bun.serve on import, so pin its SOURCE (the
//        aumlokCanonicalCeremony.test.ts pattern) ─────────────────────────────────────────────────

describe('STRUCTURAL: /api/challenge mints nothing for a stale draft without an explicit strict-boolean revive', () => {
  const doorPath = path.join(__dirname, '..', '..', 'spatial', 'aumlok-approve-serve.ts');
  const door = fs.readFileSync(doorPath, 'utf-8');

  it('imports the ONE gate implementation from stalenessCore (never a local reimplementation)', () => {
    expect(door).toContain("import { challengeStalenessGate } from '../core/src/stalenessCore';");
  });

  it('gates the mint on the VIEW\'s verdict with a strict-boolean revive: challengeStalenessGate(prop.staleness, body.revive === true)', () => {
    // The `=== true` is load-bearing: truthy marshaling (revive: "false", revive: 1) must NOT revive.
    expect(door).toContain('challengeStalenessGate(prop.staleness, body.revive === true)');
  });

  it('a disallowed decision refuses HTTP 409 proposal_stale carrying the full verdict (flagged, never hidden)', () => {
    expect(door).toContain("if (!decision.allow) return json({ ok: false, reason: 'proposal_stale', staleness: decision.verdict }, 409);");
  });

  it('route order inside /api/challenge: valid-pending precheck, THEN the staleness gate, THEN mintChallenge', () => {
    const start = door.indexOf("'/api/challenge'");
    const end = door.indexOf("'/api/approve'");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const route = door.slice(start, end);
    const precheck = route.indexOf('x.valid');
    const gateCall = route.indexOf('challengeStalenessGate(');
    const mint = route.indexOf('mintChallenge(');
    expect(precheck).toBeGreaterThan(-1);
    expect(gateCall).toBeGreaterThan(precheck); // gate consumes the view's verdict, after the precheck
    expect(mint).toBeGreaterThan(gateCall);     // nothing mints before the gate has allowed it
  });

  it('the approve page keeps the file-shrink banner and the required removal ack (the ONLY shrink enforcement)', () => {
    // The historical stale whole-file batch-approve rewound files; this banner + ack is what stands
    // between a one-click approve and that rewind (server-side shrink enforcement does not exist).
    expect(door).toContain('This REMOVES lines from a file that already exists');
    expect(door).toContain('the shape of a stale proposal rewinding it');
    expect(door).toContain('I read the diff and I mean to remove');
    expect(door).toContain('ask.disabled=!ack.checked');
  });

  it('the approve page\'s stale-draft branch shows the age and requires a SECOND explicit Revive gesture', () => {
    expect(door).toContain('cr.reason==="proposal_stale"');
    expect(door).toContain('STALE DRAFT');
    expect(door).toContain('Revive & continue');
    expect(door).toContain('revive:true'); // the revive rides the SAME request, as an explicit field
  });
});

// ─── 4. propose_patch draft-time content-staleness wiring (nativeToolCallingEngine.ts:287) ────────
// The pure reconstruct module is pinned elsewhere; THIS pins that the engine actually calls it and
// refuses a stale diff back to the model instead of letting raw stale bytes become the candidate.
// Reads against the real repo are READ-ONLY by construction (reconstruct never writes; propose_patch
// classifies + hashes only, writes nothing).

describe('propose_patch refuses a stale diff at draft time — exact-match reconstruction is load-bearing, not decorative', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function scriptedFetch(turns: Array<{ tool_calls?: Array<{ name: string; args: object }>; content?: string | null }>) {
    let call = 0;
    return vi.fn(async () => {
      const turn = turns[Math.min(call, turns.length - 1)];
      call++;
      const message: any = { content: turn.content ?? null };
      if (turn.tool_calls) {
        message.tool_calls = turn.tool_calls.map((tc, i) => ({
          id: `call_${call}_${i}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    });
  }

  // A diff whose context claims a base line the file NEVER had — the exact signature of a draft
  // authored against yesterday's bytes. core/fixtures/data.txt is the committed non-secret anchor.
  const STALE_DIFF = '@@ -1,1 +1,1 @@\n-THIS LINE WAS NEVER IN THE FILE (stale draft base)\n+patched first line\n';

  it('a stale unified diff is refused as "diff reconstruction refused" and never becomes the candidate', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'stale diff', files: [{ relPath: 'core/fixtures/data.txt', diff: STALE_DIFF }] } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'recovered', files: [{ relPath: 'docs/AGENT_STALENESS_PIN.md', content: 'ok\n' }] } }] },
    ]) as any;

    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    const staleCall = result.toolCalls[0];
    expect(staleCall.tool).toBe('propose_patch');
    expect(staleCall.ok).toBe(false);
    expect(staleCall.reason).toMatch(/diff reconstruction refused/);
    expect(staleCall.reason).toMatch(/does not apply cleanly/);
    // The loop did NOT stop on the stale round — the model was told and recovered on round 2.
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(result.candidateFiles).not.toBeNull();
    expect(result.candidateFiles!.length).toBe(1);
    expect(result.candidateFiles![0].relPath).toBe('docs/AGENT_STALENESS_PIN.md'); // never the stale target
  });

  it('a stale edits form (find snippet not on disk) is refused the same way', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'stale edits', files: [{ relPath: 'core/fixtures/data.txt', edits: [{ find: 'THIS SNIPPET NEVER EXISTED ON DISK', replace: 'x' }] }] } }] },
      { content: 'giving up' }, // after the refusal the model halts — the refusal must be the recorded reason
    ]) as any;

    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    const staleCall = result.toolCalls[0];
    expect(staleCall.ok).toBe(false);
    expect(staleCall.reason).toMatch(/diff reconstruction refused/);
    expect(staleCall.reason).toMatch(/do not apply cleanly/);
    expect(result.candidateFiles).toBeNull(); // nothing stale ever became a candidate
  });
});

// ─── 5. approve-time journal trust + no-resurrection (aumlokApproveCeremony.ts:84-87,
//        aumlokSigningAssistant.ts:246) ───────────────────────────────────────────────────────────
// These refusals all short-circuit BEFORE any key read or live apply (the ceremony checks the journal
// at :84-85 and terminal dispositions at :86-87 before touching authority-ed25519.*; no key exists in
// these temp homes at all), so no write can ever be reached from here.

describe('approve refuses on an untrustworthy disposition journal — no resurrection through journal corruption', () => {
  it('a journal that is a DIRECTORY refuses with "cannot trust proposal disposition journal"', () => {
    const hash = stageProposal('journal-dir', T0);
    fs.mkdirSync(proposalDispositionJournalPath(home), { recursive: true }); // the journal path is a dir
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cannot trust proposal disposition journal/);
  });

  it('a journal past the 1MB cap refuses the approve the same way', () => {
    const hash = stageProposal('journal-oversized', T0);
    fs.mkdirSync(path.dirname(proposalDispositionJournalPath(home)), { recursive: true });
    fs.writeFileSync(proposalDispositionJournalPath(home), 'x'.repeat(1_000_001));
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cannot trust proposal disposition journal/);
  });

  it('an untrusted journal never HIDES the artifact from the view — display stays honest, the ceremony refuses', () => {
    const hash = stageProposal('journal-dir-still-listed', T0);
    fs.mkdirSync(proposalDispositionJournalPath(home), { recursive: true });
    const hashes = view(isoAfter(T0, 1 * HOUR)).pending.map((p) => p.proposalHash);
    expect(hashes).toContain(hash); // FLAGGED/refused, never silently dropped
  });
});

describe('a rejected proposal whose archive move was interrupted stays off every approval surface', () => {
  it('the rejected-but-unarchived artifact is suppressed from view.pending; an unrelated one stays listed', () => {
    const rejectedHash = stageProposal('owner already refused this', T0, 'docs/rejected-one.md');
    const liveHash = stageProposal('still genuinely pending', T0, 'docs/live-one.md');
    expect(recordRejectedDisposition({ proposalHash: rejectedHash, decidedAt: isoAfter(T0, HOUR) }, home).ok).toBe(true);
    // simulate the interrupted archive move: the artifact file is STILL in pending-proposals/
    expect(fs.existsSync(path.join(home, 'aumlok', 'pending-proposals', `${rejectedHash}.json`))).toBe(true);

    const hashes = view(isoAfter(T0, 2 * HOUR)).pending.map((p) => p.proposalHash);
    expect(hashes).not.toContain(rejectedHash); // never re-offered — /api/challenge's precheck can't find it
    expect(hashes).toContain(liveHash);         // the filter is targeted, not a blanket drop
  });

  it('the approve ceremony independently refuses the rejected proposal (defense in depth behind the view filter)', () => {
    const hash = stageProposal('rejected then re-approved?', T0);
    expect(recordRejectedDisposition({ proposalHash: hash, decidedAt: isoAfter(T0, HOUR) }, home).ok).toBe(true);
    const r = approveAndApplyProposal(hash, 'nonce', { homeDir: home });
    expect(r).toEqual({ ok: false, reason: 'proposal already has terminal disposition: rejected' });
  });
});
