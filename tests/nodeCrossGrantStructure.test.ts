// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.5b — STRUCTURAL one-way-door guards (grep over comment-stripped source). Lock the conservation invariants the
 * dynamic suite proves behaviourally: (1) the resolver never reads the B3.5a audit-only node_foreign_manifests;
 * (2) NO check branches on issuer.kind to loosen anything (issuer is audit-only after resolve); (3) node_cross_grants is
 * written ONLY by promoteCrossGrant (no auto-promotion from import, no second authority surface); (4) ONE consume
 * chokepoint (consumeManifestUseCore) — no parallel consume.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const strip = (p: string) => readFileSync(new URL(`../convex/${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const manifests = strip("aumlokManifests.ts");
const nodeImport = strip("nodeImport.ts");
const memory = strip("aumlokMemory.ts");
const fnBody = (src: string, exportName: string) => { const i = src.indexOf(exportName); const j = src.indexOf("\nexport ", i + 1); return src.slice(i, j === -1 ? undefined : j); };

describe("B3.5b — structural conservation guards", () => {
  it("the resolver NEVER reads the B3.5a audit-only node_foreign_manifests (authority surface is isolated)", () => {
    expect(manifests.includes("node_foreign_manifests")).toBe(false);
    expect(manifests.includes('query("node_cross_grants")')).toBe(true); // it DOES read the isolated cross-grant table
  });
  it("NO check in the resolver/consume branches on issuer.kind to loosen anything (issuer is audit-only after resolve)", () => {
    // the resolver only ASSIGNS issuer = { kind: ... }; it never READS issuer.kind. consume captures + returns it, never branches.
    expect(/issuer[?.]*\.kind/.test(manifests)).toBe(false);
    expect(manifests.includes("res.issuer")).toBe(true); // captured + returned (audit), not branched
  });
  it("node_cross_grants is WRITTEN ONLY by promoteCrossGrant — no auto-promotion, no second writer", () => {
    // exactly one insert site, in nodeImport.ts
    const inserts = (nodeImport.match(/insert\("node_cross_grants"/g) ?? []).length;
    expect(inserts).toBe(1);
    // the B3.5a importer NEVER inserts a cross-grant (no auto-promotion from audit import)
    expect(fnBody(nodeImport, "export const importForeignManifest").includes("node_cross_grants")).toBe(false);
    // the one insert lives inside the flag+PoP-gated promote (it references the flag + the PoP session)
    const promote = fnBody(nodeImport, "export const promoteCrossGrant");
    expect(promote.includes('insert("node_cross_grants"')).toBe(true);
    expect(promote.includes("AUKORA_B3_CROSSGRANT_ENABLED")).toBe(true);
    expect(promote.includes("resolvePoPSession")).toBe(true);
  });
  it("ONE consume chokepoint — node_cross_grants.usedCount is incremented only via the shared consumeManifestUseCore", () => {
    // no parallel consume function: usedCount is PATCHED (incremented) in exactly one place (the shared chokepoint), via m._id.
    expect((manifests.match(/patch\(m\._id, \{ usedCount: m\.usedCount \+ 1/g) ?? []).length).toBe(1);
    // nodeImport (where promote lives) never patches usedCount itself
    expect(nodeImport.includes("usedCount: ")).toBe(true); // it sets usedCount: 0 at promote
    expect(/patch\([^)]*usedCount[^)]*\+ 1/.test(nodeImport)).toBe(false); // but never INCREMENTS it (that's the chokepoint's job)
  });
  it("the memory effect tags issuer audit-only (grant + receipt), and the foreign branch widens nothing", () => {
    expect(memory.includes("issuer: issuerKind")).toBe(true);         // recorded on grant + proofJson
    expect(memory.includes('issuer?.kind === "foreign"')).toBe(true); // tag population only
    // the write still routes through the SINGLE consume + the unchanged grant→intent→token→receipt gate
    expect(memory.includes("consumeManifestUseCore")).toBe(true);
    expect(memory.includes("submitIntentCore")).toBe(true);
    expect(memory.includes("verifyAndConsumeDecisionToken")).toBe(true);
  });
});
