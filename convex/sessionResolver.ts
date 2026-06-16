// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import type { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Demo SessionResolver seam — replaces aukoraAuth's founder allowlist (TWONODE-2).
 *   resolveSession(token) -> { principalId, nodeId, roles }
 * Demo impl: a row in `node_sessions` (seeded once via seed.ts). Prod-future: swap to an AUMLOK-backed
 * proof-of-possession resolver. There is NO founder allowlist in the extracted node.
 */
export async function resolveSession(ctx: QueryCtx | MutationCtx, token?: string) {
  if (!token?.trim()) return null;
  const row = await ctx.db.query("node_sessions").withIndex("by_token", (q) => q.eq("token", token)).first();
  return row ? { principalId: row.principalId, nodeId: row.nodeId, roles: row.roles } : null;
}

/** Kernel-compat shims (were aukoraAuth). The resolved session principal IS the authority — no allowlist gate. */
export async function resolveFounderUserId(ctx: QueryCtx | MutationCtx, token?: string): Promise<string | null> {
  const s = await resolveSession(ctx, token);
  return s ? s.principalId : null;
}
export async function requireFounderUserId(ctx: QueryCtx | MutationCtx, token?: string): Promise<string> {
  const id = await resolveFounderUserId(ctx, token);
  if (!id) throw new Error("node_session_required");
  return id;
}