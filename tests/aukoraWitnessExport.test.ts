// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.3 — env-v1 WITNESS EXPORT. Proves `/export` + `/export-harvest` now emit the B3.1 `env-v1` export envelope:
 * heads + per-field DIGESTS (+ a harvest commitment), **bodies ABSENT** (B3.1 P1 — raw receipt/trace bodies never
 * cross); the envelope round-trips through `verifyExportEnvelope` and an unknown version fails closed; and the export
 * is READ-ONLY (no authority mutation), so the B2.4 manifest→grant→token→receipt path is untouched.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { verifyExportEnvelope } from "../convex/aukoraWireFormat";

const modules = import.meta.glob("../convex/**/*.*s");
const CK = "mem:echo.test:diary";

async function seedReceipt(t: any) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("auma_receipts", {
      receiptId: "rcpt-1", ts: 1000, actorModel: "agent-echo", lane: "local", goal: "SECRET-GOAL-BODY", risk: "low",
      grade: "A", verdict: "kept", actionsJson: JSON.stringify(["SECRET-ACTION-BODY"]), proofJson: JSON.stringify({ secret: "SECRET-PROOF-BODY" }),
      chainKey: CK, prevHash: "ph", chainHash: "ch", seq: 1, threadId: "t1", notes: "SECRET-NOTES-BODY",
    });
    await ctx.db.insert("auma_receipt_chain_head", {
      key: CK, lastChainHash: "ch", count: 1, updatedAt: 1000, headSig: "sig-hex", headSigAlg: "ml-dsa-65-chainhead-v4", headSignedAt: 1000, receiptLogRoot: "root-hex",
    });
  });
}

describe("B3.3 — /export env-v1 receipt-head envelope (heads + digests, bodies ABSENT)", () => {
  it("emits env-v1; bodies absent; per-field digests present; NO raw receipt body value crosses (P1)", async () => {
    const t = convexTest(schema, modules);
    await seedReceipt(t);
    const env: any = await t.query(api.aukoraWitnessExport.exportReceiptHeadEnvelope, { chainKey: CK });
    expect([env.envelopeVersion, env.surface, env.headVersion]).toEqual(["env-v1", "receipt-head", "v4"]);
    expect(env.bodies).toBeUndefined();                                          // bodies ABSENT
    expect(env.fields.length > 0 && env.fields.every((f: any) => /^[0-9a-f]{64}$/.test(f.digest))).toBe(true);
    expect([env.head.receiptLogRoot, env.head.headSigAlg, env.head.count]).toEqual(["root-hex", "ml-dsa-65-chainhead-v4", 1]);
    const blob = JSON.stringify(env);
    for (const body of ["SECRET-GOAL-BODY", "SECRET-ACTION-BODY", "SECRET-PROOF-BODY", "SECRET-NOTES-BODY"]) expect(blob.includes(body)).toBe(false);
  });

  it("round-trips through verifyExportEnvelope; an unknown envelope/surface version FAILS CLOSED", async () => {
    const t = convexTest(schema, modules);
    await seedReceipt(t);
    const env: any = await t.query(api.aukoraWitnessExport.exportReceiptHeadEnvelope, { chainKey: CK });
    expect(verifyExportEnvelope(env).ok).toBe(true);
    expect(verifyExportEnvelope({ ...env, envelopeVersion: "env-v9" }).reason).toBe("envelope_version_refused");
    expect(verifyExportEnvelope({ ...env, surface: "checkpoint-head" }).reason).toBe("surface_version_refused"); // v4 invalid for checkpoint
  });

  it("returns null when the chain has no head/receipt (nothing to export)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.aukoraWitnessExport.exportReceiptHeadEnvelope, { chainKey: "mem:none:x" })).toBe(null);
  });
});

describe("B3.3 — /export-harvest env-v1 export-envelope (summary + commitment, bodies ABSENT)", () => {
  it("emits env-v1; bodies absent; a tracesDigest commitment crosses but the raw trace content does NOT", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx: any) => {
      await ctx.db.insert("aukora_traces", { traceId: "tr1", runId: "run1", sourceRoute: "x", actorPrincipalId: "a", action: "act", resource: "RAW-TRACE-RESOURCE-BODY", ring: "local-write", intentHash: "ih", governanceResult: "approved", mechanicalOutcome: "success", revocationState: "active", schemaVersion: "aukora-trace-1", triage: "golden_success", createdAt: 1 });
    });
    const env: any = await t.query(api.aukoraWitnessExport.exportHarvestEnvelope, { runId: "run1" });
    expect([env.envelopeVersion, env.surface]).toEqual(["env-v1", "export-envelope"]);
    expect(env.bodies).toBeUndefined();                          // bodies ABSENT (no JSONL)
    expect(verifyExportEnvelope(env).ok).toBe(true);
    expect(env.head.count).toBe(1);
    expect(env.fields.some((f: any) => f.field === "tracesDigest")).toBe(true); // the commitment field is present (digested)
    expect(JSON.stringify(env).includes("RAW-TRACE-RESOURCE-BODY")).toBe(false); // raw trace body never crosses
  });
});

describe("B3.3 — env-v1 export is READ-ONLY; B2.4 authority path untouched", () => {
  it("the export module has no mutation and references no authority mutation (no grant)", () => {
    const src = import.meta.glob("../convex/aukoraWitnessExport.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    expect(code.includes("mutation(")).toBe(false);
    for (const m of ["aumlokMemoryWrite", "aumlokCeremonyMint", "consumeManifestUse", "submitIntentCore", "writeReceiptRow"]) expect(code.includes(m)).toBe(false);
  });
});
