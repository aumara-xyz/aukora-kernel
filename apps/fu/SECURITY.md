# Security Policy — Aukora Fu

> Aukora Fu is a **research/engineering artifact**, not a production security boundary. The canonical layer is deliberately advisory-only and authority-free.

## Supported surface

Security reports may cover:

- EvidencePack canonicalization, digest binding, validation, and secret-shape scanning;
- the offline council, glyph core, and spend ledger;
- the canonical capability-boundary guard;
- the loopback legacy observer and explicit legacy runner safety gates.

Deployments, model providers, operator hosts, and downstream integrations are outside this repository's assurance boundary.

## Trust model

- Evidence is untrusted data, even when its digest verifies.
- Fu analysis is advisory. It cannot mint authority or approve an effect.
- Secret scanning is curated and best-effort; it is not a data-loss-prevention guarantee.
- The host, JavaScript runtime, dependencies, and caller are trusted to execute the audited bytes.
- Provider contact is absent from the canonical offline verification path.

## Honest residuals

- No independent security or cryptographic audit has been completed.
- SHA-256 integrity and canonical known-answer vectors do not prove source truth or execution integrity.
- The secret catalogue cannot cover every encoding, confusable, credential format, or metadata leak.
- The legacy runner can send selected source material to configured providers when explicitly enabled.
- Timing and side-channel resistance are not claimed.
- A compromised host can replace code, fixtures, or outputs.
- No signing, custody, apply, rollback, or production authority mechanism ships here.

See [LIMITATIONS.md](LIMITATIONS.md) for the broader boundary.

## Reporting a vulnerability

Do **not** open a public issue for a security vulnerability.

Report privately through [GitHub Security Advisories](../../security/advisories/new), or email **auma@aumara.xyz**. Include the affected commit, minimal reproduction, impact, and whether public disclosure is already known.

We will acknowledge a report within 72 hours and target a 90-day coordinated disclosure window. This project is offered without warranty.
