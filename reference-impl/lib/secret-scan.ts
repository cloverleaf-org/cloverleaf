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
  const raw = Array.isArray(doc.patterns) ? doc.patterns : [];
  const validSeverities = new Set(['error', 'blocker']);
  const patterns = raw.filter(
    (p): p is SecretPattern =>
      typeof (p as SecretPattern).name === 'string' && (p as SecretPattern).name.length > 0 &&
      typeof (p as SecretPattern).regex === 'string' && (p as SecretPattern).regex.length > 0 &&
      validSeverities.has((p as SecretPattern).severity),
  );
  return {
    patterns,
    placeholder_excludes: Array.isArray(doc.placeholder_excludes)
      ? (doc.placeholder_excludes as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
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
  // Support (?i) inline flag prefix (not valid in JS) by converting to the 'i' flag.
  // Only a *leading* (?i) is supported; any occurrence elsewhere is almost certainly
  // a mistake (it would be a JS syntax error) — reject it with a clear message.
  const original = pattern;
  let flags = '';
  if (pattern.startsWith('(?i)')) {
    pattern = pattern.slice(4);
    flags = 'i';
  }
  if (pattern.includes('(?i)')) {
    throw new Error('secret-scan: inline (?i) flag is only supported as a leading prefix: ' + original);
  }
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error('secret-scan: invalid pattern regex /' + pattern + '/: ' + (err as Error).message);
  }
}

export function scanSecrets(text: string, config: SecretPatternsConfig, file?: string): SecretFinding[] {
  const excludes = config.placeholder_excludes.map((p) => compileRegex(p));
  const compiled = config.patterns.map((p) => ({ ...p, re: compileRegex(p.regex) }));
  const findings: SecretFinding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    // Deliberate line-level tradeoff: a line matching any exclude pattern is
    // skipped entirely.  If a real secret happens to share a line with a
    // placeholder token (e.g. a comment), it becomes a false-negative.
    // This keeps precision high and avoids alert fatigue from generated files.
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
