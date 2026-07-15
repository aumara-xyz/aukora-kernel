# receiver/ — the read-only Convex receiver

The read-only-receiver **organs are part of the flat kernel module** and live in
[`core/src/`](../core/src/), because they import their siblings by relative path — splitting them
into this folder would break the import graph. This folder documents the trust boundary; the code is
in `core/src/`.

**Portable receiver mechanics (in `core/src/`):**
- `convexBrainReadonly.ts` — loopback-only read client (`127.0.0.1:3210`), allowlisted queries.
- `convexCanonicalPin.ts` · `convexCanonicalFreshness.ts` — canonical-pin + freshness, fail-closed.
- `convexBrainReadOnlyMount.ts` — enforces loopback-only (`rejectNonLoopback`).
- memory organs: `episodeMemory.ts` · `mdlProcessMemory.ts` · `structuralMemory.ts` · `restingGlyph.ts`.

**⚠ Needs a focused cleanup round before commit (see `docs/` worklist):**
- `convexBrainSnapshot.ts` and `convexTopology.ts` are **aukora-os host-coupled inventory** files —
  they enumerate aukora-os's private convex backends (vk / dojo / feral / harvester) and an
  AUMA-ONE donor catalog (paladin / knvs / organism), and their tests assert `schemaFound===true`
  (require aukora-os's `node-template/convex`). They must be rewritten host-agnostic, or quarantined,
  before they ship clean.

**Law:** Convex is **read-only** unless a signed apply lane is explicitly built and tested. Loopback
only. No mutation path from memory. (SAFETY_LAWS 2.)
