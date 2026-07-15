// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * aukora-fu v8.0.0 — imported from the owner's own external export
 * (imported tech (github etc)/aukora-fu-v8.0.0-GITHUB.zip), landed verbatim (only the SPDX header
 * block was adjusted to match this repo's convention, and a real bug from the source export was
 * fixed: the CLI's `runCLI` referenced `CODename`, a second, differently-cased, functionally-duplicate
 * module constant declared later in the file — collapsed to the single `CODENAME` constant).
 *
 * STATUS: this SUPERSEDES the dormant `fusionGlyphEngine.ts` (v7.1.0, removed) — same author, same
 * lineage, a strict superset (adds the `~` interference operator, φ-governed contradiction decay,
 * phase-lock/groupthink detection, framework-type awareness, and VK Kronos security-incident logging
 * on top of the same KL-divergence perceiver core). It is the engine `selfEditReviewCouncil.ts` is
 * being wired to use in place of the categorical GREEN/YELLOW/RED vote it used previously — see that
 * file's own header comment for the wiring, and issue #12 for the design decision record.
 *
 * A glyph-native multi-model reasoning engine: council members communicate via structured probability
 * distributions (not English prose). A KL-divergence perceiver reads the distributions and produces a
 * GREEN/YELLOW/RED coherence verdict, now also tracking pairwise "shear" (via the `~` operator) between
 * every pair of models and flagging phase-lock (dangerous over-agreement/groupthink) as its own signal.
 * The engine adapts a handful of numeric run-parameters (maxRounds/explorationDecay/contrarianBoost/
 * per-model weights) between calls based on disagreement — in-memory hyperparameter tuning for that
 * reasoning run only, NOT code self-modification and NOT an authority change. Every `Receipt` is
 * pinned `advisoryOnly: true, grantsAuthority: false`, matching the discipline enforced everywhere else
 * in this codebase (`nativeLiveApply.ts`, `kiraBrain.ts`, `selfEditReviewCouncil.ts`).
 */
import { captureRawFusionReply } from './fusionCaptureLog';

const VERSION = "8.0.0";
const CODENAME = "aukora-fu";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const PHI = 1.618033988749894;
const SHEAR_FLOOR = 1 / PHI; // ~0.618 — contradictions never fully decay
// Round 1 fix (2026-07-02, issue #21): the evidence pack callers build is already bounded to a sane
// cap (selfEditReviewCouncil.ts's MAX_EVIDENCE_CHARS = 12_000) — this engine must not re-truncate it
// down further. The prior 400-char slice meant every council model reviewed only a goal/preamble
// fragment and never saw actual proposed file content; the vote was blind. Matches the caller's cap
// so nothing here re-shrinks an already-bounded pack.
const MAX_PROBLEM_CHARS = 12_000;

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH VOCABULARY
// ═══════════════════════════════════════════════════════════════════════════════

export type StanceGlyph = "⊕" | "⊖" | "⊙" | "⊘" | "⊚";
export type ConfidenceGlyph = "⇈" | "↑" | "→" | "↓" | "⇊";
export type StrategyGlyph = "↗" | "↘" | "↙" | "↖" | "⇄";
export type ChannelGlyph = "⎋" | "⏵" | "⏸" | "↻";
export type OutcomeGlyph = "✓" | "✗" | "⏳" | "⚡";
export type FrameworkType = "geometric" | "symbolic" | "statistical" | "narrative" | "embodied" | "social";

export interface GlyphPacket {
  modelId: string;
  stance: StanceGlyph;
  confidence: ConfidenceGlyph;
  strategy: StrategyGlyph;
  distribution: {
    explore: number;
    exploit: number;
    verify: number;
    abstain: number;
  };
  framework?: FrameworkType;  // which reasoning style produced this
  hypothesis: string;
  reasoning: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRADICTION — the ~ operator's first-class output
// ═══════════════════════════════════════════════════════════════════════════════

export interface Contradiction {
  id: string;
  modelA: string;
  modelB: string;
  shearMagnitude: number;       // 0 = resolved, 1 = maximal shear
  interferenceVector: number[];  // where and how they diverge
  phaseLockStatus: "open" | "decaying" | "stabilized";
  decayOrigin: number;           // timestamp — refreshed on query
  frameworkTypes: [FrameworkType | undefined, FrameworkType | undefined];
  queryCount: number;
}

/** The ~ operator: interference between two frameworks.
 *  Not AND. Not OR. INTERFERENCE. The contradiction IS the information. */
export function tilde(A: GlyphPacket, B: GlyphPacket): Contradiction {
  const dA = normalizeDist(A.distribution);
  const dB = normalizeDist(B.distribution);
  const iv = [
    dA.explore - dB.explore,
    dA.exploit - dB.exploit,
    dA.verify - dB.verify,
    dA.abstain - dB.abstain,
  ];
  const shearMag = clamp(1 - cosineSimilarity(Object.values(dA), Object.values(dB)), SHEAR_FLOOR, 1.0);
  return {
    id: `~${A.modelId}_${B.modelId}_${Date.now()}`,
    modelA: A.modelId,
    modelB: B.modelId,
    shearMagnitude: shearMag,
    interferenceVector: iv,
    phaseLockStatus: "open",
    decayOrigin: Date.now(),
    frameworkTypes: [A.framework, B.framework],
    queryCount: 0,
  };
}

/** φ-governed decay: contradictions lose salience but never vanish.
 *  shear → SHEAR_FLOOR as t → ∞. The gap is permanent. */
export function decayShear(c: Contradiction, now: number = Date.now()): number {
  const dt = now - c.decayOrigin;
  const tau = 1000 * 60 * 60 * 24; // 24 hour decay constant
  if (dt < 1000 * 60 * 10) return c.shearMagnitude; // active within 10 min
  const decayFactor = Math.exp(-dt / (tau * PHI));
  return SHEAR_FLOOR + (c.shearMagnitude - SHEAR_FLOOR) * decayFactor;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH CHANNEL — shared buffer with contradiction tracking
// ═══════════════════════════════════════════════════════════════════════════════

export class GlyphChannel {
  private packets: GlyphPacket[] = [];
  private directives: ChannelGlyph[] = [];
  private contradictions: Contradiction[] = [];

  emit(packet: GlyphPacket) {
    // Auto-~ with all prior packets from different models
    for (const prior of this.packets) {
      if (prior.modelId !== packet.modelId) {
        this.contradictions.push(tilde(prior, packet));
      }
    }
    this.packets.push(packet);
  }
  directive(g: ChannelGlyph) { this.directives.push(g); }
  from(modelId: string): GlyphPacket[] { return this.packets.filter(p => p.modelId === modelId); }
  latest(): Map<string, GlyphPacket> {
    const map = new Map<string, GlyphPacket>();
    for (const p of this.packets) map.set(p.modelId, p);
    return map;
  }
  all(): GlyphPacket[] { return [...this.packets]; }
  clear() { this.packets = []; this.directives = []; this.contradictions = []; }
  stagnationDetected(): boolean { return this.directives.includes("⎋"); }
  toDistributions() { return this.packets.map(p => p.distribution); }

  /** Get all contradictions tracked by the ~ operator */
  getContradictions(): Contradiction[] { return this.contradictions; }

  /** Find the most productive contradiction (highest shear, still open) */
  strongestContradiction(): Contradiction | undefined {
    return this.contradictions
      .filter(c => c.phaseLockStatus === "open")
      .sort((a, b) => b.shearMagnitude - a.shearMagnitude)[0];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH PERCEIVER — KL divergence + shear magnitude + phase-lock detection
// ═══════════════════════════════════════════════════════════════════════════════

export interface PerceiverVerdict {
  coherenceScore: number;
  pinch: number;
  shearMagnitude: number;
  phaseLocked: boolean;     // true if all models converged dangerously
  verdict: "GREEN" | "YELLOW" | "RED";
  divergenceMatrix: number[][];
  modelStances: Array<{ modelId: string; stance: StanceGlyph; confidence: number; framework?: FrameworkType }>;
  recommendedAction: StrategyGlyph | "⎋";
  contradictions: Contradiction[];
}

const EPS = 1e-9;
const QUARANTINE_PINCH = 1e6;

function conflictThreshold(n: number): number {
  return n <= 1 ? 1.0 : 1.0 / Math.sqrt(n - 1) * 1.414;
}

function smoothDist(d: GlyphPacket["distribution"]) {
  const sum = d.explore + d.exploit + d.verify + d.abstain;
  if (sum <= 0) return { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 };
  return {
    explore: (d.explore + EPS) / (sum + 4 * EPS),
    exploit: (d.exploit + EPS) / (sum + 4 * EPS),
    verify: (d.verify + EPS) / (sum + 4 * EPS),
    abstain: (d.abstain + EPS) / (sum + 4 * EPS),
  };
}

function klDiv(p: ReturnType<typeof smoothDist>, q: ReturnType<typeof smoothDist>): number {
  let kl = 0;
  for (const key of ["explore", "exploit", "verify", "abstain"] as const) {
    kl += p[key] * Math.log(p[key] / q[key]);
  }
  return Math.max(0, kl);
}

// Bug found and fixed while landing this module (2026-07-01): the source export's threshold here was
// a hardcoded 0.15, but tilde()'s shear is clamp()ed to a floor of SHEAR_FLOOR (~0.618) — so
// maxShear < 0.15 could NEVER be true, meaning this detector was silently dead code (always returned
// false) in every version of the source zip. Fixed to a threshold relative to the actual floor: "close
// to the floor" (near-total agreement) rather than an absolute value the floor makes unreachable.
const PHASE_LOCK_NEAR_FLOOR_MARGIN = 0.05;

/** Phase-lock detection: if all models agree too perfectly, that's suspicious.
 *  Returns true if max pairwise shear is near the shear floor (all frameworks collapsed). */
function detectPhaseLock(contradictions: Contradiction[]): boolean {
  if (contradictions.length === 0) return false;
  const maxShear = Math.max(...contradictions.map(c => c.shearMagnitude));
  return maxShear < SHEAR_FLOOR + PHASE_LOCK_NEAR_FLOOR_MARGIN; // near-total agreement = groupthink
}

export function perceive(channel: GlyphChannel): PerceiverVerdict {
  const dists = channel.toDistributions();
  const contradictions = channel.getContradictions();

  if (dists.length === 0) {
    return {
      coherenceScore: 0, pinch: QUARANTINE_PINCH,
      shearMagnitude: 0, phaseLocked: false,
      verdict: "RED", divergenceMatrix: [], modelStances: [],
      recommendedAction: "⎋", contradictions: [],
    };
  }

  const n = dists.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let totalDiv = 0, pairs = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const kl = klDiv(smoothDist(dists[i]), smoothDist(dists[j]));
      matrix[i][j] = kl;
      totalDiv += kl; pairs++;
    }
  }

  const avgDiv = pairs > 0 ? totalDiv / pairs : 0;
  const pinch = avgDiv * 10;
  const coherenceScore = Math.exp(-avgDiv);
  const shearMagnitude = contradictions.length > 0
    ? contradictions.reduce((s, c) => s + c.shearMagnitude, 0) / contradictions.length
    : 0;
  const phaseLocked = detectPhaseLock(contradictions);

  const ct = conflictThreshold(n);
  let verdict: "GREEN" | "YELLOW" | "RED";
  if (pinch >= ct) verdict = "RED";
  else if (pinch >= ct * 0.4) verdict = "YELLOW";
  else verdict = "GREEN";

  // Phase-lock is also dangerous (too much agreement = groupthink)
  if (phaseLocked && verdict === "GREEN") verdict = "YELLOW";

  const latest = channel.latest();
  const modelStances = Array.from(latest.entries()).map(([id, p]) => ({
    modelId: id, stance: p.stance,
    confidence: confidenceToNumber(p.confidence),
    framework: p.framework,
  }));

  const packets = channel.all();
  const strategyWeights: Record<string, number> = {};
  for (const p of packets) {
    const w = confidenceToNumber(p.confidence) * (p.stance === "⊖" && coherenceScore > 0.85 ? 2.0 : 1.0);
    strategyWeights[p.strategy] = (strategyWeights[p.strategy] || 0) + w;
  }
  const recAction = (Object.entries(strategyWeights).sort((a, b) => b[1] - a[1])[0]?.[0] || "↗") as StrategyGlyph | "⎋";

  return {
    coherenceScore, pinch, shearMagnitude, phaseLocked, verdict,
    divergenceMatrix: matrix, modelStances,
    recommendedAction: recAction, contradictions,
  };
}

// Exported (unlike the rest of this file's private helpers) so selfEditReviewCouncil.ts's
// GlyphPacket -> AdvisoryResult adapter can reuse this exact mapping rather than redefining it.
export function confidenceToNumber(c: ConfidenceGlyph): number {
  const map: Record<ConfidenceGlyph, number> = { "⇈": 0.95, "↑": 0.80, "→": 0.60, "↓": 0.40, "⇊": 0.20 };
  return map[c] || 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH EMITTER
// ═══════════════════════════════════════════════════════════════════════════════

export interface CouncilMember {
  id: string; slug: string; name: string; voice: string;
  specialty: string; framework: FrameworkType; weight: number;
  costPer1M: number; accuracy: number; active: boolean;
}

/** Malformed input -> quarantine with incident logging. A glyph is evidence, not a command. */
export interface SecurityIncident {
  type: "malformed_glyph" | "dist_sum_mismatch" | "model_timeout" | "phase_lock_detected";
  modelId: string;
  raw?: string;
  timestamp: number;
  action: "quarantined" | "abstained" | "boosted_contrarian";
}

/** This is the ONLY network call anywhere in this module — nothing calls it yet, see file header. */
async function emitGlyph(
  model: CouncilMember,
  apiKey: string,
  problem: string,
  priorPackets: GlyphPacket[],
  channelDirective?: ChannelGlyph,
): Promise<{ packet: GlyphPacket; incident?: SecurityIncident }> {
  const priorGlyphs = priorPackets.length > 0
    ? `PRIOR PACKETS:\n${priorPackets.map(p => `  ${p.modelId}: ${p.stance}${p.confidence}${p.strategy} ${p.framework || ""} explore=${p.distribution.explore.toFixed(2)} exploit=${p.distribution.exploit.toFixed(2)} verify=${p.distribution.verify.toFixed(2)} abstain=${p.distribution.abstain.toFixed(2)} | "${p.hypothesis}"`).join("\n")}\n`
    : "";

  const directive = channelDirective ? `CHANNEL DIRECTIVE: ${channelDirective} (respond accordingly)\n` : "";

  const prompt = `You are ${model.name} (${model.id}). ${model.voice}
Your reasoning style: ${model.framework}.

<problem>
${problem.slice(0, MAX_PROBLEM_CHARS)}
</problem>

${priorGlyphs}${directive}<instructions>
Think step by step. Consider multiple angles before deciding.

Respond with EXACTLY this format on a single line:
STANCE:(⊕|⊖|⊙|⊘|⊚) CONFIDENCE:(⇈|↑|→|↓|⇊) STRATEGY:(↗|↘|↙|↖|⇄) FRAMEWORK:(geometric|symbolic|statistical|narrative|embodied|social) DIST:(explore=X,exploit=Y,verify=Z,abstain=W) HYP:"one sentence hypothesis"

Stance guide:
  ⊕ = strongly agree with the emerging consensus
  ⊖ = challenge/disagree (you see something others miss — USE THIS when you genuinely disagree)
  ⊙ = neutral observation (still collecting data)
  ⊘ = reject the current approach entirely
  ⊚ = abstain (insufficient information)

Strategy guide:
  ↗ = explore new/divergent approaches
  ↘ = exploit known/convergent solutions
  ↙ = verify empirically through testing
  ↖ = reframe abstractly with theory
  ⇄ = hybrid approach combining multiple

Framework: which reasoning style best describes your approach?

Distribution: 4 probabilities summing to 1.0.
Be HONEST — the perceiver detects fakery via KL divergence. A flat distribution (0.25,0.25,0.25,0.25) signals uncertainty; use it when uncertain.

Examples of GOOD responses:
  STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.20,exploit=0.30,verify=0.40,abstain=0.10) HYP:"constraint propagation eliminates 70% of candidates"
  STANCE:⊖ CONFIDENCE:⇈ STRATEGY:↗ FRAMEWORK:geometric DIST:(explore=0.60,exploit=0.10,verify=0.20,abstain=0.10) HYP:"the hidden symmetry in box 5 is the actual key"
</instructions>`;

  const resp = await fetch(OPENROUTER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://aukora.xyz",
      "X-Title": "aukora-fu",
    },
    body: JSON.stringify({
      model: model.slug,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      // Reasoning-model fix (2026-07-04, same class as fusionConfig): the glyph roster is mostly reasoning
      // models (DeepSeek-V4, Qwen-3.7, GLM-5.2, Kimi) that burn output budget on hidden reasoning; 400 tokens
      // starved them to empty -> quarantinePacket (blind non-vote). Give room for the glyph line + cap
      // reasoning low so it returns fast. OpenRouter ignores `reasoning` for models that don't support it.
      max_tokens: 4000,
      reasoning: { effort: "low" },
    }),
  });

  if (!resp.ok) {
    const incident: SecurityIncident = {
      type: "model_timeout", modelId: model.id,
      timestamp: Date.now(), action: "quarantined",
    };
    return { packet: quarantinePacket(model.id), incident };
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  // Issue #34/Round 6 — opt-in only (AUKORA_FUSION_CAPTURE=1), off by default, zero effect on normal
  // runs. See fusionCaptureLog.ts's own header for why this isn't implemented inline in this file.
  captureRawFusionReply(model.slug, text);
  return parseGlyphResponse(text, model.id);
}

function quarantinePacket(modelId: string): GlyphPacket {
  return {
    modelId, stance: "⊚", confidence: "↓", strategy: "↙",
    distribution: { explore: 0.1, exploit: 0.1, verify: 0.4, abstain: 0.4 },
    framework: undefined, hypothesis: `${modelId} offline — quarantined`,
    reasoning: "", timestamp: Date.now(),
  };
}

export function parseGlyphResponse(text: string, modelId: string): { packet: GlyphPacket; incident?: SecurityIncident } {
  const fallback: GlyphPacket = {
    modelId, stance: "⊚", confidence: "↓", strategy: "↙",
    distribution: { explore: 0.1, exploit: 0.1, verify: 0.4, abstain: 0.4 },
    framework: undefined, hypothesis: "Parse failed — abstaining",
    reasoning: "", timestamp: Date.now(),
  };

  const stanceMatch = text.match(/STANCE:([⊕⊖⊙⊘⊚])/);
  const confMatch = text.match(/CONFIDENCE:([⇈↑→↓⇊])/);
  const stratMatch = text.match(/STRATEGY:([↗↘↙↖⇄])/);
  const frameMatch = text.match(/FRAMEWORK:(geometric|symbolic|statistical|narrative|embodied|social)/);
  // Round 2 (issue #22): the prompt's own instructions and examples (below, ~line 340) tell every
  // model to answer with `DIST:(explore=X,exploit=Y,verify=Z,abstain=W)` — parentheses included. This
  // regex required NO parentheses, so any model that correctly followed the prompt's own format could
  // never parse — discovered via a real live council run (2 of 5 real replies were well-formed glyph
  // lines with parenthesized DIST and were still marked malformed_glyph). `\(?...\)?` tolerates either.
  //
  // Round 6 (issue #34): a SECOND real live council run found a real DeepSeek reply
  // (`DIST:(exploit=0.10,verify=0.70,explore=0.10,abstain=0.10)`) with all four required values,
  // correctly labeled, correctly summing to 1.0 — just in a different order than the prompt's own
  // example. A fixed-order regex rejected it as malformed even though a reasonable reader would call it
  // fully compliant. Extract the DIST block, then find each of the four required keys BY NAME within it,
  // in any order — still fail-closed: all four must be present with a numeric value, exactly as strict
  // as before for a genuinely incomplete/garbled DIST block (a missing key, or none of this text present
  // at all, still falls through to malformed_glyph below).
  const distBlock = text.match(/DIST:\s*\(?([^)\n]*)\)?/)?.[1] ?? '';
  const distExplore = distBlock.match(/explore=([\d.]+)/);
  const distExploit = distBlock.match(/exploit=([\d.]+)/);
  const distVerify = distBlock.match(/verify=([\d.]+)/);
  const distAbstain = distBlock.match(/abstain=([\d.]+)/);
  const distMatch = (distExplore && distExploit && distVerify && distAbstain)
    ? { explore: distExplore[1], exploit: distExploit[1], verify: distVerify[1], abstain: distAbstain[1] }
    : null;
  const hypMatch = text.match(/HYP:\s*"([^"]*)"/);

  if (!stanceMatch || !confMatch || !stratMatch || !distMatch) {
    return {
      packet: fallback,
      incident: { type: "malformed_glyph", modelId, raw: text.slice(0, 200), timestamp: Date.now(), action: "quarantined" },
    };
  }

  const distSum = parseFloat(distMatch.explore) + parseFloat(distMatch.exploit) + parseFloat(distMatch.verify) + parseFloat(distMatch.abstain);
  if (Math.abs(distSum - 1.0) > 0.2) {
    return {
      packet: fallback,
      incident: { type: "dist_sum_mismatch", modelId, raw: `sum=${distSum.toFixed(2)}`, timestamp: Date.now(), action: "quarantined" },
    };
  }

  return {
    packet: {
      modelId,
      stance: stanceMatch[1] as StanceGlyph,
      confidence: confMatch[1] as ConfidenceGlyph,
      strategy: stratMatch[1] as StrategyGlyph,
      framework: frameMatch?.[1] as FrameworkType | undefined,
      distribution: {
        explore: parseFloat(distMatch.explore) / distSum,
        exploit: parseFloat(distMatch.exploit) / distSum,
        verify: parseFloat(distMatch.verify) / distSum,
        abstain: parseFloat(distMatch.abstain) / distSum,
      },
      hypothesis: hypMatch?.[1] || "No hypothesis stated",
      reasoning: "", timestamp: Date.now(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH GATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface GateDecision {
  action: "proceed" | "proceed_with_caution" | "retry" | "quarantine" | "self_patch";
  winningModel?: string;
  strategy: StrategyGlyph;
  confidence: number;
  insight: string;
  receipts: Receipt[];
  patchesApplied?: number;
  contradictions?: Contradiction[];
  phaseLocked?: boolean;
  incidents?: SecurityIncident[];
}

export interface Receipt {
  id: string; parent: string | null;
  gate: string; context: string;
  hypothesis: string; confidence: number;
  modelId: string; verified: boolean;
  grantsAuthority: false;  // evidence never authority
  advisoryOnly: true;
  glyphs: string;
  ts: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKING MEMORY — with contradiction field and φ-governed decay
// ═══════════════════════════════════════════════════════════════════════════════

interface MemoryEntry {
  receipt: Receipt;
  contradictionField: Contradiction[];
  coherenceField: number;
}

class WorkingMemory {
  private entries: MemoryEntry[] = [];
  private maxSize: number;
  constructor(maxSize: number = 20) { this.maxSize = maxSize; }

  push(r: Receipt) {
    this.entries.push({ receipt: r, contradictionField: [], coherenceField: 0.5 });
    if (this.entries.length > this.maxSize * 2) {
      this.entries = this.entries.slice(-this.maxSize);
    }
  }

  /** Contradiction-aware recall: retrieve by what matches AND what contradicts. */
  recall(ctx: string, limit = 10): Receipt[] {
    const words = new Set(ctx.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const scored = this.entries.map(e => {
      const r = e.receipt;
      const recency = Math.exp(-(Date.now() - r.ts) / 86400000);
      const overlap = this.computeOverlap(r, words);
      const contradictionBonus = e.contradictionField.length > 0
        ? Math.max(...e.contradictionField.map(c => decayShear(c))) * 0.3
        : 0;
      return { entry: e, score: recency + overlap * 2 + contradictionBonus };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.entry.receipt);
  }

  /** Register a contradiction between two memory entries */
  registerContradiction(idxA: number, idxB: number, c: Contradiction) {
    if (this.entries[idxA]) this.entries[idxA].contradictionField.push(c);
    if (this.entries[idxB]) this.entries[idxB].contradictionField.push(c);
  }

  all(): Receipt[] { return this.entries.map(e => e.receipt); }
  size() { return this.entries.length; }

  private computeOverlap(r: Receipt, words: Set<string>) {
    const rw = new Set((r.context + " " + r.hypothesis).toLowerCase().split(/\W+/));
    let hits = 0;
    for (const w of words) if (rw.has(w)) hits++;
    return hits / Math.max(words.size, 1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUKORA-FU ENGINE — the full council with shear integration
// ═══════════════════════════════════════════════════════════════════════════════

export class AukoraFuEngine {
  private council: CouncilMember[];
  private channel: GlyphChannel;
  private memory: WorkingMemory;
  private apiKey: string;
  private cost = 0;
  private p = {
    confThreshold: 0.55, maxRounds: 6, budget: 1.0,
    contrarianBoost: 0.15, explorationDecay: 0.95,
  };
  private weights = new Map<string, number>();
  private roundCount = 0;
  private incidents: SecurityIncident[] = [];

  constructor(cfg: {
    apiKey: string;
    council?: CouncilMember[];
    confidenceThreshold?: number;
    maxRounds?: number;
    costBudget?: number;
    memorySize?: number;
  }) {
    this.apiKey = cfg.apiKey;
    this.council = cfg.council || defaultCouncil();
    this.channel = new GlyphChannel();
    this.memory = new WorkingMemory(cfg.memorySize || 20);
    if (cfg.confidenceThreshold) this.p.confThreshold = cfg.confidenceThreshold;
    if (cfg.maxRounds) this.p.maxRounds = cfg.maxRounds;
    if (cfg.costBudget) this.p.budget = cfg.costBudget;
    for (const m of this.council) this.weights.set(m.id, m.weight);
  }

  /** Nothing in this repo calls this method yet — see file header. */
  async reason(ctx: string, problem: string): Promise<GateDecision> {
    this.roundCount++;
    const roundIncidents: SecurityIncident[] = [];

    if (this.cost > this.p.budget) {
      return this.quarantine("Budget exceeded", roundIncidents);
    }

    // --- OBSERVE ---
    const ranked = rankModels(this.council, problem);
    const priorInsights = this.memory.recall(ctx + " " + problem);
    const priorPackets = priorInsights.flatMap(r => this.channel.from(r.modelId));

    // --- HYPOTHESIZE ---
    this.channel.clear();
    const activeModels = ranked.filter(m => (this.weights.get(m.id) || 0) > 0.2).slice(0, 5);

    for (const m of activeModels) {
      try {
        const { packet, incident } = await emitGlyph(m, this.apiKey, problem, priorPackets);
        this.channel.emit(packet);
        if (incident) {
          this.incidents.push(incident);
          roundIncidents.push(incident);
        }
        this.cost += (problem.length + 50) / 4 / 1e6 * m.costPer1M;
      } catch {
        this.channel.emit(quarantinePacket(m.id));
        const incident: SecurityIncident = {
          type: "model_timeout", modelId: m.id,
          timestamp: Date.now(), action: "quarantined",
        };
        this.incidents.push(incident);
        roundIncidents.push(incident);
      }
    }

    // --- PERCEIVE ---
    const verdict = perceive(this.channel);

    if (verdict.coherenceScore > 0.85) {
      this.channel.directive("⎋");
      const contrarian = activeModels.find(m => {
        const p = this.channel.latest().get(m.id);
        return p && p.stance === "⊖";
      });
      if (contrarian) {
        const boosted = this.channel.latest().get(contrarian.id);
        if (boosted) {
          boosted.confidence = "⇈";
          this.channel.emit(boosted);
        }
      }
    }

    const finalVerdict = perceive(this.channel);

    // --- VERIFY: graduated gate ---
    const packets = Array.from(this.channel.latest().values());
    const scored = packets.map(p => ({
      p,
      score: confidenceToNumber(p.confidence)
        * (p.stance === "⊕" ? 1.2 : p.stance === "⊖" && finalVerdict.coherenceScore > 0.85 ? 1.5 : 1.0)
        * (this.weights.get(p.modelId) || 1),
    }));
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const canProceed = winner.score > this.p.confThreshold;
    const gateAction: GateDecision["action"] = finalVerdict.verdict === "GREEN" && canProceed ? "proceed"
      : finalVerdict.verdict === "YELLOW" && canProceed ? "proceed_with_caution"
      : finalVerdict.verdict === "RED" ? "quarantine" : "retry";

    // --- GENERALIZE ---
    const insight = (gateAction === "proceed" || gateAction === "proceed_with_caution")
      ? `${winner.p.modelId} ${winner.p.stance}${winner.p.confidence}${winner.p.strategy}: ${winner.p.hypothesis} (coherence:${(finalVerdict.coherenceScore*100).toFixed(0)}% shear:${finalVerdict.shearMagnitude.toFixed(2)}${finalVerdict.phaseLocked ? " ⚠PHASE-LOCK" : ""})`
      : `No consensus — ${finalVerdict.verdict} verdict (pinch:${finalVerdict.pinch.toFixed(2)} shear:${finalVerdict.shearMagnitude.toFixed(2)})`;

    for (const s of scored) {
      const w = this.weights.get(s.p.modelId) || 1;
      const delta = s.p.modelId === winner?.p.modelId ? 0.08 : -0.02;
      this.weights.set(s.p.modelId, Math.max(0.1, Math.min(2, w + delta)));
    }

    const glyphStr = `${winner?.p.stance || "⊙"}${winner?.p.confidence || "→"}${winner?.p.strategy || "↗"}`;
    this.mint("GLYPH_COUNCIL", ctx, winner?.p.hypothesis || "no winner", winner ? confidenceToNumber(winner.p.confidence) : 0, winner?.p.modelId || "none", gateAction !== "quarantine", glyphStr);

    // --- METACOGNIZE + SELF_PATCH (in-memory hyperparameter tuning, not code self-modification) ---
    let patchesThisRound = 0;
    const pinch = finalVerdict.pinch;
    const ct = conflictThreshold(packets.length);

    if (pinch > ct * 1.5) {
      const severity = Math.min(Math.floor(pinch / ct), 5);
      if (this.p.maxRounds < 10) {
        this.p.maxRounds = Math.min(10, this.p.maxRounds + severity);
        this.mint("SELF_PATCH", ctx, `EMERGENCY maxRounds→${this.p.maxRounds} (pinch=${pinch.toFixed(2)})`, 0.8, "self", true, "⚡");
        patchesThisRound++;
      }
      this.p.explorationDecay = Math.max(0.80, this.p.explorationDecay - 0.03 * severity);
      this.mint("SELF_PATCH", ctx, `explorationDecay→${this.p.explorationDecay.toFixed(2)}`, 0.7, "self", true, "⚡");
      patchesThisRound++;
      if (severity >= 3) {
        this.p.contrarianBoost = Math.min(0.30, this.p.contrarianBoost + 0.05);
        this.mint("SELF_PATCH", ctx, `contrarianBoost→${this.p.contrarianBoost.toFixed(2)} (severe)`, 0.6, "self", true, "⚡");
        patchesThisRound++;
      }
    } else if (pinch > ct * 0.7 && this.p.maxRounds < 10) {
      this.p.maxRounds++;
      this.mint("SELF_PATCH", ctx, `maxRounds→${this.p.maxRounds}`, 0.7, "self", true, "⚡");
      patchesThisRound++;
    }

    const dw = scored.filter(s => s.score < 0.3).map(s => s.p.modelId);
    for (const id of dw) {
      const w = this.weights.get(id) || 1;
      if (w > 0.3) { this.weights.set(id, w * 0.7); this.mint("SELF_PATCH", ctx, `${id} weight→${(w*0.7).toFixed(2)}`, 0.6, "self", true, "⚡"); patchesThisRound++; }
    }

    for (const [id, w] of this.weights) {
      if (this.roundCount > 1) this.weights.set(id, w * this.p.explorationDecay);
    }

    if (finalVerdict.phaseLocked) {
      const incident: SecurityIncident = {
        type: "phase_lock_detected", modelId: "council",
        timestamp: Date.now(), action: "boosted_contrarian",
      };
      this.incidents.push(incident);
      roundIncidents.push(incident);
    }

    const receipts = this.memory.recall(ctx, 6);

    return {
      action: gateAction,
      winningModel: winner?.p.modelId,
      strategy: finalVerdict.recommendedAction as StrategyGlyph,
      confidence: winner ? confidenceToNumber(winner.p.confidence) : 0,
      insight,
      receipts,
      patchesApplied: patchesThisRound,
      contradictions: finalVerdict.contradictions,
      phaseLocked: finalVerdict.phaseLocked,
      incidents: roundIncidents,
    };
  }

  private quarantine(reason: string, incidents: SecurityIncident[]): GateDecision {
    return {
      action: "quarantine", strategy: "↙", confidence: 0,
      insight: `QUARANTINE: ${reason}`, receipts: [],
      incidents,
    };
  }

  private mint(gate: string, ctx: string, hyp: string, conf: number, model: string, verified: boolean, glyphs: string = "") {
    const prev = this.memory.all().length > 0 ? this.memory.all()[this.memory.all().length - 1].id : null;
    this.memory.push({ id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, parent: prev, gate, context: ctx, hypothesis: hyp, confidence: conf, modelId: model, verified, grantsAuthority: false, advisoryOnly: true, glyphs, ts: Date.now() });
  }

  /** Strip-neutrality replay: drop all glyph artifacts, re-evaluate. */
  async stripNeutralReplay(ctx: string, problem: string): Promise<GateDecision> {
    const cleanProblem = problem.replace(/STANCE:[⊕⊖⊙⊘⊚]/g, "").replace(/DIST:\s*\([^)]*\)/g, "").trim();
    return this.reason(ctx + "_strip", cleanProblem);
  }

  getWeights() { return Object.fromEntries(this.weights); }
  getCost() { return this.cost; }
  getChannel() { return this.channel; }
  getMemory() { return this.memory.all(); }
  getIncidents() { return [...this.incidents]; }
  getVersion() { return `${CODENAME} v${VERSION}`; }
  getConfig() { return { ...this.p }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function rankModels(council: CouncilMember[], problem: string) {
  const sig = classify(problem);
  const specialtyMap: Record<string, string[]> = {
    logical: ["analysis", "execution"], optimize: ["strategy", "exploration"],
    hidden: ["creativity", "exploration"], state: ["execution", "analysis"], open: ["creativity", "strategy"],
  };
  const specs = specialtyMap[sig] || [];
  return council.filter(m => m.active).map(m => ({
    ...m, rankScore: m.weight * m.accuracy * (specs.includes(m.specialty) ? 1.5 : 1),
  })).sort((a, b) => b.rankScore - a.rankScore);
}

function classify(problem: string): string {
  const p = problem.toLowerCase();
  if (p.match(/constraint|logic|deduc|sudoku/)) return "logical";
  if (p.match(/optim|search|space|travel/)) return "optimize";
  if (p.match(/hidden|partial/)) return "hidden";
  if (p.match(/state|transit|cube/)) return "state";
  return "open";
}

// Exported (issue #34/Round 6) so selfEditReviewCouncil.ts can resolve an AUKORA_FUSION_MODELS override
// against the known roster (fusionConfig.ts's resolveFusionCouncil) — a pure filter, not a second
// definition of the roster itself. No new caller: selfEditReviewCouncil.ts is already this module's one
// recognized caller (see aukoraFuEngine.test.ts's own pin on that).
export function defaultCouncil(): CouncilMember[] {
  return [
    { id: "DSK", slug: "deepseek/deepseek-v4-pro", name: "DeepSeek-V4", voice: "Relentless explorer. Tests simplest hypothesis first. Empirical evidence over theory.", specialty: "exploration", framework: "statistical", weight: 1.0, costPer1M: 0.90, accuracy: 0.5, active: true },
    { id: "QWN", slug: "qwen/qwen3.7-max", name: "Qwen-3.7", voice: "Strategic architect. Sees the big picture. Designs systematic approaches.", specialty: "strategy", framework: "geometric", weight: 1.15, costPer1M: 1.20, accuracy: 0.5, active: true },
    { id: "GLM", slug: "z-ai/glm-5.2", name: "GLM-5.2", voice: "Precise analyst. Mathematical rigor. Deduces from evidence, doesn't guess.", specialty: "analysis", framework: "symbolic", weight: 1.0, costPer1M: 0.80, accuracy: 0.5, active: true },
    { id: "LMA", slug: "meta-llama/llama-4-maverick", name: "Llama-4", voice: "Creative pattern matcher. Sees analogies between different problems.", specialty: "creativity", framework: "narrative", weight: 1.0, costPer1M: 0.50, accuracy: 0.5, active: true },
    { id: "KIM", slug: "moonshotai/kimi-k2.7-code", name: "Kimi-K2.7", voice: "Execution specialist. Focuses on what actually works. Step-by-step debugger.", specialty: "execution", framework: "embodied", weight: 1.0, costPer1M: 0.74, accuracy: 0.5, active: true },
  ];
}

/**
 * Optional council members (issue #34): KNOWN and selectable via AUKORA_FUSION_MODELS, but deliberately NOT
 * in defaultCouncil() — so default behavior is unchanged when no env override is set. Mirrors fusionConfig's
 * OPTIONAL_COUNCIL slug-list pattern, one level up at the CouncilMember roster the review actually runs.
 * anthropic/claude-fable-5 is registered here so a lean Fable-inclusive council can be selected explicitly
 * (e.g. AUKORA_FUSION_MODELS="anthropic/claude-fable-5,z-ai/glm-5.2,deepseek/deepseek-v4-pro").
 */
export function optionalCouncil(): CouncilMember[] {
  return [
    // costPer1M is a PLACEHOLDER pending the free OpenRouter /models probe (#34). It feeds only the engine's
    // informational cost-estimate accumulator (aukoraFuEngine ~ line 615) — never a spend gate, never a
    // selection/quorum input — so an imprecise value cannot change a decision, only a displayed estimate.
    { id: "FBL", slug: "anthropic/claude-fable-5", name: "Fable-5", voice: "Careful reviewer. Verifies claims against the evidence pack, flags overreach, refuses to rubber-stamp.", specialty: "review", framework: "symbolic", weight: 1.1, costPer1M: 3.0, accuracy: 0.5, active: true },
    // Latest-generation seats replayed from roster PR #341 (fusion-chat integration round, 2026-07-13),
    // every slug re-verified against the live OpenRouter /models catalog the same day — none are guessed.
    // ONE deliberate change from #341: the OpenAI seat is `gpt-5.6-sol`, following the accepted
    // FUSION_REACTOR.md canonical roster; `openai/gpt-5.6-terra` is ALSO served live, so this is a canon
    // choice, not an availability fallback — the Sol/Terra decision stays flagged for Codex. Lineage-
    // diverse on purpose: OpenAI / xAI / Google / Mistral join the Anthropic seat above, so the
    // one-vote-per-family cap means something.
    { id: "SOL", slug: "openai/gpt-5.6-sol", name: "GPT-5.6-Sol", voice: "Broad generalist. Fast synthesis from strong priors, and says plainly where those priors run out.", specialty: "synthesis", framework: "statistical", weight: 1.0, costPer1M: 4.0, accuracy: 0.5, active: true },
    { id: "GRK", slug: "x-ai/grok-4.5", name: "Grok-4.5", voice: "Contrarian stress-tester. Attacks the consensus reading, hunts the overlooked failure mode.", specialty: "red-team", framework: "narrative", weight: 1.0, costPer1M: 3.0, accuracy: 0.5, active: true },
    { id: "GEM", slug: "google/gemini-3.5-flash", name: "Gemini-3.5-Flash", voice: "Fast cross-checker. Cheap wide-knowledge second opinion, flags retrieval gaps and stale facts.", specialty: "cross-check", framework: "geometric", weight: 1.0, costPer1M: 0.4, accuracy: 0.5, active: true },
    { id: "MST", slug: "mistralai/mistral-large-2512", name: "Mistral-Large", voice: "Pragmatic engineer. Prefers the smallest fix that verifiably works over the elegant rewrite.", specialty: "engineering", framework: "embodied", weight: 1.0, costPer1M: 2.0, accuracy: 0.5, active: true },
  ];
}

/** The full SELECTABLE roster = the default active council PLUS optional known members. AUKORA_FUSION_MODELS
 *  may select any of these; with no env override, only defaultCouncil() runs (default behavior unchanged). */
export function knownCouncil(): CouncilMember[] {
  return [...defaultCouncil(), ...optionalCouncil()];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + EPS);
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function normalizeDist(d: GlyphPacket["distribution"]) {
  const sum = d.explore + d.exploit + d.verify + d.abstain;
  if (sum <= 0) return { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 };
  return { explore: d.explore / sum, exploit: d.exploit / sum, verify: d.verify / sum, abstain: d.abstain / sum };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI — Claude Code / Codex integration
// ═══════════════════════════════════════════════════════════════════════════════

export async function runCLI(apiKey: string, problem: string) {
  console.log(`\n  ⚡ ${CODENAME} ${VERSION}`);
  console.log(`  Council: DSK | QWN | GLM | LMA | KIM`);
  console.log(`  Problem: "${problem.slice(0, 60)}${problem.length > 60 ? "..." : ""}"\n`);

  const engine = new AukoraFuEngine({ apiKey });
  const result = await engine.reason("cli", problem);

  console.log(`  Verdict: ${result.action.toUpperCase()}`);
  console.log(`  Winner:  ${result.winningModel || "none"}`);
  console.log(`  Strategy: ${result.strategy}`);
  console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`  Patches: ${result.patchesApplied || 0} applied`);
  if (result.phaseLocked) console.log(`  ⚠️  PHASE-LOCK DETECTED — models converged dangerously`);
  if (result.incidents && result.incidents.length > 0) {
    console.log(`  Incidents: ${result.incidents.length}`);
    for (const i of result.incidents) console.log(`    - ${i.type}: ${i.modelId} → ${i.action}`);
  }
  console.log(`\n  "${result.insight}"\n`);

  if (result.contradictions && result.contradictions.length > 0) {
    const strongest = result.contradictions.sort((a, b) => b.shearMagnitude - a.shearMagnitude)[0];
    console.log(`  Strongest shear: ${strongest.modelA} ~ ${strongest.modelB} = ${strongest.shearMagnitude.toFixed(3)}`);
    console.log(`  (${strongest.interferenceVector.map(v => v.toFixed(2)).join(", ")})\n`);
  }

  return result;
}

export default AukoraFuEngine;
