# Aukora IDE gate — exact OpenCode insertion (24Z.64)

The gate in this folder (`aukoraGate.ts` / `governedToolBoundary.ts`) is the durable, tested Aukora contribution. It
mirrors the OpenCode tool-permission contract (MIT) so it drops in at two sites. **No OpenCode source is copied here** —
this is the map; the actual edit lands in the clean `aukora-ide` vendored copy next, post-Skunk.

## Insert site 1 — the tool `ask` (every tool)
`packages/opencode/src/session/tools.ts:63` — the `ask:(req) => permission.ask({...})` that tools call before a side
effect (e.g. `tool/edit.ts:102` calls `ctx.ask({permission:"edit", patterns, always:["*"], metadata:{filepath,diff}})`
immediately before `afs.writeWithDirs`).

**Change:** route that `ask` through `governedAsk(input, aumlokSession, onReceipt)`. On `allow` it returns and the tool
proceeds; on `deny`/`pause` it throws `AukoraGateDenied`, so the subsequent `afs.writeWithDirs` (the side effect) never
runs. Map OpenCode's `{permission, patterns, always, metadata}` directly onto `AukoraAskInput`.

## Insert site 2 — the MCP path (anti-bypass)
`packages/opencode/src/session/tools.ts:134` — MCP tools call `ctx.ask({permission:key, patterns:["*"], always:["*"]})`,
i.e. an effective auto-allow wildcard. **Route this through the same `governedAsk`.** Because the Aukora gate ignores
`always`, the MCP wildcard cannot bypass it (verified by the `mcp:fs … always:["*"]` test → still `deny`).

## Insert site 3 (optional, deeper) — the permission decision
`packages/core/src/permission.ts` `evaluateInput` / `assert` (the `{action, resources, sessionID, source}` decision).
Inserting at `evaluateInput` covers any tool that ever asks, at the cost of touching the Effect runtime (Skunk must
review for races / uninterruptible masks). Site 1+2 is the lower-risk first landing.

## What does NOT change
Schemas (`permission/schema.ts`, `sdk/js` contracts), `tool/registry.ts` layer chain, provider custom loaders,
`core/src/session/runner/*`, shell tree-sitter, native LLM runtime — all NEVER-touch-until-Skunk per the integration map.

## Proof (this round, committed + green)
`internal/edge-node/tests/aukoraIdeGate.test.ts` (10 tests): low-risk write passes; `.env`/secret-content/kernel-code
blocked before any write; locked AUMLOK pauses write-capable (read allowed); `always:["*"]` cannot bypass; receipts carry
a sha256 argsHash + reason labels only (no secret value).
