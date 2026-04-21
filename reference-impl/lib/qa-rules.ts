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

export function loadQaRulesConfig(repoRoot: string): QaRule[] {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'qa-rules.json');
  if (existsSync(consumerPath)) {
    try {
      const doc = JSON.parse(readFileSync(consumerPath, 'utf-8')) as { rules?: QaRule[] };
      if (Array.isArray(doc.rules)) {
        return doc.rules;
      }
    } catch {
      // fall through
    }
  }
  return loadDefaultRules();
}

export function selectTestCommands(changedFiles: string[], rules: QaRule[]): QaRule[] {
  return rules.filter((rule) => matchesUiPaths(changedFiles, rule.match));
}
