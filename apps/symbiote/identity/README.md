# identity/ — advisory anchors (WITHHELD in v0)

The maternal/identity anchors are advisory-only context (they inform; they never authorize —
SAFETY_LAWS 1, 3). They are **deliberately not shipped in the seed v0** because the source files
carry real PII: a legal name (×12), a pen name, an ancestor name, a date of birth, and counsel
references — all on the publish denylist.

**To bring them in (a deliberate next step):** copy the anchors with every PII token redacted to a
neutral placeholder (e.g. `[OWNER]`, `[PEN_NAME]`), then confirm `scripts/scan-secrets.sh` stays
TIER-1 clean. Only then do they enter the tree.

Until then, the organism has its laws (`docs/SAFETY_LAWS.md`) but not its private story — and that is
the correct, leak-safe default.
