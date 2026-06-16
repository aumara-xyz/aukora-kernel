// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.2/B3.3/B3.4 — DEPLOYMENT ROUTE GUARD (routing only; NOT mesh, NOT production hardening). Proves the http.ts surface
 * is default-OFF behind FOUR independent flags: AUKORA_B3_WITNESS_ENABLED (read-only witness/observe routes),
 * AUKORA_B3_CHANNEL_ENABLED (B3.4 ML-KEM channel transport), AUKORA_B3_MESH_ENABLED (cross-node IMPORT routes — incl. the
 * B3.5a audit-import + explicit-pin routes), AUKORA_DEMO_ROUTES_ENABLED (anonymous demo/run). Every gated route refuses
 * with 404 `route_disabled` + its flag name unless that flag is enabled; a disabled route invokes no handler and mutates
 * no state; the four flags are mutually INDEPENDENT (one ON never opens another's routes); and the B2.4 authority
 * mutations are not HTTP routes at all (orthogonal to the guard).
 */
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.*s");
const count = (t: any, table: string) => t.run(async (ctx: any) => (await ctx.db.query(table).collect()).length);
const FLAGS = ["AUKORA_B3_WITNESS_ENABLED", "AUKORA_B3_CHANNEL_ENABLED", "AUKORA_B3_MESH_ENABLED", "AUKORA_DEMO_ROUTES_ENABLED"];

describe("B3.2/B3.3/B3.4 — http route guard: default OFF, four independent flags", () => {
  afterEach(() => { for (const f of FLAGS) delete process.env[f]; });

  it("by default every gated route refuses with 404 route_disabled + its flag name", async () => {
    const t = convexTest(schema, modules);
    const cases = [
      { path: "/export?chainKey=x", method: "GET", flag: "AUKORA_B3_WITNESS_ENABLED" },   // read-only witness/observe
      { path: "/node-pubkey", method: "GET", flag: "AUKORA_B3_WITNESS_ENABLED" },
      { path: "/export-harvest", method: "GET", flag: "AUKORA_B3_WITNESS_ENABLED" },
      { path: "/channel-binding", method: "GET", flag: "AUKORA_B3_CHANNEL_ENABLED" },       // B3.4 channel publication
      { path: "/channel-export", method: "POST", flag: "AUKORA_B3_CHANNEL_ENABLED" },       // B3.4 channel responder
      { path: "/import-delegated", method: "POST", flag: "AUKORA_B3_MESH_ENABLED" },        // cross-node IMPORT (B3.5)
      { path: "/import-delegated-revocation", method: "POST", flag: "AUKORA_B3_MESH_ENABLED" },
      { path: "/pin-trust", method: "POST", flag: "AUKORA_B3_MESH_ENABLED" },               // B3.5a explicit-pin (no TOFU)
      { path: "/import-foreign-manifest", method: "POST", flag: "AUKORA_B3_MESH_ENABLED" }, // B3.5a audit-only import
      { path: "/import-foreign-memory", method: "POST", flag: "AUKORA_B3_MESH_ENABLED" },
      { path: "/import-revocation-view", method: "POST", flag: "AUKORA_B3_MESH_ENABLED" },
      { path: "/run-memory", method: "POST", flag: "AUKORA_DEMO_ROUTES_ENABLED" },          // anonymous demo
      { path: "/run-demo", method: "POST", flag: "AUKORA_DEMO_ROUTES_ENABLED" },
      { path: "/audit", method: "GET", flag: "AUKORA_DEMO_ROUTES_ENABLED" },
      { path: "/provision-operator", method: "POST", flag: "AUKORA_DEMO_ROUTES_ENABLED" },
    ];
    for (const c of cases) {
      const res = await t.fetch(c.path, { method: c.method });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "route_disabled", flag: c.flag });
    }
  });

  it("a disabled cross-node import route invokes nothing — no trust / import / receipt state mutates", async () => {
    const t = convexTest(schema, modules);
    const before = { trust: await count(t, "node_trust_registry"), imp: await count(t, "node_import_registry"), rcpt: await count(t, "auma_receipts") };
    const res = await t.fetch("/import-delegated", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ env: { sourceNodeId: "evil", headKeyId: "k1" } }) });
    expect(res.status).toBe(404);
    expect({ trust: await count(t, "node_trust_registry"), imp: await count(t, "node_import_registry"), rcpt: await count(t, "auma_receipts") }).toEqual(before); // unchanged
  });

  it("the FOUR flags are INDEPENDENT — enabling one opens ONLY its own routes (both directions)", async () => {
    const t = convexTest(schema, modules);
    // route is route_disabled? (404 with the route_disabled body, handler NOT invoked). An OPEN route is anything else —
    // a 200, OR a handler that ran and threw (e.g. a validator error on a deliberately-thin body) which t.fetch surfaces.
    const disabled = async (path: string, method: string, body?: any) => {
      try {
        const r = await t.fetch(path, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
        if (r.status !== 404) return false;
        return (await r.json().catch(() => ({})))?.error === "route_disabled";
      } catch { return false; } // the handler ran and threw → the gate was OPEN (route_disabled never invokes the handler)
    };
    const W: [string, string] = ["/node-pubkey", "GET"], C: [string, string] = ["/channel-binding", "GET"], M: [string, string] = ["/import-delegated", "POST"], D: [string, string] = ["/run-memory", "POST"];

    process.env.AUKORA_B3_WITNESS_ENABLED = "1"; // WITNESS only
    expect(await disabled(...W)).toBe(false);     // witness OPEN
    expect(await disabled(...C)).toBe(true);      // channel still gated — WITNESS does NOT open it
    expect(await disabled(...M, {})).toBe(true);  // import still gated (MESH)
    expect(await disabled(...D)).toBe(true);      // demo still gated
    delete process.env.AUKORA_B3_WITNESS_ENABLED;

    process.env.AUKORA_B3_CHANNEL_ENABLED = "1";  // CHANNEL only (B3.4)
    expect(await disabled(...C)).toBe(false);     // channel OPEN
    expect(await disabled(...W)).toBe(true);      // witness still gated — CHANNEL does NOT open it
    expect(await disabled(...M, {})).toBe(true);  // import still gated
    expect(await disabled(...D)).toBe(true);      // demo still gated
    delete process.env.AUKORA_B3_CHANNEL_ENABLED;

    process.env.AUKORA_B3_MESH_ENABLED = "1";     // MESH only
    expect(await disabled(...M, {})).toBe(false); // import OPEN (gate passed)
    expect(await disabled(...W)).toBe(true);      // witness still gated — MESH does NOT open it
    expect(await disabled(...C)).toBe(true);      // channel still gated
    expect(await disabled(...D)).toBe(true);      // demo still gated
    delete process.env.AUKORA_B3_MESH_ENABLED;

    process.env.AUKORA_DEMO_ROUTES_ENABLED = "1"; // DEMO only
    expect(await disabled(...D)).toBe(false);     // demo OPEN
    expect(await disabled(...W)).toBe(true);      // witness still gated
    expect(await disabled(...C)).toBe(true);      // channel still gated
    expect(await disabled(...M, {})).toBe(true);  // import still gated
  });

  it("each flag accepts only explicit truthy values — unset/empty/false/garbage default to OFF", async () => {
    const t = convexTest(schema, modules);
    for (const v of ["", "0", "false", "off", "no", "nope", "2"]) {
      process.env.AUKORA_B3_WITNESS_ENABLED = v;
      expect((await t.fetch("/node-pubkey", { method: "GET" })).status).toBe(404);
    }
    for (const v of ["1", "true", "on", "yes", "TRUE"]) {
      process.env.AUKORA_B3_WITNESS_ENABLED = v;
      expect((await t.fetch("/node-pubkey", { method: "GET" })).status).toBe(200);
    }
  });

  it("B2.4 untouched: the manifest→grant→token→receipt authority mutations are NOT http routes (orthogonal to the guard)", () => {
    const src = import.meta.glob("../convex/http.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    for (const authorityMutation of ["aumlokMemoryWrite", "aumlokCeremonyMint", "aumlokManifestConsume", "aumlokMintManifest"]) {
      expect(code.includes(authorityMutation)).toBe(false); // the guard gates demo/transport routes, never the authority path
    }
  });
});
