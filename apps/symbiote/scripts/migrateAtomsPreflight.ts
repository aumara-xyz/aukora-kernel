// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// M4 prep — migration preflight CLI (READ-ONLY, structurally incapable of writing: no transport,
// no Convex, no key custody imports — see core/src/migrationPreflight.ts header). Prints the full
// preflight report as JSON; exits 1 on wholesale abort. The M4 EXECUTOR does not exist yet and
// stays unbuilt until M2b (owner-ratified erasure) is green.
//
//   bun scripts/migrateAtomsPreflight.ts [ownerRootId]
//     brain path: $AUKORA_KIRA_STATE or state/kira/brain.json (via defaultKiraStatePath)
//     ownerRootId: the target root namespace on the local kernel (default: root.local — the
//     REAL owner root id is a deployment decision made at M4 execution, not here; the plan's
//     hashes bind whichever id is passed, so re-run preflight with the final id before executing)
import { defaultKiraStatePath } from '../core/src/kiraBrain';
import { migrationPreflightFromFile } from '../core/src/migrationPreflight';

const ownerRootId = process.argv[2] ?? 'root.local';
try {
  const report = migrationPreflightFromFile(defaultKiraStatePath(), ownerRootId);
  // full entries list can be long; print summary first, then entries — both on stdout, still one JSON doc
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  process.stderr.write(`migration_preflight_failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
