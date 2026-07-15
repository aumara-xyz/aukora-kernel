import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'app', 'shell.js'), 'utf-8');
const style = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'app', 'style.css'), 'utf-8');

function organRows(): string {
  const start = shell.indexOf('const TABS_BUILTIN = {');
  const end = shell.indexOf('\n  system:', start);
  return shell.slice(start, end);
}

describe('shipped Apps catalog', () => {
  it('keeps product apps out of Yours and reserves + New App for the App Lab', () => {
    expect(shell).toContain("wolf: { title: 'The Wolf'");
    expect(shell).toContain("{ organ: 'app-lab', label: '+ New App'");
    expect(organRows()).not.toContain("{ organ: 'app-lab'");
  });

  it('puts the owner-prioritized Apps first and keeps Wolf as a built-in app', () => {
    const rows = organRows();
    const ordered = ['luminara', 'aumalive', 'auma', 'ghp', 'arc3', 'wolf', 'media', 'browser', 'graticube'];
    let previous = -1;
    for (const key of ordered) {
      const index = rows.indexOf(`organ: '${key}'`);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(rows).not.toContain("organ: 'agora'");
    expect(rows).not.toContain("organ: 'translate'");
  });

  it('keeps Golden Horizon legible in the constrained Apps lane', () => {
    expect(shell).toContain("label: 'Golden Horizon'");
    expect(style).toContain('.menu-row > span:first-child > span:first-child { white-space: nowrap; }');
  });
});
