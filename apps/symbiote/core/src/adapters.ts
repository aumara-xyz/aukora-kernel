// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.60 — Engine adapter registry. The Host is engine-agnostic: an adapter PROPOSES a diff; it NEVER applies. Aukora
 * owns authority (AUMLOK session → risk gate → kernel receipt → undo). OpenCode is the primary CANDIDATE adapter (none is wired or active in the headless seed); Codex /
 * Hermes / Odysseus are descriptors only — not mounted, no execution this round. `canApply` is permanently false for
 * every adapter: that invariant is the whole point, and a test asserts it.
 *
 * This is a registry/descriptor (pure data + types). It contains no execution. No engine is wired or active in the headless seed (the live engine + apply lane are M4).
 * canApply is permanently false for every adapter — that invariant is the whole point.
 */
export type AdapterStatus = 'active' | 'planned' | 'quarantined';

export interface EngineAdapterDescriptor {
  id: string;
  name: string;
  status: AdapterStatus;
  /** ALWAYS false — an adapter proposes diffs; only the governed Host apply path writes. */
  canApply: false;
  note: string;
}

export const ENGINE_ADAPTERS: EngineAdapterDescriptor[] = [
  { id: 'opencode', name: 'OpenCode', status: 'planned', canApply: false, note: 'primary candidate engine — would propose diffs in a throwaway worktree; NOT wired or active in the headless seed; never applies' },
  { id: 'codex', name: 'Codex', status: 'planned', canApply: false, note: 'planned adapter — not mounted, no execution' },
  { id: 'hermes', name: 'Hermes', status: 'quarantined', canApply: false, note: 'quarantined — autonomy scaffolding; not wired, no execution' },
  { id: 'odysseus', name: 'Odysseus', status: 'planned', canApply: false, note: 'planned adapter — not mounted, no execution' },
];

export function activeAdapter(): EngineAdapterDescriptor | null {
  return ENGINE_ADAPTERS.find((a) => a.status === 'active') ?? null;
}
