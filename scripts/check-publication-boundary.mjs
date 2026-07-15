// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");

// These paths carry private strategy or lane state. Their presence at the public
// tip is always a hard failure. Public status/checkpoint documents are validated
// by content below instead of being rejected merely because they exist.
const privatePaths = [
  "apps/symbiote/docs/MESH_INBOX.md",
  "apps/symbiote/docs/inbox-archive/2026-07-04-round-reports.md",
  "apps/symbiote/docs/PRIVATE_REPO_HANDOFF.md",
  "apps/symbiote/docs/FUSION_IMPORT_NOTES.md",
  "apps/symbiote/docs/AUKORA_SYMBIOTE_SINGULARITY_PATH.md",
  "apps/symbiote/docs/AUKORA_SOVEREIGN_COMPUTE_MASTER_PLAN.md",
];

const failures = [];
for (const relative of privatePaths) {
  if (fs.existsSync(path.join(root, relative))) failures.push(`private path present: ${relative}`);
}

const blockersPath = path.join(root, "PUBLICATION_BLOCKERS.md");
if (!fs.existsSync(blockersPath)) {
  failures.push("missing public work-in-progress disclosure: PUBLICATION_BLOCKERS.md");
} else {
  const text = fs.readFileSync(blockersPath, "utf8");
  if (!text.includes("This repository is **public**.")) {
    failures.push("PUBLICATION_BLOCKERS.md does not state the repository's public status");
  }
}

const inboxPath = path.join(root, "apps/symbiote/docs/INBOX.md");
if (!fs.existsSync(inboxPath)) {
  failures.push("missing sanitized runtime inbox anchor");
} else {
  const inbox = fs.readFileSync(inboxPath, "utf8");
  if (!inbox.startsWith("# Inbox — voice-safe lane handoff (sanitized)")) {
    failures.push("apps/symbiote/docs/INBOX.md is not the sanitized public anchor");
  }
  if (/^###\s+/m.test(inbox)) {
    failures.push("apps/symbiote/docs/INBOX.md contains committed lane entries");
  }
}

// Quarantine is allowed in the public tree only as an explicitly blocked,
// non-imported engineering candidate. The portable-boundary gate independently
// proves it has no production import edge.
if (!fs.existsSync(path.join(root, "quarantine/nebius-g1/IMPORT_BLOCKERS_R23.md"))) {
  failures.push("G1 quarantine is missing its explicit blocker ledger");
}

const forbiddenInfrastructure = [
  { name: "owner absolute path", re: /(?:\/Users\/peterviviani|[A-Za-z]:\\Users\\peterviviani)/i },
  { name: "private Nebius resource id", re: /\b(?:aijob|aiendpoint|storagebucket|tenant|project)-e[a-z0-9]{8,}\b/i },
  { name: "private storage alias", re: new RegExp("\\barc3-auma-" + "strict-burn\\b", "i") },
];

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const relative of tracked) {
  const full = path.join(root, relative);
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const pattern of forbiddenInfrastructure) {
    if (pattern.re.test(text)) failures.push(`${pattern.name}: ${relative}`);
  }
}

if (failures.length) {
  console.error("publication boundary: BLOCKED");
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`publication boundary: PASS (${tracked.length} tracked paths; sanitized inbox; explicit G1 quarantine)`);
