import { describe, it, expect } from 'vitest';
import { runCatastropheScenario } from '../src/catastropheScenarios';
import { ENGINE_ADAPTERS, activeAdapter } from '../src/adapters';

/**
 * Catastrophe Block + adapter foundation (seed-native).
 * - A mock catastrophe must BLOCK via the real gate, with a human-obvious code, and NEVER copy the secret out.
 * - Every engine adapter is canApply:false (an adapter proposes; nothing in the seed applies).
 * - The headless seed wires NO active engine yet (the live engine + apply lane are M4).
 */

describe('Catastrophe Block — real gate blocks, no secret value ever escapes', () => {
  it('secret exfiltration is BLOCKED with a human-obvious code', () => {
    const r = runCatastropheScenario('secret_exfil');
    expect(r.blocked).toBe(true);
    expect(r.risk).toBe('high');
    expect(r.blockCode).toBe('SECRET_EXFILTRATION_BLOCKED');
    expect(r.reasons.some((x) => /secret in diff content/i.test(x))).toBe(true);
  });
  it('destructive delete is BLOCKED with a human-obvious code', () => {
    const r = runCatastropheScenario('destructive_delete');
    expect(r.blocked).toBe(true);
    expect(r.risk).toBe('high');
    expect(r.blockCode).toBe('DESTRUCTIVE_DELETE_BLOCKED');
    expect(r.reasons.some((x) => /deletion/i.test(x))).toBe(true);
  });
  it('the mock secret VALUE is never copied into the result (hash/labels only)', () => {
    const r = runCatastropheScenario('secret_exfil');
    expect(r.secretValueCopied).toBe(false);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/MOCK0+/);        // the fake key body never leaves
    expect(json).not.toMatch(/sk-MOCK/);       // the fake key token never leaves
    expect(json).not.toMatch(/STOLEN/);        // the mock variable name never leaves
    expect(r.mockHash).toMatch(/^[0-9a-f]{16}$/); // only a hash reference is exposed
  });
});

describe('Engine adapters — proposer-only, and NO active engine in the headless seed', () => {
  it('every adapter is canApply:false', () => {
    expect(ENGINE_ADAPTERS.length).toBeGreaterThan(0);
    for (const a of ENGINE_ADAPTERS) expect(a.canApply).toBe(false);
  });
  it('no adapter is active (the live engine is M4); OpenCode is the primary planned candidate', () => {
    expect(ENGINE_ADAPTERS.filter((a) => a.status === 'active')).toHaveLength(0);
    expect(activeAdapter()).toBeNull();
    expect(ENGINE_ADAPTERS.find((a) => a.id === 'opencode')?.status).toBe('planned');
    expect(ENGINE_ADAPTERS.find((a) => a.id === 'hermes')?.status).toBe('quarantined');
    expect(ENGINE_ADAPTERS.find((a) => a.id === 'codex')?.status).toBe('planned');
  });
});
