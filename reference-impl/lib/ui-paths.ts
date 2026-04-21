import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(here, '..', 'config', 'ui-paths.json');

function loadDefaultPatterns(): string[] {
  if (!existsSync(DEFAULT_CONFIG)) return ['site/**'];
  const doc = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf-8')) as { patterns?: string[] };
  return Array.isArray(doc.patterns) ? doc.patterns : ['site/**'];
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = escaped
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${regex}$`);
}

export function loadUiPathsConfig(repoRoot: string): { patterns: string[] } {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'ui-paths.json');
  if (existsSync(consumerPath)) {
    try {
      const doc = JSON.parse(readFileSync(consumerPath, 'utf-8')) as { patterns?: string[] };
      if (Array.isArray(doc.patterns)) {
        return { patterns: doc.patterns };
      }
    } catch {
      // fall through to package default
    }
  }
  return { patterns: loadDefaultPatterns() };
}

export function matchesUiPaths(changedFiles: string[], patterns: string[]): boolean {
  if (changedFiles.length === 0) return false;
  const regexes = patterns.map(globToRegex);
  return changedFiles.some((f) => regexes.some((r) => r.test(f)));
}
