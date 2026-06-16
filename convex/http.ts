// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { resolveChainSigningSeed } from "./aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed } from "./aukoraPqcSigner";
import { deriveChannelKeypair, signChannelBinding, channelDecapsulate, channelTranscript, sealFrame, openFrame, CHANNEL_DIR_I2R } from "./aukoraChannel";
import { utf8ToBytes } from "@noble/hashes/utils.js";

// Cross-node transport + demo driver. Both nodes deploy these; only the relevant node's data is meaningful.
//
// B3.2 DEPLOYMENT ROUTE GUARD (routing only — NOT mesh, NOT production hardening): every route is gated behind a
// default-OFF env flag, so a clean `convex deploy` publishes NO live surface. FOUR independent flags (B3.3 + B3.4):
//   • AUKORA_B3_WITNESS_ENABLED — the READ-ONLY witness/observe routes (/export, /node-pubkey). Safe to
//     enable at B3.3 (a witness only OBSERVES a peer's signed head); no import, no auto-pin.
//   • AUKORA_B3_CHANNEL_ENABLED — the B3.4 ML-KEM channel transport (/channel-binding publication, /channel-export
//     responder). DORMANT until Peter's go; confidentiality only (B2.4 untouched); the witness flag must NOT open it.
//   • AUKORA_B3_MESH_ENABLED — the cross-node IMPORT routes (/import-delegated, /import-delegated-revocation). Stays OFF
//     until B3.5 REPLACES the old auto-pin/TOFU import pattern (the witness flag must NOT open these).
//   • AUKORA_DEMO_ROUTES_ENABLED — every anonymous demo/run route.
// The flags are INDEPENDENT (one ON never opens another's routes — tested). A gated-OFF route returns 404 `route_disabled`
// BEFORE invoking its handler, so it mutates NO trust/import/receipt state. The B2.4 manifest→grant→token→receipt path
// (reached via the live mutations, not these routes) is untouched.
const http = httpRouter();
const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { "content-type": "application/json" } });

const WITNESS = "AUKORA_B3_WITNESS_ENABLED", MESH = "AUKORA_B3_MESH_ENABLED", DEMO = "AUKORA_DEMO_ROUTES_ENABLED";
// B3.4 — the ML-KEM channel transport gets its OWN flag (write-one-flag-one-surface; the witness flag must NOT open it).
// Default OFF; gates the responder /channel-export + the /channel-binding publication route. NOT live until Peter's go.
const CHANNEL = "AUKORA_B3_CHANNEL_ENABLED";
const flagOn = (flag: string): boolean => { const v = (process.env[flag] ?? "").toLowerCase(); return v === "1" || v === "true" || v === "on" || v === "yes"; };
const disabled = (flag: string) => new Response(JSON.stringify({ ok: false, error: "route_disabled", flag }), { status: 404, headers: { "content-type": "application/json" } });
/** Gate an HTTP handler behind a default-OFF flag. When the flag is not explicitly enabled, return 404 WITHOUT
 *  invoking the handler — so a disabled route performs NO query/mutation/action and changes no state. */
const gated = (flag: string, fn: (ctx: any, req: any) => Promise<Response>) => httpAction(async (ctx, req) => {
  if (!flagOn(flag)) return disabled(flag); // short-circuit: no ctx.run* runs, no state mutates
  return fn(ctx, req);
});

// ── Node A endpoints ──
http.route({ path: "/export", method: "GET", handler: gated(WITNESS, async (ctx, req) => {
  const chainKey = new URL(req.url).searchParams.get("chainKey") ?? "";
  return json(await ctx.runQuery(api.aukoraWitnessExport.exportReceiptHeadEnvelope, { chainKey })); // B3.1 env-v1, bodies ABSENT
}) });
// NOTE: the anonymous POST /seedA route was REMOVED (Gate-6-redux): it minted node_sessions rows with caller-supplied
// tokens (unbounded-growth DoS) and was the session-seam an attacker chained into the now-internal operator mutations.
// The node's signing pubkey is published read-only at GET /node-pubkey; session seeding is no longer a public surface.
http.route({ path: "/emit", method: "POST", handler: gated(DEMO, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(api.nodeA.emit, { env: b.env, chainKey: b.chainKey, action: b.action, resource: b.resource }));
}) });
http.route({ path: "/revoke", method: "POST", handler: gated(DEMO, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(api.nodeA.revoke, { env: b.env, delegationId: b.delegationId, chainKey: b.chainKey }));
}) });
// Provision the operator trust root. SAFE: takes NO caller-supplied key — the server DERIVES + pins the one legitimate
// operator pubkey, idempotently, and an active key is IMMUTABLE. So this cannot be used to hijack the gate (unlike the
// removed caller-supplied-pubkey variant). See CORE_POP_WIRING_EVIDENCE.md.
http.route({ path: "/provision-operator", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runMutation(api.popResolver.seedOperatorKey, {}));
}) });

// ── Orchestrators ──
// A→B demo (run on Node B): Node B verifies Node A's receipt.
http.route({ path: "/run-demo", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runAction(api.nodeB.runDemo, {}));
}) });
// Two-way handshake (run on Node A): Node A verifies a Node B–minted receipt (reverse direction).
http.route({ path: "/run-handshake", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runAction(api.nodeB.runHandshake, {}));
}) });
// Capability scope (run on Node A): proves the kernel governs which actions are allowed + the Aukora Capability Ledger.
http.route({ path: "/run-capability", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runMutation(api.nodeA.runCapability, {}));
}) });

// ── Ceremony rehearsal (carbon -> silicon identity) ──
// Node A: run the full ceremony rehearsal.
http.route({ path: "/run-ceremony", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runAction(api.ceremony.runCeremony, {}));
}) });
// Read-only: a node publishes its OWN signing pubkey (non-secret) so a peer can PULL + pin it from a configured URL.
// Replaces the removed anonymous POST /pin (caller-supplied key) — there is no public way to SET another node's key.
http.route({ path: "/node-pubkey", method: "GET", handler: gated(WITNESS, async () => {
  const seed = resolveChainSigningSeed();
  const publicKey = seed ? await mlDsa65PublicKeyFromSeed(seed) : null;
  return json({ sourceNodeId: process.env.AUMA_NODE_ID ?? "aukora-node-a-demo", headKeyId: process.env.AUMA_HEAD_KEY_ID ?? "demo-key-1", publicKey });
}) });
// ── B3.4 ML-KEM channel routes (gated AUKORA_B3_CHANNEL_ENABLED, default OFF; DORMANT until Peter's go) ──
// Publish this node's SIGNED channel-key binding for its current epoch (PUBLIC material only — KEM public key + epoch +
// capability + the ML-DSA-65 signature; NO secret). The initiator verifies it against the already-pinned identity key
// (no TOFU) before pinning. Read-only, no authority.
http.route({ path: "/channel-binding", method: "GET", handler: gated(CHANNEL, async (ctx) => {
  const seed = resolveChainSigningSeed();
  if (!seed) return json({ binding: null, sig: null }); // signing OFF → nothing to publish
  const epoch = await ctx.runQuery(api.aukoraWitness.channelSelfEpoch, {});
  const kp = deriveChannelKeypair(seed, epoch);
  try {
    const { binding, sig } = await signChannelBinding(seed, { nodeId: process.env.AUMA_NODE_ID ?? "aukora-node-a-demo", headKeyId: process.env.AUMA_HEAD_KEY_ID ?? "demo-key-1", epoch, channelPublicKeyHex: kp.publicKeyHex });
    return json({ binding, sig });
  } finally { kp.secretKey.fill(0); }
}) });
// Responder for ONE channel poll — WITNESS-SCOPED (it serves only the env-v1 receipt-head export, never import/memory).
// B3.5c: the request is now a SEALED i2r frame. Decapsulates the initiator's ML-KEM ciphertext (from the request frame)
// IN THIS ACTION (secret key + shared secret zeroized, never persisted / logged), OPENS the i2r request to recover the
// chainKey (never sent in cleartext), builds the bodies-ABSENT env-v1 export, and SEALS the r2i RESPONSE leg under the
// SAME shared secret with a distinct direction key. No authority (B2.4 untouched).
http.route({ path: "/channel-export", method: "POST", handler: gated(CHANNEL, async (ctx, req) => {
  const seed = resolveChainSigningSeed();
  if (!seed) return json({ error: "signing_off" });
  const b = await req.json();
  const requestFrame = b?.requestFrame;
  const ctHex = requestFrame?.ctHex;
  if (!requestFrame || typeof ctHex !== "string") return json({ error: "bad_request" });
  const epoch = await ctx.runQuery(api.aukoraWitness.channelSelfEpoch, {});
  const { publicKeyHex, secretKey } = deriveChannelKeypair(seed, epoch);
  try {
    let ss: Uint8Array;
    try { ss = channelDecapsulate(secretKey, ctHex); } catch { return json({ error: "bad_ciphertext" }); } // wrong-LENGTH ct (structural)
    try {
      const transcript = channelTranscript({ nodeId: process.env.AUMA_NODE_ID ?? "aukora-node-a-demo", headKeyId: process.env.AUMA_HEAD_KEY_ID ?? "demo-key-1", epoch, channelPublicKeyHex: publicKeyHex, ctHex });
      // B3.5c — OPEN the sealed i2r request to recover the chainKey (uniform channel_refused on any failure; no oracle).
      let chainKey: string;
      try { const reqBody = JSON.parse(new TextDecoder().decode(openFrame(ss, transcript, requestFrame, CHANNEL_DIR_I2R))); chainKey = reqBody?.chainKey; } catch { return json({ error: "channel_refused" }); }
      if (typeof chainKey !== "string") return json({ error: "bad_request" });
      const envelope = await ctx.runQuery(api.aukoraWitnessExport.exportReceiptHeadEnvelope, { chainKey }); // env-v1, bodies ABSENT
      const frame = sealFrame(ss, transcript, utf8ToBytes(JSON.stringify({ envelope, consistencyProof: null }))); // r2i RESPONSE
      return json({ frame });
    } finally { ss.fill(0); }
  } finally { secretKey.fill(0); }
}) });
// Node B: EXPLICIT-PIN a peer's key (no TOFU). The operator verifies the fingerprint out-of-band, THEN pins. Immutable
// once pinned. Db9 (B3.5b precondition): a pin is now an EFFECT-AUTHORITY input → OPERATOR PoP required (the `env` is
// verified inside `pinTrustGated`; a forged/expired/wrong-method/replayed env rolls back and writes NOTHING — so an
// unauthenticated pin can never seat a foreign-root key the resolver would honor for an effect).
http.route({ path: "/pin-trust", method: "POST", handler: gated(MESH, async (ctx, req) => {
  const b = await req.json();
  try { return json(await ctx.runMutation(internal.nodeB.pinTrustGated, { env: b.env, sourceNodeId: b.sourceNodeId, headKeyId: b.headKeyId, publicKey: b.publicKey, rootId: b.rootId })); }
  catch (e) { return json({ ok: false, error: (e as Error).message }); }
}) });
// Node B: verify a carbon->silicon delegated receipt. B3.5a: NO auto-pin — both the carbon key and the node signing key
// must already be EXPLICITLY pinned (/pin-trust) or import fails closed (unpinned_carbon / unknown_node_key).
http.route({ path: "/import-delegated", method: "POST", handler: gated(MESH, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(internal.ceremony.importDelegated, { env: b.env }));
}) });
// Node B: record a carbon-signed delegation revocation.
http.route({ path: "/import-delegated-revocation", method: "POST", handler: gated(MESH, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(internal.ceremony.importDelegatedRevocation, { rev: b.rev }));
}) });
// B3.5a — AUDIT-ONLY cross-node propagation (honor-as-record; imported records grant ZERO local effect authority). All
// MESH-gated (default OFF). The importers fail closed on unpinned/forged/stale/demo-origin (see nodeImport.ts).
http.route({ path: "/import-foreign-manifest", method: "POST", handler: gated(MESH, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(internal.nodeImport.importForeignManifest, { env: b.env }));
}) });
http.route({ path: "/import-foreign-memory", method: "POST", handler: gated(MESH, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(internal.nodeImport.importForeignMemory, { env: b.env }));
}) });
http.route({ path: "/import-revocation-view", method: "POST", handler: gated(MESH, async (ctx, req) => {
  const b = await req.json();
  return json(await ctx.runMutation(internal.nodeImport.recordRevocationView, { view: b.view }));
}) });
// Memory boundary (run on Node A): silicon mirror memory under a carbon root, scoped + receipt-coupled.
http.route({ path: "/run-memory", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runMutation(api.memory.runMemory, {}));
}) });
// Brick 6 — AUMLOK proof-of-possession resolver live proof: fires happy + 9 named attacks through the deployed resolver.
http.route({ path: "/run-pop-crash", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runAction(api.popResolver.runPopCrash, {}));
}) });
// Brick 7 — key rotation/versioning lifecycle proof (old active -> rotate -> new active, old retired grandfathered, revoked dead).
http.route({ path: "/run-key-rotation", method: "POST", handler: gated(DEMO, async (ctx) => {
  return json(await ctx.runAction(api.popResolver.runKeyRotation, {}));
}) });
// Code attestation — release-manifest provenance attack matrix (body may pass {gitSHA, bundleHash} from compute-bundle-hash.sh).
http.route({ path: "/run-code-attestation", method: "POST", handler: gated(DEMO, async (ctx, req) => {
  const b = await req.json().catch(() => ({}));
  return json(await ctx.runAction(api.codeAttestation.runCodeAttestation, { gitSHA: b.gitSHA, bundleHash: b.bundleHash }));
}) });

export default http;
