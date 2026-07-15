# Integration Spec — conversation-distiller → governed memoryAppend

## What this brick is
A **pure** distiller: `distillConversation(turns, opts?) → DistillResult`. It converts a chat transcript into ranked, capped, hedge-preserving, forbidden-content-scrubbed **summary atoms**. It performs NO capture, NO write, NO Convex, NO model call, and grants NO authority. This is the testable core of Auma's conversation lane, built UNWIRED so the wiring can be reviewed on its own.

## Exact interface (what Fable imports)
```ts
import { distillConversation, distillGrantsAuthority,
         type ConversationTurn, type DistilledAtom, type DistillResult,
         type ConversationRole, type DistillOptions } from '../src/conversationDistiller';

type ConversationRole = 'owner' | 'auma' | 'system';
interface ConversationTurn { role: ConversationRole; text: string; at?: string }
interface DistillOptions   { maxAtoms?: number; minChars?: number } // defaults 12 / 12

interface DistilledAtom {
  text: string;            // collapsed, <=280 chars, hedge-preserving, never verbatim
  role: ConversationRole;
  at?: string;             // passed through verbatim iff present on the source turn
  rank: number;            // deterministic scope-aware weight (higher = keep first)
  hedged: boolean;         // true iff the summary preserves a source hedge
  truncated: boolean;      // true iff the source overran the cap (a ' …' marker is in text)
  advisoryOnly: true; grantsAuthority: false;
}

type DistillResult =
  | { ok: true;  atoms: DistilledAtom[]; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; reason: string;         advisoryOnly: true; grantsAuthority: false };
```
`distillGrantsAuthority()` is the mechanical mirror of `workOrderGrantsAuthority` / `brainGrantsAuthority` — always returns `false`.

## How Fable wires it (the LATER, ratified step)
1. **Source of turns.** The conversation-capture lane (out of scope here) produces `ConversationTurn[]`. Fable calls `distillConversation(turns)` — NEVER inside this module; the call site lives in the wiring layer.
2. **Result handling — fail closed.**
   - `ok:false` → do NOT write anything. Surface `reason`; drop the batch.
   - `ok:true` with `atoms:[]` → valid; nothing summary-worthy. No write, no error.
3. **Feed each atom to the governed path.** For each `DistilledAtom`, build a `kiraBrain.IngestInput` and route it through the **governed `memoryAppend` transport** (the ratified write path into the LIVE Convex brain) — NOT by calling `ingestMemory` directly against a local file. Suggested mapping:
   ```ts
   { kind: 'note', text: atom.text, source: `conversation:${atom.role}`,
     scope: 'conversation',
     tags: ['conversation', atom.role, ...(atom.hedged ? ['hedged'] : []),
            ...(atom.truncated ? ['truncated'] : [])],
     now: atom.at }
   ```
   Rationale: `kind:'note'` (not `'experience'`) marks these as distilled, not raw episodes; `'erasure'` is reserved and would be rejected by `ingestMemory`.
4. **Double-scan is intentional.** `kiraBrain.sanitizeText` re-runs the forbidden-content scan on the write path. This distiller already drops forbidden atoms, so the write-path scan should never trip on distiller output — that redundancy is a feature (defense in depth), not a smell. If it ever DOES trip, that is a real bug signal, not something to suppress.
5. **Authority.** This lane must be wired like `eraseMemory`'s boundary: the distiller is model-callable/advisory, but the APPEND into the live brain still goes through the governed, owner-gated transport. The distiller itself must never be handed a write capability.

## Tests to add WHEN wiring (not in this brick)
- Round-trip: `distillConversation` → governed `memoryAppend` (mocked transport) writes exactly one atom per admissible `DistilledAtom`, zero for `ok:false` / empty.
- The `source`/`scope`/`tags` mapping above lands on the persisted atom and survives `verifyBrainState`.
- A transcript with a secret produces atoms that ALL pass the write-path `sanitizeText` scan (the distiller already dropped the forbidden one) — assert the write path never throws on distiller output.
- Boundary: assert the distiller is NOT reachable from a voice/apply-authority tool that could turn a summary into an apply (mirror the `eraseMemory` authority-boundary test).

## Invariants Fable must not break when wiring
- Do not "fix up" a `[hedged]` atom into a bare assertion. The marker is the hedge-preservation law surfacing; keep it.
- Do not re-expand a `truncated` atom back to the full turn before writing — that reintroduces raw transcript.
- Do not pass `atom` objects with the flags stripped; `advisoryOnly:true`/`grantsAuthority:false` must survive into the persisted record.
