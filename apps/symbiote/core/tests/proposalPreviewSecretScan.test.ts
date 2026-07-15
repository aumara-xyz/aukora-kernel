// RAIL: proposalpreview-secret-scan — the #105 preview/read layer must secret-scan diff content so
// key/token/credential material never renders in the AUMLOK approval UI.
//
// Safety properties pinned here (the gaps the primary proposalPreview suite leaves open):
//   1. lineIsForbidden is a UNION of BOTH trusted detectors. Each half is pinned with fixtures the
//      OTHER half provably misses (fixture-guard asserts prove that), so deleting either side of the
//      union — the exact mirror of the 2026-07-06 HIGH secret-leak — turns this file red.
//   2. lineHasSecretContent's own exported contract (no other test calls it directly): every
//      SECRET_CONTENT_PATTERNS family matches, benign lines don't, non-strings never throw.
//   3. classifyRisk pauses (HIGH) for EVERY secret family on an added diff line, not just sk- —
//      the same pattern table feeds both the preview redaction and the risk pause.
//   4. Diff formatting cannot bypass the scan: the scan runs on RAW line content, so secrets on
//      lines that themselves look like diff markup ('+', '-', '@@', leading spaces) and secrets in
//      CRLF files are still withheld.
//   5. Bounds cannot leak: a secret past the 120-line or 8000-char cap never appears, even as a
//      prefix — truncation refuses whole lines, never slices them.
//   6. End-to-end: the FULL buildAumlokAssistantView JSON — the exact payload /api/aumlok
//      (spatial/serve.ts) and /api/pending (spatial/aumlok-approve-serve.ts) serialize — never
//      contains the secret string, and the preview carries secretRedacted=true.
//   7. Honesty in the negative: a clean diff keeps secretRedacted=false (the UI banner keys on it).
//   8. Unsafe-path refusals are COMPLETE: refusedReason set, hunk empty, proposed content absent
//      from every field (not merely "does not throw").
//
// Hermetic: mkdtemp repo + home dirs only; no real key, no ~/.aukora-symbiote, no network, no server.
// Secrets are constructed by CONCATENATION so the repo's own scanners never see a whole literal.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeProposalPreview } from '../src/proposalPreview';
import { lineHasSecretContent, classifyRisk } from '../src/changeRiskClassifier';
import { scanForbiddenValues } from '../src/forbiddenContent';
import { buildAumlokAssistantView } from '../src/aumlokSigningAssistant';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact } from '../src/selfEditProposalArtifact';

const WITHHELD = '[line withheld — scanned as secret-shaped]';
const NOW = '2026-07-03T00:00:00.000Z';

// Constructed secrets (concatenated so no whole literal sits in this file).
const AKIA = 'AKIA' + 'ABCDEFGHIJKLMNOP';                    // AWS access key id (classifier half)
const GHP = 'ghp_' + 'a'.repeat(36);                          // GitHub token (classifier half)
const XOXB = 'xoxb-' + '1234567890-abcdefghij';               // Slack token (classifier half)
const CRED = 'apiKey = "' + 'abcdefghij0123456789XYZ' + '"';  // hardcoded credential (classifier half)
const PEM = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';       // PEM header (both halves)
const BEARER_TOKEN = 'tok' + '0123456789abcdef';              // 19-char tail for 'bearer ' (forbidden half)
const BEARER_LINE = `const h = 'bearer ${BEARER_TOKEN}';`;
const HEX64 = 'a1b2c3d4'.repeat(8);                           // 64-hex run, e.g. a raw ed25519 seed (forbidden half)
const HEX64_LINE = `const derived = '${HEX64}';`;
const SK_HYPHEN = 'sk-' + 'or-v1-abcXYZ123';                  // 15-char tail: misses the {16,} classifier net (forbidden half)
const SK_HYPHEN_LINE = `const k = '${SK_HYPHEN}';`;

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-secretscan-repo-'));
  fs.mkdirSync(path.join(repo, 'core', 'src'), { recursive: true });
});
afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best-effort */ } });

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), content);
};

describe('lineIsForbidden union — the forbiddenContent half (the exact 2026-07-06 leak mirror)', () => {
  it('WITHHOLDS forbiddenContent-only classes (bearer token, 64-hex run, hyphenated sk-) on added AND removed lines', () => {
    const cases: Array<[string, string]> = [
      [BEARER_LINE, BEARER_TOKEN],
      [HEX64_LINE, HEX64],
      [SK_HYPHEN_LINE, SK_HYPHEN],
    ];
    for (const [secretLine, token] of cases) {
      // fixture-guard: this class is INVISIBLE to the classifier half. If this ever starts matching,
      // the case below no longer pins the forbiddenContent side of the union and must be replaced.
      expect(lineHasSecretContent(secretLine)).toBe(false);

      // ADDED line carrying the secret
      write('core/src/a.ts', 'top\nbottom\n');
      const addPv = computeProposalPreview(repo, 'core/src/a.ts', `top\n${secretLine}\nbottom\n`);
      expect(addPv.refusedReason).toBeNull();
      expect(addPv.secretRedacted).toBe(true);
      expect(addPv.hunk).toContain(WITHHELD);
      expect(addPv.hunk).not.toContain(token);

      // REMOVED line carrying the secret
      write('core/src/b.ts', `top\n${secretLine}\nbottom\n`);
      const remPv = computeProposalPreview(repo, 'core/src/b.ts', 'top\nbottom\n');
      expect(remPv.refusedReason).toBeNull();
      expect(remPv.secretRedacted).toBe(true);
      expect(remPv.hunk).toContain(WITHHELD);
      expect(remPv.hunk).not.toContain(token);
    }
  });
});

describe('lineIsForbidden union — the classifier half on ADDED lines', () => {
  it('WITHHOLDS classifier-only classes (AKIA / ghp_ / xoxb- / hardcoded credential) introduced as NEW (+) content', () => {
    const cases: Array<[string, string]> = [
      [`const a = "${AKIA}";`, AKIA],
      [`const g = "${GHP}";`, GHP],
      [`const s = "${XOXB}";`, XOXB],
      [CRED, 'abcdefghij0123456789XYZ'],
    ];
    for (const [secretLine, token] of cases) {
      // fixture-guard: this class is INVISIBLE to the forbiddenContent half — so scanning added
      // lines with scanForbiddenValues alone (a plausible refactor) turns this test red.
      expect(scanForbiddenValues({ v: secretLine }).length).toBe(0);

      write('core/src/c.ts', 'top\nbottom\n');
      const pv = computeProposalPreview(repo, 'core/src/c.ts', `top\n${secretLine}\nbottom\n`);
      expect(pv.refusedReason).toBeNull();
      expect(pv.secretRedacted).toBe(true);
      expect(pv.hunk).toContain(WITHHELD);
      expect(pv.hunk).not.toContain(token);
    }
  });
});

describe('lineHasSecretContent — the exported detector contract (no other test calls it directly)', () => {
  it('every trusted family matches; benign lines and non-strings do not', () => {
    // each of the six SECRET_CONTENT_PATTERNS families
    expect(lineHasSecretContent('sk-' + 'a'.repeat(20))).toBe(true);            // sk- key
    expect(lineHasSecretContent(PEM)).toBe(true);                                // PEM private-key header
    expect(lineHasSecretContent(`const a = "${AKIA}";`)).toBe(true);             // AWS access key id
    expect(lineHasSecretContent(`const g = "${GHP}";`)).toBe(true);              // GitHub token
    expect(lineHasSecretContent(`const s = "${XOXB}";`)).toBe(true);             // Slack token
    expect(lineHasSecretContent(CRED)).toBe(true);                               // hardcoded credential

    // benign lines
    expect(lineHasSecretContent('const x = 1;')).toBe(false);
    expect(lineHasSecretContent('// discuss the password policy in prose')).toBe(false);
    expect(lineHasSecretContent('const sha40 = "' + 'ab'.repeat(20) + '";')).toBe(false); // 40-hex: precision negative
    expect(lineHasSecretContent('')).toBe(false);

    // non-string input: never throws, never matches
    for (const v of [null, undefined, 42, {}, ['sk-' + 'a'.repeat(20)]] as unknown[]) {
      expect(lineHasSecretContent(v as string)).toBe(false);
    }
  });

  it('classifyRisk pauses (HIGH) for EVERY secret family on an added diff line — same table, second consumer', () => {
    const secrets = [`const a = "${AKIA}";`, `const g = "${GHP}";`, `const s = "${XOXB}";`, CRED, PEM, 'sk-' + 'a'.repeat(20)];
    for (const s of secrets) {
      const r = classifyRisk([{ path: 'core/src/x.ts', status: 'modified' }], `+${s}\n`);
      expect(r.risk).toBe('high');
      expect(r.reasons.join(' ')).toMatch(/secret in diff content/);
    }
  });
});

describe('diff formatting cannot bypass the scan', () => {
  it('secrets on RAW lines that look like diff markup (+ / @@ / leading spaces / -) are still withheld', () => {
    const markupCases: Array<[string, string]> = [
      ['+' + CRED, 'abcdefghij0123456789XYZ'],  // raw line begins with '+'
      [`@@ ${AKIA} @@`, AKIA],                   // raw line looks like a hunk header
      [`    ${GHP}`, GHP],                       // leading whitespace
    ];
    for (const [rawLine, token] of markupCases) {
      write('core/src/d.ts', 'top\nbottom\n');
      const pv = computeProposalPreview(repo, 'core/src/d.ts', `top\n${rawLine}\nbottom\n`);
      expect(pv.refusedReason).toBeNull();
      expect(pv.secretRedacted).toBe(true);
      expect(pv.hunk).not.toContain(token);
    }
    // a raw file line beginning with '-' that gets REMOVED by the proposal
    write('core/src/e.ts', `keep\n- ${XOXB}\nkeep2\n`);
    const rem = computeProposalPreview(repo, 'core/src/e.ts', 'keep\nkeep2\n');
    expect(rem.secretRedacted).toBe(true);
    expect(rem.hunk).not.toContain(XOXB);
  });

  it('CRLF line endings do not defeat any pattern (added and removed sides)', () => {
    write('core/src/f.ts', 'alpha\r\nbeta\r\n');
    const add = computeProposalPreview(repo, 'core/src/f.ts', `alpha\r\nconst a = "${AKIA}";\r\nbeta\r\n`);
    expect(add.refusedReason).toBeNull();
    expect(add.secretRedacted).toBe(true);
    expect(add.hunk).not.toContain(AKIA);

    write('core/src/g.ts', `alpha\r\n${BEARER_LINE}\r\nbeta\r\n`);
    const rem = computeProposalPreview(repo, 'core/src/g.ts', 'alpha\r\nbeta\r\n');
    expect(rem.secretRedacted).toBe(true);
    expect(rem.hunk).not.toContain(BEARER_TOKEN);
  });
});

describe('bounds never leak — truncation refuses whole lines, never slices them', () => {
  it('the same secret at the first changed line, past the 120-line cap, and past the 8000-char budget never appears', () => {
    const secretLine = `const a = "${AKIA}";`;

    // (1) at the FIRST changed line: withheld with the placeholder
    const firstContent = [secretLine, ...Array.from({ length: 5 }, (_, i) => `l${i}`)].join('\n') + '\n';
    const first = computeProposalPreview(repo, 'core/src/n1.ts', firstContent);
    expect(first.isNewFile).toBe(true);
    expect(first.secretRedacted).toBe(true);
    expect(first.hunk).toContain(WITHHELD);
    expect(first.hunk).not.toContain(AKIA);

    // (2) past the 120-line cap: the secret line is never reached, and nothing of it leaks
    const lines2 = Array.from({ length: 200 }, (_, i) => `l${i}`);
    lines2[150] = secretLine;
    const pastLines = computeProposalPreview(repo, 'core/src/n2.ts', lines2.join('\n') + '\n');
    expect(pastLines.truncated).toBe(true);
    expect(pastLines.hunk).not.toContain(AKIA);
    expect(pastLines.hunk).not.toContain(AKIA.slice(0, 8)); // not even a prefix

    // (3) past the 8000-char budget: a join-then-slice rewrite would emit a PREFIX of the secret line
    const lines3 = Array.from({ length: 60 }, (_, i) => `pad ${i} ` + 'x'.repeat(180));
    lines3[50] = secretLine;
    const pastChars = computeProposalPreview(repo, 'core/src/n3.ts', lines3.join('\n') + '\n');
    expect(pastChars.truncated).toBe(true);
    expect(pastChars.hunk).not.toContain(AKIA);
    expect(pastChars.hunk).not.toContain(AKIA.slice(0, 8));
    expect(pastChars.hunk.length).toBeLessThan(9000);
  });
});

describe('secretRedacted honesty in the negative', () => {
  it('stays false on a clean diff — the withheld banner never cries wolf', () => {
    write('core/src/h.ts', 'one\ntwo\nthree\n');
    const pv = computeProposalPreview(repo, 'core/src/h.ts', 'one\ntwo\n// a perfectly ordinary comment\nthree\n');
    expect(pv.refusedReason).toBeNull();
    expect(pv.secretRedacted).toBe(false);
    expect(pv.truncated).toBe(false);
    expect(pv.hunk).toContain('+ // a perfectly ordinary comment');
    expect(pv.hunk).not.toContain('withheld');
  });
});

describe('unsafe-path refusals are COMPLETE — nothing renders, not merely "does not throw"', () => {
  it('traversal / absolute / NUL / empty relPaths refuse with a reason, an empty hunk, and zero content echo', () => {
    const marker = 'LEAK_MARKER_' + 'ZZ9x7';
    for (const bad of ['../../etc/passwd', '/etc/passwd', 'core/src/a\u0000b.ts', '']) {
      const pv = computeProposalPreview(repo, bad, `${marker}\n`);
      expect(pv.refusedReason).toBeTruthy();
      expect(pv.hunk).toBe('');
      expect(pv.addedLines).toBe(0);
      expect(pv.removedLines).toBe(0);
      // the proposed content must be absent from EVERY field of the result
      expect(JSON.stringify(pv)).not.toContain(marker);
    }
  });
});

// ── End-to-end: the exact JSON /api/aumlok (spatial/serve.ts) and /api/pending
// (spatial/aumlok-approve-serve.ts) serialize is buildAumlokAssistantView. A REAL pending-proposal
// artifact (canonical hash, trusted dir) whose content carries secrets must produce a view whose
// FULL serialization never contains the secret — this catches any future field shipping raw content
// under a new name, which no per-key unit pin can. ──
describe('the FULL assistant view — the exact /api/aumlok and /api/pending payload', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-secretscan-home-'));
  });
  afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });

  it('never contains a secret string anywhere in the serialized view, and flags secretRedacted', () => {
    const content = [
      'export const service = () => {',
      `  const a = "${AKIA}";`,     // classifier-half class
      `  ${BEARER_LINE}`,           // forbiddenContent-half class
      '  return 1;',
      '};',
    ].join('\n') + '\n';
    writeSelfEditProposalArtifact(
      buildSelfEditProposalArtifact('wire the service', [{ relPath: 'core/src/service.ts', content }], NOW),
      home,
    );
    const v = buildAumlokAssistantView({ homeDir: home, repoRoot: repo }, NOW);
    expect(v.pending.length).toBe(1);
    expect(v.pending[0].valid).toBe(true);

    const serialized = JSON.stringify(v);
    expect(serialized).not.toContain(AKIA);
    expect(serialized).not.toContain(BEARER_TOKEN);

    const pv = v.pending[0].preview[0];
    expect(pv.secretRedacted).toBe(true);
    expect(pv.hunk).toContain(WITHHELD);
    // the clean surrounding lines still preview — redaction is per-line, not a blackout
    expect(pv.hunk).toContain('return 1;');
  });

  it('a clean proposal previews normally through the view with secretRedacted false', () => {
    writeSelfEditProposalArtifact(
      buildSelfEditProposalArtifact('tidy docs', [{ relPath: 'docs/notes.md', content: 'hello\nworld\n' }], NOW),
      home,
    );
    const v = buildAumlokAssistantView({ homeDir: home, repoRoot: repo }, NOW);
    const pv = v.pending[0].preview[0];
    expect(pv.secretRedacted).toBe(false);
    expect(pv.hunk).toContain('+ hello');
  });
});
