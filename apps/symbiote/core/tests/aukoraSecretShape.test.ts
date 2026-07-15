import { describe, it, expect } from 'vitest';
import { looksLikeSecretToken } from '../../memory/runtime/secretShape';

// 24Z.83 (Codex signer-entropy gap) — the daemon's anti-secret-stash backstop. Codex live-probed `dir/abcdefabcdef…` → it
// SIGNED because the old rule required a digit AND a letter. These are the committed regressions: letters-only hex / long
// letters-only base64 → REFUSE; AWS slash-secret → REFUSE; real path / versioned filename / prose → SIGN.
describe('24Z.83 — looksLikeSecretToken: letters-only & hex-shaped tokens are caught (no digit required)', () => {
  it('REFUSES letters-only hex-shaped tokens (Codex gap)', () => {
    expect(looksLikeSecretToken('abcdefabcdefabcdefabcdef')).toBe(true);          // 24 a–f, no digit
    expect(looksLikeSecretToken('dir/abcdefabcdefabcdefabcdef')).toBe(true);      // Codex's exact probe — hex run behind a path prefix
    expect(looksLikeSecretToken('deadbeefdeadbeefdeadbeefdeadbeef')).toBe(true);  // 32 hex letters
    expect(looksLikeSecretToken('a'.repeat(40))).toBe(true);                      // long a-run is still a hex run
  });

  it('REFUSES a real 64-hex key (K shape), bare and behind path/extension wrappers', () => {
    const K = 'a3f9c2e8b1d47f60a3f9c2e8b1d47f60a3f9c2e8b1d47f60a3f9c2e8b1d47f60';
    expect(looksLikeSecretToken(K)).toBe(true);
    expect(looksLikeSecretToken(K + '.md')).toBe(true);        // .md-suffix bypass closed
    expect(looksLikeSecretToken('secrets/' + K)).toBe(true);   // dir-prefix bypass closed
  });

  it('REFUSES a long letters-only base64 token (no digit, mixed case)', () => {
    expect(looksLikeSecretToken('GhIjKlMnOpQrStUvWxYzAbCd')).toBe(true);           // 24 mixed letters, high diversity
    expect(looksLikeSecretToken('note GhIjKlMnOpQrStUvWxYzAbCd here')).toBe(true); // embedded in prose
  });

  it('REFUSES a slash-bearing base64 secret with a digit (AWS secret access key)', () => {
    expect(looksLikeSecretToken('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBe(true);
    expect(looksLikeSecretToken('aws_creds\nwJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBe(true);
  });

  it('SIGNS a real file path / versioned filename / identifier (no false positive)', () => {
    expect(looksLikeSecretToken('aukora-ide/identity/MATERNAL_ANCHOR.v1.md — your Core Identity; read it for depth')).toBe(false);
    expect(looksLikeSecretToken('see aukora-ide/identity/SOME_LONGER_IDENTITY_DOCUMENT.v2.md for details')).toBe(false);
    expect(looksLikeSecretToken('packages/opencode/src/session/aukora/risk.ts')).toBe(false);
    expect(looksLikeSecretToken('SOME_LONGER_IDENTITY_DOCUMENT')).toBe(false); // 29-char SCREAMING_SNAKE identifier
  });

  it('SIGNS natural-language facts (prose never matches)', () => {
    expect(looksLikeSecretToken("Peter's favorite color is teal and his cat is Boots")).toBe(false);
    expect(looksLikeSecretToken('the maternal anchor is bidirectional and bounded by the dark-mother tests')).toBe(false);
    expect(looksLikeSecretToken('born January 4 2026 under a full Wolf Moon')).toBe(false); // a short number is fine
  });

  it('does not flag low-entropy repeats that are not secret-shaped beyond the hex case', () => {
    // a 24+ run of a single non-hex letter has <12 distinct chars → branch 3 passes (it is not a hex run either)
    expect(looksLikeSecretToken('z'.repeat(30))).toBe(false);
  });
});
