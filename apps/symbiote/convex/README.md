# aukora-convex-brain — the vendored governed memory kernel (Brick S1a)

Vendored from `aukora-os/node-template/convex@b399db1` (2026-07-05, Option A,
owner-ratified). 14 modules + schema; provenance headers in every file; changes
from donor marked `S1a:`. See `docs/LOCAL_CONVEX_BRAIN_FOUNDATION.md` (plan of
record) and `docs/LOCAL_CONVEX_S0_RESULTS.md` (substrate proof).

## Security posture (B1 + B2, one lock)
- **ZERO public Convex functions.** All 25 registered functions are
  `internalMutation`/`internalQuery` — unauthenticated `/api/mutation` gets
  `FunctionPathNotFound` (live-verified). Reaching them requires the self-hosted
  admin key (AUMLOK-tier custody, NOT AUMLOK-colocated).
- Gate tests enforce this shape: `tests/internalOnly.test.ts` (zero public
  registrations) and `tests/noUseNode.test.ts` (zero "use node") — both verified
  to bite on planted violations.
- Demo material removed by name (demo node-id fallback, demo operator/founder
  seeds, `popGatedAct`/`runPopCrash`/`runKeyRotation` demo lanes). `AUMA_NODE_ID`
  and `AUMA_OPERATOR_SEED` are now REQUIRED envs — fail closed when unset.
- Multi-node modules are NOT vendored (parked); the cross-grant resolution path
  fails closed against the empty `node_*` tables by design.

## Tests
`bash test.sh` — standalone: installs, codegen-fallback, vitest (edge-runtime +
convex-test). 16 files / 174 tests. Donor tests unsatisfiable in this slice are
listed in the S1 INBOX note (24 skipped, each with a reason).

## ⚠ Deploying — do NOT run `convex deploy` from THIS directory
Running the CLI from `convex/` itself treats this dir as an app root and
**silently deploys zero functions** (false green — verified). Deploy from a
proper app root one level up (node_modules must not live inside the functions
dir), with `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` + `CI=1`.
The real deployment wiring lands with Brick W3 (`scripts/` lifecycle).

---

## Historical contract (pre-S1a, preserved)

# convex/ — Kira durable brain contract

This folder is the Convex-facing contract for the seed-native Kira brain.

The implementation that runs today is in:

- `core/src/kiraBrain.ts`
- `core/src/kiraConvexMirror.ts`
- `scripts/kira.sh`

The durable Convex shape is:

```text
kira_receipts
kira_atoms
kira_head
```

Law:

```text
Convex persistence does not add authority.
Memory suggests, never authorizes.
Writes require a governed apply lane.
Read/recall remains advisory-only.
```

The pure mirror tests prove the local brain can round-trip through Convex-shaped
rows without breaking receipt-chain verification or recall.
