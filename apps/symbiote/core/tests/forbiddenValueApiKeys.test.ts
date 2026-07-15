// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Focused pins for the broadened sk- net in FORBIDDEN_VALUE_RE (stabilization round, 2026-07-07):
// modern hyphenated API key families must be caught at the shared scanner, not only by the capture
// lane's stopgap. Negatives pin that ordinary prose and the UI placeholder stay clean.
import { describe, it, expect } from 'vitest';
import { FORBIDDEN_VALUE_RE, scanForbiddenValues } from '../src/forbiddenContent';
import { distillConversation } from '../src/conversationDistiller';

const hits = (s: string) => scanForbiddenValues({ text: s }).length;

describe('FORBIDDEN_VALUE_RE — modern API key families (broadened sk- net)', () => {
  it('catches an OpenRouter-style key (sk-or-v1- + 64 hex) — hyphenated tail, hex tail, both nets', () => {
    const k = 'sk-or-v1-' + 'a1b2c3d4'.repeat(8);
    expect(FORBIDDEN_VALUE_RE.test(k)).toBe(true);
    expect(hits(`my key is ${k} keep it safe`)).toBe(1);
  });

  it('catches an OpenRouter-shaped key even with a SHORT non-hex tail (the old escape)', () => {
    expect(hits('here: sk-or-v1-abcXYZ123 saved')).toBe(1);
  });

  it('catches an Anthropic-style key (sk-ant-api03- + base64url tail with - and _)', () => {
    const k = 'sk-ant-api03-Ab1_cd2-EF3gh_45ij-KL6mn7op_89qr-ST0uvAA';
    expect(FORBIDDEN_VALUE_RE.test(k)).toBe(true);
    expect(hits(`please remember ${k}`)).toBe(1);
  });

  it('catches an OpenAI project-style key (sk-proj-…)', () => {
    expect(hits('config used sk-proj-N7xw2_Qr-9ZtY4kV1m rotated monthly')).toBe(1);
  });

  it('still catches the classic unbroken form (superset of the old net)', () => {
    expect(hits('legacy sk-A1b2C3d4E5f6G7h8 form')).toBe(1);
  });

  it('catches underscore-only tails', () => {
    expect(hits('odd but real: sk-abc_def_ghi_jkl')).toBe(1);
  });

  it('NEGATIVE: the Settings UI placeholder stays clean (ellipsis breaks the tail)', () => {
    expect(hits('sk-or-v1-…  (paste your key)')).toBe(0);
  });

  it('NEGATIVE: short sk- fragments and ordinary prose stay clean', () => {
    expect(hits('the sk-42 form is fine')).toBe(0);
    expect(hits('sync the desk-organizer list')).toBe(0);
    expect(hits('no keys here at all')).toBe(0);
  });

  it('ACCEPTED false-positive class, pinned deliberately: hyphenated sk- prose identifiers drop', () => {
    // "sk-learn-based-pipelines" style strings DO match — a false hit only drops an atom (law 3's
    // safe direction). Pinned so a future "fix" that reopens the key families fails this suite.
    expect(hits('we used sk-learn-based-pipelines here')).toBe(1);
  });
});

describe('distiller integration — hyphenated keys are dropped at the shared net (not only capture)', () => {
  it('a turn carrying an Anthropic-style key yields NO atom containing it', () => {
    const k = 'sk-ant-api03-Ab1_cd2-EF3gh_45ij-KL6mn7op_89qr-ST0uvAA';
    const r = distillConversation([
      { role: 'owner', text: `store this credential for me forever please: ${k}` },
      { role: 'auma', text: 'I will not store credential material; noted that you asked though.' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.atoms)).not.toContain('sk-ant');
    expect(r.atoms.length).toBe(1); // the clean reply survives; the key-bearing turn is dropped
  });
});
