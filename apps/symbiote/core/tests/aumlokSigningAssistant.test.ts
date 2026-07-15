// Issues #81 + #91: AUMLOK in-app signing ASSISTANT — observer/helper only. It explains status +
// proposals + safety + exact terminal commands, and it can NEVER sign, apply, or read the private key.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAumlokAssistantView, shellQuote } from '../src/aumlokSigningAssistant';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact } from '../src/selfEditProposalArtifact';

const NOW = '2026-07-03T00:00:00.000Z';
let home: string;
let repo: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-assist-home-'));
  repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-assist-repo-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

function writeRepoFile(rel: string, lines: number) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
}
function writeProposal(goal: string, files: { relPath: string; content: string }[]) {
  return writeSelfEditProposalArtifact(buildSelfEditProposalArtifact(goal, files, NOW), home);
}
const view = () => buildAumlokAssistantView({ homeDir: home, repoRoot: repo }, NOW);

describe('#81/#91 assistant — AUMLOK status is honest', () => {
  it('with no key generated: keygenNeeded, keygen command shown, live promotion locked', () => {
    const v = view();
    expect(v.schema).toBe('aumlok-signing-assistant-v1');
    expect(v.status.keyPresent).toBe(false);
    expect(v.keygenNeeded).toBe(true);
    expect(v.commands.keygen).toMatch(/aumlok-authority\.sh keygen/);
    expect(v.status.livePromotionUnlocked).toBe(false);
    expect(v.advisoryOnly).toBe(true);
    expect(v.grantsAuthority).toBe(false);
  });

  it('when a key file EXISTS (existence only), keygen is not offered', () => {
    // the real keygen writes the private key here: <home>/aumlok/authority-ed25519.key
    const keyDir = path.join(home, 'aumlok');
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(path.join(keyDir, 'authority-ed25519.key'), 'PRIVATE-KEY-PLACEHOLDER (never read by the assistant)');
    const v = view();
    expect(v.status.keyPresent).toBe(true);
    expect(v.keygenNeeded).toBe(false);
    expect(v.commands.keygen).toBeNull();
  });
});

describe('#81/#91 assistant — pending proposals from the trusted dir', () => {
  it('reads + validates a proposal and enriches it (goal, files, createdAt, advisory flags)', () => {
    writeRepoFile('docs/SMALL.md', 10);
    const art = writeProposal('tidy a doc', [{ relPath: 'docs/SMALL.md', content: Array.from({ length: 11 }, (_, i) => `l${i}`).join('\n') }]);
    const p = view().pending;
    expect(p.length).toBe(1);
    expect(p[0].valid).toBe(true);
    expect(p[0].proposalHash).toBe(JSON.parse(fs.readFileSync(art, 'utf8')).proposalHash);
    expect(p[0].goal).toBe('tidy a doc');
    expect(p[0].createdAt).toBe(NOW);
    expect(p[0].advisoryOnly).toBe(true);
    expect(p[0].grantsAuthority).toBe(false);
    expect(p[0].files[0].existsInRepo).toBe(true);
    expect(p[0].files[0].beforeLines).toBe(11); // 10 lines + trailing newline → 11 split segments
  });

  it('a proposal-shaped file OUTSIDE pending-proposals (elsewhere in home) is NOT read', () => {
    // a valid artifact dropped in the home root, not the trusted dir
    const art = buildSelfEditProposalArtifact('sneaky', [{ relPath: 'docs/x.md', content: 'hi' }], NOW);
    fs.writeFileSync(path.join(home, 'loose-proposal.json'), JSON.stringify(art));
    expect(view().pending).toEqual([]); // only <home>/aumlok/pending-proposals is scanned
  });
});

describe('#91 assistant — file-shrink / truncation warning', () => {
  it('an EXISTING large file replaced by tiny content is flagged (the #35 rehearsal-1 class)', () => {
    writeRepoFile('docs/BIG.md', 100);
    writeProposal('truncating change', [{ relPath: 'docs/BIG.md', content: 'only\nfive\nlines\nleft\nhere' }]);
    const f = view().pending[0].files[0];
    expect(f.existsInRepo).toBe(true);
    expect(f.beforeLines).toBe(101);
    expect(f.afterLines).toBe(5);
    expect(f.netLineDelta).toBe(5 - 101);
    expect(f.shrinkWarning).toBe(true);
    expect(view().pending[0].anyShrinkWarning).toBe(true);
  });

  it('a clean small edit (grow by one line) does NOT warn (the #35 rehearsal-2 class)', () => {
    writeRepoFile('docs/SMALL.md', 19);
    writeProposal('add one line', [{ relPath: 'docs/SMALL.md', content: Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') }]);
    expect(view().pending[0].files[0].shrinkWarning).toBe(false);
    expect(view().pending[0].anyShrinkWarning).toBe(false);
  });

  it('a NEW file (no before) never warns and reports beforeLines null', () => {
    writeProposal('new doc', [{ relPath: 'docs/NEW.md', content: 'hello' }]);
    const f = view().pending[0].files[0];
    expect(f.existsInRepo).toBe(false);
    expect(f.beforeLines).toBeNull();
    expect(f.netLineDelta).toBeNull();
    expect(f.shrinkWarning).toBe(false);
  });
});

describe('#81/#91 assistant — invalid artifact is flagged, not trusted', () => {
  it('a tampered artifact (hash does not match) is listed as invalid, never signable-clean', () => {
    const art = buildSelfEditProposalArtifact('real', [{ relPath: 'docs/x.md', content: 'a' }], NOW);
    (art as any).goal = 'tampered after hashing';
    const dir = path.join(home, 'aumlok', 'pending-proposals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${art.proposalHash}.json`), JSON.stringify(art));
    const p = view().pending;
    expect(p.length).toBe(1);
    expect(p[0].valid).toBe(false);
    expect(p[0].invalidReason).toMatch(/hash|tamper/i);
    expect(p[0].riskHint).toMatch(/INVALID/);
  });
});

describe('#81/#91 assistant — exact + escaped terminal commands', () => {
  it('sign command references the artifact path and is shell-escaped; apply hint is the workbench command', () => {
    writeRepoFile('docs/SMALL.md', 10);
    writeProposal('x', [{ relPath: 'docs/SMALL.md', content: 'y' }]);
    const p = view().pending[0];
    expect(p.signCommand).toContain('bash scripts/aumlok-authority.sh sign ');
    expect(p.signCommand).toContain(shellQuote(p.artifactPath));
    expect(p.signCommand).toMatch(/> '\/tmp\/signed-[0-9a-f]{12}\.json'/);
    expect(p.applyHint).toMatch(/^apply signed proposal \/tmp\/signed-[0-9a-f]{12}\.json$/);
  });

  it('shellQuote wraps in single quotes and escapes embedded quotes', () => {
    expect(shellQuote('/a/b.json')).toBe(`'/a/b.json'`);
    expect(shellQuote(`a'b`)).toBe(`'a'\\''b'`);
  });
});

describe('#81/#91 assistant — cannot sign, apply, or read the key (source assertions)', () => {
  const RAW = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokSigningAssistant.ts'), 'utf8');
  // Strip comments so the boundary DOCSTRING (which names the forbidden calls to say it doesn't use them)
  // doesn't false-trip the assertions — we assert on real code, not documentation.
  const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).filter((l) => !l.trim().startsWith('*')).join('\n');
  it('imports NOTHING that can sign or apply, and no shell/network (comment-stripped code)', () => {
    expect(CODE).not.toMatch(/from ['"]\.\/aumlokSigner['"]/);
    expect(CODE).not.toMatch(/signPromotionAuthorization/);
    expect(CODE).not.toMatch(/dispatchSignedLiveApply/);
    expect(CODE).not.toMatch(/child_process|execFileSync|execSync|\bspawn\b/);
    expect(CODE).not.toMatch(/\bfetch\(|WebSocket|https?\.request/);
  });
  it('never opens the private key — key info comes only from the existence-checked snapshot', () => {
    expect(CODE).not.toMatch(/aumlok-dev\.json|aumlokKeyfilePath/);
    expect(CODE).not.toMatch(/readFileSync\([^)]*[kK]ey/);
    expect(CODE).toMatch(/buildAumlokStatusSnapshot/);
  });
  it('warnings state the boundaries (terminal-only, no key in browser, do-not-sign-shrink, Fusion advises)', () => {
    const w = buildAumlokAssistantView({ homeDir: home, repoRoot: repo }, NOW).warnings.join(' ');
    expect(w).toMatch(/ONLY in your own terminal/i);
    expect(w).toMatch(/[Nn]ever paste your private key/);
    expect(w).toMatch(/FILE-SHRINK/);
    expect(w).toMatch(/Fusion only advises/i);
  });
  it('the serve.ts /api/aumlok route + the organs.js panel never sign/apply (source assertions)', () => {
    const serve = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'serve.ts'), 'utf8');
    const organs = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'app', 'organs.js'), 'utf8');
    // serve.ts is GET/HEAD only (no write route can exist) and serves the assistant view via the pure module
    expect(serve).toMatch(/method !== 'GET' && .*method !== 'HEAD'/);
    expect(serve).toMatch(/buildAumlokAssistantView/);
    expect(serve).not.toMatch(/signPromotionAuthorization|dispatchSignedLiveApply/);
    // the panel only READS via getJSON; it never POSTs, never calls a sign/apply endpoint
    const organsCode = organs.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(organsCode).not.toMatch(/method:\s*['"]POST['"]|fetch\([^)]*POST/i);
    expect(organsCode).not.toMatch(/\/sign\b|\/apply\b|signPromotion|dispatchSignedLiveApply/);
    expect(organsCode).toMatch(/getJSON\('\/api\/aumlok'\)/);
  });

  it('the view never echoes repo file CONTENT — only line/byte counts', () => {
    writeRepoFile('docs/SECRETISH.md', 3); // unique marker content lives in the repo file
    fs.writeFileSync(path.join(repo, 'docs/SECRETISH.md'), 'UNIQUE_MARKER_abc123\nsecond\nthird\n');
    writeProposal('edit', [{ relPath: 'docs/SECRETISH.md', content: 'UNIQUE_MARKER_abc123\nsecond\nthird\nfourth\n' }]);
    // the PROPOSAL content is authored by us so it can contain the marker; the point is the assistant's
    // BEFORE-side never reads/echoes the repo file content. Assert counts exist and the view carries no
    // 'content' field on any file-safety entry.
    const p = view().pending[0];
    expect(p.files[0].beforeLines).not.toBeNull();
    expect(Object.keys(p.files[0])).not.toContain('content');
  });
});

// #178 round 2 (Fusion lane): the council's reading rides the signing view — tri-state, fail-closed,
// display-only. A verdict NEVER changes validity or signability; tampering shows as refusal, not absence.
import { buildProposalFusionAdvisory, writeProposalFusionAdvisory, proposalAdvisoriesDir } from '../src/proposalFusionAdvisory';
import type { SelfEditReviewSummary } from '../src/selfEditReviewCouncil';

function cannedReview(verdict: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM'): SelfEditReviewSummary {
  return {
    schema: 'self-edit-review-v2', goal: 'gate view fixture', councilModels: ['a/x', 'b/y', 'c/z'], results: [],
    quorum: {
      status: 'YELLOW_QUORUM', completedCount: 3, failureCount: 0, totalCount: 3,
      adapterFailuresArePoisoning: false, reason: 'canned',
      completedVotes: 3, nonVotes: 0, redVotes: 1, greenVotes: 1, yellowVotes: 1,
    } as SelfEditReviewSummary['quorum'],
    overallVerdict: verdict, recommendations: ['r1', 'r2', 'r3', 'r4', 'r5'],
    gateAction: 'proceed_with_caution', insight: 'the fixture insight', contradictions: [],
    strongestContradiction: null, phaseLocked: true, incidents: [], patchesApplied: 0, skippedReason: null,
    fusionRunArtifact: null, fusionRunValid: false, fusionSelfReview: null, fusionSelfReviewValid: false,
    kiraRecall: null, advisoryOnly: true, grantsAuthority: false, createdAt: NOW,
  };
}

describe('#178 round 2 — the council verdict at the gate', () => {
  it("no sidecar → state 'none' (honest absence)", () => {
    writeProposal('plain proposal', [{ relPath: 'docs/x.md', content: 'hi' }]);
    expect(view().pending[0].councilAdvisory).toEqual({ state: 'none' });
  });

  it('present sidecar → bounded projection: verdict, votes, provenance (count + readAt), recs capped at 3', () => {
    writeProposal('reviewed proposal', [{ relPath: 'docs/x.md', content: 'hi' }]);
    const hash = view().pending[0].proposalHash;
    const w = writeProposalFusionAdvisory(buildProposalFusionAdvisory({ proposalHash: hash, review: cannedReview('YELLOW'), createdAt: NOW }), home);
    expect(w.ok).toBe(true);
    const ca = view().pending[0].councilAdvisory;
    expect(ca.state).toBe('present');
    if (ca.state === 'present') {
      expect(ca.verdict).toBe('YELLOW');
      expect(ca.votes).toEqual({ green: 1, yellow: 1, red: 1, non: 0 });
      expect(ca.recommendations).toEqual(['r1', 'r2', 'r3']); // top 3, capped
      expect(ca.councilCount).toBe(3);
      expect(ca.readAt).toBe(NOW);
      expect(ca.phaseLocked).toBe(true);
    }
  });

  it("tampered sidecar → 'refused' with a reason — never partial data, never silent absence", () => {
    writeProposal('tampered-sidecar proposal', [{ relPath: 'docs/x.md', content: 'hi' }]);
    const hash = view().pending[0].proposalHash;
    const dir = proposalAdvisoriesDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${hash}.json`), '{"schema":"proposal-fusion-advisory-v1","grantsAuthority":true}');
    const ca = view().pending[0].councilAdvisory;
    expect(ca.state).toBe('refused');
    if (ca.state === 'refused') expect(ca.reason).toMatch(/fail-closed/);
  });

  it('display-only pin: a RED verdict changes NOTHING about validity or the sign command', () => {
    writeProposal('red-verdict proposal', [{ relPath: 'docs/x.md', content: 'hi' }]);
    const hash = view().pending[0].proposalHash;
    writeProposalFusionAdvisory(buildProposalFusionAdvisory({ proposalHash: hash, review: cannedReview('RED'), createdAt: NOW }), home);
    const p = view().pending[0];
    expect(p.councilAdvisory.state).toBe('present');
    expect(p.valid).toBe(true); // RED is advice, not a veto
    expect(p.signCommand).toMatch(/aumlok-authority\.sh sign/); // the owner's path is untouched
  });
});

// #178 round 5: seat track records at the gate — floors enforced upstream, silence below them,
// 'not-started' until this node's first signed decision exists. Display-only.
import {
  appendSeatLedgerRows, appendOwnerDecisionRows, seatLedgerDir, OWNER_DECISIONS_FILE, OWNER_RATE_FLOOR,
  type SeatLedgerRowV1, type OwnerDecisionRowV1,
} from '../src/fusionSeatLedger';

const voteRow = (key: string, seat = 'QWN'): SeatLedgerRowV1 => ({
  schema: 'fusion-seat-ledger-row-v1', createdAt: NOW, runKind: 'proposal-review', key, seat,
  vote: 'GREEN', providerContacted: true, durationMs: 5, overallVerdict: 'GREEN',
  quorumStatus: 'GREEN_QUORUM', phaseLocked: false, advisoryOnly: true, grantsAuthority: false,
});
const decisionRow = (key: string): OwnerDecisionRowV1 => ({
  schema: 'fusion-ledger-owner-decision-v1', createdAt: NOW, key, ownerDecision: 'signed-applied',
  decidedAt: NOW, commitSha: 'c0ffee123456', advisoryOnly: true, grantsAuthority: false,
});
const key64 = (i: number) => i.toString(16).padStart(64, '0');

describe('#178 round 5 — seat track records at the gate', () => {
  it("no decision evidence ever recorded → 'not-started' (the first signature starts it)", () => {
    expect(view().seatRecords).toEqual({ state: 'not-started' });
  });

  it('the advisory projection now carries the seat list the track records key on', () => {
    writeProposal('with council list', [{ relPath: 'docs/x.md', content: 'hi' }]);
    const hash = view().pending[0].proposalHash;
    writeProposalFusionAdvisory(buildProposalFusionAdvisory({ proposalHash: hash, review: cannedReview('GREEN'), createdAt: NOW }), home);
    const ca = view().pending[0].councilAdvisory;
    expect(ca.state).toBe('present');
    if (ca.state === 'present') expect(ca.council).toEqual(['a/x', 'b/y', 'c/z']);
  });

  it('recording below the floor: counts shown, every rate NULL — no percentage speaks', () => {
    appendSeatLedgerRows([voteRow(key64(1)), voteRow(key64(2))], home);
    appendOwnerDecisionRows([decisionRow(key64(1)), decisionRow(key64(2))], home);
    const sr = view().seatRecords;
    expect(sr.state).toBe('recording');
    if (sr.state === 'recording') {
      expect(sr.decisionCount).toBe(2);
      expect(sr.floor).toBe(OWNER_RATE_FLOOR);
      expect(sr.records).toEqual([{ seat: 'QWN', ownerScored: 2, ownerAgreed: 2, ownerRate: null }]);
    }
  });

  it('at the floor, the rate finally speaks', () => {
    const keys = Array.from({ length: OWNER_RATE_FLOOR }, (_, i) => key64(i + 1));
    appendSeatLedgerRows(keys.map((k) => voteRow(k)), home);
    appendOwnerDecisionRows(keys.map((k) => decisionRow(k)), home);
    const sr = view().seatRecords;
    if (sr.state === 'recording') expect(sr.records[0]).toEqual({ seat: 'QWN', ownerScored: OWNER_RATE_FLOOR, ownerAgreed: OWNER_RATE_FLOOR, ownerRate: 1 });
    else expect.fail('expected recording state');
  });

  it('a garbage decisions file cannot break the signing page — honest zero, invalid lines skipped', () => {
    fs.mkdirSync(seatLedgerDir(home), { recursive: true });
    fs.writeFileSync(path.join(seatLedgerDir(home), OWNER_DECISIONS_FILE), 'not json\n{"schema":"nope"}\n');
    const v = view();
    expect(v.seatRecords).toEqual({ state: 'recording', decisionCount: 0, floor: OWNER_RATE_FLOOR, records: [] });
    expect(v.schema).toBe('aumlok-signing-assistant-v1'); // the view itself stands
  });
});
