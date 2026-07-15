// RAIL PIN — shrink-guard (#91 / the 2026-07-06 stale-batch incident class).
//
// A large line-removal proposal must trip the widened-OR shrink detection
//   rule 1: after <= 0.5 * before  AND  deleted >= 20   (severe fractional shrink)
//   rule 2: deleted >= 100                              (large ABSOLUTE deletion, any fraction)
//   rule 3: after <= 0.75 * before AND  deleted >= 50   (moderate fractional + moderate absolute)
// and the approval door must then demand an explicit "I read the diff and I mean to remove N line(s)."
// acknowledgement before the Approve button is clickable.
//
// Why this file exists: before it, rules 1 and 2 could BOTH be deleted from fileShrink.ts and the
// entire suite stayed green (every existing warn fixture also trips rule 3), and the remove-N-lines
// ack in the approval page could be deleted with zero red. These tests make the guard load-bearing.
//
// Hermetic: detector tests run on mkdtemp throwaway repos; door/organ surfaces are pinned via
// readFileSync source assertions (the repo's established STRUCTURAL pattern — the door is a Bun.serve
// module that must never be imported under vitest). No real home dir, no keys, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeFileShrink,
  computeProposalShrinks,
  defaultRepoRoot,
  SHRINK_LINE_FRACTION,
  SHRINK_MIN_DELETED_LINES,
  SHRINK_ABS_DELETED_LINES,
  SHRINK_MODERATE_FRACTION,
  SHRINK_MODERATE_DELETED,
} from '../src/fileShrink';
import { buildAumlokAssistantView } from '../src/aumlokSigningAssistant';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact } from '../src/selfEditProposalArtifact';
import { buildEvidencePacketFromRunReport } from '../src/workbenchEvidencePacket';
import { buildRunReport, stageReport } from '../src/workbenchRunReport';

const REPO_ROOT = path.join(__dirname, '..', '..');
const NOW = '2026-07-13T00:00:00.000Z';

/** n lines of content with NO trailing newline, so countLinesBytes reads back EXACTLY n lines.
 *  (Files written with a trailing newline split to n+1 — the quirk that makes boundary tests drift.) */
function linesContent(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'shrinkrail-')); });
afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best-effort */ } });

function writeRepoFileExact(rel: string, lineCount: number) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, linesContent(lineCount)); // no trailing newline: beforeLines === lineCount exactly
}

// ---------------------------------------------------------------------------------------------
// 1. The five thresholds, pinned BY VALUE. Silent drift in any direction is a guard weakening.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — the widened-OR thresholds are pinned by value (0.5/20, 100, 0.75/50)', () => {
  it('rule 1: severe fraction 0.5 with min-deleted floor 20', () => {
    expect(SHRINK_LINE_FRACTION).toBe(0.5);
    expect(SHRINK_MIN_DELETED_LINES).toBe(20);
  });
  it('rule 2: absolute deletion floor 100', () => {
    expect(SHRINK_ABS_DELETED_LINES).toBe(100);
  });
  it('rule 3: moderate fraction 0.75 with deleted floor 50', () => {
    expect(SHRINK_MODERATE_FRACTION).toBe(0.75);
    expect(SHRINK_MODERATE_DELETED).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Rule 2 stands ALONE. Every pre-existing warn fixture in the suite also trips rule 3, so
//    deleting `deleted >= SHRINK_ABS_DELETED_LINES ||` used to leave the whole suite green.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — rule 2 (absolute >=100 deleted) is independently load-bearing', () => {
  it('warns on >=100 lines deleted even when 88 percent of the file survives (no other rule trips)', () => {
    writeRepoFileExact('docs/HUGE.md', 1001);
    const after = 881; // deletes 120
    // fixture sanity: NEITHER fractional rule can fire here, so only rule 2 carries the verdict
    expect(after > 1001 * SHRINK_MODERATE_FRACTION).toBe(true);
    expect(after > 1001 * SHRINK_LINE_FRACTION).toBe(true);
    expect(1001 - after >= SHRINK_ABS_DELETED_LINES).toBe(true);
    const r = computeFileShrink(repo, 'docs/HUGE.md', linesContent(after));
    expect(r.beforeLines).toBe(1001);
    expect(r.afterLines).toBe(881);
    expect(r.shrinkWarning).toBe(true);
  });

  it('boundary is INCLUSIVE: exactly 100 deleted trips, 99 does not', () => {
    writeRepoFileExact('docs/HUGE.md', 1001);
    // 1001 -> 901 deletes exactly SHRINK_ABS_DELETED_LINES; survives 90% so no fractional rule helps
    expect(901 > 1001 * SHRINK_MODERATE_FRACTION).toBe(true);
    expect(computeFileShrink(repo, 'docs/HUGE.md', linesContent(901)).shrinkWarning).toBe(true);
    // 1001 -> 902 deletes 99: below every rule -> silent
    expect(computeFileShrink(repo, 'docs/HUGE.md', linesContent(902)).shrinkWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Rule 1 stands ALONE (all pre-existing rule-1 fixtures delete >=50 lines, so rule 3 masked it).
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — rule 1 (severe fraction) is independently load-bearing', () => {
  it('warns on a severe fractional shrink that deletes fewer than 50 lines (no other rule trips)', () => {
    writeRepoFileExact('docs/MID.md', 61);
    const after = 25; // deletes 36, keeps 41%
    // fixture sanity: rules 2 and 3 CANNOT fire (36 < 50 and 36 < 100) — only rule 1 carries this
    expect(61 - after < SHRINK_MODERATE_DELETED).toBe(true);
    expect(61 - after < SHRINK_ABS_DELETED_LINES).toBe(true);
    expect(after <= 61 * SHRINK_LINE_FRACTION).toBe(true);
    expect(61 - after >= SHRINK_MIN_DELETED_LINES).toBe(true);
    expect(computeFileShrink(repo, 'docs/MID.md', linesContent(after)).shrinkWarning).toBe(true);
  });

  it('boundaries are INCLUSIVE: exactly half AND exactly 20 deleted trips (40 -> 20); one line either side does not (41 -> 21)', () => {
    writeRepoFileExact('docs/E.md', 40);
    // 40 -> 20: after == before*0.5 exactly AND deleted == 20 exactly; rules 2/3 cannot fire (20 < 50).
    // A <= weakened to < OR a >= weakened to > both go silent here.
    expect(computeFileShrink(repo, 'docs/E.md', linesContent(20)).shrinkWarning).toBe(true);
    writeRepoFileExact('docs/F.md', 41);
    // 41 -> 21: 21 > 20.5 (fraction fails) — no rule trips
    expect(computeFileShrink(repo, 'docs/F.md', linesContent(21)).shrinkWarning).toBe(false);
  });

  it('the fraction boundary alone is inclusive even with deleted comfortably above the floor (98 -> 49)', () => {
    writeRepoFileExact('docs/G.md', 98);
    // 49 == 98*0.5 exactly; deletes 49 (>= 20, but < 50 so rule 3 stays out, < 100 so rule 2 stays out)
    expect(49 <= 98 * SHRINK_LINE_FRACTION).toBe(true);
    expect(98 - 49 < SHRINK_MODERATE_DELETED).toBe(true);
    expect(computeFileShrink(repo, 'docs/G.md', linesContent(49)).shrinkWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Rule 3 at its exact inclusive boundaries, standing alone.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — rule 3 (moderate) boundaries are inclusive and independently load-bearing', () => {
  it('exactly 75 percent kept AND exactly 50 deleted trips (200 -> 150); one line either side does not', () => {
    writeRepoFileExact('docs/M.md', 200);
    // 200 -> 150: after == before*0.75 exactly, deleted == 50 exactly; rule 1 cannot fire (150 > 100),
    // rule 2 cannot fire (50 < 100) — only rule 3, at both of its boundaries at once.
    expect(150 > 200 * SHRINK_LINE_FRACTION).toBe(true);
    expect(200 - 150 < SHRINK_ABS_DELETED_LINES).toBe(true);
    expect(computeFileShrink(repo, 'docs/M.md', linesContent(150)).shrinkWarning).toBe(true);
    // 200 -> 151: deleted 49 and fraction just over — silent
    expect(computeFileShrink(repo, 'docs/M.md', linesContent(151)).shrinkWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. The widened OR flows through the SIGN-TIME surface both doors consume: a rule-2-only shrink
//    must set files[].shrinkWarning + anyShrinkWarning in buildAumlokAssistantView. This is what
//    the approval door's banner, red portal, and ack all derive from.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — sign-time assistant view carries a rule-2-only verdict', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'shrinkrail-home-')); });
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });

  it('an existing 1001-line file proposed back as 881 lines flags the proposal', () => {
    writeRepoFileExact('docs/HUGE.md', 1001);
    writeSelfEditProposalArtifact(
      buildSelfEditProposalArtifact('trim comments', [{ relPath: 'docs/HUGE.md', content: linesContent(881) }], NOW),
      home,
    );
    const v = buildAumlokAssistantView({ homeDir: home, repoRoot: repo }, NOW);
    expect(v.pending.length).toBe(1);
    expect(v.pending[0].files[0].beforeLines).toBe(1001);
    expect(v.pending[0].files[0].afterLines).toBe(881);
    expect(v.pending[0].files[0].shrinkWarning).toBe(true);
    expect(v.pending[0].anyShrinkWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. The RUN-TIME seam: real detector output (not hand-set fixtures) piped into the evidence
//    packet must surface the loud FILE-SHRINK / Do-NOT-sign line for a rule-2-only shrink.
//    (Existing packet tests inject fixture FileShrinkResult objects, so they never exercise
//    the detector-to-packet composition.)
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — real detector output surfaces in the evidence packet', () => {
  it('a rule-2-only shrink computed by computeProposalShrinks yields FILE-SHRINK + Do NOT sign in the summary', () => {
    writeRepoFileExact('docs/HUGE.md', 1001);
    const files = [
      { relPath: 'docs/HUGE.md', content: linesContent(881) }, // rule-2-only offender
      { relPath: 'docs/NEW.md', content: 'brand new file' },   // clean new file — must be filtered out
    ];
    const shrinks = computeProposalShrinks(repo, files);
    const report = buildRunReport({
      goal: 'trim comments across the huge doc',
      stages: [
        stageReport('agent', true, 'proposed 2 files'),
        stageReport('sandbox_apply', true, 'temp copy'),
        stageReport('content_check', true, 'match'),
        stageReport('typecheck', true, 'tsc exit 0'),
        stageReport('fusion_review', true, 'verdict: GREEN'),
        stageReport('write_receipt', true, 'receipt persisted'),
      ],
      proposalHash: 'a'.repeat(64),
      model: 'anthropic/claude-fable-5',
      receiptPath: '/tmp/fake-receipt.json',
      artifactPath: '/tmp/fake-artifact.json',
      signCommand: 'bash scripts/aumlok-authority.sh sign <path>',
    });
    const packet = buildEvidencePacketFromRunReport(report, { fileShrinks: shrinks });
    expect(packet.anyShrinkWarning).toBe(true);
    expect(packet.fileShrinkWarnings.length).toBe(1); // only the offender rides, never the clean file
    expect(packet.fileShrinkWarnings[0].relPath).toBe('docs/HUGE.md');
    expect(packet.summary).toContain('FILE-SHRINK (#91)');
    expect(packet.summary).toContain('Do NOT sign');
    expect(packet.summary).toContain('docs/HUGE.md (1001→881 lines)');
  });

  it('STRUCTURAL: the run chain wires the live-repo detector into the packet (workbenchCommandLoop)', () => {
    // Deleting `fileShrinks` from this call site silently strips run-time truncation warnings while
    // every packet-side test stays green (they inject fixtures) — so the wiring text itself is pinned.
    const loop = fs.readFileSync(path.join(REPO_ROOT, 'core', 'src', 'workbenchCommandLoop.ts'), 'utf-8');
    expect(loop).toContain("import { computeProposalShrinks, defaultRepoRoot } from './fileShrink';");
    expect(loop).toContain(
      'const fileShrinks = session.lastProposal ? computeProposalShrinks(defaultRepoRoot(), session.lastProposal.files) : [];',
    );
    expect(loop).toContain(
      'const packet = buildEvidencePacketFromRunReport(report, { intentId: fromIntentId, fileShrinks });',
    );
    // and defaultRepoRoot really is the repo root the run chain reads before/after counts from
    expect(defaultRepoRoot()).toBe(path.resolve(__dirname, '..', '..'));
  });
});

// ---------------------------------------------------------------------------------------------
// 7. THE ACK. The only "remove N lines" acknowledgement in the repo is client-side JS inside the
//    approval door's inline page (spatial/aumlok-approve-serve.ts). The door is a Bun.serve module
//    (listens on :7094 at import) so it must NEVER be imported here — pin its source text, the
//    same STRUCTURAL pattern aumlokCanonicalCeremony.test.ts uses on the same file.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — STRUCTURAL: the approval page requires the explicit remove-N-lines ack', () => {
  const door = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'aumlok-approve-serve.ts'), 'utf-8');

  it('the page derives its shrink set from the per-file shrinkWarning verdicts', () => {
    expect(door).toContain('const shrinks=files.filter(f=>f&&f.shrinkWarning);');
  });

  it('the ack checkbox names the exact total line count being removed', () => {
    expect(door).toContain('const totalDel=shrinks.reduce((s,f)=>s+(f.beforeLines-f.afterLines),0);');
    expect(door).toContain('" I read the diff and I mean to remove "+totalDel+" line(s)."');
  });

  it('the Approve button is BORN disabled on a shrink proposal and only the ack enables it', () => {
    expect(door).toContain('ask.disabled=true; ack.onchange=()=>{ ask.disabled=!ack.checked; };');
    // ordering pin: that disable+ack wiring lives INSIDE the shrinks-branch right after the button
    // is created — so a shrink proposal is never one-click approvable.
    expect(door).toMatch(
      /const ask=el\("button",null,"Approve this"\);\s*if\(shrinks\.length\)\{[\s\S]{0,500}?ask\.disabled=true; ack\.onchange=\(\)=>\{ ask\.disabled=!ack\.checked; \};/,
    );
  });
});

describe('shrink-guard rail — STRUCTURAL: shrink danger stays red while collapsed and the banner never folds away', () => {
  const door = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'aumlok-approve-serve.ts'), 'utf-8');

  it('shrink is part of the danger flag that turns the collapsed portal red', () => {
    expect(door).toContain('const danger=(!p.valid)||shrinks.length>0;');
    expect(door).toContain('const card=el("details","portal-card"+(danger?" warn":""));');
  });

  it('a shrink proposal reads "review" not "approve" on the collapsed pill', () => {
    expect(door).toContain('!p.valid?"review":(shrinks.length?"review →":"approve →")');
  });

  it('the loud banner (REMOVES lines + per-file removes-N) is appended to the portal BODY, before the technical fold exists', () => {
    expect(door).toContain('sb.append(el("div","shrink-h","⚠ This REMOVES lines from a file that already exists"));');
    expect(door).toContain('" lines  (removes "+(f.beforeLines-f.afterLines)+")"');
    expect(door).toContain('body.append(sb);');
    // the banner lands on the body BEFORE the collapsible technical fold is even created — it can
    // never be tucked inside it
    const bannerAt = door.indexOf('body.append(sb);');
    const foldAt = door.indexOf('const fold=el("details","fold");');
    expect(bannerAt).toBeGreaterThan(-1);
    expect(foldAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(foldAt);
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Observer surfaces must not smooth the shrink over: the legacy System-tab panel WITHHOLDS the
//    terminal sign command entirely, and the shell organ keeps its loud banner. Browser modules —
//    source pins only.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — STRUCTURAL: observer surfaces withhold the sign path and keep the banner', () => {
  it('organs.js: FILE-SHRINK pill present, and the sign command is only reachable in the NON-shrink branch', () => {
    const organs = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'app', 'organs.js'), 'utf-8');
    expect(organs).toContain("pill('⚠ FILE-SHRINK (#91)', 'pill-red')");
    // the load-bearing shape: anyShrinkWarning shows Do-NOT-sign INSTEAD of the sign cmdBlock
    expect(organs).toMatch(
      /if \(pr\.anyShrinkWarning\) \{\s*box\.append\(el\('div', 'aumlok-warn', '⚠ Do NOT sign[\s\S]{0,500}?\} else if \(pr\.valid && !v\.keygenNeeded\) \{\s*box\.append\(cmdBlock\('1\) sign it in your terminal:', pr\.signCommand\)\);/,
    );
  });

  it('aumlok.js: the shell organ maps per-file verdicts and renders the loud removes-N banner', () => {
    const organ = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'app', 'aumlok.js'), 'utf-8');
    expect(organ).toContain('fileSafeties: Array.isArray(p.files) ? p.files : [],');
    expect(organ).toContain('const shrinks = (p.fileSafeties || []).filter((f) => f && f.shrinkWarning);');
    expect(organ).toContain("el('div', 'aum-shrink-h', '⚠ Removes lines from an existing file')");
    expect(organ).toContain("' lines  (removes ' + (f.beforeLines - f.afterLines) + ')'");
  });
});

// ---------------------------------------------------------------------------------------------
// 9. REPORT-ONLY honesty pin (a documented GAP, not a guard): the ack is CLIENT-SIDE ONLY.
//    /api/approve gates on the proposal-bound phrase + ceremony — it accepts NO shrink
//    acknowledgement field, and the apply core has no shrink logic. This test states the current
//    truth so that IF server-side enforcement lands (flagged for Codex, 2026-07-06), whoever adds
//    it deliberately updates this pin rather than the gap regressing in silence either direction.
// ---------------------------------------------------------------------------------------------
describe('shrink-guard rail — REPORT-ONLY: no server-side shrink ack exists today (known gap, stated honestly)', () => {
  it('the approve route reads only proposalHash + phrase and runs the phrase ceremony — no ack field', () => {
    const door = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'aumlok-approve-serve.ts'), 'utf-8');
    const start = door.indexOf("p === '/api/approve'");
    expect(start).toBeGreaterThan(-1);
    const block = door.slice(start, start + 2600);
    expect(block).toContain('body.proposalHash');
    expect(block).toContain('body.phrase');
    expect(block).toContain('verifyAndConsumeChallenge');
    expect(block).toContain('approveAndApplyProposal');
    // the gap itself: no shrink/acknowledgement gating anywhere in the route
    expect(block).not.toMatch(/shrink/i);
    expect(block).not.toMatch(/body\.ack|acknowledg/i);
  });
});
