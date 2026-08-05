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

function loadDefaultRules(): QaRule[] {
  if (!existsSync(DEFAULT_CONFIG)) return [];
  const doc = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf-8')) as { rules?: QaRule[] };
  return Array.isArray(doc.rules) ? doc.rules : [];
}

export interface QaRulesDocument {
  rules: QaRule[];
}

/**
 * The qa-rules document in the shape the prompts consume it: the `{ rules: [...] }`
 * object, not a bare array. `reviewer.md` ({{test_rules}}), `implementer.md`
 * ({{test_rules}}) and `qa.md` ({{qa_rules}}) all document the token as an object —
 * 0.10.1 shipped a fix precisely because `qa.md` had described it as an array, and an
 * agent iterating a non-existent top-level array is the bug that fix closed. Callers
 * substituting one of those tokens must stringify THIS, never `loadQaRulesConfig()`.
 *
 * Precedence matches what the standalone skills `cat`: the consumer's
 * `.cloverleaf/config/qa-rules.json` when it exists and parses to a `rules` array,
 * otherwise the packaged default.
 */
export function loadQaRulesDocument(repoRoot: string): QaRulesDocument {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'qa-rules.json');
  if (existsSync(consumerPath)) {
    try {
      const doc = JSON.parse(readFileSync(consumerPath, 'utf-8')) as { rules?: QaRule[] };
      if (Array.isArray(doc.rules)) {
        return { rules: doc.rules };
      }
    } catch {
      // fall through
    }
  }
  return { rules: loadDefaultRules() };
}

/** The rules array alone, for callers that select/execute commands rather than prompt with them. */
export function loadQaRulesConfig(repoRoot: string): QaRule[] {
  return loadQaRulesDocument(repoRoot).rules;
}

export function selectTestCommands(changedFiles: string[], rules: QaRule[]): QaRule[] {
  return rules.filter((rule) => matchesUiPaths(changedFiles, rule.match));
}
