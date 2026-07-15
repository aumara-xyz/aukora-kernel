# Aukora Spatial

The trinity spatial workspace: the codebase as a 3D map, inside the
three-lane glass shell from auma.one/trinity (rebuilt from scratch).
**Left lane is always chats.** Center is the organ stage. Right is the menu.

```
bun spatial/serve.ts        # http://127.0.0.1:7090  — the shell + advisory reads
bun spatial/chat-serve.ts   # http://127.0.0.1:7091  — the chat door (governed loop)
```

Files are orbs (sized by LOC, colored by top-level dir), imports are threads,
test results are waves. Corners size the lanes (`[` `]` `,` `.`), clicking an
orb opens the inspector dock inside the map, `Esc` closes chat / deselects.
Chat with Aukora in the left lane: `help`, `status`, `map yourself`,
`search <q>`, `agent: <goal>` — she explores read-only, drafts in the sandbox,
and halts for your signature.

## Invariants — two processes, two contracts

**spatial/serve.ts (7090) — the advisory read surface:**
- GET/HEAD only; the method guard runs before routing, so no write lane exists
  on this surface. This process never writes to disk.
- Pure reads: repo source (graph scan via `core/src/importGraphVerifier`),
  `state/kira/brain.json`, the AUMLOK status snapshot (key existence only,
  never key bytes), `dashboard/fu/runs/*.json`, `scripts/status.sh`.

**spatial/chat-serve.ts (7091) — the chat door:**
- The governed workbench loop (`core/src/workbenchCommandLoop`), imported
  lazily on first request and cached (restart to pick up new core/ code). A
  chat turn can write ONLY through the engine's own governed lanes: pending
  proposals awaiting signature, sandbox temp dirs, the advisory Kira memory
  capture (`state/kira/brain.json` — load-modify-save, last-writer-wins if the
  7070 dashboard runs the same loop concurrently), and the signature-gated
  `apply signed proposal` lane. AUMLOK stays sole write authority for the
  live folder.
- Attachments: text files are inlined into the outbound message; images
  preview in the transcript but nothing consumes them yet (issue #31).
- Loopback only; server-side Origin allowlist (7090 shell only) blocks
  browser CSRF from foreign pages.

Both bind 127.0.0.1 and never touch dashboard 7070's endpoints.

## Layout

```
serve.ts                  advisory server: static app + read-only JSON APIs + SSE stub
chat-serve.ts             chat door: governed workbench loop on 7091 (separate process)
app/index.html            trinity shell skeleton
app/style.css             design language (hues, glass, corners, pills, rows, chat, dock)
app/shell.js              lane state machine, hot corners, tabs, organ switching
app/chat.js               chats lane: threads, transcript, composer -> chat door
app/organs.js             read-only DOM organs: council / kira / aumlok / status
app/map/map.js            map organ: graph fetch, picking, labels, waves, inspector dock
app/map/renderer.js       raw WebGL2: node impostors + edge ribbons (2 draw calls)
app/map/camera.js         mat4 math + orbit/fly camera with inertia
app/map/layout.worker.js  force layout: converge-then-freeze, deterministic
assets/aumara-icon.png    the trinity mark
```

Design spec + brick queue: `docs/SPATIAL_TRINITY_IDE_SPEC.md`.
Renderer program contracts: `spatial/RENDERER.md`.
