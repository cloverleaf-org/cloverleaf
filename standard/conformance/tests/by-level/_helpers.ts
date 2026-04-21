import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Sidecar {
  levels: string[];
  fixture_of: string;
}

export function readSidecar(jsonPath: string): Sidecar | null {
  const metaPath = jsonPath.replace(/\.json$/, '.meta.json');
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, 'utf-8')) as Sidecar;
}

export function walkExamples(root: string): Array<{ schemaName: string; jsonPath: string; sidecar: Sidecar | null }> {
  const out: Array<{ schemaName: string; jsonPath: string; sidecar: Sidecar | null }> = [];
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root)) {
    const subdir = resolve(root, dir);
    if (!statSync(subdir).isDirectory()) continue;
    for (const f of readdirSync(subdir).filter((x) => x.endsWith('.json') && !x.endsWith('.meta.json'))) {
      const jsonPath = resolve(subdir, f);
      out.push({ schemaName: dir, jsonPath, sidecar: readSidecar(jsonPath) });
    }
  }
  return out;
}
