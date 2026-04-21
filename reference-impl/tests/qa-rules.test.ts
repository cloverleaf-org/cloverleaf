import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectTestCommands, loadQaRulesConfig } from '../lib/qa-rules.js';

describe('selectTestCommands', () => {
  let defaultRules: ReturnType<typeof loadQaRulesConfig>;
  let _tmpRoot: string;

  beforeAll(() => {
    _tmpRoot = mkdtempSync(join(tmpdir(), 'clv-qa-rules-default-'));
    defaultRules = loadQaRulesConfig(_tmpRoot);
  });

  afterAll(() => {
    rmSync(_tmpRoot, { recursive: true, force: true });
  });

  it('selects the root test command when a .ts file changes', () => {
    const cmds = selectTestCommands(['src/lib/foo.ts'], defaultRules);
    expect(cmds).toContainEqual(
      expect.objectContaining({ cwd: '.', command: expect.stringMatching(/npm test|vitest/) })
    );
  });

  it('selects the root test command when a .js file changes', () => {
    const cmds = selectTestCommands(['lib/cli.js'], defaultRules);
    expect(cmds).toContainEqual(
      expect.objectContaining({ cwd: '.', command: expect.stringMatching(/npm test|vitest/) })
    );
  });

  it('selects the root test command when a .json file changes', () => {
    const cmds = selectTestCommands(['config/qa-rules.json'], defaultRules);
    expect(cmds).toContainEqual(
      expect.objectContaining({ cwd: '.', command: expect.stringMatching(/npm test|vitest/) })
    );
  });

  it('returns no duplicate commands for multi-file diffs matching the same rule', () => {
    const cmds = selectTestCommands(
      ['src/a.ts', 'src/b.ts', 'lib/c.js'],
      defaultRules
    );
    // All match the single default rule — deduped to 1
    expect(cmds.length).toBe(1);
    expect(cmds[0].cwd).toBe('.');
  });

  it('returns empty array for non-testable changes', () => {
    // .md and .yaml files don't match the default rule's match patterns
    const cmds = selectTestCommands(['.cloverleaf/events/x.md', 'docs/README.md'], defaultRules);
    expect(cmds).toEqual([]);
  });

  it('default rules include at least one rule', () => {
    expect(defaultRules.length).toBeGreaterThanOrEqual(1);
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
    expect(rules.length).toBeGreaterThanOrEqual(1);
    const cwds = rules.map((r) => r.cwd);
    expect(cwds).toContain('.');
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
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores consumer override with invalid JSON', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, 'qa-rules.json'), 'not json');
    const rules = loadQaRulesConfig(repoRoot);
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });
});
