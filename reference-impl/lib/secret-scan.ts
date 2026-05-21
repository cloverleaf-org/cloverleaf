import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(here, '..', 'config', 'secret-patterns.json');

export interface SecretPattern { name: string; regex: string; severity: 'error' | 'blocker'; }
export interface SecretPatternsConfig { patterns: SecretPattern[]; placeholder_excludes: string[]; }

export interface SecretFinding {
  severity: 'error' | 'blocker';
  message: string;
  rule: string;
  location?: { file?: string; line?: number };
}

function normalize(doc: Partial<SecretPatternsConfig>): SecretPatternsConfig {
  return {
    patterns: Array.isArray(doc.patterns) ? doc.patterns : [],
    placeholder_excludes: Array.isArray(doc.placeholder_excludes) ? doc.placeholder_excludes : [],
  };
}

export function loadSecretPatternsConfig(repoRoot: string): SecretPatternsConfig {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'secret-patterns.json');
  const path = existsSync(consumerPath) ? consumerPath : DEFAULT_CONFIG;
  if (!existsSync(path)) throw new Error(`secret-patterns config not found at ${path}`);
  return normalize(JSON.parse(readFileSync(path, 'utf-8')) as Partial<SecretPatternsConfig>);
}

/**
 * Scan text (typically the added/changed lines of a diff) for secrets.
 * A line that matches any placeholder_exclude is skipped entirely (env refs,
 * templates, obvious placeholders), keeping precision high.
 */
function compileRegex(pattern: string): RegExp {
  // Support (?i) inline flag prefix (not valid in JS) by converting to the 'i' flag
  if (pattern.startsWith('(?i)')) return new RegExp(pattern.slice(4), 'i');
  return new RegExp(pattern);
}

export function scanSecrets(text: string, config: SecretPatternsConfig, file?: string): SecretFinding[] {
  const excludes = config.placeholder_excludes.map((p) => compileRegex(p));
  const compiled = config.patterns.map((p) => ({ ...p, re: compileRegex(p.regex) }));
  const findings: SecretFinding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (excludes.some((re) => re.test(line))) return;
    for (const p of compiled) {
      if (p.re.test(line)) {
        findings.push({
          severity: p.severity,
          rule: p.name,
          message: `Possible hardcoded secret (${p.name}) on line ${idx + 1}`,
          location: { ...(file ? { file } : {}), line: idx + 1 },
        });
      }
    }
  });
  return findings;
}
