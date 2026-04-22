import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { rfcsDir } from './paths.js';
import { validateOrThrow } from './validate.js';
import { advanceWorkItemStatus } from './work-item.js';
import type { StatusTransitions } from '@cloverleaf/standard/validators/index.js';

const req = createRequire(import.meta.url);

export interface RfcDoc {
  type: 'rfc';
  project: string;
  id: string;
  title: string;
  status: string;
  owner: { kind: 'agent' | 'human' | 'system'; id: string };
  problem: string;
  solution: string;
  unknowns: string[];
  acceptance_criteria: string[];
  out_of_scope: string[];
  [key: string]: unknown;
}

export function loadRfc(repoRoot: string, id: string): RfcDoc {
  const path = join(rfcsDir(repoRoot), `${id}.json`);
  if (!existsSync(path)) throw new Error(`RFC ${id} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as RfcDoc;
}

export function saveRfc(repoRoot: string, rfc: RfcDoc): void {
  validateOrThrow('https://cloverleaf.example/schemas/rfc.schema.json', rfc);
  const path = join(rfcsDir(repoRoot), `${rfc.id}.json`);
  writeFileSync(path, JSON.stringify(rfc, null, 2) + '\n');
}

function loadRfcStateMachine(): StatusTransitions {
  const pkgPath = req.resolve('@cloverleaf/standard/package.json');
  const pkgDir = pkgPath.replace(/\/package\.json$/, '');
  return JSON.parse(readFileSync(`${pkgDir}/state-machines/rfc.json`, 'utf-8')) as StatusTransitions;
}

export function advanceRfcStatus(
  repoRoot: string,
  id: string,
  toStatus: string,
  actor: 'agent' | 'human',
  options: { gate?: string } = {}
): RfcDoc {
  const rfc = loadRfc(repoRoot, id);
  const from = rfc.status;
  const sm = loadRfcStateMachine();
  const fixture = { type: 'rfc', id: rfc.id, project: rfc.project, status: rfc.status };

  const proposed = { ...rfc, status: toStatus };
  advanceWorkItemStatus({
    repoRoot,
    workItemType: 'rfc',
    project: rfc.project,
    id: rfc.id,
    from,
    to: toStatus,
    actor,
    stateMachine: sm,
    validateFixture: fixture,
    save: (p) => saveRfc(repoRoot, p as RfcDoc),
    proposed,
    gate: options.gate,
  });
  return proposed;
}
