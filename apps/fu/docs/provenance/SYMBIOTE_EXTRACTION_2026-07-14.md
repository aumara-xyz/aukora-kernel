# Aukora Fu canonical-core extraction — 2026-07-14

> **HISTORICAL PROVENANCE RECORD — SUPERSEDED FOR CURRENT STATUS.** This page records the state of the
> initial 2026-07-14 extraction. The repository is now public and AGPL-3.0-or-later licensed, and
> EvidencePack v1 is implemented at accepted D6. See [README.md](../../README.md), [CLAIMS.md](../../CLAIMS.md),
> and [LIMITATIONS.md](../../LIMITATIONS.md). The source pins and byte hashes below remain provenance evidence.

This save point recorded the one-time extraction of the hardened advisory council from Aukora
Symbiote into the existing `aumara-xyz/aukora-fu` repository. At that historical point it did not
change repository visibility, licensing, authority semantics, or release status.

## Source pins

- Donor repository: `aumara-xyz/aukora-symbiote`
- Donor commit: `41707f910d10696482c28ee80346c252a55e9d41`
- Donor tree: `7020cc0230fad3dd793d7ae6a50ddf05f6e3eac4`
- Target base: `aumara-xyz/aukora-fu@5a98e44e7917a576868b51ebd22a50f52446cc66`
- Target base tree: `7ab6e9b23e5ca1672a7082c925152a56cd26ec5c`

## Extracted source evidence

| Donor path | Git blob | SHA-256 of donor bytes |
|---|---|---|
| `core/src/aukoraFuCouncil.ts` | `b34b6a0cf3b7f5fefe29c1bc993587a0c27266cf` | `0f2f6b2e0d7df479b18c135d8b35437d0727875fd6c03d3568c4463ee2b61663` |
| `core/src/aukoraFuEngine.ts` | `4239132de10d0e88d157ae1f2526861adf84f9a8` | `5b68d0f409697c83f4d076ec7cb71eea344275879711471898451a7e1dafbb3a` |
| `core/src/aukoraFuSpendLedger.ts` | `60d4407cf4ad8056802e3dbb3be7fd88a0ecec60` | `1b9935a0eb1c4e254638281a5a4197cc627d9764e1f6f57c9663a6ba5d5a04d3` |
| `core/tests/aukoraFuCouncil.test.ts` | `7a8169fd6d3980660c2f65030626c2aaceff2c44` | `084e602884197ddc4b79a41544e67cf9d01d12c44ee5caa3ad9212eac52e6f5d` |
| `core/tests/aukoraFuEngine.test.ts` | `2742e56d7a3092e7db12ffc1ca5c4b4d965422a1` | `5174b7180f50dfb3c61b916867aeb63887dd8a4baa1cd721c8cb5065d48a0978` |
| `core/tests/aukoraFuSpendLedger.test.ts` | `99bff7fd48b720b2bdf341463dfbd4d862e94417` | `08badddc16621d3531eb586ecff94a11b2333d8a7edaad6570e3453c531e1d4b` |

The captured reply fixtures were also extracted as test evidence. They contain model output only and
no credentials or authority material.

| Donor fixture path | Git blob | SHA-256 of donor bytes |
|---|---|---|
| `core/tests/fixtures/fusion-replies/deepseek-v4-pro-dist-reordered.txt` | `eb33d0940618f88147d79bfd613794c9fe760b65` | `5c5069504a56d3649d3d7799eaf52c6a41d3337a4c6ee357cf0d43462d1d2c8e` |
| `core/tests/fixtures/fusion-replies/glm-5.2-compliant.txt` | `1723ddbdd2cb096cab377ae8aad43d11bf7fd258` | `87e482ca22fcd6da3e415c8213aff4b25a70daa2325e37591a82a8613109f413` |
| `core/tests/fixtures/fusion-replies/kimi-k2.7-code-empty.txt` | `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `core/tests/fixtures/fusion-replies/llama-4-maverick-prose-noncompliant.txt` | `1dba7a20a08d789fa126c41cd77448fa56358d76` | `8ed09fe6e798170d62e05135788fe9e79af355f179e029a8a5c6a56ad136c1be` |
| `core/tests/fixtures/fusion-replies/qwen3.7-max-compliant.txt` | `bc5f252af288df02763b039990b7e81d11c57ac9` | `6440ff6356a6f9cd50fdc4b14b75ec62b5702ed3daa9a95552bda0591031fbad` |

## Deliberate boundary changes

1. The donor `aukoraFuEngine.ts` was narrowed to `aukoraFuGlyph.ts`: only its pure glyph vocabulary,
   parser, interference geometry, and perceiver primitives were retained. Its older direct-network
   engine and `fusionCaptureLog`/`authority/symbiotePaths` edge were excluded entirely.
2. The standalone caller-set test recognizes only the canonical council. Symbiote's
   `selfEditReviewCouncil.ts` is not copied.
3. The pre-existing standalone `run-council.ts` remains operational but is explicitly labeled legacy.
4. No observer adapter, API-key discovery, Symbiote path convention, memory, AURA, custody, signing,
   Convex, live apply, or private OS/lab source is included.
5. No paid model call is part of this save point.

## Authority boundary

All council outputs are advisory evidence. They are pinned `advisoryOnly: true` and
`grantsAuthority: false`. Aukora Fu cannot sign, authorize, apply, write memory, or mutate a reviewed
repository. **Historical statement:** EvidencePackV1, hardened observers, the canonical CLI, and
Symbiote package consumption were future work at this extraction point. EvidencePack v1 subsequently
landed; current implementation status is maintained in the top-level documents linked above.
