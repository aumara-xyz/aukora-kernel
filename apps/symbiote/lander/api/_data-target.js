// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the FAIL-CLOSED persistence boundary for lander visitor data.
//
// Both lander write endpoints (log-chat, notify) persist visitor-supplied content (chat text,
// email addresses) = real PII. This module is the single place that decides WHERE that data is
// allowed to go. The load-bearing guarantees:
//
//   1. There is NO default write target. Visitor data is persisted ONLY when the operator has
//      explicitly configured a SEPARATE private data repo via env. Absent config → null → the
//      caller fails closed and writes nothing.
//   2. The code repo is a hard refusal. Even if someone points the config AT aumara-xyz/
//      aukora-symbiote (any branch), this returns null. Visitor PII must NEVER land in the code
//      repo or its main branch — not by default, not by misconfiguration.
//
// Env contract:
//   AUKORA_LANDER_DATA_REPO   = "owner/repo" of a SEPARATE, private data-only repository.
//   AUKORA_LANDER_DATA_BRANCH = branch to write to (default "main" of THAT data repo).
//   GITHUB_CONTENTS_TOKEN     = a token scoped to that data repo (unchanged; still required).

// The code repository — visitor data may never be written here regardless of configuration.
const CODE_REPO = { owner: 'aumara-xyz', repo: 'aukora-symbiote' };
const REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)\/([A-Za-z0-9._-]{1,100})$/;

/**
 * Resolve the private data target, or null (fail closed). Never throws.
 * @returns {{ owner: string, repo: string, branch: string } | null}
 */
export function resolveDataTarget(env = process.env) {
  const raw = String(env.AUKORA_LANDER_DATA_REPO || '').trim();
  if (!raw) return null; // no explicit target configured → write nothing
  const m = REPO_RE.exec(raw);
  if (!m) return null; // malformed "owner/repo" → fail closed
  const owner = m[1];
  const repo = m[2];
  // Hard refusal: never write visitor PII into the code repo, on any branch, under any config.
  if (owner.toLowerCase() === CODE_REPO.owner.toLowerCase() && repo.toLowerCase() === CODE_REPO.repo.toLowerCase()) {
    return null;
  }
  const branch = String(env.AUKORA_LANDER_DATA_BRANCH || 'main').trim() || 'main';
  return { owner, repo, branch };
}

export const _CODE_REPO = CODE_REPO; // exported for tests only
