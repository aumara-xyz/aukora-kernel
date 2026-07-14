// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

/** Explicit adapter configuration. Test harnesses inject disposable values. */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function flagEnabled(name: string): boolean {
  return ["1", "true", "on", "yes"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function requireIdentifier(name: "AUMA_NODE_ID" | "AUMA_HEAD_KEY_ID", code: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${code}_unconfigured`);
  if (!ID_RE.test(value)) throw new Error(`${code}_invalid`);
  return value;
}

export function requireNodeId(): string {
  return requireIdentifier("AUMA_NODE_ID", "aukora_node_id");
}

export function requireHeadKeyId(): string {
  return requireIdentifier("AUMA_HEAD_KEY_ID", "aukora_head_key_id");
}

export function requireDemoSeed(name: string, code: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${code}_unconfigured`);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${code}_invalid`);
  return value;
}
