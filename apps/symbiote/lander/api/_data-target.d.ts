// SPDX-License-Identifier: AGPL-3.0-or-later
// Type declarations for the fail-closed lander data-target resolver (Eagle Eye #86).
export interface LanderDataTarget { owner: string; repo: string; branch: string }
export function resolveDataTarget(env?: Record<string, string | undefined>): LanderDataTarget | null;
export const _CODE_REPO: { owner: string; repo: string };
