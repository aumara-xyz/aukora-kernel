# Policy Rings Ratification Packet

**RATIFIED** by the owner (Peter), 2026-07-04, in-session: decisions 1–11 accepted as written. This is a governance-document ratification recorded in chat and by this commit — not an AUMLOK-signed promotion; it authorizes the PolicyKernel build (step 1 of the build order), nothing else.

*Same-session correction (2026-07-04, owner present):* the kernel's test suite caught a prose↔table divergence — the table lacked the `docs/issues-snapshot/**` → Ring 3 rule this packet's Ring-3 section already names, so the new-path fail-closed redirect would have paused every regenerated issue snapshot at Ring 1. Rule restored to match the ratified prose; tracked-file counts unchanged.

For issue #78. Revision 2 (2026-07-04): exhaustive module coverage, one ring per module, Ring-0 fence widened, current-enforcement honesty section; supersedes the 2026-07-04 initial draft. Machine form of the table: [`docs/policy-rings/ring-table.json`](policy-rings/ring-table.json), verified by [`docs/policy-rings/check-ring-coverage.mjs`](policy-rings/check-ring-coverage.mjs), whose matcher is the **normative glob semantics** the kernel adopts — **every one of the 598 tracked files matches exactly one rule** (Ring 0: 45 · Ring 1: 220 · Ring 2: 119 · Ring 3: 157 · Ring 4: 57; counts as of ratification). The JSON is the PolicyKernel's classification table, consumed verbatim; amending it is a Ring-0 change requiring re-ratification.

## Purpose

Several correct local guards exist, but no single owner-ratified `PolicyDecision` that every proposal, sandbox, live-apply, UI command, and future session-grant lane consumes. Before #72/#73/#82/#92 are coded, the owner ratifies the taxonomy they will enforce.

## Rings

| Ring | Name | Meaning | Default posture |
|---:|---|---|---|
| -1 | Physical owner authority | Hardware custody, recovery secrets, private keys in the owner environment (`~/.aukora-symbiote/aumlok/`). | Never handled by the organism. Human-only. |
| 0 | Sacred authority fence | Signer/verifier/root, the gate, live apply, replay ledgers, flight recorder, kill switch, secret scanners, law docs, **and the PolicyKernel itself** (`core/src/policyKernel.ts`, pinned in the table as a `reserved` rule). | **Never auto-applied, never session-grant eligible.** Explicit ceremony only, cooling-off posture. |
| 1 | Governance substrate | Sandbox lane, test gate + its config inputs, classifiers, path confinement, receipt persistence, egress fences, workbench door, ceremony UX, test suite, contract docs. | Explicit Ring-1 signature; full suite + targeted tests; advisory review. Second reviewer/key is Decision 4. |
| 2 | Organism runtime | Advisory organs: Kira memory, Fusion council, proposers, evidence artifacts, voice lane, spend surfaces, owner-invoked launchers, deploy config. | Owner-signed after sandbox/tests + advisory review. Short-lived scoped grants possible later (Decision 5). |
| 3 | Body, UI, docs | Spatial shell, dashboards, lander, websites, explanatory docs, generated snapshots. | Bounded low-risk pre-approval possible later with caps and receipts (Decision 6). |
| 4 | Labs and experiments | Probes, deferred tests, parked design artifacts, drift battery. | Isolated. Never promoted without reclassification into Rings 0–3. |

## Classification rules (exhaustive)

Precedence: **exact file > deepest directory glob** (`dir/*` beats `dir/**` at the same directory; the checker's matcher is normative). New paths: a new file under a directory containing any Ring-0 exact rule is **fail-closed Ring 1** (pause, owner classification) — a `core/src/liveApplyV2.ts` must not inherit Ring 2 from `core/src/**`; otherwise a new path takes its deepest directory rule; fully unmatched paths are fail-closed Ring 1. Untracked working files are out of table scope: key material is Ring -1 custody, `state/` runtime data Ring 2, `lab_only/` & co. Ring 4.

**Ring 0 — the authority fence (45 files + 1 reserved, fully enumerated):**
- `authority/**` — the boundary itself: byte-pinned gate law (`aukoraGate`, `governedToolBoundary`, `sensitivePolicy`, `risk` + vectors, `.gate-integrity.sha256`), AUMLOK ceremony/keyfile writer, canonical key paths (`symbiotePaths.ts`), egress sandbox, trusted-execs manifest + stamps.
- Signing & roots: `core/src/aumlokSigner.ts` (only module touching a private key), `aumlokAuthorityRoot.ts`, `aumlokApprovalRoot.ts`, `crypto.ts`, `pinnedPublicKey.ts`, `nodeIdentity.ts`, `proposalHash.ts` (the one hash the human signs).
- Apply & gate law: `core/src/nativeLiveApply.ts` (the only organism write to the live repo), `executor.ts`, `index.ts` (`evaluateIntent` + receipt chain), `kernelActionClassifier.ts` (the sacred-path refusal executing *inside* live apply — fence enforcement cannot sit below the fence).
- Ledgers & witness: `core/src/appliedProposalLedger.ts`, `boundedNonceLedger.ts`, `flightRecorder.ts` (hash-chained capability witness).
- Kill switch: `spatial/capabilityMode.ts`, `spatial/chat-serve.ts` (the lockdown intercept lives in the door — Decision 8).
- Scanners: `core/src/forbiddenContent.ts`, `wombForbiddenPatterns.ts`, `scripts/scan-secrets.sh`, `scripts/verify-public-readiness.sh`, `scripts/aumlok-authority.sh`.
- Law docs: `docs/SAFETY_LAWS.md`, `docs/AUMLOK_OWNER_CEREMONY.md`, this packet and `docs/policy-rings/**` — the kernel's future law table (Decision 7).
- Owner-signed lane: `identity/**`. Reserved: `core/src/policyKernel.ts`.

**Ring 1 — governance substrate:**
- Sandbox lane: `core/src/sandboxApply.ts`, `sandboxApplyPermit.ts`, `sandboxEngineBridge.ts`, `sandboxTestRunner.ts`, `sandboxPreviewPlan.ts`, `promotionRollback.ts` — rehearsal, permits, rollback muscle.
- Classifiers & confinement: `changeRiskClassifier.ts`, `normalizer.ts`, `repoReadPathResolver.ts`, `canonicalizationSentinel.ts`, `evidenceAuthorityGuard.ts`, `fileShrink.ts`, `hexTruncation.ts`.
- Invariant rails: `advisoryOrganRegistry.ts`, `surfaceVersionRegistry.ts`, `importGraphVerifier.ts`, `execsManifest.ts`.
- Engine/egress fences: `openCodeSpawnTransport.ts`, `openCodeSandboxRunner.ts`, `openCodeSandboxDraftEngine.ts`, `openCodeOutputNormalizer.ts`, `openCodeModelWire.ts`, `localModelClient.ts`, `localPostGuard.ts`, `localEndpointReadiness.ts`.
- Convex governance: `convexExecutionApproval.ts`, `convexCanonicalPin.ts`, `convexCanonicalFreshness.ts`, `convexTopology.ts`, `convexBrainReadonly.ts`, `kernelAdapter.ts`.
- Attestation (lab-tier, not AUMLOK): `manifestSigner.ts`, `manifestCanonical.ts`, `mldsaSandboxSigner.ts`.
- Proposal/receipt lane: `patchApproval.ts`, `selfEditProposalArtifact.ts`, `workbenchReceiptPersistence.ts`, `workbenchCommandLoop.ts`, `nativeIdeDispatcher.ts`, `ideToolContract.ts`.
- AUMLOK honesty surfaces: `aumlokSigningAssistant.ts`, `aumlokStatusSnapshot.ts`, `aumlokBondCeremony.ts`, `aumlokCeremonySpec.ts`, and `spatial/app/aumlok.js` (browser half of the ceremony: composes + clipboard-copies the terminal sign command the owner pastes).
- Doors & bridges: `spatial/voiceReadToolBridge.ts` (read-only allowlist; where lockdown actually refuses tool calls), `dashboard/serve.ts` (workbench POST gateway).
- Gate & scan harness: `scripts/test.sh`, `scripts/status.sh`, `scripts/scan-release-archive.sh`, `scripts/scan-vectors.local.sh.example`, `.gitignore` (passive leak guard), and the gate's config inputs `spatial/tsconfig.json` + `spatial/bun-env.d.ts` (a tsconfig edit can silently drop the Ring-0 door from the typecheck leg — see #68).
- Memory integrity: `memory/chain.ts`, `memory/runtime/secretShape.ts`.
- Test-pinned contract docs: `docs/SEED_ROOT_CONTRACT.md`, `docs/COHESION_INVARIANTS.md`, `docs/PROPOSER_CONTRACT.md`, `docs/VISION_CONTRACT.md`.
- The suite and its config: `core/tests/**`, `core/*` (package.json, tsconfig, vitest config — can silently exclude tests).

**Ring 2 — organism runtime:** `core/src/**` remainder (Kira brain/mirror, Fusion engines, proposers, routers, evidence packets, telemetry, truth manifest), `core/fixtures/**`, `core/run-council.ts`, `scripts/**` remainder (rehearsal/demo/ops tooling), `memory/**` remainder, `convex/**`, `receiver/**`, named egress/spend or long-running surfaces (`spatial/serve.ts`, `spatial/voiceLane.ts`, `spatial/capabilityPreamble.ts`, `spatial/identityAnchor.ts`, `spatial/historyWindow.ts`, `dashboard/fu/run-council.ts`, `lander/api/**` — the public internet spend surface incl. any future endpoint beside `chat.js`; ties into #84), plus exec-shaping surfaces promoted out of Ring 3: `vercel.json` (chooses which directory is published to aukora.xyz), `First Contact.command`, `scripts/console.sh`, `scripts/website.sh`, `dashboard/fu/package.json` (each redirects what runs under owner privileges when invoked).

**Ring 3 — body/UI/docs (remainders after the exact-rule promotions above):** `spatial/**`, `dashboard/**`, `lander/**`, `website/**`, `auma-lingwa/**`, `docs/**` (incl. generated `docs/issues-snapshot/**`), `fusion/**` (archived notes), `core/src/console.html`, root files (`README.md`, `AUMARA FULL TRANSPARENT ICON.png`).

**Ring 4 — labs:** `probes/**`, `deferred-tests/**`, `core/src/chronosProtocol.ts`, `boundaryTraceFixture.ts`, `fableDryRun.ts`, `scripts/run-drift-battery.sh|.ts`.

## Honest status: the fence is not yet enforced

Adversarial review of this packet (2026-07-04, three independent passes) verified: the *current* sacred-path refusal inside `nativeLiveApply` is `kernelActionClassifier`'s keyword net, and run against the enumerated fence it refuses only name-matched files (e.g. `aumlok*`) — **most Ring-0 files, including the gate law, ledgers, kill switch, scanners, and law docs, are live-applyable today with one ordinary owner-signed receipt.** Also: Ring-0 chokepoints import guard logic from lower rings (`index.ts` → `normalizer.ts` (R1) and `vk.ts` (R2); `nativeLiveApply` → `isSafeRelPath` from `sandboxApply.ts` (R1), locally re-checked); and lockdown is enforced in the voice bridge/lane but **not** in the `dashboard/serve.ts` workbench door (signature verification still gates authority there). Ratifying this packet is what authorizes closing these gaps: the never-auto-applied guarantee for the fence exists only once the PolicyKernel consumes this table (build steps 1–2).

## Ratification decisions for Peter

1. **Vocabulary.** Are the six rings the canonical language for all future PolicyKernel work?
2. **Ring-0 fence.** Accept the enumerated fence above (45 files + reserved `policyKernel.ts`), subject to Decisions 7–8 — including the promotions from the initial draft: live apply + executor + kernel gate (was Ring 1), flight recorder (was Ring 2), replay ledgers, and `kernelActionClassifier.ts`? Includes the new-path rules: Ring-0-containing directories fail closed to Ring 1; unmatched paths fail closed to Ring 1.
3. **Ring-0 posture.** Ring 0 is always explicit ceremony — no standing grants, no session eligibility, no browser/app signing. Confirm.
4. **Ring-1 signature.** Does Ring 1 require an explicit Ring-1 phrase/challenge beyond ordinary owner signing, and is a second reviewer/key parked until after #72/#73/#82?
5. **Ring-2 grants.** May Ring 2 support short-lived, scoped, signed session grants after #72/#73/#82 land (#92)?
6. **Ring-3 pre-approval.** May Ring 3 support bounded pre-approval, and what hard caps: max files, max lines, max runtime, allowed paths, generated snapshots excluded? (Deliberately stricter than #78 comment 1, which floated Ring 3/4 pre-approval: here Ring 4 stays isolated — see Decision 9.)
7. **Law docs.** `SAFETY_LAWS.md`, `AUMLOK_OWNER_CEREMONY.md`, this packet + `docs/policy-rings/**` = Ring 0; the four test-pinned contract docs = Ring 1. Accept, or keep all docs Ring 3?
8. **The chat door.** `spatial/chat-serve.ts` is whole-file Ring 0 because the lockdown intercept lives inside it. Accept, or require the intercept be split into its own module so the door proper can be Ring 1? (Disclosed: lockdown does not currently cover the `dashboard/serve.ts` workbench door — a code gap to close, tracked as an action item, not a table choice.)
9. **Ring-4 quarantine.** Probes, deferred tests, and shadow-node/Nebius artifacts stay Ring 4 until explicitly imported through a governed snapshot. Confirm.
10. **Kernel witness.** Every PolicyKernel decision is recorded on the hash-chained flight recorder before any proposal can be signed, and `policyHash` is bound into the future PromotionBundle (#73). Confirm.
11. **Effect classes.** #78 requires `PolicyDecision { effectClass, ring, allowed, requiredCapabilities, reasons, policyHash }`. Ratify the minimal effect-class vocabulary `read | write | delete | exec | spawn | egress | sign` now (with `requiredCapabilities` named per ring in the schema PR), or defer the vocabulary to the schema PR as its own decision?

## Build order after ratification

1. Pure `PolicyDecision` schema (`effectClass`, `ring`, `allowed`, `requiredCapabilities`, `reasons`, `policyHash`) + `classifyRing(targetPaths, actionKind)` consuming the ratified table with the checker's matcher, composing (not replacing) existing classifiers. 2. Surface ring decisions in workbench/proposal evidence, no authority change — including the #78 acceptance test: *proposals touching Ring 0/1 cannot pass through the ordinary UI/docs path*, and an import-closure check (via `importGraphVerifier`) that Ring-0 chokepoints execute no lower-ring guard logic. 3. #72 transactional live apply. 4. #73 PromotionBundle with `policyHash`. 5. #82 trusted test substrate. 6. Only then #92 scoped session grants.

## Non-decisions

This packet does not decide grants, implement auto-apply, change AUMLOK, touch the private key, change the live apply lane, or classify any pending proposal. It exists so the owner ratifies the language before code turns it into law.
