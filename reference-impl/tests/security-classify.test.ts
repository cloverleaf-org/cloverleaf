import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecurityPathsConfig, matchesSensitivePath, matchesSensitiveKeyword, computeSecurityClassification, classifyTaskSecurity, __setMockChangedFiles } from '../lib/security-classify.js';

const cfg = loadSecurityPathsConfig(process.cwd());

describe('matchesSensitivePath', () => {
  it('matches a .env file', () => {
    expect(matchesSensitivePath('config/.env.paper', cfg)).toBe(true);
  });
  it('matches a deploy script', () => {
    expect(matchesSensitivePath('scripts/deploy.sh', cfg)).toBe(true);
  });
  it('matches an SQL migration', () => {
    expect(matchesSensitivePath('engine/migrations/011_x.sql', cfg)).toBe(true);
  });
  it('matches a prompt file (artifact integrity)', () => {
    expect(matchesSensitivePath('reference-impl/prompts/reviewer.md', cfg)).toBe(true);
  });
  it('does NOT match an ordinary source file', () => {
    expect(matchesSensitivePath('engine/loop.py', cfg)).toBe(false);
  });
});

describe('matchesSensitiveKeyword', () => {
  it('matches a brief mentioning credentials', () => {
    expect(matchesSensitiveKeyword('Wire Binance credentials into the engine', cfg)).toBe(true);
  });
  it('matches "api key"', () => {
    expect(matchesSensitiveKeyword('store the api key safely', cfg)).toBe(true);
  });
  it('does NOT match a benign brief', () => {
    expect(matchesSensitiveKeyword('refactor the candle buffer warmup', cfg)).toBe(false);
  });
});

describe('computeSecurityClassification', () => {
  it('declared high → effective high regardless of diff', () => {
    const r = computeSecurityClassification('high', [], cfg);
    expect(r.effective).toBe('high');
    expect(r.declared).toBe('high');
  });
  it('declared low + sensitive path → effective high (diff_detected)', () => {
    const r = computeSecurityClassification('low', ['scripts/deploy.sh', 'engine/loop.py'], cfg);
    expect(r.diff_detected).toBe(true);
    expect(r.effective).toBe('high');
    expect(r.matched_paths).toContain('scripts/deploy.sh');
    expect(r.matched_paths).not.toContain('engine/loop.py');
  });
  it('declared low + benign diff → effective low', () => {
    const r = computeSecurityClassification('low', ['engine/loop.py', 'README.md'], cfg);
    expect(r.diff_detected).toBe(false);
    expect(r.effective).toBe('low');
    expect(r.matched_paths).toEqual([]);
  });
  it('declared low + empty diff → effective low', () => {
    expect(computeSecurityClassification('low', [], cfg).effective).toBe('low');
  });
});

describe('loadSecurityPathsConfig', () => {
  it('loads the shipped default', () => {
    expect(cfg.path_patterns.length).toBeGreaterThan(0);
    expect(cfg.keyword_patterns.length).toBeGreaterThan(0);
  });
  it('falls back to the default when the consumer override is malformed JSON', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cloverleaf-test-'));
    try {
      mkdirSync(join(tmp, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(join(tmp, '.cloverleaf', 'config', 'security-paths.json'), '{ not valid json');
      const result = loadSecurityPathsConfig(tmp);
      expect(result.path_patterns.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('classifyTaskSecurity', () => {
  let repoRoot: string;

  function writeTask(
    id: string,
    securityClass?: 'low' | 'high'
  ): void {
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    const doc: Record<string, unknown> = {
      type: 'task',
      id,
      project: 'T',
      status: 'automated-gates',
      owner: { kind: 'agent', id: 'implementer' },
      title: 'test',
      context: { rfc: { project: 'T', id: 'T-RFC-1' } },
      acceptance_criteria: ['ac'],
      definition_of_done: ['dod'],
      risk_class: 'low',
    };
    if (securityClass !== undefined) {
      doc.security_class = securityClass;
    }
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${id}.json`),
      JSON.stringify(doc) + '\n'
    );
  }

  afterEach(() => {
    // Always clear the mock after each test.
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('declared=low + injected sensitive file → effective=high, diff_detected=true', () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-cst-'));
    writeTask('T-1', 'low');
    __setMockChangedFiles(['engine/exchange.py', 'scripts/deploy.sh']);
    const result = classifyTaskSecurity(repoRoot, 'T-1');
    expect(result.declared).toBe('low');
    expect(result.diff_detected).toBe(true);
    expect(result.effective).toBe('high');
    expect(result.matched_paths).toContain('scripts/deploy.sh');
  });

  it('declared=low + injected benign file → effective=low', () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-cst-'));
    writeTask('T-2', 'low');
    __setMockChangedFiles(['engine/loop.py', 'README.md']);
    const result = classifyTaskSecurity(repoRoot, 'T-2');
    expect(result.declared).toBe('low');
    expect(result.diff_detected).toBe(false);
    expect(result.effective).toBe('low');
  });

  it('declared=high + any file list → effective=high', () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-cst-'));
    writeTask('T-3', 'high');
    __setMockChangedFiles(['engine/loop.py']);
    const result = classifyTaskSecurity(repoRoot, 'T-3');
    expect(result.declared).toBe('high');
    expect(result.effective).toBe('high');
  });

  it('opts.changedFiles overrides mock', () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-cst-'));
    writeTask('T-4', 'low');
    __setMockChangedFiles(['scripts/deploy.sh']); // would be high
    const result = classifyTaskSecurity(repoRoot, 'T-4', { changedFiles: ['README.md'] });
    // opts.changedFiles wins → benign → low
    expect(result.effective).toBe('low');
  });
});
