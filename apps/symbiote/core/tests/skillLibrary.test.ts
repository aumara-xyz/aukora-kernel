import { describe, it, expect } from 'vitest';
import {
  proposeSkill, advanceSkill, buildSkillLibrary, seedSkillLibrary, summarizeSkillLibrary, skillLibraryGrantsAuthority,
} from '../src/skillLibrary';

// 24Z.15 — M1 skill library: external auditable artifacts, NOT weights. No execution; approval needs a receipt.

describe('24Z.15: M1 skill library (schema/registry, draft-only)', () => {
  it('a proposed skill is a DRAFT artifact granting no authority + requiring signed apply', () => {
    const s = proposeSkill({ id: 'skill.x', title: 'X', description: 'does x' });
    expect(s.lifecycle).toBe('draft');
    expect(s.authority.grantsAuthority).toBe(false);
    expect(s.authority.requiresSignedApply).toBe(true);
    expect(s.receiptRef).toBeNull();
  });

  it('the library NEVER executes and is not autonomous', () => {
    const l = seedSkillLibrary();
    expect(l.canExecute).toBe(false);
    expect(l.autonomousUse).toBe(false);
    expect(l.grantsAuthority).toBe(false);
    expect(skillLibraryGrantsAuthority(l)).toBe(false);
  });

  it('lifecycle advances ONE step; draft→reviewed is refused', () => {
    const s = proposeSkill({ id: 'skill.x', title: 'X', description: 'd' });
    expect(advanceSkill(s, 'proposed').ok).toBe(true);
    expect(advanceSkill(s, 'reviewed').ok).toBe(false); // can't skip 'proposed'
  });

  it('approval REQUIRES a signed receipt (AUMLOK gate) — cannot jump to approved unsigned', () => {
    let s = proposeSkill({ id: 'skill.x', title: 'X', description: 'd' });
    s = advanceSkill(s, 'proposed').skill;
    s = advanceSkill(s, 'reviewed').skill;
    const noReceipt = advanceSkill(s, 'approved');
    expect(noReceipt.ok).toBe(false);
    expect(noReceipt.reason).toContain('signed receipt');
    expect(noReceipt.skill.lifecycle).toBe('reviewed'); // stays reviewed
    const withReceipt = advanceSkill(s, 'approved', 'receipt:abc123');
    expect(withReceipt.ok).toBe(true);
    expect(withReceipt.skill.lifecycle).toBe('approved');
    expect(withReceipt.skill.receiptRef).toBe('receipt:abc123');
  });

  it('the seed library answers "what skills do you have?" with draft/proposed only (none active)', () => {
    const l = seedSkillLibrary();
    expect(l.summary.total).toBeGreaterThan(0);
    expect(l.summary.byLifecycle.approved).toBe(0); // nothing approved/active
    const s = summarizeSkillLibrary(l);
    expect(s).toContain('NOT weights');
    expect(s).toContain('canExecute=false');
  });

  it('module is pure — no execution/network/fs surface', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'skillLibrary.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|child_process|execFile|exec\(|spawn\s*\(|writeFile|eval\(/);
  });
});
