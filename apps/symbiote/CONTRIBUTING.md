# Contributing

> **Pre-release draft.** This project is not yet publicly released and its license is still an open owner
> decision (see `docs/OPEN_SOURCE_DECISION.md`). These guidelines describe how work is done so the process
> is clear if and when contributions are opened.

Thank you for your interest. Aukora is a **local-first, governed** system: it runs on your own machine, and
every change that becomes real passes through a human signature. Please read the boundaries below before
opening a pull request.

## The workflow

1. **Branch, don't push to `main`.** One focused change per branch, one pull request per change.
2. **Open a pull request to `main`.** Describe what changed and why; keep it reviewable.
3. **Green the gate.** Run `bash scripts/test.sh` locally (typecheck + behavior tests + release-package
   check) and make sure it passes before requesting review.
4. **Preflight is available.** `bun run doctor` reports a read-only environment check; `bun run start` is
   the one canonical way to run the node.
5. **A maintainer reviews and merges.** Contributors do not self-merge.

## The authority boundary (non-negotiable)

Aukora's safety rests on one rule: **propose → the owner signs (AUMLOK) → apply.** A contribution can
propose and be reviewed, but it can never grant itself authority, sign, or apply a live change. No pull
request, tool, model, or automation may bypass the human signature at the gate. Changes that weaken or
route around this boundary will not be accepted.

## Privacy and local state

- **Never commit local node state, keys, or personal data.** A node's identity, keys, and memory live
  *outside* the repository on the owner's machine and must stay there.
- **Never commit visitor or waitlist data.** Live data paths are ignored by design; only clearly
  synthetic `*.example` fixtures belong in the repo.
- **Run the secret scan** (`bash scripts/scan-secrets.sh`) before committing, and check its exit code.
- Keep any machine-specific configuration in ignored `*.local.*` files.

## Reporting a suspected secret or vulnerability

If you find a committed secret, an exposed key, or a security-boundary flaw:
- **do not** open a public issue or pull request containing the value,
- **do not** paste the secret anywhere public,
- follow `SECURITY.md` and use the private disclosure route.

## Style

- Match the surrounding code: its naming, comment density, and idioms.
- Keep pull requests small and single-purpose.
- Write honestly — never claim a capability, test result, or release status that is not real.
