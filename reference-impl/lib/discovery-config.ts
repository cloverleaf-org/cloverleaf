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
  if (existsSync(override)) {
    return JSON.parse(readFileSync(override, 'utf-8')) as DiscoveryConfig;
  }
  return JSON.parse(readFileSync(PACKAGE_DEFAULT, 'utf-8')) as DiscoveryConfig;
}
