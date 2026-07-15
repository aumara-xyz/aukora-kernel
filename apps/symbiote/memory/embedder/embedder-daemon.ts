// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.85 — LOCAL EMBEDDER SIDECAR (her memory gets a MEANING layer, on-box, ZERO egress). Mirrors the signer-daemon pattern:
 * a sibling process on a 0600 unix socket. It loads all-MiniLM-L6-v2 (384-d) from the VENDORED local model dir with
 * `allowRemoteModels=false` — so it NEVER reaches the network: her memory text is embedded entirely on the machine and never
 * leaves it (sovereignty / §13 forbidden: no remote embedder). It holds NO secret (no K, no keys) — it only turns text into a
 * vector. memory_write embeds each value here; memory_recall_semantic embeds the free-form query here.
 *
 * Protocol: one JSON line in, one JSON line out.
 *   {op:"embed", text:"…"}            -> {ok:true, dims:384, vector:[…]}
 *   {op:"embed_batch", texts:["…"]}   -> {ok:true, dims:384, vectors:[[…],…]}
 *   {op:"health"}                     -> {ok:true, model, dims, remote:false}
 */
import { pipeline, env } from "@xenova/transformers"
import { mkdirSync, chmodSync, existsSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
// OFFLINE-ONLY: load from the vendored local model dir; NEVER fetch remotely. This is the zero-egress guarantee.
env.cacheDir = join(HERE, "models")
env.localModelPath = join(HERE, "models")
env.allowRemoteModels = false
env.allowLocalModels = true

const DIR = process.env.AUKORA_EMBEDDER_DIR || join(homedir(), ".aukora", "embedder")
const SOCK = process.env.AUKORA_EMBEDDER_SOCK || join(DIR, "embed.sock")
const MODEL = "Xenova/all-MiniLM-L6-v2"
const DIMS = 384
const MAX_TEXT = 4000 // cap input length (mirror memory value caps) — keeps embed bounded
const MAX_BATCH = 256

let extractor: any = null

async function embedOne(text: string): Promise<number[]> {
  const out = await extractor(String(text ?? "").slice(0, MAX_TEXT), { pooling: "mean", normalize: true })
  return Array.from(out.data as Float32Array)
}

async function handle(req: any): Promise<any> {
  try {
    if (req?.op === "health") return { ok: true, model: MODEL, dims: DIMS, remote: false }
    if (req?.op === "embed") {
      if (typeof req.text !== "string") return { ok: false, reason: "embed requires text:string" }
      return { ok: true, dims: DIMS, vector: await embedOne(req.text) }
    }
    if (req?.op === "embed_batch") {
      if (!Array.isArray(req.texts)) return { ok: false, reason: "embed_batch requires texts:string[]" }
      if (req.texts.length > MAX_BATCH) return { ok: false, reason: `batch too large (>${MAX_BATCH})` }
      const vectors: number[][] = []
      for (const t of req.texts) vectors.push(await embedOne(t))
      return { ok: true, dims: DIMS, vectors }
    }
    return { ok: false, reason: "unknown op" }
  } catch (e) {
    return { ok: false, reason: "embed failed: " + String(e) }
  }
}

async function main() {
  try { process.umask(0o077) } catch {} // 24Z.85b (review LOW) — create the dir 0700 + socket 0600 from the START (close the chmod TOCTOU window)
  mkdirSync(DIR, { recursive: true })
  try { chmodSync(DIR, 0o700) } catch {}
  // load + warm the model from disk (offline). If the vendored model is missing this THROWS — fail-closed (no silent remote).
  extractor = await pipeline("feature-extraction", MODEL, { quantized: true })
  await embedOne("warm")
  try { if (existsSync(SOCK)) unlinkSync(SOCK) } catch {}
  // robust write: a batch response can exceed the socket's send buffer, so s.write() may return a PARTIAL count under
  // backpressure (this is why a 20KB batch timed out while a 7KB single embed succeeded). Track the remaining bytes and
  // finish on `drain`. Ends the connection only once the whole reply is flushed.
  const reply = (s: any, obj: any) => { s.out = Buffer.from(JSON.stringify(obj) + "\n", "utf8"); s.off = 0; pump(s) }
  const pump = (s: any) => {
    if (!s.out) return
    const n = s.write(s.out.subarray(s.off)); s.off += n > 0 ? n : 0
    if (s.off >= s.out.length) { s.out = null; try { s.end() } catch {} }
  }
  // @ts-ignore — Bun.listen unix socket
  Bun.listen({
    unix: SOCK,
    socket: {
      data(s: any, d: Buffer) {
        // accumulate until a newline, then handle one request (memory values/queries are single-line JSON)
        s.buf = (s.buf || "") + d.toString("utf8")
        const nl = s.buf.indexOf("\n")
        if (nl < 0) return
        const line = s.buf.slice(0, nl)
        s.buf = s.buf.slice(nl + 1)
        let req: any
        try { req = JSON.parse(line) } catch { reply(s, { ok: false, reason: "bad json" }); return }
        handle(req).then((res) => reply(s, res))
      },
      drain(s: any) { pump(s) },
      open(s: any) { s.buf = ""; s.out = null; s.off = 0 },
      error(_s: any, _e: any) {},
    },
  })
  chmodSync(SOCK, 0o600)
  console.error(`[embedder] listening on ${SOCK} (0600) · model ${MODEL} · ${DIMS}d · allowRemoteModels=false (LOCAL, zero-egress) · holds NO secret`)
}

main().catch((e) => { console.error("[embedder] FATAL:", e); process.exit(1) })
