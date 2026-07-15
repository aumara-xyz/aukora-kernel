# Claim Status

Aukora Fu separates implemented evidence from roadmap language.

## VERIFIED ENGINEERING

At accepted D6 commit `72173be9e491fe6a0c41007a1e6209ebd230dffb`:

- the canonical capability-boundary guard, TypeScript check, and 146 offline tests pass;
- the Python reference reproduces the published EvidencePack KATs;
- EvidencePack validation enforces literal `advisoryOnly:true` and `grantsAuthority:false`;
- canonical sealing and verification use an inert snapshot;
- the directed dot-terminated JWT adversarial vector has deterministic linear scanner work;
- the EvidencePack, council, and glyph pure subset contains no signing, apply, filesystem, model-provider, or authority capability;
- the separate spend-ledger adapter is the one boundary-guarded filesystem exception and grants no authority.

These claims describe the tested bytes and environments. They are not a production certification or independent audit.

## DESIGN / ROADMAP

- a canonical filesystem reader that produces bounded EvidencePacks;
- hardened observer transports and an automated offline Fu round controller;
- a packaged import surface for the Aukora workspace;
- a unified read-only Seed demonstration.

Roadmap items are not shipped features.

## NOT CLAIMED

- exhaustive secret detection or data-loss prevention;
- truth, completeness, or provenance of caller-supplied evidence;
- authorization, signing, execution, rollback, or self-modification;
- resistance to a compromised host, dependency, runtime, or operator;
- constant-time or side-channel resistance;
- global consensus, model independence, or unbiased judgment;
- production readiness, formal verification, or an independent security audit.

## Evidence rule

Every public claim should name the exact commit, command or vector, observed result, and untested boundary. A model-generated report is advisory evidence, not proof by itself.
