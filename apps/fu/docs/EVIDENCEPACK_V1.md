<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (c) 2026 Aukora -->

# EvidencePack v1 — contract (Round-11 settled)

> The pure, offline, deterministic evidence boundary for Aukora Fu. It carries **evidence**, never
> authority. `advisoryOnly: true` and `grantsAuthority: false` are literal, validator-enforced
> invariants. This document is the byte-level source of truth; the implementation (`src/evidence/`)
> agrees with it field-for-field. **Commit 1 is pure** — no filesystem, network, environment,
> subprocess, transport, observer, spend, signing, apply, or repository mutation. The filesystem
> reader (Commit 2) is not part of this.

## 1. Law
The Seed has hands to heal, but no authority to forge. A green pack proves *what was presented and
that it is internally consistent* — it does **not** prove disk fidelity, provider honesty, or that
`testRuns[]` output came from a real command (§13).

## 2. Body vs. envelope
`EvidencePackV1` is the reproducible **body** (no digest field). `EvidencePackEnvelopeV1 = { body,
packDigest }`. Every body field participates in `packDigest`; `packDigest` does not. **No timestamp
lives in the pack** (decision 3) — a later controller-run artifact may bind `createdAtIso` alongside
`packDigest`.

## 3. Subject (snapshot-primary, decision 1)
`repoId`, `headCommit` (40-hex), `headTree` (40-hex). Optional comparison: `baseCommit` + `baseTree`
— **both** present or **both** `null` (`E_BASE_PAIR`). There is **no** `diffSha256` — a diff may only
be carried later as exact bound diff bytes.

## 4. Evidence (decision 2)
`testRuns[]` is the evidence: `command[]`, `cwdRelative`, `exitCode`, `stdoutSha256`, `stderrSha256`,
`stdoutBytes`, `stderrBytes`, `stdoutExcerpt`, `durationMs|null`, `toolVersions`. **Narrative
`claims[]` are excluded** from EvidencePack (they belong in a separate Fu advisory artifact).

## 5. Files / omissions
`files[]`: `path` (relative POSIX, NFC), `kind` (`text|binary`), `originalSizeBytes`,
`includedByteStart`, `includedByteEnd`, `truncated`, `sha256` (over the full original bytes), `encoding`
(`utf8|base64|omitted`), `content`. `omissions[]`: `path`, `reason` (**closed enum**, decision 10),
`originalSizeBytes|null`, `sha256|null`. A path is in `files` XOR `omissions`. Both arrays sort by NFC
`path`.

## 6. Canonicalization (JCS-aligned)
Minified UTF-8 JSON, LF, no insignificant whitespace. Object keys sorted by UTF-16 code unit; arrays
preserved in given order; numbers are finite safe integers emitted without exponent (`-0`→`0`);
strings via JSON escaping.

## 7. Digest — domain-separated + length-framed
`packDigest = hex( SHA-256( utf8("aukora-fu-evidence-pack-v1") ‖ 0x00 ‖ uint64BE(len(C)) ‖ C ) )`,
`C = canonicalBytes(body)`. Lowercase 64-hex.

## 8. Fence (decision 4 — derived, never stored)
The inert-data fence is derived at presentation from `(domain, packDigest, counter)`, incrementing the
counter until neither `<<AUKORA-DATA:nonce>>` nor `<<AUKORA-END:nonce>>` occurs in any content. It is
**not** a stored body field, so the reproducible body carries no presentation state.

## 9. Catalogue (decision 5)
`catalogueId` (bound body field) must equal `SHA-256(canonicalBytes(SECRET_CATALOGUE))`. Any catalogue
change changes the id. The catalogue is used to **refuse** (never redact-and-retain) any pack whose
included text content is secret-shaped (decision 10, `E_SECRET_CONTENT`).

## 10. Limits (decision 6 — registry-owned)
`limitsProfileId` names a registered immutable profile (`LIMITS_PROFILES`); the validator uses that
profile's `maxFileBytes`/`maxPackBytes`/`maxFiles`. A pack **cannot self-declare** ceilings; a self-
declared `limits` object is an unknown field.

## 11. Test identity (decision 7)
Ordering/dedup key length-frames every argv element and the cwd:
`argv.map(a => len(a)+":"+a).join(",") + "#" + len(cwd)+":"+cwd`. `["a b"]` ≠ `["a","b"]`. Duplicate
identities are rejected (`E_DUP_TEST`).

## 12. Validation invariants (decisions 8, 9, 12, 13)
Recursive closed schema — unknown fields rejected at every depth. Authority-shaped keys rejected on
object **keys only**, never on content (`E_AUTHORITY_SHAPED_KEY`). Relative POSIX + NFC paths
(`E_REL_PATH`/`E_NOT_NFC`); **no raw NUL** in any string (`E_NUL`); lone-surrogate rejection; lowercase
exact `sha256`/git-sha; safe integers; content length vs. byte range verified for utf8/base64/omitted
(`E_CONTENT_LENGTH`); aggregate limits (§10). The pack contains **no** signature, approval, token,
grant, apply, signing, mutation, or authorization field.

## 13. Honest limitations
A pure pack cannot prove disk fidelity, provider honesty, or real command execution. It proves
internal consistency, tamper-evidence, catalogue binding, content/range agreement, and limit compliance.

**Secret scanning is best-effort, not a guarantee.** The scanner refuses content matching a *curated*
catalogue of known credential shapes, folded through NFC + NFKC + NFD + zero-width/combining-mark stripping +
a confusable skeleton so common Unicode obfuscation (compatibility, precomposed/decomposed, combining-mark
splits) cannot dodge a catalogued shape. It deliberately has **no generic entropy backstop**: a pack's
legitimate purpose is to ship file evidence (base64 binaries, minified code, hashes, git SHAs) which is
itself high-entropy, so an entropy detector would either false-positive on real evidence or be tuned too
loose to help. Consequently a *novel* credential format with no catalogued shape, or a low-entropy
structured secret, can pass. **"No secret found" is advisory — never treat it as proof the pack is
secret-free.** Adversarial red-teaming (Round-14) confirmed this bound is real; the catalogue was widened in
response, but exhaustive detection is impossible by construction.

**Secret scanning is O(n), not O(n²).** The `url-userinfo` (`scheme://user:pass@host`) and `jwt`
(`eyJ…​.…​.…`) detectors are **linear hand-written scanners** (`SECRET_CATALOGUE.scanners`), not regexes —
their former greedy regexes were O(n²) ReDoS on adversarial repeated-prefix input. The `jwt` scanner (D5) has
**no length cap and no backtracking**, so it detects arbitrarily large enterprise / `x5c` tokens (the D4
capped regex missed payloads > 4096 chars). Additionally, every remaining *catalogue regex* whose greedy
quantifier precedes a required token has a **bounded** upper limit (`{m,N}`, not `{m,}`) so per-start-position
work is O(N) and scanning is O(n·N) = linear; terminal `{m,}` quantifiers (no trailing token) do not backtrack
and stay open. This keeps `validatePackBody` linear on legal within-limits input (minified JS, lockfiles,
base64 blobs), verified by a deterministic step-budget test (not a load-sensitive wall clock).

The remaining bounds are **best-effort ceilings** — a matchable run longer than its bound is not matched:
the url-userinfo scanner detects a userinfo (`user:pass`) of length **≤ 512** (511 and 512 detected, 513 the
first miss; the scheme window is 40); the bounded regexes cap their variable segments (`env-value ≤ 4096`,
`sendgrid ≤ 512`, `pem label ≤ 64`). The `jwt` scanner has no such ceiling.

## 14. Known-answer vectors (decision 11)
Fixed, independently recomputable vectors are pinned in `test/evidencePackV1.test.ts` and reproduced by
`scripts/pyref/evidence_canonical_ref.py` (Python) and under Node + Bun. The exact values (catalogue v3):
- `catalogueId` = `1504a1587d9464712076f331fda35327f4ba14fa9d9a260d1ac0285aade07aa7`
- minimal-body `packDigest` = `84e9b48d33e007101157f42dac7b0d05befb8a88f8812384ef95485fced862d2`
- maximal-body `packDigest` = `03cf93eb0f97d3fde24963aa409e272ef1d8cafcceb46e534412fa32a63112e1`
- fence nonce `3a23cb4c6895e0ca934a95f328985122a706ccf9d9188a2897e9fbef158acc28` for `deriveFenceNonce("00"×32,
["hello","world"])`.

## Round-12 (Commit D) amendments
Building on the settled contract, Commit D adds:
- **File hashes:** `sha256` → `fullSha256` (full original bytes) + `includedSha256` (recomputed from the
  **decoded** included content); a complete file (`start=0`, `end=originalSize`) requires
  `includedSha256 === fullSha256`.
- **No `encoding:"omitted"`** on files; excluded entries live only in `omissions[]`. `text`⇒`utf8`,
  `binary`⇒`base64` with a **canonical base64 round-trip**.
- **Exact partition:** `files.path ∪ omissions.path = rootAllowlist`, `files.path ∩ omissions.path = ∅`.
- **Path discipline everywhere:** relative-POSIX + NFC for file/omission/allowlist paths and test `cwd`
  (`"."` allowed only for `cwd`). **No raw NUL** in any string.
- **Secret projections** (raw, NFC, zero-width-stripped, confusable-skeleton) applied to utf8 content,
  base64-decoded-as-text, and `stdoutExcerpt`/`stderrExcerpt`; any hit **refuses** the pack.
- **Open maps:** keys must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`; values must be NFC.
- **Test identity** length-frames every argv element and cwd by **UTF-8 byte length**; argv NFC-asserted.
- **Canonicalizer rejects `-0`** outright (decision 14). **Strict canonical-wire verification**
  (`verifyCanonicalWire`) rejects BOM, leading/trailing/alternate whitespace, duplicate keys, alternate
  numeric/escape encodings, and malformed Unicode (decision 15).

## Round-13 (D1) amendments
- **Full-width fence:** `deriveFenceNonce` uses the entire 64-hex SHA-256 (no truncation).
- **Exact base64 secret scan:** for `base64` file content, always scan a deterministic ASCII-byte
  projection (printable ASCII + TAB/LF/CR retained; every other byte → LF), which catches an ASCII
  secret hidden inside invalid-UTF-8 binary; additionally strict-decode UTF-8
  (`TextDecoder("utf-8",{fatal:true})`) and, on success, run the raw/NFC/zero-width/confusable
  projections, which catches a confusable secret inside valid-UTF-8 base64.

## Round-14 (D2) immune-gate amendments
- **Prototype/inherited discipline:** every closed-schema node must be an ordinary or null-prototype object
  (`E_PROTO`) with all required fields as **OWN** properties (`E_MISSING_FIELD`) — an inherited authority
  literal or envelope field cannot validate while vanishing from the canonical (own-key) bytes.
- **Total file ceiling:** `rootAllowlist.length ≤ maxFiles` (`E_LIMIT_ALLOWLIST`) — since the exact partition
  makes the allowlist the union of files + omissions, a large `omissions[]` can no longer bypass the ceiling.
- **Open maps:** keys are normalized (lowercase, separators stripped) before authority screening against an
  expanded lexicon (`apiKey`, `signingKey`, `privateKey`, `accessToken`, `bearerToken`, credential/password/
  secret/seed/token/approve/apply/grant/unlock/mutate/signature families); every map **value** is secret-scanned.
- **Secret scan of all free-text structural channels:** `repoId` (also NFC-asserted), argv, cwd, and every path.
- **Immutable sealed evidence:** `sealEnvelope` canonical-clones the accepted body (ordinary prototypes, no
  extra/inherited fields) and recursively **freezes** the envelope; `renderForSeat` **re-validates** and refuses
  invalid or post-seal-mutated evidence.
- **Stream truth:** `UTF8(excerpt).length ≤ claimed streamBytes` (`E_STREAM_LENGTH`); when equal, the excerpt
  IS the whole stream so `SHA256(UTF8(excerpt)) === claimed streamSha` (`E_STREAM_HASH`).
- **Surrogates + composed projection:** the canonicalizer rejects lone surrogates in keys and values at any
  depth (so `verifyCanonicalWire` refuses lone-surrogate JSON); a composed
  `confusableSkeleton(stripZeroWidth(NFC(text)))` projection catches layered obfuscation.
- **Catalogue + lexicon completeness (red-team round 3):** the secret catalogue adds common credential
  families — `ghp_`/`github_pat_`, `xox[baprs]-`, `AIza…`, `sk_(live|test)_`, `npm_`, `glpat-`, `sk-ant-`
  (Anthropic), `SG.…` (SendGrid), `AccountKey=…` (Azure), and a shape-based `scheme://user:pass@` matcher
  for connection-string / DB-URL leaks (the most common real exposure). The invisible-strip projection also
  removes Unicode combining marks (`\p{M}`), and two **NFKC** projections were added so fullwidth
  (`U+FF01…`), mathematical-alphanumeric (`U+1D400…`), superscript, and circled lookalikes fold back to
  ASCII where the catalogue matches — a proven fullwidth/math-monospace bypass of a live credential.
  The authority-key lexicon adds the bare `key`/`cert`/`auth`/`pat`/`ssh` families. Each catalogue change
  re-derives `catalogueId` (and the min/max KAT digests). A generic entropy backstop was **deliberately
  omitted** — see §13; it would refuse legitimate high-entropy file evidence. Secret detection is
  best-effort, not exhaustive.

## Round-16 (D4) membrane repair
Three reachable defects found by the Round-15 exact-head audit are closed:
- **Snapshot-first seal + exotic array rejection.** `sealEnvelope` previously validated the live body then
  *re-read* it while cloning; an accessor-defined array index (arrays were screened only with `Array.isArray`)
  could return clean bytes to validation and dirty bytes to the clone, producing a digest-bound value that
  validation never approved. D4 takes ONE canonical snapshot, then validates, digests, and freezes that exact
  snapshot. `verifyEnvelope` and `renderForSeat` are likewise snapshot-first, so the same read-twice split
  cannot resurface in the verify/render paths for a live-accessor envelope. Additionally, every array
  container is run through `ordinaryDataArray`: a non-standard prototype,
  symbol own key, hole (sparse array), non-index own property, non-enumerable index, or accessor index is
  refused (`E_PROTO`).
- **NFD-first projection.** NFC/NFKC *compose*, so a precomposed diacritic lookalike (e.g. `ó` for `o`,
  `Á` for `A`) survived every projection and its base letter never surfaced. D4 adds
  `confusableSkeleton(stripZeroWidth(NFD(text)))`: NFD decomposes the precomposed char into base + combining
  mark, which `\p{M}` stripping removes, exposing the base letter where the catalogue matches. Decomposed and
  precomposed regression vectors are pinned.
- **Bounded linear url-userinfo scanner + catalogue-wide ReDoS bounding.** The `scheme://user:pass@host`
  detector was a greedy regex that made `validatePackBody` O(n²) on benign long runs (a proven ReDoS: 40 KB ≈
  12.6 s, 1 MB ≈ 2 h). D4 replaces it with `scanUrlUserinfo`, a bounded O(n) scan (each `://` located once;
  scheme + userinfo checked in bounded windows), listed in `SECRET_CATALOGUE.scanners` so `catalogueId` still
  binds it. Adversarial re-testing found the **same quadratic class in two more catalogue regexes**
  (`env-secret-assign` on `API…`, `jwt` on `eyJ…`; `repoId='API'×n` took ~7 s at 40 KB) — so D4 additionally
  **bounds every greedy quantifier that precedes a required token** (`{m,N}` not `{m,}`) across the catalogue
  (pem/jwt/env-secret-assign/sendgrid); terminal `{m,}` quantifiers are left open. All prefix classes now scan
  in near-linear time (a scaling regression test asserts sub-quadratic for `API…`/`eyJ…`/`-----BEGIN …`/`SG.…`/
  `a://…`). Schema bumped to `-v3`; KATs re-pinned. This scope extension beyond the round's stated url-userinfo
  change is deliberate — leaving the other two quadratic patterns would keep the immune gate DoS-able and make
  the "linear" claim false.

## Round-18 (D5) final byte-pin cleanup
Freeze-quality fixes found by the D4 exact-head audit (no P0/P1; correctness/coverage/robustness):
- **`verifyEnvelope` is a total boolean predicate.** Any canonicalization / validation / digest error on
  hostile inert input (`-0`, lone surrogate, unsafe integer, a throwing accessor, a non-object) returns
  `false` instead of throwing (the snapshot read is inside the `try`). Pinned with bad-integer / lone-surrogate
  / hostile-descriptor vectors.
- **URL userinfo boundary pinned.** The `@` may sit at index `uStart + 512` inclusive, so a `user:pass` of
  length exactly **512 is detected**; **513 is the first miss**. 511/512/513 behaviour is pinned and documented.
- **Deterministic linear JWT scanner replaces the capped regex.** D4's bounded `jwt` regex (`{10,4096}`
  payload) introduced an arbitrary > 4096-char false negative (large enterprise / `x5c` tokens). `scanJwt` is a
  linear scan with **no length cap and no backtracking**: on every failed candidate the cursor advances PAST
  the consumed seg-1 run (D6 — D5 advanced by only +1 when that run ended in a dot, a reachable O(n²) on
  `'eyJ'×K + '.'`; deterministic dot-terminated regression vectors are pinned).
  It is listed in `SECRET_CATALOGUE.scanners` (`jwt-v1`) so `catalogueId` binds it. `> 4096` and large-`x5c`
  detection vectors are pinned.
- **Deterministic step-budget replaces the flaky wall-clock ratio.** `scanStepBudget` counts exact character
  steps of the hand-written scanners; the test asserts an O(n) step count (identical on every machine), so
  correctness no longer depends on scheduler load. A generous wall-clock smoke remains **non-normative**.
- **Public KAT values corrected** to the exact TS/Python digests (§14). Honest best-effort limitations (§13)
  and all D4 hostile tests are preserved.

## Error taxonomy
`E_SCHEMA, E_NOT_OBJECT, E_MISSING_FIELD, E_UNKNOWN_FIELD, E_WRONG_TYPE, E_ADVISORY_LITERAL,
E_AUTHORITY_SHAPED_KEY, E_NOT_NFC, E_REL_PATH, E_NUL, E_INVALID_UTF8, E_BAD_INTEGER, E_BAD_SHA,
E_BAD_GITSHA, E_BASE_PAIR, E_ARRAY_UNSORTED, E_DUP_PATH, E_DUP_TEST, E_BAD_RANGE, E_BINARY_INLINE,
E_BAD_ENUM, E_CONTENT_LENGTH, E_SECRET_CONTENT, E_OMISSION_REASON, E_LIMIT_PROFILE, E_LIMIT_FILES,
E_LIMIT_FILE_BYTES, E_LIMIT_PACK_BYTES, E_CATALOGUE_ID, E_DIGEST_MISMATCH, E_HASH_INCLUDED,
E_HASH_COMPLETE, E_BASE64_NONCANONICAL, E_PARTITION, E_MAP_KEY, E_MAP_VALUE_NFC, E_CWD, E_PROTO,
E_STREAM_LENGTH, E_STREAM_HASH, E_LIMIT_ALLOWLIST`.
