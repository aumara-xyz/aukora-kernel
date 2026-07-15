// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");

const expected = {
  "apps/fu": { files: 50, digest: "fc7c58546de9208b54449304f5be98a03f4b0f8f7e649e8c0fa6ee49f7a7bedb" },
  "apps/symbiote": { files: 1057, digest: "1a57994d88648466672c0276636dcae0f017c710b7ae809c2987b48a81249650" },
  "quarantine/nebius-g1": { files: 42, digest: "97401175478b8d97e2b0d17cc767d111d441f409f7dec2f39eb1f9531a3a1e36" },
  "research/energy-sensing": { files: 2, digest: "f3342de161e425e39b6d4c16ea9268a4bffdff18c8b753c3cf8349574bfbde25" },
};

function walk(relativeRoot) {
  const base = path.join(root, relativeRoot);
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`source_lock_symlink_refused:${path.relative(root, full)}`);
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) files.push(full);
      else throw new Error(`source_lock_unsupported_entry:${path.relative(root, full)}`);
    }
  };
  visit(base);

  const manifest = files.map((file) => {
    const rel = path.relative(base, file).split(path.sep).join("/");
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return `${rel}\0${digest}\n`;
  }).join("");

  return {
    files: files.length,
    digest: crypto.createHash("sha256").update(manifest, "utf8").digest("hex"),
  };
}

const actual = Object.fromEntries(Object.keys(expected).map((key) => [key, walk(key)]));

if (process.argv.includes("--print")) {
  console.log(JSON.stringify(actual, null, 2));
  process.exit(0);
}

for (const [key, pin] of Object.entries(expected)) {
  const got = actual[key];
  if (got.files !== pin.files || got.digest !== pin.digest) {
    throw new Error(`source_lock_mismatch:${key}:expected=${JSON.stringify(pin)}:actual=${JSON.stringify(got)}`);
  }
}

console.log("organism source locks: verified");
