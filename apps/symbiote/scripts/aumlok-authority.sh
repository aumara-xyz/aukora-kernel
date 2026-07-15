#!/usr/bin/env bash
# aumlok-authority.sh — terminal-first human authority root.
#
#   bind-v2  the HUMAN binds a fresh POST-QUANTUM HYBRID identity (#361): two independent CSPRNG seeds
#            (Ed25519 + ML-DSA-65), complete bundle published by ONE atomic rename under
#            ~/.aukora-symbiote/aumlok/hybrid-v2/ (0600 seeds, human-held, never in the repo). The
#            binding phrase is typed at a stdin prompt — NEVER argv (argv leaks into process listings).
#   keygen   LEGACY v1: generates an Ed25519-only keypair. REFUSED when any v2 state exists on this node.
#   sign     the human signs a promotion authorization (the model never does this). On a node with ANY v2
#            state this produces the MANDATORY dual Ed25519+ML-DSA-65 receipt from hybrid custody — a v1
#            receipt is never produced beside v2 state (no downgrade at the source; incoherent custody
#            refuses instead of falling back).
#   verify   the organism verifies a signed receipt against pinned PUBLIC material only (v1 or v2 by schema).
#   status   honest node authority status: suite, custody tier, display root fingerprint.
#
# Live promotion stays LOCKED — this tool proves a human can authorize and the seed can verify; it does not
# flip the live self-edit gate. Custody tier is SOFTWARE (software_hybrid) — never claim hardware/production.
set -euo pipefail   # -e: a failed keygen/sign/verify aborts — never prints a success-looking line after a failure
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${AUKORA_SYMBIOTE_HOME:-$HOME/.aukora-symbiote}"
KEYDIR="$HOME_DIR/aumlok"
PRIV="$KEYDIR/authority-ed25519.key"
PUB="$KEYDIR/authority-ed25519.pub"
MANIFEST="$KEYDIR/authority-root.json"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin"
cd "$REPO/core"
export PRIV PUB MANIFEST HOME_DIR

case "${1:-help}" in
  bind-v2)
    # Fresh post-quantum hybrid bind (#361 Cycle A). The phrase is read from the terminal (stdin), never
    # from argv; it gates the owner's gesture and derives NO key material. All refusal logic (existing
    # v1/v2 state, concurrent bind, staged-bundle verification) lives in bindHybridV2 — fail-closed.
    printf "binding phrase (typed, never shown in argv/process list): " >&2
    IFS= read -r BIND_PHRASE
    [ -n "$BIND_PHRASE" ] || { echo "no phrase typed — nothing was created"; exit 1; }
    export BIND_PHRASE
    bun -e '
import { bindHybridV2 } from "./src/aumlokBindV2";
const v = bindHybridV2(process.env.HOME_DIR, process.env.BIND_PHRASE, Date.now());
if (!v.ok) { console.error("bind-v2 REFUSED:", v.reason); process.exit(1); }
console.log("hybrid identity bound.");
console.log("suite:  ", v.suite);
console.log("custody:", v.custody, "(software custody — never claim hardware/production)");
console.log("root id:", v.rootId);
console.log("ed25519 public: ", v.publicKeys.ed25519);
console.log("ml-dsa-65 public (first 64 hex of 3904):", v.publicKeys.mlDsa65.slice(0, 64) + "...");
'
    unset BIND_PHRASE
    echo "seeds -> $KEYDIR/hybrid-v2/  (human-held · gitignored · 0600 · never in the repo · the model never reads them)"
    ;;
  keygen)
    # LEGACY v1 keygen. A node with ANY v2 state refuses: minting a classical identity beside hybrid
    # custody would be a downgrade footgun the apply lane would then have to refuse anyway.
    V2_STATE=$(bun -e 'import { hybridV2StatePresent } from "./src/aumlokBindV2"; console.log(hybridV2StatePresent(process.env.HOME_DIR) ? "yes" : "no");')
    [ "$V2_STATE" = "no" ] || { echo "this node has post-quantum hybrid (v2) state — refusing to create a legacy v1 key beside it (use bind-v2 / status)"; exit 1; }
    mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
    [ -f "$PRIV" ] && { echo "refusing to overwrite existing key at $PRIV (revoke + rotate deliberately)"; exit 1; }
    bun -e '
import { generateKeypair } from "./src/aumlokSigner";
import { pinAuthorityRoot, serializeRootManifest } from "./src/aumlokAuthorityRoot";
import * as fs from "fs";
const { privateKeyHex, publicKeyHex } = generateKeypair();
fs.writeFileSync(process.env.PRIV, privateKeyHex, { mode: 0o600 });
fs.writeFileSync(process.env.PUB, publicKeyHex);
fs.writeFileSync(process.env.MANIFEST, serializeRootManifest(pinAuthorityRoot(publicKeyHex)));
console.log("PUBLIC key (pin this in the organism):", publicKeyHex);
'
    chmod 600 "$PRIV"
    echo "PRIVATE key -> $PRIV  (human-held · gitignored · 0600 · never in the repo · the model never reads it)"
    ;;
  sign)
    # Signs a PROPOSAL ARTIFACT FILE (written by the workbench's "propose patch" command), never a bare
    # hash string — the hash is RE-DERIVED here from the artifact's own goal+files via the exact same
    # computeProposalHash function Aukora used, and the full goal + file list is printed BEFORE signing
    # so this is real informed consent, not a hash you have to trust blindly.
    # Suite dispatch (#361 Cycle A): ANY v2 state on this node → the MANDATORY dual receipt from hybrid
    # custody (signPromotionV2FromCustody: coherence-gated, sign-then-self-verified) or a refusal —
    # NEVER a v1 receipt beside v2 state. The legacy v1 path survives only where no v2 state exists.
    ARTIFACT="${2:?usage: $0 sign <proposal-artifact.json>}"
    [ -f "$ARTIFACT" ] || { echo "no such proposal artifact: $ARTIFACT"; exit 1; }
    ARTIFACT_PATH="$ARTIFACT"
    export ARTIFACT_PATH
    bun -e '
import * as fs from "fs";
import { readSelfEditProposalArtifact } from "./src/selfEditProposalArtifact";
import { hybridV2StatePresent } from "./src/aumlokBindV2";
import { signPromotionV2FromCustody } from "./src/aumlokSignerCustodyV2";

const read = readSelfEditProposalArtifact(process.env.ARTIFACT_PATH);
if (!read.ok) { console.error("refusing to sign — invalid proposal artifact:", read.reason); process.exit(1); }
const { artifact } = read;

console.error("── You are about to sign this exact proposal ──");
console.error("goal:", artifact.goal);
console.error("files:");
for (const f of artifact.files) console.error(`  - ${f.relPath} (${f.content.length} chars)`);
console.error("proposalHash:", artifact.proposalHash);
console.error("────────────────────────────────────────────");

const nonce = "cli-" + process.pid + "-" + process.hrtime.bigint().toString();
if (hybridV2StatePresent(process.env.HOME_DIR)) {
  const dual = signPromotionV2FromCustody(process.env.HOME_DIR, { proposalHash: artifact.proposalHash, nonce });
  if (!dual.ok) { console.error("refusing to sign —", dual.reason); process.exit(1); }
  console.error("suite: aumlok-ed25519-ml-dsa-65-v1 (dual signature, software_hybrid custody)");
  console.log(JSON.stringify(dual.signedReceipt, null, 2));
} else {
  const { pinAuthorityRoot } = await import("./src/aumlokAuthorityRoot");
  const { signPromotionAuthorization } = await import("./src/aumlokSigner");
  if (!fs.existsSync(process.env.PRIV)) { console.error("no key — run: scripts/aumlok-authority.sh bind-v2 (or legacy keygen)"); process.exit(1); }
  const priv = fs.readFileSync(process.env.PRIV, "utf-8").trim();
  const root = pinAuthorityRoot(fs.readFileSync(process.env.PUB, "utf-8").trim());
  const auth = {
    keyId: root.keyId, proposalHash: artifact.proposalHash, draftHash: artifact.proposalHash,
    nonce, issuedAt: new Date().toISOString(), expiresAt: null,
  };
  console.error("suite: ed25519 v1 (legacy — this node has no post-quantum state yet; bind-v2 to upgrade)");
  console.log(JSON.stringify(signPromotionAuthorization(priv, auth), null, 2));
}
'
    ;;
  verify)
    RECEIPT="${2:?usage: $0 verify <receipt.json>}"
    export RECEIPT
    bun -e '
import * as fs from "fs";
import { isLivePromotionUnlocked } from "./src/aumlokAuthorityRoot";
const receipt = JSON.parse(fs.readFileSync(process.env.RECEIPT, "utf-8"));
if (receipt?.schema === "aumlok-signed-promotion-v2") {
  const { verifyPromotionV2 } = await import("./src/aumlokAuthorityV2");
  const { loadHybridCustody } = await import("./src/aumlokBindV2");
  const custody = loadHybridCustody(process.env.HOME_DIR);
  if (!custody.ok) { console.log("hybrid custody unavailable:", custody.reason); process.exit(1); }
  const v = verifyPromotionV2(receipt, custody.root);
  console.log("v2 dual signature valid:", v.valid, v.reason ? "("+v.reason+")" : "(ed25519 AND ml-dsa-65 both verified)");
} else {
  const { parseRootManifest, verifyPromotionReceipt } = await import("./src/aumlokAuthorityRoot");
  const parsed = parseRootManifest(fs.readFileSync(process.env.MANIFEST, "utf-8"));
  if (!parsed.ok) { console.log("authority root manifest invalid:", parsed.reason); process.exit(1); }
  const v = verifyPromotionReceipt(receipt, parsed.root);
  console.log("signature valid:", v.valid, v.reason ? "("+v.reason+")" : "");
}
console.log("live promotion unlocked:", isLivePromotionUnlocked(), "(authority verified ≠ promotion executed — the live gate stays LOCKED)");
'
    ;;
  status)
    bun -e '
import { buildAumlokStatusSnapshot, summarizeAumlokStatus } from "./src/aumlokStatusSnapshot";
console.log(summarizeAumlokStatus(buildAumlokStatusSnapshot({ homeDir: process.env.HOME_DIR })));
'
    ;;
  migrate-v2)
    # v1 → hybrid v2 migration INSTALL (#361 Cycle C): the OLD Ed25519 root consents by signature, the new
    # ML-DSA-65 key proves possession, the envelope is verified against the TRUSTED on-disk v1 manifest and
    # consumed in the durable authority-event ledger, then the hybrid bundle is installed atomically. The v1
    # files stay byte-untouched (retired in place; historical v1 receipts remain verify-only). The typed
    # phrase becomes the NEW bundle's gesture phrase — the old key's SIGNATURE is the consent, never the phrase.
    printf "NEW binding phrase for the hybrid bundle (typed, never in argv): " >&2
    IFS= read -r MIG_PHRASE
    [ -n "$MIG_PHRASE" ] || { echo "no phrase typed — nothing was migrated"; exit 1; }
    export MIG_PHRASE
    bun -e '
import { migrateV1ToHybridV2 } from "./src/aumlokMigrateV2";
const v = migrateV1ToHybridV2(process.env.HOME_DIR, process.env.MIG_PHRASE, Date.now());
if (!v.ok) { console.error("migrate-v2 REFUSED:", v.reason); process.exit(1); }
console.log("migrated to the hybrid suite.");
console.log("suite:   ", v.suite, "· custody:", v.custody);
console.log("old root:", v.oldRootId);
console.log("new root:", v.newRootId);
console.log("lineage receipt -> aumlok/migration-receipt-v1.json · old v1 files retired in place (verify-only forever)");
'
    unset MIG_PHRASE
    ;;
  rotate-v2)
    # Dual-signed KEY rotation (#361 Cycle C). This rotates the KEYS: the CURRENT root authorizes a freshly
    # generated successor by Ed25519+ML-DSA-65 signature, and the CURRENT seven-word phrase is proved and
    # RETAINED (re-fingerprinted into the successor — the phrase does NOT change). A separate ceremony that
    # proves the current phrase then lets the owner choose+confirm a DIFFERENT successor phrase ("phrase
    # refresh") does not exist yet and is an owner decision. The successor bundle (with its embedded signed
    # event) replaces the current one atomically under the bind lock; the reservation commits after.
    printf "CURRENT binding phrase (typed, never in argv) — proved and RETAINED, keys rotate: " >&2
    IFS= read -r ROT_PHRASE
    [ -n "$ROT_PHRASE" ] || { echo "no phrase typed — nothing was rotated"; exit 1; }
    export ROT_PHRASE
    bun -e '
import { rotateHybridV2 } from "./src/aumlokLifecycleV2";
const v = rotateHybridV2(process.env.HOME_DIR, process.env.ROT_PHRASE, Date.now());
if (!v.ok) { console.error("rotate-v2 REFUSED:", v.reason); process.exit(1); }
console.log("hybrid KEYS rotated (phrase re-proven and retained — not changed).");
console.log("old root:", v.oldRootId);
console.log("new root:", v.newRootId);
console.log("rotations:", v.rotations, "· signed event embedded in the bundle + appended to aumlok/lifecycle-journal.jsonl");
'
    unset ROT_PHRASE
    ;;
  revoke-v2)
    # Dual-signed revocation (#361 Cycle C): TERMINAL for this root — after the manifest is re-sealed
    # revoked:true, the signer refuses, every apply refuses, and rotation refuses. Recovery of a revoked
    # node is an owner-ruling path; this tool will not invent one.
    printf "CURRENT binding phrase (typed, never in argv): " >&2
    IFS= read -r REV_PHRASE
    [ -n "$REV_PHRASE" ] || { echo "no phrase typed — nothing was revoked"; exit 1; }
    export REV_PHRASE
    bun -e '
import { revokeHybridV2 } from "./src/aumlokLifecycleV2";
const v = revokeHybridV2(process.env.HOME_DIR, process.env.REV_PHRASE, Date.now());
if (!v.ok) { console.error("revoke-v2 REFUSED:", v.reason); process.exit(1); }
console.log("hybrid root REVOKED — authority on this root is dead (signing and applying now refuse).");
console.log("root:", v.rootId);
'
    unset REV_PHRASE
    ;;
  rehearse)
    # verify + PERSIST a hash-chained rehearsal receipt. This is evidence of a ceremony, not an apply path —
    # promotionExecuted is a literal `false` in the type; nothing here can flip it, even on a forged input.
    RECEIPT="${2:?usage: $0 rehearse <signed-receipt.json>}"
    [ -f "$MANIFEST" ] || { echo "no pinned authority root — run: $0 keygen"; exit 1; }
    RECEIPTS_DIR="$KEYDIR/receipts"
    LEDGER="$RECEIPTS_DIR/ledger.json"
    mkdir -p "$RECEIPTS_DIR"; chmod 700 "$RECEIPTS_DIR"
    export RECEIPT LEDGER RECEIPTS_DIR
    bun -e '
import * as fs from "fs";
import * as path from "path";
import { parseRootManifest, verifyPromotionReceipt, buildRehearsalReceipt, isLivePromotionUnlocked } from "./src/aumlokAuthorityRoot";
const promotion = JSON.parse(fs.readFileSync(process.env.RECEIPT, "utf-8"));
const parsed = parseRootManifest(fs.readFileSync(process.env.MANIFEST, "utf-8"));
if (!parsed.ok) { console.log("authority root manifest invalid:", parsed.reason); process.exit(1); }
const ledgerPath = process.env.LEDGER;
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) : [];
const prevReceiptHash = ledger.length ? ledger[ledger.length - 1].receiptHash : null;
const rehearsal = buildRehearsalReceipt(promotion, parsed.root, { seq: ledger.length, prevReceiptHash });
const outPath = path.join(process.env.RECEIPTS_DIR, `rehearsal-${String(rehearsal.chain.seq).padStart(6, "0")}-${rehearsal.receiptHash.slice(0, 12)}.json`);
fs.writeFileSync(outPath, JSON.stringify(rehearsal, null, 2), { mode: 0o600 });
ledger.push({ seq: rehearsal.chain.seq, receiptHash: rehearsal.receiptHash, createdAt: rehearsal.createdAt });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
console.log("verifier result:", JSON.stringify(rehearsal.verifierResult));
console.log("rehearsal receipt written ->", outPath);
console.log("chain: seq", rehearsal.chain.seq, "prevReceiptHash", rehearsal.chain.prevReceiptHash);
console.log("promotionExecuted:", rehearsal.promotionExecuted, "(always false — this is a receipt, not an apply)");
console.log("live promotion unlocked:", isLivePromotionUnlocked(), "(authority verified ≠ promotion executed — the live gate stays LOCKED)");
'
    ;;
  *)
    echo "usage: $0 {bind-v2 | migrate-v2 | rotate-v2 | revoke-v2 | keygen | sign <proposal-artifact.json> | verify <receipt.json> | status | rehearse <receipt.json>}"
    ;;
esac
