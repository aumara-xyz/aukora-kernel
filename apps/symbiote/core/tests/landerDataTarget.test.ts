// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the fail-closed persistence boundary. Visitor PII persists ONLY to an
// explicitly-configured SEPARATE private repo, and NEVER to the code repo — not by default,
// not by misconfiguration.
import { describe, it, expect } from 'vitest';
import { resolveDataTarget, _CODE_REPO } from '../../lander/api/_data-target.js';

describe('resolveDataTarget — no default, never the code repo', () => {
  it('unset config → null (fail closed, writes nothing)', () => {
    expect(resolveDataTarget({})).toBeNull();
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: '' })).toBeNull();
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: '   ' })).toBeNull();
  });
  it('malformed "owner/repo" → null', () => {
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: 'not-a-repo' })).toBeNull();
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: 'a/b/c' })).toBeNull();
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: '/leading-slash' })).toBeNull();
  });
  it('HARD REFUSAL: the code repo is never a write target, on any branch or casing', () => {
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: `${_CODE_REPO.owner}/${_CODE_REPO.repo}` })).toBeNull();
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: 'AUMARA-XYZ/AUKORA-SYMBIOTE' })).toBeNull();
    expect(resolveDataTarget({
      AUKORA_LANDER_DATA_REPO: 'aumara-xyz/aukora-symbiote',
      AUKORA_LANDER_DATA_BRANCH: 'some-other-branch',
    })).toBeNull();
  });
  it('a separate private repo → resolves, default branch main', () => {
    expect(resolveDataTarget({ AUKORA_LANDER_DATA_REPO: 'aumara-xyz/aukora-lander-data' }))
      .toEqual({ owner: 'aumara-xyz', repo: 'aukora-lander-data', branch: 'main' });
    expect(resolveDataTarget({
      AUKORA_LANDER_DATA_REPO: 'someorg/private-visitor-data',
      AUKORA_LANDER_DATA_BRANCH: 'collect',
    })).toEqual({ owner: 'someorg', repo: 'private-visitor-data', branch: 'collect' });
  });
});
