// Aukora OS — Landing Page Server (dev tooling/preview)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AUKORA_WEB_PORT || 7080);
const DIR = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(DIR, "index.html");

const read = (p: string) => { 
  try { 
    return readFileSync(p, "utf-8"); 
  } catch { 
    return "<h1>Aukora landing page not found on disk</h1>"; 
  } 
};

Bun.serve({
  // Loopback-only (127.0.0.1) — local static preview. Bun.serve otherwise defaults to all-interfaces
  // (0.0.0.0). Per the seed-root contract there is no signed/network lane yet, so serve local-only.
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/") {
      return new Response(read(HTML_PATH), { 
        headers: { "content-type": "text/html; charset=utf-8" } 
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log("🌱 Aukora OS Web Preview → http://localhost:" + PORT);
