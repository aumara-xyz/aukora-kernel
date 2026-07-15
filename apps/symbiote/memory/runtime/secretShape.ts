// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.83 (Codex signer-entropy gap) — the daemon's anti-secret-stash backstop, extracted PURE so the regression is a real
 * committed unit test (the daemon imports it; vitest imports it). It answers: does a memory-fact value contain a token that
 * looks like an unlabeled SECRET (K's 64-hex shape, or a base64/base64url blob)? This is DEFENSE-IN-DEPTH behind the gate's
 * SECRET_CONTENT scan (which runs first and catches LABELED shapes: sk-, AKIA, JWT, key=…). §13: pure predicate, no authority.
 *
 * The hard constraint: a real FILE PATH / identifier ("aukora-ide/identity/MATERNAL_ANCHOR.v1.md", "SOME_LONGER_IDENTITY_DOC")
 * must SIGN, while a high-entropy secret must be REFUSED. Codex's gap: the old rule required a token to contain BOTH a digit
 * AND a letter, so a letters-only/hex-shaped token (e.g. "dir/abcdefabcdef…") signed. Three branches close it:
 *   (1) a 24+ HEX RUN anywhere in the token (K=64hex; also "dir/<hex>" — searched, not whole-token) — letters a–f count.
 *   (2) a base64 token WITH a digit, whole-token over the base64 alphabet incl. `/` — the AWS slash-secret + digit-bearing blobs.
 *   (3) NO-DIGIT high-entropy: a 24+ run of PURE LETTERS after stripping path/identifier separators (/ _ -), with high
 *       character diversity — a letters-only base64 secret. Paths/identifiers split into <24 segments and pass.
 * Tokens are first split on whitespace and `.` so a versioned filename's digit ("…ANCHOR.v1.md") separates out (no path FP).
 * Errs toward OVER-block on exotic inputs (long single words, slash+digit dir names) — the safe direction for a secret backstop.
 * Known narrow residual: a letters-only base64url secret that uses internal `/ _ -` and has NO digit can still slip (contrived;
 * a random base64 secret of length ≥24 almost always contains a digit → branch 2; and the crown-jewel K is hex → branch 1).
 */
export function looksLikeSecretToken(s: string): boolean {
  for (const tok of String(s).split(/[\s.]+/)) {
    // (1) HEX run ≥24 anywhere (K = 64 hex; catches a hex blob with a path/word prefix like "dir/abcdef…"; a–f are letters).
    if (/[a-fA-F0-9]{24,}/.test(tok)) return true;
    // (2) base64 token WITH a digit (alphabet incl. `/`) — AWS secret access key "wJalr…/…", digit-bearing base64 blobs.
    if (tok.length >= 24 && /[0-9]/.test(tok) && /[A-Za-z]/.test(tok) && /^[A-Za-z0-9+/=_-]+$/.test(tok)) return true;
    // (3) NO-DIGIT high-entropy letters-only run: strip path/identifier separators, then a ≥24 pure-letter segment with ≥12
    //     distinct letters is a letters-only secret. Real paths/identifiers split into short word-segments and never reach 24.
    for (const seg of tok.split(/[/_-]+/))
      if (seg.length >= 24 && /^[A-Za-z]+$/.test(seg) && new Set(seg.toLowerCase()).size >= 12) return true;
  }
  return false;
}
