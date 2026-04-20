import { describe, it, expect } from 'vitest';
import { selectTestCommands, loadDefaultRules } from '../lib/qa-rules.js';

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
