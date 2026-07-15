// SPDX-License-Identifier: AGPL-3.0-or-later
// run-deliberation.ts — DRIVE the glyph-native deliberation engine (aukoraFuEngine.ts) that was built but
// dead-called ("Nothing in this repo calls this method yet", aukoraFuEngine.ts:589). This is that missing
// driver: it runs AukoraFuEngine.reason() across multiple rounds on ONE problem. The engine's working-memory
// + glyph channel carry each round's packets forward, so round 2+ models receive the PRIOR PACKETS block
// (aukoraFuEngine.ts:317) and can revise — i.e. real multi-model deliberation, not blind parallel votes.
//
// Advisory-only: reason() returns a GateDecision but nothing here signs, applies, or mutates the repo.
//
//   OPENROUTER_API_KEY=... bun run-deliberation.ts
//   DELIB_ROUNDS=4 bun run-deliberation.ts
import { AukoraFuEngine, defaultCouncil } from "./src/aukoraFuEngine";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function resolveKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".local/share/opencode/auth.json"), "utf-8"));
    if (j?.openrouter?.key) return j.openrouter.key;
  } catch { /* fall through */ }
  throw new Error("no OPENROUTER_API_KEY (env or opencode auth.json)");
}

const ROUNDS = Math.max(1, Math.min(8, Number(process.env.DELIB_ROUNDS || 3)));

const PROBLEM = `Proposed change to a governed AI symbiote: the live-apply gate currently refuses any write
whose scope touches state/** or authority/**. A contributor proposes RELAXING that so an AUMLOK-signed
proposal MAY write to state/kira/brain.json (the memory file), arguing "the owner signed it, so it's
consented." Evaluate: is this safe? What breaks the fail-closed guarantee? What must hold before it could
ever be allowed? Give your stance, strategy, and a one-sentence hypothesis.`;

async function main() {
  const key = resolveKey();
  const council = defaultCouncil();
  console.log(`\n⚡ GLYPH DELIBERATION — ${council.length} models, ${ROUNDS} rounds`);
  console.log(`   council: ${council.map(m => `${m.id}(${m.slug.split("/").pop()})`).join(" · ")}`);
  console.log(`   problem: ${PROBLEM.slice(0, 90).replace(/\n/g, " ")}...\n`);

  const engine = new AukoraFuEngine({ apiKey: key, maxRounds: ROUNDS, council });

  for (let r = 1; r <= ROUNDS; r++) {
    const t0 = Date.now();
    const d: any = await engine.reason("delib", PROBLEM);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`── ROUND ${r} (${secs}s) ─────────────────────────────────────────`);
    console.log(`   verdict:    ${String(d.action).toUpperCase()}`);
    console.log(`   winner:     ${d.winningModel || "none"}  ·  strategy ${d.strategy || "?"}  ·  confidence ${((d.confidence ?? 0) * 100).toFixed(0)}%`);
    console.log(`   insight:    ${d.insight || "(none)"}`);
    if (d.phaseLocked) console.log(`   ⚠ PHASE-LOCK — models converged suspiciously (perceiver flagged it)`);
    if (Array.isArray(d.contradictions) && d.contradictions.length) {
      const top = [...d.contradictions].sort((a: any, b: any) => b.shearMagnitude - a.shearMagnitude).slice(0, 3);
      for (const c of top) console.log(`   shear:      ${c.modelA} ~ ${c.modelB} = ${c.shearMagnitude.toFixed(3)} (framework interference)`);
    }
    if (Array.isArray(d.incidents) && d.incidents.length) {
      console.log(`   incidents:  ${d.incidents.map((i: any) => `${i.modelId}:${i.type}`).join(", ")}`);
    }
    console.log("");
  }
  console.log("Deliberation complete. Round 2+ models received the prior round's glyph packets and could");
  console.log("revise — the divergence you see between rounds IS the deliberation the engine was built for.\n");
}

main().catch(e => { console.error("deliberation failed:", e); process.exit(1); });
