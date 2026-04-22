import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the plugin root.
 *
 * At runtime, this module lives at <plugin-root>/lib/plugin-path.js (or .ts in dev),
 * so the plugin root is the parent directory.
 *
 * Works under:
 * - dev mode (repo source: <repo>/reference-impl/)
 * - npm install (node_modules/@cloverleaf/reference-impl/)
 * - claude plugin install cache (~/.claude/plugins/cache/cloverleaf-local/cloverleaf/0.4.1/)
 * - legacy symlink into ~/.claude/plugins/cloverleaf/
 * - claude --plugin-dir <path>
 */
export function getPluginRoot(): string {
  return resolve(here, '..');
}
