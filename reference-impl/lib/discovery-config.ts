import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DEFAULT = join(here, '..', 'config', 'discovery.json');

export interface DiscoveryConfig {
  docContextUri: string;
  projectId: string;
  idStart: number;
}

export function loadDiscoveryConfig(repoRoot: string): DiscoveryConfig {
  const override = join(repoRoot, '.cloverleaf', 'config', 'discovery.json');
  const fallback = JSON.parse(readFileSync(PACKAGE_DEFAULT, 'utf-8')) as DiscoveryConfig;

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
  };
}
