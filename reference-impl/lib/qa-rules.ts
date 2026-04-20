import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchesUiPaths } from './ui-paths.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(here, '..', 'config', 'qa-rules.json');

export interface QaRule {
  cwd: string;
  match: string[];
  command: string;
}

export function loadDefaultRules(): QaRule[] {
  if (!existsSync(DEFAULT_CONFIG)) return [];
  const doc = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf-8')) as { rules?: QaRule[] };
  return Array.isArray(doc.rules) ? doc.rules : [];
}

export function selectTestCommands(changedFiles: string[], rules: QaRule[]): QaRule[] {
  return rules.filter((rule) => matchesUiPaths(changedFiles, rule.match));
}
