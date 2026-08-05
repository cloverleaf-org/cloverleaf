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

// makeRepo() is risk_class:'low' → the shipped two-lane default routes it to the
// delivery-fast lane (reviewer; security only when security_class:high). The
// delivery-full (high-risk) lane + the ui-when-changes dimension are covered in
// council-backcompat.test.ts. Full back-compat matrix lives there; this block
// pins the fast lane's shape + member defaults.
describe('resolveCouncilPlan — default (low risk) resolves the fast lane (REGRESSION GUARD)', () => {
  let repoRoot: string;
  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  it('low risk + low security → delivery-fast, reviewer only', () => {
    repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.profile).toBe('delivery-fast');
    expect(plan.mode).toBe('decisive');
    expect(plan.aggregation).toBe('any-veto');
    expect(plan.on_round_bounce).toBe('stop');
    expect(plan.rounds.map((r) => r.map((x) => x.member))).toEqual([['reviewer']]);
  });

  it('low risk + declared high security → security member becomes active', () => {
    repoRoot = makeRepo({ security_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.profile).toBe('delivery-fast');
    expect(plan.rounds.map((r) => r.map((x) => x.member))).toEqual([['reviewer'], ['security']]);
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

// The runner substitutes a fixed five tokens ({{task}}, {{branch}}, {{base_branch}},
// {{repo_root}}, {{diff}}) into every member prompt — a set complete only for
// security-reviewer.md. reviewer.md declares {{test_rules}}, qa.md {{qa_rules}}, and
// ui-reviewer.md {{affected_routes}} / {{preview_port}} / {{ui_review_config}}. These
// pin the per-member map that carries them, so a prompt gaining a token is a change
// in TS with a test behind it rather than silent drift in skill prose.
describe('resolveCouncilPlan — per-member prompt substitutions', () => {
  let repoRoot: string;
  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  const memberOf = (plan: ReturnType<typeof resolveCouncilPlan>, id: string) =>
    plan.rounds.flat().find((m) => m.member === id);

  it('gives the reviewer member its test_rules token', () => {
    repoRoot = makeRepo();
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    const reviewer = memberOf(plan, 'reviewer');
    expect(reviewer).toBeDefined();
    expect(Object.keys(reviewer!.substitutions)).toContain('test_rules');
    expect(() => JSON.parse(reviewer!.substitutions.test_rules)).not.toThrow();
  });

  it('gives the qa member its qa_rules token', () => {
    repoRoot = makeRepo({ risk_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    const qa = memberOf(plan, 'qa');
    expect(qa).toBeDefined();
    expect(Object.keys(qa!.substitutions)).toContain('qa_rules');
  });

  // reviewer.md and qa.md both document their token as a JSON *object* `{ rules: [...] }`.
  // 0.10.1 shipped a fix because qa.md had described it as a bare array, and an agent
  // iterating a non-existent top-level array is the bug that fix closed. Emitting
  // loadQaRulesConfig()'s QaRule[] here would silently re-open it.
  it('emits test_rules/qa_rules as the { rules: [...] } object, never a bare array', () => {
    repoRoot = makeRepo({ risk_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    for (const [id, token] of [['reviewer', 'test_rules'], ['qa', 'qa_rules']] as const) {
      const doc = JSON.parse(memberOf(plan, id)!.substitutions[token]);
      expect(Array.isArray(doc)).toBe(false);
      expect(Array.isArray(doc.rules)).toBe(true);
    }
  });

  // Same precedence the standalone cloverleaf-review / cloverleaf-qa skills use:
  // the consumer's .cloverleaf/config/qa-rules.json wins over the shipped default.
  // This is the 0.10.0 test-runner agnosticism that F3 left inert on the council path.
  it('honors a consumer qa-rules.json override for both tokens', () => {
    repoRoot = makeRepo({ risk_class: 'high' });
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'config', 'qa-rules.json'),
      JSON.stringify({ rules: [{ cwd: 'api', match: ['**/*.py'], command: 'pytest -q' }] }),
    );
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(JSON.parse(memberOf(plan, 'reviewer')!.substitutions.test_rules).rules[0].command).toBe('pytest -q');
    expect(JSON.parse(memberOf(plan, 'qa')!.substitutions.qa_rules).rules[0].command).toBe('pytest -q');
  });

  it('does not give the security member tokens its prompt has no placeholder for', () => {
    repoRoot = makeRepo({ security_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    const security = memberOf(plan, 'security');
    expect(security).toBeDefined();
    expect(security!.substitutions).toEqual({});
  });

  it('gives the ui member affected_routes + ui_review_config', () => {
    repoRoot = makeRepo({ risk_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: ['src/pages/faq.astro'] });
    const ui = memberOf(plan, 'ui');
    expect(ui).toBeDefined();
    // Byte-identical to what `cloverleaf-cli affected-routes` prints, so the token
    // reads the same on the council path and the standalone path.
    expect(ui!.substitutions.affected_routes).toBe('["/faq/"]');
    expect(JSON.parse(ui!.substitutions.ui_review_config).viewports.desktop).toEqual({ width: 1280, height: 800 });
  });

  it("encodes a global-pattern change as the \"all\" sentinel, not an array", () => {
    repoRoot = makeRepo({ risk_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: ['src/components/Nav.astro'] });
    expect(memberOf(plan, 'ui')!.substitutions.affected_routes).toBe('"all"');
  });

  // There is no configured preview port and no side-effect-free resolver for one —
  // lib/ports.ts exposes only getFreePort(), which *allocates*. Planning stays pure,
  // so the token is omitted rather than fabricated; the runner allocates at dispatch.
  it('omits preview_port — planning must not allocate a port', () => {
    repoRoot = makeRepo({ risk_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: ['src/pages/faq.astro'] });
    expect(Object.keys(memberOf(plan, 'ui')!.substitutions)).not.toContain('preview_port');
  });

  it('is deterministic — resolving twice yields identical substitutions', () => {
    repoRoot = makeRepo({ risk_class: 'high', security_class: 'high' });
    const opts = { changedFiles: ['src/pages/faq.astro'] };
    const a = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', opts);
    const b = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', opts);
    expect(a.rounds.flat().map((m) => m.substitutions)).toEqual(b.rounds.flat().map((m) => m.substitutions));
  });

  it('gives an unknown custom member id an empty map rather than a guessed one', () => {
    repoRoot = makeRepo();
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'prompts'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'prompts', 'perf.md'), '# perf');
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { p: { rounds: [[{ member: 'perf', prompt: 'perf.md' }]], aggregation: 'any-veto' } },
      gates: { 'task.review': 'p' },
    }));
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.rounds[0][0].substitutions).toEqual({});
  });

  it('every substituted value is a string — substitution is textual', () => {
    repoRoot = makeRepo({ risk_class: 'high', security_class: 'high' });
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: ['src/pages/faq.astro'] });
    const values = plan.rounds.flat().flatMap((m) => Object.values(m.substitutions));
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'string')).toBe(true);
  });
});
