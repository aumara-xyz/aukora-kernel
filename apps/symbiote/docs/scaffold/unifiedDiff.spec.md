# Integration Spec — unified-diff engine (Brick #104) → Fable wiring

## What this brick is
A PURE, standalone unified-diff apply engine at `core/src/unifiedDiff.ts`. It grants no authority, touches no gate/signer/apply/convex/scripts module, and does no fs or network I/O. It converts `(diskBytes, unifiedDiff) → fullNewContent` with an exact-match safety guarantee, so a diff-carrying proposal can be turned back into whole-file content that flows through the EXISTING (unchanged) hash → sandbox → gate → AUMLOK path.

## Exact interface (all pure functions on strings)
```ts
export interface Hunk {
  oldStart: number; oldLen: number; newStart: number; newLen: number;
  lines: Array<{ marker: ' ' | '-' | '+'; text: string }>;
}
export type ParseResult = { ok: true; hunks: Hunk[] } | { ok: false; reason: string };
export type ApplyResult = { ok: true; content: string } | { ok: false; reason: string };

export function parseUnifiedDiff(diff: string): ParseResult;
export function applyUnifiedDiff(original: string, diff: string): ApplyResult;
export function diffStats(diff: string):
  { ok: true; added: number; removed: number; hunks: number } | { ok: false; reason: string };
```
- `parseUnifiedDiff` — parses `@@ -oldStart,oldLen +newStart,newLen @@` hunks + `' '`/`'-'`/`'+'` body lines. Skips `---`/`+++`/`diff `/`index ` preamble BEFORE the first `@@`. Omitted length defaults to 1. Empty/whitespace-only diff → `{ok:true, hunks:[]}` (legit no-op).
- `applyUnifiedDiff` — parses then applies. VERIFIES every context and removed line against `original` byte-for-byte at the hunk's position. Multi-hunk supported; hunks must be in order and non-overlapping. Preserves the original's trailing-newline state and CRLF bytes exactly.
- `diffStats` — pure counts; refusal-shaped on malformed input.

## The safety property Fable relies on
`applyUnifiedDiff` REFUSES (never guesses / fuzzy-matches / half-applies) when the diff does not cleanly apply to `original`. This is what lets the rest of the pipeline stay unchanged: a diff that didn't truly see the disk bytes cannot produce a reconstruction, so the hash the owner signs is always bound to content actually derived from real disk bytes.

## How Fable wires it (the ONLY new wiring; do not add it in this brick)
When a proposal file carries a `diff` instead of whole-file `content`, at the point where Fable currently has `ProposalFile = {relPath, content}`:
1. Read the CURRENT disk bytes for `relPath` using the repo's existing read-path resolver (`resolveRepoReadPath` in `core/src/repoReadPathResolver.ts`) — NOT a raw `fs.readFileSync`, so symlink/confinement/sensitive-path defenses still apply.
2. `const applied = applyUnifiedDiff(diskContent, proposalDiff);`
3. If `!applied.ok` → surface `applied.reason` as a proposal REJECTION (fail closed, do not fall back to whole-file). No apply, no signature request.
4. If `applied.ok` → construct the SAME `ProposalFile = { relPath, content: applied.content }` and feed it to the UNCHANGED `buildSelfEditProposalArtifact(goal, files)` in `core/src/selfEditProposalArtifact.ts`. From there `computeProposalHash` / sandbox / gate / AUMLOK are byte-identical to today.

Net effect: the diff is a THROUGHPUT optimization for how the proposal is transported/authored. It changes nothing about what the owner signs — they still sign a hash over the full reconstructed content.

## Tests to add WHEN WIRING (belong in the wiring brick, not here)
- Round-trip: `applyUnifiedDiff(disk, realDiff)` == the intended whole-file content, and its `computeProposalHash` equals the whole-file proposal's hash for the same goal+relPath.
- Stale-disk refusal: a diff generated against an older disk state is REJECTED (not silently applied) when disk has since changed.
- Resolver path: diff application reads through `resolveRepoReadPath`, so a sensitive/symlinked target is refused before any diff is applied.
- Multi-file proposal where one file's diff refuses → whole proposal is rejected atomically.

## Verification already done in this brick
- `core/` isolated typecheck (`core/tsconfig.json`, local tsc) — clean, zero errors.
- `vitest run tests/unifiedDiff.test.ts` — 28/28 passing, deterministic.
- Module has ZERO imports (no fs/network/authority/convex/scripts).