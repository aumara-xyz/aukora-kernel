/**
 * 24Z.24 — OpenCode model-wire decision layer (config only; no secrets, no network this round).
 *
 * OpenCode is a coding agent: producing a REAL diff needs a model provider. This module makes that an EXPLICIT,
 * env-driven decision — it never hardcodes a secret and never reads loose key files. Default provider is `none`,
 * so OpenCode stays parked honestly. For `openrouter`, the API key is referenced by env-var NAME only; its VALUE
 * is never stored, logged, or placed in any prompt/context/manifest — only its PRESENCE is reported.
 */

export type ModelProvider = 'none' | 'local' | 'openrouter';

export interface OpenCodeModelConfig {
  provider: ModelProvider;
  model: string | null;        // a safe model id (e.g. 'qwen3-coder') — never a secret
  endpoint: string | null;     // for `local` (e.g. a loopback URL); never a remote prod wire by default
  keyEnvVar: string | null;    // the NAME of the env var holding the provider key (never the value)
  keyPresent: boolean;         // whether that env var is set (presence only)
}

/** Resolve the model config from env (default = parked). NEVER returns or logs a key value. */
export function resolveModelConfig(env: NodeJS.ProcessEnv = process.env): OpenCodeModelConfig {
  const provider = (env.OPENCODE_MODEL_PROVIDER as ModelProvider) || 'none';
  if (provider !== 'local' && provider !== 'openrouter') {
    return { provider: 'none', model: null, endpoint: null, keyEnvVar: null, keyPresent: false };
  }
  const model = (env.OPENCODE_MODEL || '').trim() || null;
  const keyEnvVar = provider === 'openrouter' ? (env.OPENCODE_KEY_ENV || 'OPENROUTER_API_KEY') : null;
  // loopback-only for a local endpoint; anything else is ignored (no remote prod wire is configured here).
  const rawEndpoint = (env.OPENCODE_MODEL_ENDPOINT || '').trim();
  const endpoint = provider === 'local' && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(rawEndpoint) ? rawEndpoint : null;
  const keyPresent = keyEnvVar ? typeof env[keyEnvVar] === 'string' && env[keyEnvVar]!.length > 0 : false;
  return { provider, model, endpoint, keyEnvVar, keyPresent };
}

/** A provider is genuinely usable only with a model + (for openrouter) a present key / (for local) a loopback endpoint. */
export function modelConfigured(cfg: OpenCodeModelConfig): boolean {
  if (cfg.provider === 'none' || !cfg.model) return false;
  if (cfg.provider === 'openrouter') return cfg.keyPresent;
  if (cfg.provider === 'local') return !!cfg.endpoint;
  return false;
}

/** Safe, secret-free view for the manifest / the console (presence only — never the key value). */
export function summarizeModelWire(cfg: OpenCodeModelConfig): { provider: ModelProvider; model: string | null; configured: boolean; keyPresent: boolean } {
  return { provider: cfg.provider, model: cfg.model, configured: modelConfigured(cfg), keyPresent: cfg.keyPresent };
}

/**
 * Map the internal provider to a SAFE DISPLAY token for the manifest / the console. The browser truth-surface never
 * names a specific external vendor (and the tauri source-safety scan bans it), and the token can never be an
 * authority-loaded enum. `openrouter` → `scoped_api`. the console validates/renders against this fixed vocabulary.
 */
export function providerDisplayToken(p: ModelProvider): 'none' | 'local' | 'scoped_api' {
  return p === 'local' ? 'local' : p === 'openrouter' ? 'scoped_api' : 'none';
}
