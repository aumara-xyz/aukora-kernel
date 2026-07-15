import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildWorkTrackerBoard,
  validateWorkItem,
  type WorkTrackerItem,
} from '../src/workTracker';

const itemsDir = path.resolve(__dirname, '..', 'work-tracker', 'items');

function readSeedItems(): WorkTrackerItem[] {
  return fs.readdirSync(itemsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(itemsDir, file), 'utf-8'));
      const validated = validateWorkItem(raw);
      expect(validated.ok, `${file}: ${validated.reason}`).toBe(true);
      return validated.item!;
    });
}

describe('24Z.88-W: structured work tracker', () => {
  it('validates every seeded work item and forces planning-only authority', () => {
    const items = readSeedItems();
    expect(items.length).toBeGreaterThanOrEqual(6);
    for (const item of items) {
      expect(item.grantsAuthority).toBe(false);
      expect(item.id).toMatch(/^[a-z0-9][a-z0-9._:-]{2,80}$/);
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('builds a UI-ready board with blocked, next, parked, and active lanes', () => {
    const board = buildWorkTrackerBoard(readSeedItems(), '2026-06-28');
    expect(board.grantsAuthority).toBe(false);
    expect(board.total).toBeGreaterThanOrEqual(6);
    expect(board.done.map((i) => i.id)).toContain('24z88-close-high-gaps');
    expect(board.parked.map((i) => i.id)).toContain('skillopt-sleep-sidecar');
    expect(board.next.map((i) => i.id)).toContain('nemo-guardrails-absorption-benchmark');
    expect(board.done.map((i) => i.id)).toContain('24z88-work-tracker-v0');
    expect(board.highRiskOpen).toBeGreaterThanOrEqual(3);
    expect(board.uiItems.every((i) => typeof i.evidenceCount === 'number')).toBe(true);
  });

  it('rejects tracker-rot patterns: done without evidence, blocked without blockers, unsafe ids, and hidden payload keys', () => {
    const base = readSeedItems()[0];
    expect(validateWorkItem({ ...base, status: 'done', evidenceRefs: [] }).ok).toBe(false);
    expect(validateWorkItem({ ...base, status: 'blocked', blockedBy: [] }).ok).toBe(false);
    expect(validateWorkItem({ ...base, id: 'bad id with spaces' }).ok).toBe(false);
    expect(validateWorkItem({ ...base, rawPrompt: 'please hide this' }).ok).toBe(false);
  });

  it('keeps live-apply candidates blocked until separately approved', () => {
    const base = readSeedItems()[0];
    expect(validateWorkItem({ ...base, adoption: 'live_apply_candidate', status: 'planned' }).ok).toBe(false);
    expect(validateWorkItem({ ...base, adoption: 'live_apply_candidate', status: 'blocked', blockedBy: ['explicit future approval missing'] }).ok).toBe(true);
  });
});
