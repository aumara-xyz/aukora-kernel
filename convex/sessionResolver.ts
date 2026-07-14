// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { flagEnabled, requireNodeId } from "./runtimeConfig";

export const DEMO_SESSIONS_FLAG = "AUKORA_DEMO_SESSIONS_ENABLED";

/**
 * Demo SessionResolver seam — replaces aukoraAuth's founder allowlist (TWONODE-2).
 *   resolveSession(token) -> { principalId, nodeId, roles }
 * Demo impl: a row in `node_sessions` (seeded only through internal functions). It is disabled unless
 * AUKORA_DEMO_SESSIONS_ENABLED is explicit. Production integrations must use an AUMLOK-backed proof-of-possession
 * resolver. There is no founder allowlist in this lab seam.
 */
export async function resolveSession(ctx: QueryCtx | MutationCtx, token?: string) {
  if (!flagEnabled(DEMO_SESSIONS_FLAG)) return null;
  const normalized = token?.trim();
  if (!normalized || normalized.length < 32 || normalized.length > 256) return null;
  const row = await ctx.db.query("node_sessions").withIndex("by_token", (q) => q.eq("token", normalized)).first();
  if (!row || row.nodeId !== requireNodeId() || !Array.isArray(row.roles) || !row.roles.includes("operator")) return null;
  return { principalId: row.principalId, nodeId: row.nodeId, roles: [...row.roles] };
}

/** Legacy lab shims. They can authorize only when the explicit demo-session flag is enabled. */
export async function resolveFounderUserId(ctx: QueryCtx | MutationCtx, token?: string): Promise<string | null> {
  const s = await resolveSession(ctx, token);
  return s ? s.principalId : null;
}
export async function requireFounderUserId(ctx: QueryCtx | MutationCtx, token?: string): Promise<string> {
  const id = await resolveFounderUserId(ctx, token);
  if (!id) throw new Error("node_session_required");
  return id;
}
