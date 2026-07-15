// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const blockers = [
  "PUBLICATION_BLOCKERS.md",
  "quarantine/nebius-g1",
  "apps/symbiote/docs/INBOX.md",
  "apps/symbiote/docs/MESH_INBOX.md",
  "apps/symbiote/docs/inbox-archive/2026-07-04-round-reports.md",
  "apps/symbiote/docs/PRIVATE_REPO_HANDOFF.md",
  "apps/symbiote/docs/FUSION_IMPORT_NOTES.md",
  "apps/symbiote/docs/AUKORA_SYMBIOTE_SINGULARITY_PATH.md",
  "apps/symbiote/docs/AUKORA_SOVEREIGN_COMPUTE_MASTER_PLAN.md",
];

const present = blockers.filter((relative) => fs.existsSync(path.join(root, relative)));
if (present.length) {
  console.error("publication boundary: BLOCKED");
  for (const relative of present) console.error(`- ${relative}`);
  process.exit(1);
}

console.log("publication boundary: no known private-checkpoint blockers present");

