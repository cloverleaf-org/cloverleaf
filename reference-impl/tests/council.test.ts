import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync as _git } from 'node:child_process';
import { resolveCouncilPlan, resolveBinding, evaluateWhen, resolveChangedFiles, resolveMemberPrompt } from '../lib/council.js';

function makeRepo(taskOverrides: Record<string, unknown> = {}): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'clv-council-'));
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify({
      id: 'DEMO-001',
      type: 'task',
      status: 'council',
      owner: { kind: 'agent', id: 'unassigned' },
      project: 'DEMO',
      title: 'demo',
      context: {},
      acceptance_criteria: ['a'],
      definition_of_done: ['d'],
      risk_class: 'low',
      ...taskOverrides,
    }),
  );
  return repoRoot;
}

describe('evaluateWhen', () => {
  it('always / undefined → true', () => {
    expect(evaluateWhen('always', { securityHigh: false, uiChanges: false })).toBe(true);
    expect(evaluateWhen(undefined, { securityHigh: false, uiChanges: false })).toBe(true);
  });
  it('security_class:high follows securityHigh', () => {
    expect(evaluateWhen('security_class:high', { securityHigh: true, uiChanges: false })).toBe(true);
    expect(evaluateWhen('security_class:high', { securityHigh: false, uiChanges: false })).toBe(false);
  });
  it('ui_changes follows uiChanges', () => {
    expect(evaluateWhen('ui_changes', { securityHigh: false, uiChanges: true })).toBe(true);
  });
});

describe('resolveBinding', () => {
  it('string → that profile, decisive', () => {
    expect(resolveBinding('code-review', { risk_class: 'low' })).toEqual({ profile: 'code-review', mode: 'decisive' });
  });
  it('{profile, mode}', () => {
    expect(resolveBinding({ profile: 'p', mode: 'advisory' }, { risk_class: 'low' })).toEqual({ profile: 'p', mode: 'advisory' });
  });
  it('conditional selector by risk_class with wildcard fallback', () => {
    const b = { by: 'risk_class', map: { high: 'strict', '*': 'default' } };
    expect(resolveBinding(b, { risk_class: 'high' }).profile).toBe('strict');
    expect(resolveBinding(b, { risk_class: 'low' }).profile).toBe('default');
  });
  it('undefined binding → no council', () => {
    expect(resolveBinding(undefined, { risk_class: 'low' })).toEqual({ profile: null, mode: 'decisive' });
  });
});

describe('resolveCouncilPlan — default council reproduces today (REGRESSION GUARD)', () => {
  let repoRoot: string;
  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  it('low security + no UI changes → reviewer, then qa only', () => {
    repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.profile).toBe('default');
    expect(plan.mode).toBe('decisive');
    expect(plan.aggregation).toBe('any-veto');
    expect(plan.on_round_bounce).toBe('stop');
    expect(plan.rounds.map((r) => r.map((x) => x.member))).toEqual([['reviewer'], ['qa']]);
  });

  it('declared high security → security member becomes active', () => {
    repoRoot = makeRepo({ security_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.rounds.map((r) => r.map((x) => x.member))).toEqual([['reviewer'], ['security', 'qa']]);
  });

  it('no binding for an unknown gate → empty plan (today behavior)', () => {
    repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.final_gate', { changedFiles: [] });
    expect(plan.profile).toBeNull();
    expect(plan.rounds).toEqual([]);
  });

  it('members carry resolved blocking/weight defaults', () => {
    repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.rounds[0][0]).toEqual(expect.objectContaining({ member: 'reviewer', blocking: true, weight: 1 }));
  });
});

describe('resolveCouncilPlan — source + unknown profile', () => {
  it("default config → source 'default'", () => {
    const repoRoot = makeRepo();
    expect(resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] }).source).toBe('default');
  });
  it("consumer config → source 'consumer'", () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'),
      JSON.stringify({ profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } }, gates: { 'task.review': 'p' } }));
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.source).toBe('consumer');
    expect(plan.profile).toBe('p');
  });
  it('unknown profile in a consumer file → empty plan + stderr notice', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'),
      JSON.stringify({ profiles: {}, gates: { 'task.review': 'ghost' } }));
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.profile).toBeNull();
    expect(plan.source).toBe('consumer');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("profile 'ghost'"));
    spy.mockRestore();
  });
});

describe('resolveMemberPrompt', () => {
  it('built-in ids resolve to their shipped prompt files', () => {
    expect(resolveMemberPrompt({ member: 'reviewer' }, '/x').endsWith('/prompts/reviewer.md')).toBe(true);
    expect(resolveMemberPrompt({ member: 'security' }, '/x').endsWith('/prompts/security-reviewer.md')).toBe(true);
    expect(resolveMemberPrompt({ member: 'ui' }, '/x').endsWith('/prompts/ui-reviewer.md')).toBe(true);
    expect(resolveMemberPrompt({ member: 'qa' }, '/x').endsWith('/prompts/qa.md')).toBe(true);
  });
  it('a custom member resolves under .cloverleaf/prompts and exist-checks', () => {
    const repo = mkdtempSync(join(tmpdir(), 'clv-custom-'));
    try {
      mkdirSync(join(repo, '.cloverleaf', 'prompts'), { recursive: true });
      writeFileSync(join(repo, '.cloverleaf', 'prompts', 'perf-reviewer.md'), '# perf');
      expect(resolveMemberPrompt({ member: 'perf', prompt: 'perf-reviewer.md' }, repo))
        .toBe(join(repo, '.cloverleaf', 'prompts', 'perf-reviewer.md'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
  it('throws when a custom prompt file is missing', () => {
    const repo = mkdtempSync(join(tmpdir(), 'clv-missing-'));
    try {
      expect(() => resolveMemberPrompt({ member: 'perf', prompt: 'nope.md' }, repo)).toThrow(/not found/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
  it('throws for an unknown id with no prompt', () => {
    expect(() => resolveMemberPrompt({ member: 'mystery' }, '/x')).toThrow(/unknown member/);
  });
});

describe('resolveCouncilPlan — members carry a resolved promptPath', () => {
  it('default reviewer member has a built-in promptPath', () => {
    const repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.rounds[0][0]).toEqual(expect.objectContaining({ member: 'reviewer', blocking: true, weight: 1 }));
    expect(plan.rounds[0][0].promptPath.endsWith('/prompts/reviewer.md')).toBe(true);
  });
});

describe('resolveCouncilPlan — chair aggregation threading', () => {
  it('a chair profile emits aggregation=chair + built-in chair promptPath', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { cr: { rounds: [[{ member: 'reviewer' }, { member: 'qa' }]], aggregation: 'chair' } },
      gates: { 'task.review': 'cr' },
    }));
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.aggregation).toBe('chair');
    expect(plan.chair?.promptPath.endsWith('/prompts/chair.md')).toBe(true);
  });
  it('a custom chair.prompt resolves under .cloverleaf/prompts', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'prompts'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'prompts', 'strict-chair.md'), '# strict');
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { cr: { rounds: [[{ member: 'reviewer' }]], aggregation: 'chair', chair: { prompt: 'strict-chair.md' } } },
      gates: { 'task.review': 'cr' },
    }));
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.chair?.promptPath).toBe(join(repoRoot, '.cloverleaf', 'prompts', 'strict-chair.md'));
  });
  it('a non-chair profile has no chair field', () => {
    const repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.aggregation).toBe('any-veto');
    expect(plan.chair).toBeUndefined();
  });
});

describe('resolveChangedFiles git path — hardened against spaces in repoRoot', () => {
  it('returns changed files via real git when repoRoot contains a space', () => {
    const base = mkdtempSync(join(tmpdir(), 'clv-rcf-'));
    const repoRoot = join(base, 'dir with space');
    mkdirSync(repoRoot, { recursive: true });
    const git = (args: string[]) => _git('git', ['-C', repoRoot, ...args], { stdio: 'pipe' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
    writeFileSync(join(repoRoot, 'a.txt'), 'x'); git(['add', '.']); git(['commit', '-qm', 'init']);
    git(['checkout', '-q', '-b', 'cloverleaf/DEMO-001']);
    writeFileSync(join(repoRoot, 'b.txt'), 'y'); git(['add', '.']); git(['commit', '-qm', 'b']);

    expect(resolveChangedFiles(repoRoot, 'DEMO-001')).toEqual(['b.txt']);
  });
});
