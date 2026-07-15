// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the friend-share audit's classification + two-verdict logic, pinned.
// Live visitor data (real chats + waitlist) is PII and must be flagged; explicitly-synthetic
// *.example.json fixtures must NOT be. HEAD-clean and history-clean are SEPARATE verdicts.
import { describe, it, expect } from 'vitest';
import { isLiveDataPath, classifyLiveDataPaths, auditFromLists } from '../../scripts/friendShareAudit';

describe('isLiveDataPath — real visitor PII vs synthetic fixtures', () => {
  it('flags a real chat json and the waitlist', () => {
    expect(isLiveDataPath('lander/data/chats/c-mr925gwn-b6ism3.json')).toBe(true);
    expect(isLiveDataPath('lander/data/chats/test-verify-0706.json')).toBe(true);
    expect(isLiveDataPath('lander/data/waitlist.jsonl')).toBe(true);
    expect(isLiveDataPath('./lander/data/chats/c-anything.json')).toBe(true); // ZIP find-style ./ prefix
  });
  it('does NOT flag explicitly-synthetic .example fixtures or unrelated files', () => {
    expect(isLiveDataPath('lander/data/chats/example-conversation.example.json')).toBe(false);
    expect(isLiveDataPath('lander/api/log-chat.js')).toBe(false);
    expect(isLiveDataPath('README.md')).toBe(false);
    expect(isLiveDataPath('')).toBe(false);
  });
});

describe('classifyLiveDataPaths — dedupes + sorts the PII hits', () => {
  it('returns only the live-data paths', () => {
    const hits = classifyLiveDataPaths([
      'lander/data/chats/c-real.json',
      'lander/data/chats/example-conversation.example.json',
      'lander/data/waitlist.jsonl',
      'lander/data/chats/c-real.json', // dup
      'package.json',
    ]);
    expect(hits).toEqual(['lander/data/chats/c-real.json', 'lander/data/waitlist.jsonl']);
  });
});

describe('auditFromLists — HEAD and history are independent verdicts', () => {
  it('HEAD clean + history dirty = the honest post-containment state (green ZIP, red clone)', () => {
    const tracked = ['lander/data/chats/example-conversation.example.json', 'package.json'];
    const history = ['lander/data/chats/c-mr925gwn-b6ism3.json', 'lander/data/waitlist.jsonl'];
    const v = auditFromLists(tracked, history);
    expect(v.headClean).toBe(true);        // a fresh ZIP is safe to hand over
    expect(v.historyClean).toBe(false);     // a clone still exposes past visitor data
    expect(v.historyHits.length).toBe(2);
  });
  it('both clean only when neither surface carries live data', () => {
    const v = auditFromLists(['README.md'], ['README.md', 'lander/data/chats/x.example.json']);
    expect(v.headClean).toBe(true);
    expect(v.historyClean).toBe(true);
  });
  it('a live file tracked at HEAD fails the HEAD/ZIP verdict', () => {
    const v = auditFromLists(['lander/data/chats/c-leak.json'], []);
    expect(v.headClean).toBe(false);
    expect(v.headHits).toEqual(['lander/data/chats/c-leak.json']);
  });
});
