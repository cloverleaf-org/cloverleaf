import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DEFAULT = join(here, '..', 'config', 'discovery.json');

export interface DiscoveryConfig {
  docContextUri: string;
  projectId: string;
  idStart: number;
  prep_copy_dirs: string[];
}

export function loadDiscoveryConfig(repoRoot: string): DiscoveryConfig {
  const override = join(repoRoot, '.cloverleaf', 'config', 'discovery.json');
  const rawFallback = JSON.parse(readFileSync(PACKAGE_DEFAULT, 'utf-8')) as Partial<DiscoveryConfig>;
  const fallback: DiscoveryConfig = {
    docContextUri: typeof rawFallback.docContextUri === 'string' ? rawFallback.docContextUri : '',
    projectId: typeof rawFallback.projectId === 'string' ? rawFallback.projectId : '',
    idStart: typeof rawFallback.idStart === 'number' ? rawFallback.idStart : 1,
    prep_copy_dirs: Array.isArray(rawFallback.prep_copy_dirs)
      ? (rawFallback.prep_copy_dirs as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
  };

  if (existsSync(override)) {
    try {
      const doc = JSON.parse(readFileSync(override, 'utf-8')) as Partial<DiscoveryConfig>;
      return normalise(doc, fallback);
    } catch {
      // Malformed consumer JSON — fall through to package default.
    }
  }
  return fallback;
}

function normalise(doc: Partial<DiscoveryConfig>, fallback: DiscoveryConfig): DiscoveryConfig {
  return {
    docContextUri: typeof doc.docContextUri === 'string' ? doc.docContextUri : fallback.docContextUri,
    projectId:     typeof doc.projectId     === 'string' ? doc.projectId     : fallback.projectId,
    idStart:       typeof doc.idStart       === 'number' ? doc.idStart       : fallback.idStart,
    prep_copy_dirs: Array.isArray(doc.prep_copy_dirs)
      ? (doc.prep_copy_dirs as unknown[]).filter((p): p is string => typeof p === 'string')
      : fallback.prep_copy_dirs,
  };
}
