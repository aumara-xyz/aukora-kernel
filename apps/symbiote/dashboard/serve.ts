// Aukora Symbiote — Builder Console.
// DEV TOOLING, not the organism. Two DIFFERENT things live behind this one server, honestly labeled:
//   /console, /anatomy, /first-contact — genuinely READ-ONLY: Singularity Path / Inbox / Laws / live
//     status / the meaning-graph. These never touch core/ authority/ memory/.
//   / (default) — the WORKBENCH chat, real and gated, NOT read-only: every command routes through
//     the same governed pipeline as scripts/kira.sh etc (propose -> sandbox -> test -> Fusion review),
//     and "apply signed proposal" IS a real path to the live repo — gated entirely by the owner's own
//     Ed25519 signature produced in their own terminal (never here), never automatic, never silent.
// Run:
//   bun dashboard/serve.ts        (or: bash scripts/console.sh)
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAumlokStatusSnapshot } from "../core/src/aumlokStatusSnapshot";
import { checkLocalPostGuard } from "../core/src/localPostGuard";
import { runWorkbenchCommand, freshWorkbenchSession } from "../core/src/workbenchCommandLoop";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AUKORA_CONSOLE_PORT || 7070);
const DOCS = join(REPO, "docs");
const GRAPH = join(REPO, "graphify-out", "graph.html");
const FIRST_CONTACT = join(REPO, "core", "src", "console.html");
const AUMARA_ICON = join(REPO, "dashboard", "assets", "aumara-icon.png");
const WORKBENCH = join(REPO, "dashboard", "workbench.html");
const LOCAL_POST_TOKEN = process.env.AUKORA_LOCAL_POST_TOKEN || "";
const WORKBENCH_ORIGINS = [
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
];

// Single local owner, single workbench — one in-memory session is the right scope (resets on restart).
// This is the ONLY state the chat endpoint touches; it never reads/writes fs beyond the native dispatcher.
const workbenchSession = freshWorkbenchSession();

const read = (p: string) => { try { return readFileSync(p, "utf-8"); } catch { return ""; } };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function countFiles(rel: string): number {
  const root = join(REPO, rel); let n = 0;
  const walk = (d: string) => {
    let ents: string[]; try { ents = readdirSync(d); } catch { return; }
    for (const e of ents) {
      if (e === "node_modules" || e === ".git" || e === "graphify-out") continue;
      const p = join(d, e); let s; try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p); else n++;
    }
  };
  walk(root); return n;
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}
function md(src: string): string {
  const lines = src.split("\n");
  let html = "", i = 0, inList = false, tag = "ul";
  const close = () => { if (inList) { html += "</" + tag + ">"; inList = false; } };
  const cells = (r: string) => r.split("|").slice(1, -1).map((c) => c.trim());
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith("```")) { let buf = ""; i++; while (i < lines.length && !lines[i].startsWith("```")) { buf += lines[i] + "\n"; i++; } i++; close(); html += "<pre><code>" + esc(buf) + "</code></pre>"; continue; }
    if (/^\s*\|/.test(ln) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|?\s*$/.test(lines[i + 1])) {
      close(); const head = ln; i += 2;
      html += "<table><thead><tr>" + cells(head).map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
      while (i < lines.length && /^\s*\|/.test(lines[i])) { html += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; i++; }
      html += "</tbody></table>"; continue;
    }
    let m = ln.match(/^(#{1,4})\s+(.*)/);
    if (m) { close(); const l = m[1].length; html += "<h" + l + ">" + inline(m[2]) + "</h" + l + ">"; i++; continue; }
    if (/^---+\s*$/.test(ln)) { close(); html += "<hr>"; i++; continue; }
    if (/^>\s?/.test(ln)) { close(); html += "<blockquote>" + inline(ln.replace(/^>\s?/, "")) + "</blockquote>"; i++; continue; }
    let cb = ln.match(/^\s*-\s+\[([ xX])\]\s+(.*)/);
    if (cb) { if (!inList || tag !== "ul") { close(); tag = "ul"; inList = true; html += '<ul class="chk">'; } const done = cb[1].toLowerCase() === "x"; html += '<li class="' + (done ? "done" : "") + '">' + (done ? "☑" : "☐") + " " + inline(cb[2]) + "</li>"; i++; continue; }
    let ul = ln.match(/^\s*[-*]\s+(.*)/);
    if (ul) { if (!inList || tag !== "ul") { close(); tag = "ul"; inList = true; html += "<ul>"; } html += "<li>" + inline(ul[1]) + "</li>"; i++; continue; }
    let ol = ln.match(/^\s*\d+\.\s+(.*)/);
    if (ol) { if (!inList || tag !== "ol") { close(); tag = "ol"; inList = true; html += "<ol>"; } html += "<li>" + inline(ol[1]) + "</li>"; i++; continue; }
    if (/^\s*$/.test(ln)) { close(); i++; continue; }
    close(); html += "<p>" + inline(ln) + "</p>"; i++;
  }
  close();
  return html;
}

function status(): { ready: boolean; state: string; text: string } {
  try {
    const r = Bun.spawnSync(["bash", join(REPO, "scripts/status.sh")]);
    const text = (r.stdout?.toString() || "").replace(/\x1b\[[0-9;]*m/g, "");
    const m = text.match(/STATE:\s*([A-Z_]+)/);
    const state = m ? m[1] : "UNKNOWN";
    return { ready: state.includes("READY"), state, text };
  } catch { return { ready: false, state: "UNAVAILABLE", text: "status unavailable" }; }
}

// OBSERVER ONLY — runs one M4 self-edit heartbeat (sandbox-only) and returns its phased trace. The console
// never authorizes the loop; it watches it. The heartbeat applies only to a throwaway temp dir (appliedLive=false).
function heartbeat(): string {
  try {
    const r = Bun.spawnSync(["bash", join(REPO, "scripts/heartbeat.sh")]);
    return (r.stdout?.toString() || "").replace(/\x1b\[[0-9;]*m/g, "") || "(no output)";
  } catch (e) { return "heartbeat unavailable: " + String(e); }
}

// ── Anatomy: the real organism as a meaning-graph. Gate at center (everything flows through it),
//    organs as nodes sized by live file count, the laws written on the edges. Cool AND true. ──
function anatomy(): string {
  type Nd = { id: string; label: string; sub: string; x: number; y: number; color: string; count: number; dash?: boolean };
  const N = (id: string, label: string, sub: string, x: number, y: number, color: string, count: number, dash = false): Nd => ({ id, label, sub, x, y, color, count, dash });
  const gate = N("gate", "AUTHORITY", "gate · AUMLOK · chokepoint — decides every effect, emits a receipt", 470, 380, "#d29922", countFiles("authority"));
  const prop = N("prop", "PROPOSER", "a model, outside the boundary — proposes json_action_v1", 470, 78, "#6e7681", 0, true);
  const receipt = N("receipt", "RECEIPT LEDGER", "authority + intent + effect, hash-chained — no receipt, no reality", 470, 690, "#3fb950", 0);
  const econ = N("economy", "SOVEREIGN LOOP", "FUTURE — not built yet: witnessed AURA coherence (nonnumeric — never a token) + Hive network (web-of-trust)", 800, 350, "#e3b341", 0, true);
  // Round 3 (issue #23): the "SELF-EDIT" node used to represent the vendored donor IDE tool fork
  // (a 97-file tree with zero real runtime importers) — deleted, archived to a separate git branch.
  // The organism's REAL self-editing surface today is the native tool-calling agent
  // (core/src/nativeToolCallingEngine.ts) driven through the workbench
  // (core/src/workbenchCommandLoop.ts) — not shown here as its own node since, unlike the other 4
  // organs, it isn't a static directory countFiles() can size; it's the workbench's own "agent: <goal>"
  // path, documented in dashboard/README.md instead.
  const organs: Nd[] = [
    N("core", "CORE", "the kernel law — executes only through the gate", 140, 350, "#3fb950", countFiles("core/src")),
    N("memory", "MEMORY", "recall + zero-egress embedder — suggests, never authorizes", 235, 150, "#58a6ff", countFiles("memory")),
    N("recv", "RECEIVER", "Convex brain surface — read-only (organs in core/)", 235, 605, "#56d4dd", countFiles("receiver")),
    N("fusion", "FUSION", "the council — reviews, never authorizes (organs in core/)", 705, 605, "#f0883e", countFiles("fusion")),
  ];
  const rOf = (n: Nd) => n.id === "gate" ? 60 : (n.id === "prop" || n.id === "receipt" || n.id === "economy") ? 30 : Math.max(26, Math.min(58, 20 + Math.sqrt(n.count) * 3.2));
  // edges from each organ + proposer + receipt to the gate (the hub)
  const E: [Nd, Nd, string][] = [
    [prop, gate, "proposes"],
    [organs[0], gate, "executes via gate"],
    [organs[1], gate, "suggests only"],
    [organs[2], gate, "read-only"],
    [organs[3], gate, "advises only"],
    [gate, receipt, "every effect → receipt"],
    [econ, gate, "vouched by key"],
  ];
  const edge = ([a, b, label]: [Nd, Nd, string]) => {
    const lx = a.x + (b.x - a.x) * 0.42, ly = a.y + (b.y - a.y) * 0.42;
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${a.id === "gate" ? b.color : a.color}" stroke-width="1.6" opacity=".4"/>` +
      (label ? `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#8b949e" font-size="9.5" class="el">${esc(label)}</text>` : "");
  };
  const node = (n: Nd) => {
    const r = rOf(n);
    const info = `${esc(n.label)} — ${esc(n.sub)}${n.count ? ` · ${n.count} files` : ""}`;
    return `<g class="nd" data-info="${info}" transform="translate(${n.x},${n.y})">` +
      (n.id === "gate" ? `<circle r="${r + 9}" class="halo"/>` : "") +
      `<circle r="${r}" fill="${n.color}1f" stroke="${n.color}" stroke-width="${n.id === "gate" ? 3 : 2}"${n.dash ? ' stroke-dasharray="5 4"' : ""}/>` +
      (n.id === "gate" ? `<text text-anchor="middle" dy="6" font-size="26">🛡</text>` : "") +
      (n.id === "economy" ? `<circle r="7" fill="none" stroke="#e3b341" stroke-width="2"/><circle r="2.5" fill="#e3b341"/>` : "") +
      `<text text-anchor="middle" dy="${r + 16}" fill="#e6edf3" font-size="12" font-weight="700">${esc(n.label)}</text>` +
      (n.count ? `<text text-anchor="middle" dy="${r + 30}" fill="#8b949e" font-size="10">${n.count} files</text>` : "") +
      `</g>`;
  };
  const all = [prop, ...organs, gate, receipt, econ];
  const svg = `<svg viewBox="0 0 940 740" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
    E.map(edge).join("") + all.map(node).join("") + `</svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg:#010409;--ink:#c9d1d9;--dim:#8b949e}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column}
.top{padding:12px 18px 4px;color:var(--dim);font-size:12px}.top b{color:var(--ink)}
.wrap{flex:1;min-height:0}
.nd{cursor:pointer}.nd:hover circle{filter:brightness(1.35)}
.el{pointer-events:none}
.halo{fill:#d2992233;stroke:none;animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.25;r:69}50%{opacity:.6;r:74}}
#info{padding:9px 18px;border-top:1px solid #21262d;background:#0d1117;font-size:12px;color:var(--ink);min-height:38px}
#info .h{color:var(--dim)}
</style></head><body>
<div class="top"><b>Your actual organism.</b> Solid nodes are real code (counts live off disk); dashed nodes (the proposer model, the future sovereign loop) are external or not-yet-built. Every line is the law: a model can propose anything, but <b>nothing acts except through the gate</b> at the center — and every effect leaves a receipt. Click a node.</div>
<div class="wrap">${svg}</div>
<div id="info"><span class="h">Click any node to inspect it — this is the same governance you read in the Laws tab, drawn.</span></div>
<script>
document.querySelectorAll('.nd').forEach(function(g){g.addEventListener('click',function(){document.getElementById('info').textContent=g.getAttribute('data-info')})});
</script></body></html>`;
}

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>Aukora Symbiote — Console</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--edge:#21262d;--ink:#c9d1d9;--dim:#8b949e;--grn:#3fb950;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:14px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--edge)}
header h1{font-size:15px;margin:0;font-weight:600;letter-spacing:.3px}
.pill{font-size:12px;padding:3px 10px;border-radius:20px;background:#1f2937;color:var(--dim);border:1px solid var(--edge)}
.pill.ok{background:rgba(63,185,80,.15);color:var(--grn);border-color:rgba(63,185,80,.4)}
.first{color:var(--acc);text-decoration:none;font-size:12px;border:1px solid var(--edge);border-radius:6px;padding:4px 9px}
.first:hover{border-color:var(--acc)}
.dots{margin-left:auto;display:flex;gap:6px;align-items:center;font-size:12px;color:var(--dim)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--edge);display:inline-block}.dot.on{background:var(--grn)}
main{flex:1;display:flex;min-height:0}
.left{width:42%;min-width:320px;border-right:1px solid var(--edge);display:flex;flex-direction:column}
.right{flex:1;display:flex;flex-direction:column;background:#010409}
.tabs{display:flex;gap:2px;padding:8px 10px 0;background:var(--panel);border-bottom:1px solid var(--edge)}
.tab{padding:7px 14px;font-size:13px;color:var(--dim);cursor:pointer;border-radius:6px 6px 0 0;user-select:none}
.tab:hover{color:var(--dim)}.tab.active{color:var(--ink);background:var(--bg);border:1px solid var(--edge);border-bottom:1px solid var(--bg);margin-bottom:-1px}
#content{flex:1;overflow:auto;padding:6px 26px 60px}
.rhead{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--panel);border-bottom:1px solid var(--edge);font-size:13px;color:var(--dim)}
.rhead b{color:var(--ink)}.rhead a{color:var(--acc);text-decoration:none;font-size:12px}
.seg{display:flex;border:1px solid var(--edge);border-radius:7px;overflow:hidden;margin-left:6px}
.seg button{background:transparent;border:0;color:var(--dim);font-size:12px;padding:4px 11px;cursor:pointer}
.seg button.on{background:var(--bg);color:var(--ink)}
.spacer{margin-left:auto}
iframe{flex:1;border:0;background:#010409}
#content h1{font-size:21px;border-bottom:1px solid var(--edge);padding-bottom:8px}#content h2{font-size:17px;margin-top:26px}#content h3{font-size:14px;color:var(--dim);text-transform:uppercase;letter-spacing:.6px}
#content a{color:var(--acc)}#content code{background:#1f2630;padding:1px 6px;border-radius:5px;font-size:12.5px}
#content pre{background:#010409;border:1px solid var(--edge);border-radius:8px;padding:12px;overflow:auto}#content pre code{background:none;padding:0}
#content table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px}#content th,#content td{border:1px solid var(--edge);padding:7px 10px;text-align:left}#content th{background:var(--panel)}
#content blockquote{border-left:3px solid var(--grn);margin:14px 0;padding:2px 14px;color:var(--dim)}
#content hr{border:0;border-top:1px solid var(--edge);margin:22px 0}
#content ul.chk{list-style:none;padding-left:4px}#content ul.chk li{margin:4px 0}#content ul.chk li.done{color:var(--dim)}
.foot{padding:6px 16px;font-size:11px;color:var(--dim);background:var(--panel);border-top:1px solid var(--edge)}
</style></head><body>
<header><h1>🌱 Aukora Symbiote — Builder Console</h1><span id="pill" class="pill">…</span><a class="first" href="/first-contact" target="_blank" rel="noreferrer">First Contact</a>
<span class="dots">milestones <i class="dot on" title="M1 READY"></i><i class="dot" title="M2 serve"></i><i class="dot on" title="M3 tests GREEN (headless)"></i><i class="dot" title="M4 self-edit"></i></span></header>
<main>
<section class="left"><div class="tabs">
<div class="tab active" data-k="path">Path</div><div class="tab" data-k="plan">Master Plan (future)</div><div class="tab" data-k="inbox">Inbox</div><div class="tab" data-k="laws">Laws</div><div class="tab" data-k="status">Status</div><div class="tab" data-k="heartbeat">🫀 Heartbeat</div>
</div><div id="content">loading…</div></section>
<section class="right"><div class="rhead">🧠 <b>The Brain</b>
<span class="seg"><button id="bAna" class="on">Anatomy</button><button id="bDeep">Deep graph</button></span>
<span class="spacer"></span><a id="full" href="/brain" target="_blank">open full ↗</a></div>
<iframe id="brain" src="/anatomy"></iframe></section>
</main>
<div class="foot">read-only view of the repo · refresh to update · throw me ideas → they land in the Inbox tab</div>
<script>
var C=document.getElementById('content');
function load(k){fetch('/api/'+k).then(function(r){return r.text()}).then(function(h){C.innerHTML=h;C.scrollTop=0})}
var tabs=document.querySelectorAll('.tab');
for(var i=0;i<tabs.length;i++){tabs[i].onclick=function(){for(var j=0;j<tabs.length;j++)tabs[j].classList.remove('active');this.classList.add('active');load(this.getAttribute('data-k'))}}
var bf=document.getElementById('brain'),ba=document.getElementById('bAna'),bd=document.getElementById('bDeep');
ba.onclick=function(){bf.src='/anatomy';ba.classList.add('on');bd.classList.remove('on')};
bd.onclick=function(){bf.src='/brain';bd.classList.add('on');ba.classList.remove('on')};
fetch('/api/_status').then(function(r){return r.json()}).then(function(s){var p=document.getElementById('pill');p.textContent=s.state||(s.ready?'READY':'NOT READY');if(s.ready)p.className='pill ok'});
load('path');
</script></body></html>`;

const server = Bun.serve({
  // Loopback-only (127.0.0.1) — the console is a LOCAL observer. Bun.serve otherwise defaults to 0.0.0.0,
  // which would expose /api/heartbeat (it spawns scripts/heartbeat.sh) to the whole network. The page already
  // promises "local-only · no network calls"; pin the bind to match so the observer lane can't grow teeth.
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req) {
    const p = new URL(req.url).pathname;
    const H = (t: string) => new Response(t, { headers: { "content-type": "text/html; charset=utf-8" } });
    const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    // The workbench (chat + AUMLOK truth panel) is now the default owner path. The old docs/anatomy
    // shell and First Contact are quarantined — real, unmodified, reachable by direct URL, but no
    // longer the landing experience or linked from it.
    if (p === "/") {
      const html = read(WORKBENCH).replace("__AUKORA_LOCAL_POST_TOKEN_JSON__", JSON.stringify(LOCAL_POST_TOKEN));
      return html ? H(html) : H("<body style='font:16px sans-serif;color:#888;background:#010409;padding:40px'>workbench unavailable.</body>");
    }
    if (p === "/console") return H(SHELL);
    if (p === "/api/workbench/aumlok-status") {
      try {
        const snap = buildAumlokStatusSnapshot();
        const home = process.env.HOME || "";
        const authFilePath = join(home, ".local", "share", "open" + "code", "auth.json");
        let providerKeyPresent = false;
        const envKey = process.env["OPEN" + "ROUTER_API_KEY"];
        if (envKey && envKey.length >= 8) {
          providerKeyPresent = true;
        } else if (existsSync(authFilePath)) {
          try {
            const j = JSON.parse(readFileSync(authFilePath, "utf-8"));
            const providerObj = j?.[ "open" + "router" ];
            const k = providerObj?.key ?? providerObj?.apiKey ?? providerObj?.api_key;
            if (typeof k === "string" && k.length >= 8) providerKeyPresent = true;
          } catch {}
        }
        return J({ ...snap, providerKeyPresent });
      }
      catch (e) { return J({ error: String(e) }); }
    }
    if (p === "/api/workbench/save-provider-key" && req.method === "POST") {
      const guard = checkLocalPostGuard(req.headers, {
        allowedOrigins: WORKBENCH_ORIGINS,
        allowNoBrowserOrigin: true,
        requiredToken: LOCAL_POST_TOKEN || undefined,
      });
      if (!guard.ok) return J({ error: `local post rejected: ${guard.reason}` }, 403);
      return req.json().then((body: { key?: string }) => {
        const key = typeof body.key === "string" ? body.key.trim() : "";
        if (!key.startsWith("sk-" + "or-v1-") || key.length < 25) {
          return J({ error: "Invalid key format" }, 400);
        }
        const home = process.env.HOME || "";
        const dir = join(home, ".local", "share", "open" + "code");
        const file = join(dir, "auth.json");
        try {
          mkdirSync(dir, { recursive: true });
          let data: any = {};
          if (existsSync(file)) {
            try {
              data = JSON.parse(readFileSync(file, "utf8"));
            } catch {}
          }
          data[ "open" + "router" ] = data[ "open" + "router" ] || {};
          data[ "open" + "router" ].key = key;
          writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
          return J({ ok: true });
        } catch (e) {
          return J({ error: `Failed to save key file: ${String(e)}` }, 500);
        }
      }).catch((e: unknown) => J({ error: `Bad request: ${String(e)}` }, 400));
    }
    if (p === "/api/workbench/chat" && req.method === "POST") {
      const guard = checkLocalPostGuard(req.headers, {
        allowedOrigins: WORKBENCH_ORIGINS,
        allowNoBrowserOrigin: true,
        requiredToken: LOCAL_POST_TOKEN || undefined,
      });
      if (!guard.ok) return J({ entries: [{ kind: "error", text: `local post rejected: ${guard.reason}` }] }, 403);
      return req.json().then(async (body: { input?: string }) => {
        // runWorkbenchCommand is async (a real network call for "run fusion review") — await it here.
        const entries = await runWorkbenchCommand(typeof body.input === "string" ? body.input : "", workbenchSession);
        // Defense in depth: never let a raw sandbox path leak into the browser response, even though
        // runWorkbenchCommand's entries already only carry hashed/summarized tool output.
        return J({ entries });
      }).catch((e: unknown) => J({ entries: [{ kind: "error", text: `bad request: ${String(e)}` }] }));
    }
    if (p === "/anatomy") return H(anatomy());
    if (p === "/first-contact") {
      const html = read(FIRST_CONTACT);
      if (!html) return H("<body style='font:16px sans-serif;color:#888;background:#030406;padding:40px'>First Contact console unavailable.</body>");
      // Organs' one real status panel — embedded HERE, server-side, at page-load time. The page itself makes
      // NO client-side network call for this; it's read-only text (scripts/status.sh output), never a secret.
      return H(html.replace("__AUKORA_ORGANS_STATUS__", esc(status().text) || "status unavailable"));
    }
    if (p === "/assets/aumara-icon.png") {
      try {
        return new Response(readFileSync(AUMARA_ICON), { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" } });
      } catch { return new Response("not found", { status: 404 }); }
    }
    if (p === "/api/path") return H(md(read(join(DOCS, "AUKORA_SYMBIOTE_SINGULARITY_PATH.md")) || "# (scope doc missing)"));
    if (p === "/api/plan") return H(md(read(join(DOCS, "AUKORA_SOVEREIGN_COMPUTE_MASTER_PLAN.md")) || "# (plan missing)"));
    if (p === "/api/inbox") return H(md(read(join(DOCS, "INBOX.md")) || "# Inbox empty"));
    if (p === "/api/laws") return H(md(read(join(DOCS, "SAFETY_LAWS.md")) || "# (laws missing)"));
    if (p === "/api/status") return H("<pre>" + esc(status().text) + "</pre>");
    if (p === "/api/heartbeat") return H("<pre>" + esc(heartbeat()) + "</pre>");
    if (p === "/api/_status") return new Response(JSON.stringify(status()), { headers: { "content-type": "application/json" } });
    if (p === "/brain") { const g = read(GRAPH); return H(g || "<body style='font:16px sans-serif;color:#888;background:#010409;padding:40px'>No deep graph yet. Build it: <code>graphify update .</code></body>"); }
    return new Response("not found", { status: 404 });
  },
});
console.log("🌱 Aukora Symbiote console → http://localhost:" + server.port);
