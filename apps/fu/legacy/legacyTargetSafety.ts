import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'runs', 'dist', 'build', '.next', 'target']);
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);
const SECRET_BASENAMES = new Set([
  '.env',
  'credentials',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
]);
const SECRET_SUFFIX = /(?:\.pem|\.key|\.p12|\.pfx|\.jks|\.keystore|\.seed|\.secret)$/i;

function looksSecretBearing(name: string): boolean {
  const lower = name.toLowerCase();
  if (SAFE_ENV_TEMPLATES.has(lower)) return false;
  return SECRET_BASENAMES.has(lower) || lower.startsWith('.env.') || SECRET_SUFFIX.test(lower);
}

/**
 * The old folder scraper is retained only for compatibility. Before it reads any target bytes, this
 * guard refuses secret-shaped files and symlinks. EvidencePackV1 will replace this denylist seam with
 * an explicit allowlist and content-addressed reader.
 */
export function assertLegacyTargetSafe(root: string): void {
  const absoluteRoot = path.resolve(root);
  const rootStat = fs.lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('legacy_target_must_be_a_real_directory');
  }

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(absoluteRoot, full).split(path.sep).join('/');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`legacy_target_symlink_refused:${relative}`);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (stat.isFile() && looksSecretBearing(entry.name)) {
        throw new Error(`legacy_target_secret_file_refused:${relative}`);
      }
    }
  }

  walk(absoluteRoot);
}
