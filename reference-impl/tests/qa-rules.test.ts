import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectTestCommands, loadDefaultRules, loadQaRulesConfig } from '../lib/qa-rules.js';

describe('selectTestCommands', () => {
  const defaultRules = loadDefaultRules();

  it('selects standard/ test command when standard paths changed', () => {
    const cmds = selectTestCommands(['standard/src/foo.ts'], defaultRules);
    expect(cmds).toContainEqual(
      expect.objectContaining({ cwd: 'standard', command: expect.stringMatching(/npm test|vitest/) })
    );
  });

  it('selects reference-impl/ test command when reference-impl paths changed', () => {
    const cmds = selectTestCommands(['reference-impl/lib/cli.ts'], defaultRules);
    expect(cmds).toContainEqual(
      expect.objectContaining({ cwd: 'reference-impl', command: expect.stringMatching(/npm test|vitest/) })
    );
  });

  it('selects site/ build command when site paths changed', () => {
    const cmds = selectTestCommands(['site/src/index.astro'], defaultRules);
    expect(cmds).toContainEqual(
      expect.objectContaining({ cwd: 'site', command: expect.stringMatching(/build/) })
    );
  });

  it('selects multiple commands for multi-package diffs', () => {
    const cmds = selectTestCommands(
      ['standard/src/a.ts', 'reference-impl/lib/b.ts'],
      defaultRules
    );
    expect(cmds.length).toBe(2);
    expect(cmds.map((c) => c.cwd).sort()).toEqual(['reference-impl', 'standard']);
  });

  it('returns empty array for non-testable changes', () => {
    const cmds = selectTestCommands(['.cloverleaf/events/x.json'], defaultRules);
    expect(cmds).toEqual([]);
  });

  it('default rules include the three packages', () => {
    expect(defaultRules.length).toBeGreaterThanOrEqual(3);
    const cwds = defaultRules.map((r) => r.cwd);
    expect(cwds).toContain('standard');
    expect(cwds).toContain('reference-impl');
    expect(cwds).toContain('site');
  });
});

describe('loadQaRulesConfig', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-qa-rules-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns package default when consumer override is absent', () => {
    const rules = loadQaRulesConfig(repoRoot);
    const cwds = rules.map((r) => r.cwd);
    expect(cwds).toContain('standard');
    expect(cwds).toContain('reference-impl');
    expect(cwds).toContain('site');
  });

  it('returns consumer override when present', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      join(overrideDir, 'qa-rules.json'),
      JSON.stringify({
        rules: [
          { cwd: 'apps/web', match: ['apps/web/**'], command: 'pnpm test' }
        ]
      })
    );
    const rules = loadQaRulesConfig(repoRoot);
    expect(rules.length).toBe(1);
    expect(rules[0].cwd).toBe('apps/web');
    expect(rules[0].command).toBe('pnpm test');
  });

  it('ignores consumer override with missing rules array', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, 'qa-rules.json'), JSON.stringify({ foo: 'bar' }));
    const rules = loadQaRulesConfig(repoRoot);
    expect(rules.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores consumer override with invalid JSON', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, 'qa-rules.json'), 'not json');
    const rules = loadQaRulesConfig(repoRoot);
    expect(rules.length).toBeGreaterThanOrEqual(3);
  });
});
