# Nebius G1 import status — Round 23

**Status: QUARANTINED / DO NOT DEPLOY / DO NOT ARM**

The sealed local bundle is preserved here so the work cannot be lost. It is not imported into the Kernel or any production adapter.

Independent reproduction found these blocking defects:

1. A final-component symlink can escape the intended base directory during artifact writes.
2. Artifact verification is not exact-key closed and can accept recomputed authority-shaped fields.
3. D6 verification does not bind the pinned commit, tree, complete tracked-tree digest, or entry count strongly enough.
4. The hard stop and teardown implementation is not wired into the controller.
5. The sealing script does not enforce the complete runtime dependency closure or the deployment allowlist.
6. There is no CLI/service runner proving the canary or deadline claims.
7. The current evaluator is a deterministic rehearsal fixture, not the canonical Aukora Fu council.
8. The sealed manifest omits material inputs including `package-lock.json`, the audit document, and the manifest itself.

Promotion requires a fresh audit demonstrating exact-key schemas, no-follow writes, immutable D6 provenance binding, wired hard-stop/teardown, complete closure sealing, canonical Fu execution, and a self-covering manifest.

Original claimed bundle digest: `3d70472f81a2ae839bca1e6472a807f7faa57564d2b50711c16c5ee93972912f`.

