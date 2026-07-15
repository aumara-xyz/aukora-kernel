#!/usr/bin/env bun
// Create a collision-resistant mesh report file. This intentionally avoids
// editing docs/MESH_INBOX.md, whose newest-top convention creates PR conflicts
// whenever multiple lanes report at once.

import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

type Args = {
  slug: string;
  title: string;
  author: string;
  machine: string;
  date: string;
};

function usage(): never {
  console.error(`usage: bun scripts/mesh-entry.ts --slug <safe-name> --title <title> --author <name> --machine <node> [--date YYYY-MM-DD]

Creates docs/mesh/YYYY-MM-DD/<slug>.md from a short advisory template.
Do not use this for secrets, key bytes, private memory contents, or authority.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) usage();
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) usage();
    args[key.slice(2)] = value;
    i += 1;
  }

  const today = new Date().toISOString().slice(0, 10);
  const parsed = {
    slug: args.slug,
    title: args.title,
    author: args.author,
    machine: args.machine,
    date: args.date ?? today,
  };

  if (!parsed.slug || !parsed.title || !parsed.author || !parsed.machine) usage();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    throw new Error(`date must be YYYY-MM-DD, got ${JSON.stringify(parsed.date)}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(parsed.slug)) {
    throw new Error('slug must be lowercase letters, digits, dot, underscore, or dash, and start with a letter/digit');
  }
  return parsed;
}

function template(args: Args): string {
  return `# ${args.date} — ${args.author} · ${args.machine} · ${args.title}

**Advisory only:** this report can suggest, never authorize. No secrets, key bytes, private memory contents, or authority grants.

**Branches / PRs**
- TODO

**Summary**
- TODO

**Verification**
- TODO

**Action items**
- TODO
`;
}

const repo = resolve(import.meta.dir, '..');
const args = parseArgs(process.argv.slice(2));
const dir = join(repo, 'docs', 'mesh', args.date);
const path = join(dir, `${args.slug}.md`);

mkdirSync(dir, { recursive: true });

if (existsSync(path)) {
  throw new Error(`mesh entry already exists: docs/mesh/${args.date}/${args.slug}.md`);
}

await Bun.write(path, template(args));
console.log(`created docs/mesh/${args.date}/${args.slug}.md`);
