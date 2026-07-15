// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// Aukora FU standalone Fusion engine.
// Advisory-only. It calls OpenRouter, writes validated fusion-run-v1 artifacts into ./runs/,
// and grants no authority. The browser only reads those artifacts.
import * as fs from "fs";
import * as path from "path";
import { assertLegacyTargetSafe } from "./legacy/legacyTargetSafety";

type Vote = "GREEN" | "YELLOW" | "RED" | "non_vote";
type Reason =
  | "missing_key"
  | "rate_cap"
  | "network_timeout"
  | "http_4xx"
  | "http_5xx"
  | "rate_limited"
  | "empty_response"
  | "invalid_json"
  | "schema_mismatch"
  | "adapter_failure";

interface Review {
  model: string;
  shard: string;
  label: string;
  verdict: "GREEN" | "YELLOW" | "RED";
  confidence: number;
  findings: string;
  risks: string;
  missing_tests: string;
  recommended_next_commit: string;
  adapterFailure: boolean;
  failureReason?: Reason;
  provider_contacted: boolean;
  synthetic: boolean;
  durationMs: number;
}

interface Distribution { g: number; y: number; r: number }

const ROOT = __dirname;
const RUNS_DIR = path.join(ROOT, "runs");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODELS = [
  "anthropic/claude-opus-4.8",
  "openai/gpt-5.5",
  "z-ai/glm-5.2",
  "moonshotai/kimi-k2.7-code",
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3.7-max",
  "mistralai/mistral-large-2512",
];
const SHARDS = ["engine", "observer_ui", "security_boundary", "packaging", "next_improvement"] as const;
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".md", ".json", ".txt", ".yml", ".yaml", ".toml", ".sh"]);
const SKIP_DIRS = new Set([".git", "node_modules", "runs", "dist", "build", ".next", "target"]);
const SKIP_FILES = new Set([".env", ".env.local", ".DS_Store"]);

function loadDotenv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(raw ?? fallback));
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
}

function models(): string[] {
  return (process.env.FUSION_MODELS || DEFAULT_MODELS.join(","))
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function shortModel(slug: string): string {
  return (slug.split("/").pop() || slug).replace(/[^a-z0-9._-]/gi, "_");
}

function safeRel(base: string, file: string): string {
  return path.relative(base, file).split(path.sep).join("/");
}

function collectFiles(root: string): Array<{ rel: string; body: string }> {
  const out: Array<{ rel: string; body: string }> = [];
  function walk(dir: string) {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) throw new Error(`legacy_target_symlink_refused:${safeRel(root, p)}`);
      if (st.isDirectory()) { walk(p); continue; }
      if (!TEXT_EXT.has(path.extname(name).toLowerCase())) continue;
      if (st.size > 180_000) continue;
      const body = fs.readFileSync(p, "utf8").slice(0, 12_000);
      out.push({ rel: safeRel(root, p), body: scrubSecrets(body) });
    }
  }
  walk(root);
  return out.slice(0, 80);
}

function buildShardText(targetRoot: string, shard: string): string {
  const files = collectFiles(targetRoot);
  const focus = files.filter(f => {
    const r = f.rel.toLowerCase();
    if (shard === "engine") return /run-council|engine|fusion|external|config|package/.test(r);
    if (shard === "observer_ui") return /dashboard|server|html|css|readme/.test(r);
    if (shard === "security_boundary") return /server|gitignore|readme|run-council|auth|secret|env/.test(r);
    if (shard === "packaging") return /package|readme|gitignore|env|command|license/.test(r);
    return true;
  });
  const picked = (focus.length ? focus : files).slice(0, 14);
  return [
    `SHARD: ${shard}`,
    `TARGET: ${targetRoot}`,
    "",
    ...picked.map(f => `--- FILE: ${f.rel} ---\n${f.body.slice(0, 6000)}`),
    "",
    "Review this shard. Return JSON only with keys: verdict, findings, risks, missing_tests, recommended_next_commit, confidence.",
    "Verdict must be GREEN, YELLOW, or RED. Confidence is 0-10.",
    "Important: this council is advisory-only. Do not claim authority, signing, promotion, or live apply.",
  ].join("\n").slice(0, 22_000);
}

function prompt(shard: string, evidence: string): string {
  return [
    "You are one model in the Aukora FU Fusion Council.",
    "Audit the provided code/evidence. Be strict, practical, and concise.",
    "You do not authorize anything. You only provide advisory evidence.",
    "Return ONLY a JSON object:",
    '{"verdict":"GREEN|YELLOW|RED","findings":"...","risks":"...","missing_tests":"...","recommended_next_commit":"...","confidence":0-10}',
    "",
    evidence,
  ].join("\n");
}

function extractJson(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string" || !content.trim()) return null;
  const s = content.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  try { const d = JSON.parse(s); return d && typeof d === "object" ? d as Record<string, unknown> : null; } catch {}
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { const d = JSON.parse(s.slice(start, i + 1)); return d && typeof d === "object" ? d as Record<string, unknown> : null; } catch { return null; }
      }
    }
  }
  return null;
}

function coerce(parsed: Record<string, unknown> | null): Omit<Review, "model" | "shard" | "label" | "adapterFailure" | "provider_contacted" | "synthetic" | "durationMs"> | null {
  if (!parsed) return null;
  const rawVote = String(parsed.verdict ?? "").toUpperCase().trim();
  if (rawVote !== "GREEN" && rawVote !== "YELLOW" && rawVote !== "RED") return null;
  const str = (x: unknown, d = "") => cleanText(x == null ? d : String(x), 520);
  const n = Number(parsed.confidence ?? 5);
  return {
    verdict: rawVote,
    confidence: Math.max(0, Math.min(10, Number.isFinite(n) ? n : 5)) / 10,
    findings: str(parsed.findings),
    risks: str(parsed.risks),
    missing_tests: str(parsed.missing_tests, "N/A"),
    recommended_next_commit: str(parsed.recommended_next_commit, "none"),
  };
}

async function reviewModel(model: string, shard: string, evidence: string, apiKey: string | null): Promise<Review> {
  const started = Date.now();
  const label = `${shortModel(model)}:${shard}:standalone`;
  const fail = (reason: Reason, contacted = false, findings = `review failed: ${reason}`): Review => ({
    model, shard, label, verdict: "RED", confidence: 0, findings, risks: "adapter failure/closed state",
    missing_tests: "N/A", recommended_next_commit: "none", adapterFailure: true, failureReason: reason,
    provider_contacted: contacted, synthetic: false, durationMs: Date.now() - started,
  });
  if (!apiKey) return fail("missing_key");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "http-referer": "https://github.com/aumara-xyz/aukora-fu",
        "x-title": "Aukora FU",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a strict code reviewer. Return JSON only." },
          { role: "user", content: prompt(shard, evidence) },
        ],
        temperature: 0.1,
        max_tokens: 1400,
      }),
    });
    clearTimeout(timer);
    if (res.status === 429) return fail("rate_limited", true);
    if (res.status >= 500) return fail("http_5xx", true);
    if (!res.ok) return fail("http_4xx", true, `http ${res.status}`);
    const json = await res.json() as any;
    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || !content.trim()) return fail("empty_response", true);
    const parsed = extractJson(content);
    if (!parsed) return fail("invalid_json", true);
    const c = coerce(parsed);
    if (!c) return fail("schema_mismatch", true);
    return { model, shard, label, ...c, adapterFailure: false, provider_contacted: true, synthetic: false, durationMs: Date.now() - started };
  } catch (e: any) {
    const reason: Reason = e?.name === "AbortError" ? "network_timeout" : "adapter_failure";
    return fail(reason, true);
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function classify(r: Review): Vote {
  if (r.adapterFailure || r.synthetic) return "non_vote";
  return r.verdict;
}

function quorum(results: Review[]) {
  const votes = results.map(classify);
  const greenVotes = votes.filter(v => v === "GREEN").length;
  const yellowVotes = votes.filter(v => v === "YELLOW").length;
  const redVotes = votes.filter(v => v === "RED").length;
  const nonVotes = votes.filter(v => v === "non_vote").length;
  const completedVotes = votes.length - nonVotes;
  const total = votes.length;
  const min = Math.min(3, Math.max(1, Math.ceil(total * 0.25)));
  let status = "NO_QUORUM", reason = `Only ${completedVotes}/${total} completed; minimum ${min}`;
  if (redVotes > 0) { status = "RED_QUORUM"; reason = `${redVotes} completed model(s) returned RED (${nonVotes} non-votes excluded)`; }
  else if (completedVotes >= min && yellowVotes > 0) { status = "YELLOW_QUORUM"; reason = `${completedVotes}/${total} completed with ${yellowVotes} YELLOW`; }
  else if (completedVotes >= min) { status = "GREEN_QUORUM"; reason = `${completedVotes}/${total} completed with no RED/YELLOW`; }
  return { status, greenVotes, yellowVotes, redVotes, nonVotes, completedVotes, reason };
}

function dist(vote: Vote, confidence: number): Distribution {
  const c = Math.max(0, Math.min(1, confidence));
  const rest = (1 - c) / 2;
  if (vote === "GREEN") return { g: c, y: rest, r: rest };
  if (vote === "YELLOW") return { g: rest, y: c, r: rest };
  if (vote === "RED") return { g: rest, y: rest, r: c };
  return { g: 1 / 3, y: 1 / 3, r: 1 / 3 };
}

function js(a: Distribution, b: Distribution): number {
  const p = [a.g, a.y, a.r], q = [b.g, b.y, b.r], eps = 1e-9;
  const m = p.map((_, i) => (p[i] + q[i]) / 2);
  const kl = (x: number[], y: number[]) => x.reduce((s, xi, i) => s + (xi + eps) * Math.log2((xi + eps) / (y[i] + eps)), 0);
  return Math.max(0, Math.min(1, 0.5 * kl(p, m) + 0.5 * kl(q, m)));
}

function worst(votes: Vote[]): Vote {
  if (votes.includes("RED")) return "RED";
  if (votes.includes("YELLOW")) return "YELLOW";
  if (votes.includes("GREEN")) return "GREEN";
  return "non_vote";
}

function mean(ds: Distribution[]): Distribution {
  if (!ds.length) return { g: 1 / 3, y: 1 / 3, r: 1 / 3 };
  return {
    g: ds.reduce((s, d) => s + d.g, 0) / ds.length,
    y: ds.reduce((s, d) => s + d.y, 0) / ds.length,
    r: ds.reduce((s, d) => s + d.r, 0) / ds.length,
  };
}

function buildArtifact(results: Review[], council: string[], target: string) {
  const syntheticCount = results.filter(r => r.synthetic).length;
  if (syntheticCount > 0 && syntheticCount !== results.length) throw new Error('mixed_synthetic_and_live_results');
  const synthetic = syntheticCount === results.length && results.length > 0;
  const q = synthetic
    ? {
      status: "SYNTHETIC_SAMPLE",
      greenVotes: 0,
      yellowVotes: 0,
      redVotes: 0,
      nonVotes: results.length,
      completedVotes: 0,
      reason: `Synthetic sample: ${results.length} generated cells, zero providers contacted, not eligible for quorum`,
    }
    : quorum(results);
  const cells = results.map(r => {
    const vote = classify(r);
    return {
      model: r.model, shard: r.shard, vote, confidence: vote === "non_vote" ? 0 : r.confidence,
      dist: dist(vote, vote === "non_vote" ? 0 : r.confidence),
      provider_contacted: r.provider_contacted, synthetic: r.synthetic, adapterFailure: r.adapterFailure,
      findingSummary: cleanText(r.adapterFailure ? `non-vote (${r.failureReason ?? "unknown"})` : `${r.findings} ${r.risks}`, 240),
    };
  });
  const models = council.map(model => {
    const mine = cells.filter(c => c.model === model);
    const responded = mine.filter(c => c.vote !== "non_vote");
    const md = mean(responded.map(c => c.dist));
    return {
      model,
      overallVote: worst(mine.map(c => c.vote)),
      meanConfidence: responded.length ? responded.reduce((s, c) => s + c.confidence, 0) / responded.length : 0,
      dist: md,
      meanDivergence: 0,
      isContrarian: false,
      respondedShards: responded.length,
      nonVoteShards: mine.length - responded.length,
    };
  });
  const completed = new Set(models.filter(m => m.respondedShards > 0).map(m => m.model));
  const matrix = models.map((a, i) => models.map((b, j) => {
    if (i === j) return 0;
    if (!completed.has(a.model) || !completed.has(b.model)) return -1;
    return js(a.dist, b.dist);
  }));
  models.forEach((m, i) => {
    if (!completed.has(m.model)) { m.meanDivergence = -1; return; }
    const row = matrix[i].filter((v, j) => j !== i && v >= 0);
    m.meanDivergence = row.length ? row.reduce((s, v) => s + v, 0) / row.length : 0;
  });
  let contrarian: null | { model: string; meanDivergence: number } = null;
  const respondedModels = models.filter(m => completed.has(m.model));
  if (respondedModels.length >= 2) {
    const top = respondedModels.reduce((a, b) => b.meanDivergence > a.meanDivergence ? b : a);
    if (top.meanDivergence > 0) { top.isContrarian = true; contrarian = { model: top.model, meanDivergence: top.meanDivergence }; }
  }
  const perShard = SHARDS.map(shard => {
    const sc = cells.filter(c => c.shard === shard);
    const resp = sc.filter(c => c.vote !== "non_vote");
    let pairJs = 0, pairs = 0;
    for (let i = 0; i < resp.length; i++) for (let j = i + 1; j < resp.length; j++) { pairJs += js(resp[i].dist, resp[j].dist); pairs++; }
    return {
      shard,
      consensusStrength: pairs ? Math.max(0, 1 - pairJs / pairs) : (resp.length === 1 ? 1 : 0),
      verdicts: {
        g: sc.filter(c => c.vote === "GREEN").length,
        y: sc.filter(c => c.vote === "YELLOW").length,
        r: sc.filter(c => c.vote === "RED").length,
        nonVote: sc.filter(c => c.vote === "non_vote").length,
      },
      dominant: worst(resp.map(c => c.vote)),
    };
  });
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  return {
    schema: "fusion-run-v1",
    advisoryOnly: true,
    grantsAuthority: false,
    runMode: synthetic ? "synthetic-sample" : "legacy-live",
    synthetic,
    evidenceEligible: false,
    providerContacted: results.some(r => r.provider_contacted),
    runId,
    createdAt: new Date().toISOString(),
    target,
    council,
    shards: [...SHARDS],
    quorum: q,
    cells,
    models,
    divergenceMatrix: { models: council, js: matrix },
    perShard,
    contrarian,
    nonVotes: cells.filter(c => c.vote === "non_vote").map(c => ({ model: c.model, reason: c.findingSummary, provider_contacted: c.provider_contacted })),
    governanceLines: [
      `council (${council.length}): ${council.join(", ")}`,
      `verdict: ${q.status} - green=${q.greenVotes} yellow=${q.yellowVotes} red=${q.redVotes} nonVotes=${q.nonVotes}`,
      "boundary: advisory-only, grants no authority, no signing, no promotion",
      synthetic ? "evidence: synthetic sample only; zero providers contacted; no quorum" : "evidence: legacy live artifact; not canonical EvidencePack evidence",
      `target: ${target}`,
    ],
  };
}

function forbiddenKey(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (k !== "grantsAuthority" && /(privatekey|secret|signature|nonce|pop|unlock|promote|authorize|authoritygrant|token)/.test(lk)) return k;
    const nested = forbiddenKey(v);
    if (nested) return nested;
  }
  return null;
}

function validateArtifact(a: any): { ok: boolean; reason?: string } {
  if (a?.schema !== "fusion-run-v1") return { ok: false, reason: "wrong schema" };
  if (a.advisoryOnly !== true || a.grantsAuthority !== false) return { ok: false, reason: "not advisory-only" };
  if (a.evidenceEligible !== false) return { ok: false, reason: "legacy artifact must not be evidence-eligible" };
  if (a.runMode !== "synthetic-sample" && a.runMode !== "legacy-live") return { ok: false, reason: "invalid run mode" };
  if (a.synthetic === true) {
    if (a.runMode !== "synthetic-sample" || a.providerContacted !== false) return { ok: false, reason: "synthetic provenance mismatch" };
    if (a.quorum?.status !== "SYNTHETIC_SAMPLE" || a.quorum?.completedVotes !== 0) return { ok: false, reason: "synthetic quorum mismatch" };
    if (!Array.isArray(a.cells) || a.cells.some((cell: any) => cell.provider_contacted !== false || cell.synthetic !== true || cell.vote !== "non_vote")) {
      return { ok: false, reason: "synthetic cell claimed live evidence" };
    }
  }
  const bad = forbiddenKey(a);
  if (bad) return { ok: false, reason: `authority/secret-shaped key: ${bad}` };
  const text = JSON.stringify(a);
  if (/sk-(?:or|proj)-[a-z0-9_-]{12,}/i.test(text) || /BEGIN PRIVATE KEY/.test(text) || /Bearer\s+[a-z0-9._-]{12,}/i.test(text)) {
    return { ok: false, reason: "secret-shaped value" };
  }
  return { ok: true };
}

function scrubSecrets(s: string): string {
  let out = s;
  const envSecrets = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].map(k => process.env[k]).filter(Boolean) as string[];
  for (const sec of envSecrets) out = out.split(sec).join("[REDACTED_SECRET]");
  return out
    .replace(/sk-(?:or|proj)-[a-z0-9_-]{12,}/gi, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-z0-9._-]{12,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/-----BEGIN\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+PRIVATE\s+KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

function cleanText(s: unknown, cap = 520): string {
  return scrubSecrets(String(s ?? "")).slice(0, cap);
}

function sampleResults(council: string[]): Review[] {
  const now = Date.now();
  return council.flatMap((model, mi) => SHARDS.map((shard, si) => {
    const yellow = (mi + si) % 6 === 0;
    const non = model.includes("kimi") && shard === "packaging";
    return {
      model, shard, label: `${shortModel(model)}:${shard}:standalone`,
      verdict: yellow ? "YELLOW" as const : "GREEN" as const,
      confidence: non ? 0 : yellow ? 0.62 : 0.86,
      findings: non ? "sample non-vote" : yellow ? "Sample concern: tighten the instruction path." : "Sample pass: observer boundary holds.",
      risks: yellow ? "Potential clunkiness if setup instructions are vague." : "No authority granted.",
      missing_tests: yellow ? "Add smoke instructions." : "N/A",
      recommended_next_commit: yellow ? "Improve packaging docs." : "none",
      adapterFailure: non,
      failureReason: non ? "empty_response" as Reason : undefined,
      provider_contacted: false,
      synthetic: true,
      durationMs: Date.now() - now,
    };
  }));
}

async function main() {
  console.warn('[fu][legacy] This is the preserved v0.1 shard runner, not the hardened canonical council in src/. Use `bun run core:verify` for the canonical offline core.');
  loadDotenv();
  const sample = process.argv.includes("--sample");
  const council = models();
  const target = path.resolve(process.env.FUSION_TARGET || ROOT);
  const budget = clampInt(process.env.COUNCIL_BUDGET, council.length * SHARDS.length, 1, 50);
  const concurrency = clampInt(process.env.COUNCIL_CONCURRENCY, 3, 1, 8);
  const apiKey = process.env.OPENROUTER_API_KEY || null;
  fs.mkdirSync(RUNS_DIR, { recursive: true });

  if (!sample) {
    if (process.env.AUKORA_ALLOW_LEGACY_PAID_RUN !== '1') {
      throw new Error('legacy_paid_runner_disabled:Set AUKORA_ALLOW_LEGACY_PAID_RUN=1 only after reviewing the target');
    }
    if (!process.env.FUSION_TARGET) throw new Error('legacy_target_required:Set an explicit FUSION_TARGET');
    assertLegacyTargetSafe(target);
  }

  console.log(`[fu] target: ${target}`);
  console.log(`[fu] council: ${council.length} model(s), ${SHARDS.length} shard(s), budget=${sample ? "sample" : budget}, concurrency=${concurrency}`);

  let results: Review[];
  if (sample) {
    results = sampleResults(council);
  } else {
    const shardText = new Map<string, string>(SHARDS.map(s => [s, buildShardText(target, s)]));
    const tasks: Array<() => Promise<Review>> = [];
    for (const shard of SHARDS) for (const model of council) {
      if (tasks.length >= budget) break;
      tasks.push(() => reviewModel(model, shard, shardText.get(shard)!, apiKey));
    }
    results = await runWithConcurrency(tasks, concurrency);
  }

  const artifact = buildArtifact(results, council, sample ? "Aukora FU sample run" : target);
  const v = validateArtifact(artifact);
  if (!v.ok) {
    console.error(`[fu] artifact failed validation; not writing: ${v.reason}`);
    process.exit(1);
  }
  const file = path.join(RUNS_DIR, `${artifact.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(path.join(RUNS_DIR, "latest.json"), JSON.stringify(artifact, null, 2));
  console.log(`[fu] wrote ${path.relative(ROOT, file)} and runs/latest.json`);
  console.log(`[fu] verdict: ${artifact.quorum.status} (${artifact.quorum.reason})`);
  console.log("[fu] open http://127.0.0.1:9900 after starting: bun run legacy:observer");
}

main().catch(e => {
  console.error("[fu] run failed:", e);
  process.exit(1);
});
