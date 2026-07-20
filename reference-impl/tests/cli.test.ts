import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { __setMockChangedFiles, __setMockClassifyError } from '../lib/security-classify.js';
import { advanceStatus } from '../lib/task.js';

const CLI = resolve(__dirname, '..', 'lib', 'cli.ts');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  return runWithEnv(args, {});
}

function runWithEnv(
  args: string[],
  env: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('cli', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-cli-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
      JSON.stringify({ key: 'DEMO', name: 'Demo' })
    );
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify({
        id: 'DEMO-001',
        type: 'task',
        status: 'pending',
        owner: { kind: 'agent', id: 'unassigned' },
        project: 'DEMO',
        title: 'demo',
        context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
        acceptance_criteria: ['a'],
        definition_of_done: ['d'],
        risk_class: 'low',
      })
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('load-task returns task JSON', () => {
    const { stdout, exitCode } = run(['load-task', repoRoot, 'DEMO-001']);
    expect(exitCode).toBe(0);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('DEMO-001');
  });

  it('infer-project returns the sole project', () => {
    const { stdout, exitCode } = run(['infer-project', repoRoot]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('DEMO');
  });

  it('next-task-id allocates the next ID', () => {
    const { stdout } = run(['next-task-id', repoRoot, '--project=DEMO']);
    expect(stdout.trim()).toBe('DEMO-002');
  });

  it('advance-status moves task through a legal transition', () => {
    const { exitCode } = run(['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent']);
    expect(exitCode).toBe(0);
    const task = JSON.parse(readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8'));
    expect(task.status).toBe('tactical-plan');
  });

  it('advance-status exits nonzero on illegal transition', () => {
    const { exitCode, stderr } = run(['advance-status', repoRoot, 'DEMO-001', 'merged', 'agent']);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/illegal|not allowed/);
  });

  it('advance-status rejects actor=system with exit code 2', () => {
    const { exitCode, stderr } = run(['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'system']);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toMatch(/actor.*agent.*human|agent.*or.*human/);
  });

  describe('detect-ui-paths', () => {
    beforeEach(() => {
      // Create a git repo + feature branch for diff inspection
      execSync('git init -q -b main', { cwd: repoRoot });
      execSync('git config user.email test@test', { cwd: repoRoot });
      execSync('git config user.name test', { cwd: repoRoot });
      writeFileSync(join(repoRoot, 'README.md'), 'initial\n');
      execSync('git add . && git commit -q -m initial', { cwd: repoRoot });
      execSync('git checkout -q -b cloverleaf/DEMO-001', { cwd: repoRoot });
    });

    it('returns true when src/pages/** paths changed', () => {
      mkdirSync(join(repoRoot, 'src', 'pages'), { recursive: true });
      writeFileSync(join(repoRoot, 'src', 'pages', 'index.astro'), '<p>hi</p>');
      execSync('git add . && git commit -q -m "add page"', { cwd: repoRoot });
      const { stdout, exitCode } = run(['detect-ui-paths', repoRoot, 'DEMO-001']);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('true');
    });

    it('returns false when no UI paths changed', () => {
      mkdirSync(join(repoRoot, 'standard', 'src'), { recursive: true });
      writeFileSync(join(repoRoot, 'standard', 'src', 'index.ts'), 'export {};\n');
      execSync('git add . && git commit -q -m "add standard"', { cwd: repoRoot });
      const { stdout, exitCode } = run(['detect-ui-paths', repoRoot, 'DEMO-001']);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('false');
    });

    it('returns error when feature branch missing', () => {
      execSync('git checkout -q main', { cwd: repoRoot });
      execSync('git branch -D cloverleaf/DEMO-001', { cwd: repoRoot });
      const { exitCode, stderr } = run(['detect-ui-paths', repoRoot, 'DEMO-001']);
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/branch|not found/i);
    });
  });

  it('write-feedback --prefix=u writes file with u prefix', () => {
    const fbFile = join(repoRoot, 'tmp-fb.json');
    writeFileSync(fbFile, JSON.stringify({ verdict: 'bounce', summary: 's', findings: [{ severity: 'error', message: 'm' }] }));
    const { exitCode, stdout } = run(['write-feedback', repoRoot, 'DEMO-001', fbFile, '--prefix=u']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/DEMO-001-u1\.json/);
  });

  // CLV-75: load-task --pretty flag + jq-safe default
  it('load-task default output is single-line JSON ending in \\n and parses with JSON.parse', () => {
    const { stdout, exitCode } = run(['load-task', repoRoot, 'DEMO-001']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('DEMO-001');
    expect(stdout.endsWith('\n')).toBe(true);
  });

  it('load-task --pretty output has multiple lines and parses with JSON.parse', () => {
    const { stdout, exitCode } = run(['load-task', repoRoot, 'DEMO-001', '--pretty']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('DEMO-001');
  });

  it('load-task with missing args writes error to stderr and exits nonzero', () => {
    const { exitCode, stderr } = run(['load-task', repoRoot]);
    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });

  describe('affected-routes', () => {
    beforeEach(() => {
      execSync('git init -q -b main', { cwd: repoRoot });
      execSync('git config user.email test@test', { cwd: repoRoot });
      execSync('git config user.name test', { cwd: repoRoot });
      writeFileSync(join(repoRoot, 'README.md'), 'initial\n');
      execSync('git add . && git commit -q -m initial', { cwd: repoRoot });
      execSync('git checkout -q -b cloverleaf/DEMO-001', { cwd: repoRoot });
    });

    it('returns route list for a specific page change', () => {
      mkdirSync(join(repoRoot, 'src', 'pages'), { recursive: true });
      writeFileSync(join(repoRoot, 'src', 'pages', 'faq.astro'), '<p>faq</p>');
      execSync('git add . && git commit -q -m "add faq"', { cwd: repoRoot });
      const { stdout, exitCode } = run(['affected-routes', repoRoot, 'DEMO-001']);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual(['/faq/']);
    });

    it('returns "all" string for layout changes', () => {
      mkdirSync(join(repoRoot, 'src', 'layouts'), { recursive: true });
      writeFileSync(join(repoRoot, 'src', 'layouts', 'Base.astro'), 'layout');
      execSync('git add . && git commit -q -m "layout"', { cwd: repoRoot });
      const { stdout, exitCode } = run(['affected-routes', repoRoot, 'DEMO-001']);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('"all"');
    });

    it('returns [] for non-site changes', () => {
      mkdirSync(join(repoRoot, 'standard', 'src'), { recursive: true });
      writeFileSync(join(repoRoot, 'standard', 'src', 'foo.ts'), 'export {};');
      execSync('git add . && git commit -q -m "standard"', { cwd: repoRoot });
      const { stdout, exitCode } = run(['affected-routes', repoRoot, 'DEMO-001']);
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.trim())).toEqual([]);
    });

    it('returns error when feature branch missing', () => {
      execSync('git checkout -q main', { cwd: repoRoot });
      execSync('git branch -D cloverleaf/DEMO-001', { cwd: repoRoot });
      const { exitCode, stderr } = run(['affected-routes', repoRoot, 'DEMO-001']);
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/branch|not found/i);
    });
  });

  describe('consumer override', () => {
    beforeEach(() => {
      execSync('git init -q -b main', { cwd: repoRoot });
      execSync('git config user.email test@test', { cwd: repoRoot });
      execSync('git config user.name test', { cwd: repoRoot });
      writeFileSync(join(repoRoot, 'README.md'), 'initial\n');
      execSync('git add . && git commit -q -m initial', { cwd: repoRoot });
      execSync('git checkout -q -b cloverleaf/DEMO-001', { cwd: repoRoot });
    });

    it('detect-ui-paths respects consumer override', () => {
      // Consumer config says UI lives at apps/web/, not site/
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-paths.json'),
        JSON.stringify({ patterns: ['apps/web/**'] })
      );
      // Change site/ file — should NOT match overridden patterns
      mkdirSync(join(repoRoot, 'site', 'src'), { recursive: true });
      writeFileSync(join(repoRoot, 'site', 'src', 'page.astro'), '<p>hi</p>');
      execSync('git add . && git commit -q -m "site change"', { cwd: repoRoot });
      const { stdout } = run(['detect-ui-paths', repoRoot, 'DEMO-001']);
      expect(stdout.trim()).toBe('false');
    });

    it('affected-routes respects consumer override with contentRoutes', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'affected-routes.json'),
        JSON.stringify({
          pageRoots: [],
          globalPatterns: [],
          routeScope: ['site/src/**'],
          contentRoutes: { 'site/src/content/guide/**': '/guide/' },
        })
      );
      mkdirSync(join(repoRoot, 'site', 'src', 'content', 'guide'), { recursive: true });
      writeFileSync(join(repoRoot, 'site', 'src', 'content', 'guide', '01.mdx'), '# chapter 1');
      execSync('git add . && git commit -q -m "guide chapter"', { cwd: repoRoot });
      const { stdout } = run(['affected-routes', repoRoot, 'DEMO-001']);
      expect(JSON.parse(stdout.trim())).toEqual(['/guide/']);
    });
  });

  describe('cli: ui-review-config', () => {
    it('prints the resolved UiReviewConfig as JSON (package default)', () => {
      const { stdout, exitCode } = run(['ui-review-config', '--repo-root', repoRoot]);
      expect(exitCode).toBe(0);
      const doc = JSON.parse(stdout);
      expect(doc.viewports.desktop).toEqual({ width: 1280, height: 800 });
      expect(doc.visualDiff.enabled).toBe(true);
      expect(doc.axe.viewports).toEqual(['desktop']);
    });

    it('honors consumer override', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1440, height: 900 } },
          visualDiff: { enabled: false, threshold: 0.2, maxDiffRatio: 0.02, mask: [] },
          axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const { stdout, exitCode } = run(['ui-review-config', '--repo-root', repoRoot]);
      expect(exitCode).toBe(0);
      const doc = JSON.parse(stdout);
      expect(doc.viewports.desktop.width).toBe(1440);
      expect(doc.visualDiff.enabled).toBe(false);
    });
  });

  describe('cli: plugin-root', () => {
    it('prints the plugin root path (absolute, no trailing newline)', () => {
      const { stdout, exitCode } = run(['plugin-root']);
      expect(exitCode).toBe(0);
      expect(stdout.startsWith('/')).toBe(true);
      // No trailing newline — shell-composable via $(cloverleaf-cli plugin-root)
      expect(stdout.endsWith('\n')).toBe(false);
      // Matches the reference-impl directory pattern
      expect(stdout).toMatch(/reference-impl$/);
    });

    it('plugin-root output can be concatenated with a relative skill path', () => {
      const { stdout } = run(['plugin-root']);
      const prompt = `${stdout}/prompts/documenter.md`;
      expect(prompt).toContain('/prompts/documenter.md');
    });
  });

  it('council-plan returns the fast-lane plan for a low-risk task.review', () => {
    // DEMO-001 is risk_class:'low' → the shipped two-lane default routes it to delivery-fast.
    const { stdout, exitCode } = run(['council-plan', repoRoot, 'DEMO-001', 'task.review', '--changed-files=']);
    expect(exitCode).toBe(0);
    const plan = JSON.parse(stdout);
    expect(plan.profile).toBe('delivery-fast');
    expect(plan.rounds.map((r: { member: string }[]) => r.map((x) => x.member))).toEqual([['reviewer']]);
  });

  it('council-plan activates security for a declared-high task', () => {
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-002.json'),
      JSON.stringify({
        id: 'DEMO-002', type: 'task', status: 'review', owner: { kind: 'agent', id: 'unassigned' },
        project: 'DEMO', title: 'demo2', context: {}, acceptance_criteria: ['a'], definition_of_done: ['d'],
        risk_class: 'high', security_class: 'high',
      }),
    );
    const { stdout, exitCode } = run(['council-plan', repoRoot, 'DEMO-002', 'task.review', '--changed-files=']);
    expect(exitCode).toBe(0);
    const plan = JSON.parse(stdout);
    expect(plan.rounds.map((r: { member: string }[]) => r.map((x) => x.member))).toEqual([['reviewer'], ['security', 'qa']]);
  });

  it('aggregate-verdicts combines member verdicts by rule', () => {
    const members = JSON.stringify([{ member: 'a', verdict: 'pass' }, { member: 'b', verdict: 'bounce' }]);
    const { stdout, exitCode } = run(['aggregate-verdicts', members, 'any-veto']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).verdict).toBe('bounce');
  });

  it('aggregate-verdicts honors escalate short-circuit', () => {
    const members = JSON.stringify([{ member: 'a', verdict: 'pass' }, { member: 'b', verdict: 'escalate' }]);
    const { stdout } = run(['aggregate-verdicts', members, 'majority']);
    expect(JSON.parse(stdout).verdict).toBe('escalate');
  });

  it('aggregate-verdicts rejects a non-numeric quorum', () => {
    const members = JSON.stringify([{ member: 'a', verdict: 'pass' }]);
    const { exitCode } = run(['aggregate-verdicts', members, 'quorum:abc']);
    expect(exitCode).toBe(2);
  });

  it('chair-context renders a deliberation packet', () => {
    const inputs = JSON.stringify([
      { member: 'security', verdict: 'bounce', envelope: { summary: 'leaked key', findings: [{ severity: 'blocker', message: 'key in code' }] } },
      { member: 'qa', verdict: 'pass' },
    ]);
    const { stdout, exitCode } = run(['chair-context', inputs]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('security — bounce');
    expect(stdout).toContain('key in code');
  });

  it('chair-verdict normalizes chair output to rule=chair', () => {
    const raw = JSON.stringify({ verdict: 'bounce', rationale: 'fix it', forward: ['security'] });
    const members = JSON.stringify([{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }]);
    const { stdout, exitCode } = run(['chair-verdict', raw, members]);
    expect(exitCode).toBe(0);
    const v = JSON.parse(stdout);
    expect(v.rule).toBe('chair');
    expect(v.forward).toEqual(['security']);
  });

  it('council-plan reports source=default with no consumer config', () => {
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify({
        id: 'DEMO-001', type: 'task', status: 'review', project: 'DEMO', title: 't',
        owner: { kind: 'agent', id: 'unassigned' }, context: {},
        acceptance_criteria: ['a'], definition_of_done: ['d'], risk_class: 'low',
      }),
    );
    const { stdout, exitCode } = run(['council-plan', repoRoot, 'DEMO-001', 'task.review', '--changed-files=']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).source).toBe('default');
  });

  it('apply-council-verdict drives a fast-lane pass to automated-gates', () => {
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify({
        id: 'DEMO-001', type: 'task', status: 'review', project: 'DEMO', title: 't',
        owner: { kind: 'agent', id: 'unassigned' }, context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
        acceptance_criteria: ['a'], definition_of_done: ['d'], risk_class: 'low',
      }),
    );
    const verdict = JSON.stringify({ verdict: 'pass', rule: 'any-veto', rationale: 'ok', members: [{ member: 'reviewer', verdict: 'pass' }] });
    const { stdout, exitCode } = run(['apply-council-verdict', repoRoot, 'DEMO-001', 'task.review', verdict]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).final_verdict).toBe('pass');
    expect(JSON.parse(readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')).status).toBe('automated-gates');
  });
});

describe('cli — rfc', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-rfc-'));
    mkdirSync(join(tmp, '.cloverleaf', 'rfcs'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('save-rfc + load-rfc round-trips', () => {
    const rfc = {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 't', problem: 'p', solution: 's',
      unknowns: [], acceptance_criteria: ['ac'], out_of_scope: [],
    };
    const p = join(tmp, 'r.json');
    writeFileSync(p, JSON.stringify(rfc));
    const { exitCode: saveCode } = run(['save-rfc', tmp, p]);
    expect(saveCode).toBe(0);
    const { stdout, exitCode } = run(['load-rfc', tmp, 'CLV-009']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).id).toBe('CLV-009');
  });

  it('advance-rfc moves drafting → spike-in-flight', () => {
    const rfc = {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 't', problem: 'p', solution: 's',
      unknowns: [], acceptance_criteria: ['ac'], out_of_scope: [],
    };
    const p = join(tmp, 'r.json');
    writeFileSync(p, JSON.stringify(rfc));
    run(['save-rfc', tmp, p]);
    const { exitCode: advCode } = run(['advance-rfc', tmp, 'CLV-009', 'spike-in-flight', 'agent']);
    expect(advCode).toBe(0);
    const { stdout } = run(['load-rfc', tmp, 'CLV-009']);
    expect(JSON.parse(stdout).status).toBe('spike-in-flight');
  });

  it('advance-rfc rejects actor=system (v0.1.1 guardrail)', () => {
    const rfc = {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 't', problem: 'p', solution: 's',
      unknowns: [], acceptance_criteria: ['ac'], out_of_scope: [],
    };
    const p = join(tmp, 'r.json');
    writeFileSync(p, JSON.stringify(rfc));
    run(['save-rfc', tmp, p]);
    const { exitCode, stderr } = run(['advance-rfc', tmp, 'CLV-009', 'spike-in-flight', 'system']);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/actor.*agent.*human|agent.*or.*human/);
  });

  // CLV-75: load-rfc --pretty flag + jq-safe default
  it('load-rfc default output is single-line JSON ending in \\n and parses with JSON.parse', () => {
    const rfc = {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 't', problem: 'p', solution: 's',
      unknowns: [], acceptance_criteria: ['ac'], out_of_scope: [],
    };
    const p = join(tmp, 'r.json');
    writeFileSync(p, JSON.stringify(rfc));
    run(['save-rfc', tmp, p]);
    const { stdout, exitCode } = run(['load-rfc', tmp, 'CLV-009']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('CLV-009');
    expect(stdout.endsWith('\n')).toBe(true);
  });

  it('load-rfc --pretty output has multiple lines and parses with JSON.parse', () => {
    const rfc = {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 't', problem: 'p', solution: 's',
      unknowns: [], acceptance_criteria: ['ac'], out_of_scope: [],
    };
    const p = join(tmp, 'r.json');
    writeFileSync(p, JSON.stringify(rfc));
    run(['save-rfc', tmp, p]);
    const { stdout, exitCode } = run(['load-rfc', tmp, 'CLV-009', '--pretty']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('CLV-009');
  });

  it('load-rfc with missing args writes error to stderr and exits nonzero', () => {
    const { exitCode, stderr } = run(['load-rfc', tmp]);
    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe('cli — spike', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-spike-'));
    mkdirSync(join(tmp, '.cloverleaf', 'spikes'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('save-spike + load-spike round-trips', () => {
    const spike = {
      type: 'spike', project: 'CLV', id: 'CLV-010',
      title: 'test', status: 'pending',
      owner: { kind: 'agent', id: 'researcher' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      question: 'q?', method: 'research',
    };
    const p = join(tmp, 's.json');
    writeFileSync(p, JSON.stringify(spike));
    const { exitCode: saveCode } = run(['save-spike', tmp, p]);
    expect(saveCode).toBe(0);
    const { stdout, exitCode } = run(['load-spike', tmp, 'CLV-010']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).id).toBe('CLV-010');
  });

  it('advance-spike moves pending → running', () => {
    const spike = {
      type: 'spike', project: 'CLV', id: 'CLV-010',
      title: 'test', status: 'pending',
      owner: { kind: 'agent', id: 'researcher' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      question: 'q?', method: 'research',
    };
    const p = join(tmp, 's.json');
    writeFileSync(p, JSON.stringify(spike));
    run(['save-spike', tmp, p]);
    const { exitCode } = run(['advance-spike', tmp, 'CLV-010', 'running', 'agent']);
    expect(exitCode).toBe(0);
    const { stdout } = run(['load-spike', tmp, 'CLV-010']);
    expect(JSON.parse(stdout).status).toBe('running');
  });

  // CLV-75: load-spike --pretty flag + jq-safe default
  it('load-spike default output is single-line JSON ending in \\n and parses with JSON.parse', () => {
    const spike = {
      type: 'spike', project: 'CLV', id: 'CLV-010',
      title: 'test', status: 'pending',
      owner: { kind: 'agent', id: 'researcher' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      question: 'q?', method: 'research',
    };
    const p = join(tmp, 's.json');
    writeFileSync(p, JSON.stringify(spike));
    run(['save-spike', tmp, p]);
    const { stdout, exitCode } = run(['load-spike', tmp, 'CLV-010']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('CLV-010');
    expect(stdout.endsWith('\n')).toBe(true);
  });

  it('load-spike --pretty output has multiple lines and parses with JSON.parse', () => {
    const spike = {
      type: 'spike', project: 'CLV', id: 'CLV-010',
      title: 'test', status: 'pending',
      owner: { kind: 'agent', id: 'researcher' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      question: 'q?', method: 'research',
    };
    const p = join(tmp, 's.json');
    writeFileSync(p, JSON.stringify(spike));
    run(['save-spike', tmp, p]);
    const { stdout, exitCode } = run(['load-spike', tmp, 'CLV-010', '--pretty']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('CLV-010');
  });

  it('load-spike with missing args writes error to stderr and exits nonzero', () => {
    const { exitCode, stderr } = run(['load-spike', tmp]);
    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe('cli — plan', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-plan-'));
    mkdirSync(join(tmp, '.cloverleaf', 'plans'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('materialise-tasks writes task files from plan', () => {
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-012', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [{ project: 'CLV', id: 'CLV-013' }],
        edges: [],
      },
      tasks: [{
        type: 'task', project: 'CLV', id: 'CLV-013', title: 't',
        status: 'pending', risk_class: 'high',
        owner: { kind: 'agent', id: 'implementer' },
        acceptance_criteria: ['a'], definition_of_done: ['d'],
        context: { rfc: { project: 'CLV', id: 'CLV-009' } },
      }],
    };
    const p = join(tmp, 'plan.json');
    writeFileSync(p, JSON.stringify(plan));
    const { exitCode: saveCode } = run(['save-plan', tmp, p]);
    expect(saveCode).toBe(0);
    const { stdout, exitCode } = run(['materialise-tasks', tmp, 'CLV-012']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).task_ids).toEqual(['CLV-013']);
  });

  it('advance-plan moves drafting → gate-pending', () => {
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-012', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [{ project: 'CLV', id: 'CLV-013' }],
        edges: [],
      },
      tasks: [{
        type: 'task', project: 'CLV', id: 'CLV-013', title: 't',
        status: 'pending', risk_class: 'high',
        owner: { kind: 'agent', id: 'implementer' },
        acceptance_criteria: ['a'], definition_of_done: ['d'],
        context: { rfc: { project: 'CLV', id: 'CLV-009' } },
      }],
    };
    const p = join(tmp, 'plan.json');
    writeFileSync(p, JSON.stringify(plan));
    run(['save-plan', tmp, p]);
    const { exitCode } = run(['advance-plan', tmp, 'CLV-012', 'gate-pending', 'agent', 'task_batch_gate']);
    expect(exitCode).toBe(0);
    const { stdout } = run(['load-plan', tmp, 'CLV-012']);
    expect(JSON.parse(stdout).status).toBe('gate-pending');
  });

  // CLV-75: load-plan --pretty flag + jq-safe default
  it('load-plan default output is single-line JSON ending in \\n and parses with JSON.parse', () => {
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-012', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: { nodes: [{ project: 'CLV', id: 'CLV-013' }], edges: [] },
      tasks: [{
        type: 'task', project: 'CLV', id: 'CLV-013', title: 't',
        status: 'pending', risk_class: 'high',
        owner: { kind: 'agent', id: 'implementer' },
        acceptance_criteria: ['a'], definition_of_done: ['d'],
        context: { rfc: { project: 'CLV', id: 'CLV-009' } },
      }],
    };
    const p = join(tmp, 'plan.json');
    writeFileSync(p, JSON.stringify(plan));
    run(['save-plan', tmp, p]);
    const { stdout, exitCode } = run(['load-plan', tmp, 'CLV-012']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('CLV-012');
    expect(stdout.endsWith('\n')).toBe(true);
  });

  it('load-plan --pretty output has multiple lines and parses with JSON.parse', () => {
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-012', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: { nodes: [{ project: 'CLV', id: 'CLV-013' }], edges: [] },
      tasks: [{
        type: 'task', project: 'CLV', id: 'CLV-013', title: 't',
        status: 'pending', risk_class: 'high',
        owner: { kind: 'agent', id: 'implementer' },
        acceptance_criteria: ['a'], definition_of_done: ['d'],
        context: { rfc: { project: 'CLV', id: 'CLV-009' } },
      }],
    };
    const p = join(tmp, 'plan.json');
    writeFileSync(p, JSON.stringify(plan));
    run(['save-plan', tmp, p]);
    const { stdout, exitCode } = run(['load-plan', tmp, 'CLV-012', '--pretty']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('CLV-012');
  });

  it('load-plan with missing args writes error to stderr and exits nonzero', () => {
    const { exitCode, stderr } = run(['load-plan', tmp]);
    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe('cli — discovery-config', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-disccfg-'));
    mkdirSync(join(tmp, '.cloverleaf', 'config'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('returns package default when no override', () => {
    const { stdout, exitCode } = run(['discovery-config', '--repo-root', tmp]);
    expect(exitCode).toBe(0);
    const c = JSON.parse(stdout);
    expect(c.docContextUri).toBe('');
    expect(c.projectId).toBe('');
    expect(c.idStart).toBe(1);
  });

  it('returns consumer override when present', () => {
    writeFileSync(
      join(tmp, '.cloverleaf/config/discovery.json'),
      JSON.stringify({ docContextUri: 'docs/', projectId: 'CLV', idStart: 9 })
    );
    const { stdout, exitCode } = run(['discovery-config', '--repo-root', tmp]);
    expect(exitCode).toBe(0);
    const c = JSON.parse(stdout);
    expect(c.projectId).toBe('CLV');
  });
});

describe('cli — next-work-item-id', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-nextid-'));
    for (const d of ['rfcs', 'spikes', 'plans', 'tasks']) {
      mkdirSync(join(tmp, '.cloverleaf', d), { recursive: true });
    }
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('returns CLV-1 for empty dirs', () => {
    const { stdout, exitCode } = run(['next-work-item-id', tmp, 'CLV']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('CLV-1');
  });

  it('returns max+1 when files exist across rfcs/spikes/plans/tasks', () => {
    writeFileSync(join(tmp, '.cloverleaf/rfcs/CLV-3.json'), '{}');
    writeFileSync(join(tmp, '.cloverleaf/spikes/CLV-12.json'), '{}');
    writeFileSync(join(tmp, '.cloverleaf/plans/CLV-5.json'), '{}');
    writeFileSync(join(tmp, '.cloverleaf/tasks/CLV-7.json'), '{}');
    const { stdout, exitCode } = run(['next-work-item-id', tmp, 'CLV']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('CLV-13');
  });
});

describe('cli — prep-worktree', () => {
  it('exits non-zero with usage when args are missing', () => {
    const { exitCode, stderr } = run(['prep-worktree']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/prep-worktree requires <mainRoot> <worktreePath>/);
  });

  it('exits non-zero with a clear error when an embedded/monorepo worktree is not primed', () => {
    // F2: prep-worktree is now topology-aware. A worktree without standard/ or reference-impl/
    // is treated as a non-monorepo consumer and succeeds (nothing to copy). To exercise the
    // error path we must create a worktree that looks like a monorepo clone (has both
    // standard/package.json and reference-impl/package.json) but whose mainRoot has no
    // node_modules — that still fails with a helpful message.
    const mainTmp = mkdtempSync(join(tmpdir(), 'cli-prep-main-'));
    const wtTmp = mkdtempSync(join(tmpdir(), 'cli-prep-wt-'));
    try {
      mkdirSync(join(wtTmp, 'standard'), { recursive: true });
      mkdirSync(join(wtTmp, 'reference-impl'), { recursive: true });
      writeFileSync(join(wtTmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));
      writeFileSync(join(wtTmp, 'reference-impl', 'package.json'), JSON.stringify({ name: '@cloverleaf/reference-impl' }));
      const { exitCode, stderr } = run(['prep-worktree', mainTmp, wtTmp]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/node_modules/);
    } finally {
      rmSync(mainTmp, { recursive: true, force: true });
      rmSync(wtTmp, { recursive: true, force: true });
    }
  });
});

describe('cli — dag-walker and walk-state', () => {
  let repoRoot: string;
  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cli-walker-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'plans'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'plans', 'CLV-15.json'),
      JSON.stringify({
        type: 'plan',
        project: 'CLV',
        id: 'CLV-15',
        status: 'gate-approved',
        owner: { kind: 'agent', id: 'plan' },
        parent_rfc: { project: 'CLV', id: 'CLV-0' },
        task_dag: {
          nodes: [
            { project: 'CLV', id: 'CLV-17' },
            { project: 'CLV', id: 'CLV-18' },
          ],
          edges: [],
        },
        tasks: [],
      }),
    );
  });
  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  it('dag-ready-tasks returns ready task ids as newline-separated list', () => {
    const walkStateDir = join(repoRoot, '.cloverleaf', 'runs', 'plan', 'CLV-15');
    mkdirSync(walkStateDir, { recursive: true });
    writeFileSync(
      join(walkStateDir, 'walk-state.json'),
      JSON.stringify({
        plan_id: 'CLV-15',
        started: '2026-04-24T00:00:00Z',
        max_concurrent: 3,
        tasks: {},
      }),
    );
    const { stdout, exitCode } = run(['dag-ready-tasks', repoRoot, 'CLV-15', '3']);
    expect(exitCode).toBe(0);
    expect(stdout.trim().split('\n').sort()).toEqual(['CLV-17', 'CLV-18']);
  });

  it('dag-detect-cycle exits 0 with empty stdout on acyclic plan', () => {
    const { stdout, exitCode } = run(['dag-detect-cycle', repoRoot, 'CLV-15']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('walk-state-read prints JSON to stdout, exits 2 when file missing', () => {
    const { exitCode: missingCode, stderr: missingErr } = run([
      'walk-state-read',
      repoRoot,
      'CLV-15',
    ]);
    expect(missingCode).toBe(2);
    expect(missingErr).toMatch(/walk-state.*not found/i);

    const walkStateDir = join(repoRoot, '.cloverleaf', 'runs', 'plan', 'CLV-15');
    mkdirSync(walkStateDir, { recursive: true });
    const state = {
      plan_id: 'CLV-15',
      started: '2026-04-24T00:00:00Z',
      max_concurrent: 3,
      tasks: {},
    };
    writeFileSync(join(walkStateDir, 'walk-state.json'), JSON.stringify(state));
    const { stdout, exitCode } = run(['walk-state-read', repoRoot, 'CLV-15']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(state);
  });

  it('walk-state-write reads JSON from file path argument and persists', () => {
    const state = {
      plan_id: 'CLV-15',
      started: '2026-04-24T00:00:00Z',
      max_concurrent: 2,
      tasks: { 'CLV-17': { state: 'pending' } },
    };
    const p = join(repoRoot, 'input.json');
    writeFileSync(p, JSON.stringify(state));
    const { exitCode } = run(['walk-state-write', repoRoot, p]);
    expect(exitCode).toBe(0);
    const persisted = JSON.parse(
      readFileSync(
        join(repoRoot, '.cloverleaf', 'runs', 'plan', 'CLV-15', 'walk-state.json'),
        'utf-8',
      ),
    );
    expect(persisted.max_concurrent).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CLV-19: read-ui-review-state / write-ui-review-state CLI commands
// ---------------------------------------------------------------------------

describe('cli — read-ui-review-state / write-ui-review-state (CLV-19)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-ui-state-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('read-ui-review-state returns baselines_pending: false when state.json is absent', () => {
    const { stdout, exitCode } = run(['read-ui-review-state', tmp, 'CLV-42']);
    expect(exitCode).toBe(0);
    const doc = JSON.parse(stdout);
    expect(doc.baselines_pending).toBe(false);
  });

  it('write-ui-review-state true then read-ui-review-state returns baselines_pending: true', () => {
    const { exitCode: wc } = run(['write-ui-review-state', tmp, 'CLV-42', 'true']);
    expect(wc).toBe(0);
    const { stdout, exitCode } = run(['read-ui-review-state', tmp, 'CLV-42']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).baselines_pending).toBe(true);
  });

  it('write-ui-review-state false then read returns baselines_pending: false', () => {
    run(['write-ui-review-state', tmp, 'CLV-42', 'true']);
    const { exitCode: wc } = run(['write-ui-review-state', tmp, 'CLV-42', 'false']);
    expect(wc).toBe(0);
    const { stdout } = run(['read-ui-review-state', tmp, 'CLV-42']);
    expect(JSON.parse(stdout).baselines_pending).toBe(false);
  });

  it('write-ui-review-state creates intermediate directories automatically', () => {
    const { exitCode } = run(['write-ui-review-state', tmp, 'CLV-42', 'true']);
    expect(exitCode).toBe(0);
    const stateFile = join(tmp, '.cloverleaf', 'runs', 'CLV-42', 'ui-review', 'state.json');
    expect(JSON.parse(readFileSync(stateFile, 'utf-8')).baselines_pending).toBe(true);
  });

  it('read-ui-review-state exits nonzero with usage when args are missing', () => {
    const { exitCode } = run(['read-ui-review-state']);
    expect(exitCode).not.toBe(0);
  });

  it('write-ui-review-state exits nonzero with usage when args are missing', () => {
    const { exitCode } = run(['write-ui-review-state', tmp, 'CLV-42']);
    expect(exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLV-38: write-baseline guard — refuses writes when baselines_pending is true
// ---------------------------------------------------------------------------

describe('cli — write-baseline guard (CLV-38)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cli-write-baseline-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exits nonzero with a descriptive error when baselines_pending is true (v0.6.1 guard present)', () => {
    // Set baselines_pending: true to simulate an unreviewed UI Reviewer run
    run(['write-ui-review-state', tmp, 'CLV-42', 'true']);

    // Create a dummy source PNG
    const srcFile = join(tmp, 'candidate.png');
    writeFileSync(srcFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes

    const { exitCode, stderr } = run([
      'write-baseline',
      tmp,
      'CLV-42',
      'chromium',
      'index',
      'desktop',
      srcFile,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/baselines_pending.*true|refused.*baselines_pending/i);
  });

  it('succeeds and copies the file when baselines_pending is false (gate cleared)', () => {
    // Set baselines_pending: false to simulate post-approval state
    run(['write-ui-review-state', tmp, 'CLV-42', 'false']);

    const srcFile = join(tmp, 'candidate.png');
    writeFileSync(srcFile, Buffer.from('fake-png-content'));

    const { exitCode, stdout } = run([
      'write-baseline',
      tmp,
      'CLV-42',
      'chromium',
      'index',
      'desktop',
      srcFile,
    ]);

    expect(exitCode).toBe(0);
    // stdout should be the destination path
    const destPath = stdout.trim();
    expect(destPath).toContain('.cloverleaf/baselines/chromium/index-desktop.png');
    expect(readFileSync(destPath, 'utf-8')).toBe('fake-png-content');
  });

  it('succeeds when state.json is absent (no prior UI Reviewer run — baselines_pending defaults to false)', () => {
    // No state.json exists — readUiReviewState returns { baselines_pending: false }
    const srcFile = join(tmp, 'candidate.png');
    writeFileSync(srcFile, Buffer.from('fake-png-content'));

    const { exitCode } = run([
      'write-baseline',
      tmp,
      'CLV-42',
      'chromium',
      'index',
      'desktop',
      srcFile,
    ]);

    expect(exitCode).toBe(0);
  });

  it('creates intermediate baselines subdirectory automatically', () => {
    run(['write-ui-review-state', tmp, 'CLV-42', 'false']);

    const srcFile = join(tmp, 'shot.png');
    writeFileSync(srcFile, Buffer.from('png-data'));

    run(['write-baseline', tmp, 'CLV-42', 'webkit', 'faq', 'mobile', srcFile]);

    const expectedPath = join(tmp, '.cloverleaf', 'baselines', 'webkit', 'faq-mobile.png');
    expect(readFileSync(expectedPath, 'utf-8')).toBe('png-data');
  });

  it('exits nonzero with usage when required args are missing', () => {
    const { exitCode, stderr } = run(['write-baseline', tmp, 'CLV-42']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/write-baseline requires/i);
  });

  it('guard is independent of the task: CLV-27 retroactive write is not blocked when state.json is absent', () => {
    // CLV-27 is already merged; its .cloverleaf/runs/CLV-27/ui-review/state.json
    // does not exist in a fresh consumer repo. The guard must NOT refuse writes
    // for a task whose state file is absent (absence = baselines_pending: false).
    const srcFile = join(tmp, 'legacy.png');
    writeFileSync(srcFile, Buffer.from('legacy-baseline'));

    const { exitCode } = run([
      'write-baseline',
      tmp,
      'CLV-27',
      'chromium',
      'guide',
      'desktop',
      srcFile,
    ]);

    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLV-58: walker-default-concurrency subcommand
// ---------------------------------------------------------------------------

describe('cli — walker-default-concurrency (CLV-58)', () => {
  let xdgTmp: string;

  beforeEach(() => {
    xdgTmp = mkdtempSync(join(tmpdir(), 'cli-walkercfg-'));
  });

  afterEach(() => {
    rmSync(xdgTmp, { recursive: true, force: true });
  });

  // Test 1: plain form with { "max_concurrent": 2 } → stdout "2\n", exit 0
  it('plain form prints resolved integer when config has max_concurrent: 2', () => {
    mkdirSync(join(xdgTmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(xdgTmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: 2 })
    );
    const { stdout, exitCode } = runWithEnv(['walker-default-concurrency'], {
      XDG_CONFIG_HOME: xdgTmp,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe('2\n');
  });

  // Test 2: --explain form with { "max_concurrent": 2 } → stdout matches pattern, exit 0
  it('--explain form prints formatted line with file path when config has max_concurrent: 2', () => {
    mkdirSync(join(xdgTmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(xdgTmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: 2 })
    );
    const { stdout, exitCode } = runWithEnv(
      ['walker-default-concurrency', '--explain'],
      { XDG_CONFIG_HOME: xdgTmp }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^max_concurrent=2 \(from .+\/walker\.json\)\n?$/);
  });

  // Test 3: plain form, file absent → stdout "3\n", exit 0
  it('plain form prints default 3 when config file is absent', () => {
    const { stdout, exitCode } = runWithEnv(['walker-default-concurrency'], {
      XDG_CONFIG_HOME: xdgTmp,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe('3\n');
  });

  // Test 4: plain form, malformed file → exit non-zero, stderr contains file path, stdout empty
  it('exits non-zero with file path in stderr and no stdout when config is malformed', () => {
    mkdirSync(join(xdgTmp, 'cloverleaf'), { recursive: true });
    writeFileSync(join(xdgTmp, 'cloverleaf', 'walker.json'), '{ not valid json');
    const { stdout, stderr, exitCode } = runWithEnv(['walker-default-concurrency'], {
      XDG_CONFIG_HOME: xdgTmp,
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(join(xdgTmp, 'cloverleaf', 'walker.json'));
    expect(stdout).toBe('');
  });
});

// ---------------------------------------------------------------------------
// CLV-76: release-preflight subcommand removed
// ---------------------------------------------------------------------------

describe('cli — release-preflight removed (CLV-76)', () => {
  it('release-preflight exits with a usage error (subcommand removed)', () => {
    const { exitCode, stderr } = run(['release-preflight', '/tmp/irrelevant']);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/unknown command/i);
  });
});

// ---------------------------------------------------------------------------
// CLV-87: check-scope and extend-scope subcommands
// ---------------------------------------------------------------------------

describe('cli — check-scope (CLV-87)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cli-check-scope-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
      JSON.stringify({ key: 'DEMO', name: 'Demo' })
    );

    // Initialize git repo with main branch and task doc
    execSync('git init -q -b main', { cwd: repoRoot });
    execSync('git config user.email test@test', { cwd: repoRoot });
    execSync('git config user.name test', { cwd: repoRoot });

    writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), JSON.stringify({
      type: 'task', project: 'DEMO', id: 'DEMO-001',
      title: 'demo', status: 'pending', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['a'], definition_of_done: ['d'],
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-1' } },
      scope: { files_touched: ['lib/foo.ts'] },
    }));
    writeFileSync(join(repoRoot, 'README.md'), 'initial\n');
    execSync('git add . && git commit -q -m initial', { cwd: repoRoot });
    execSync('git checkout -q -b cloverleaf/DEMO-001', { cwd: repoRoot });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns valid JSON with three buckets when branch exists and task doc present', () => {
    mkdirSync(join(repoRoot, 'lib'), { recursive: true });
    writeFileSync(join(repoRoot, 'lib', 'foo.ts'), 'export const x = 1;');
    execSync('git add . && git commit -q -m "add lib/foo.ts"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(Array.isArray(result.own)).toBe(true);
    expect(Array.isArray(result.contested)).toBe(true);
    expect(Array.isArray(result.extension)).toBe(true);
    // lib/foo.ts is declared in scope.files_touched → own bucket
    expect(result.own).toContain('lib/foo.ts');
  });

  it('exits 1 when the branch does not exist', () => {
    const { exitCode, stderr } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/nonexistent',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/branch|not found/i);
  });

  it('exits 2 when --branch flag is missing', () => {
    const { exitCode, stderr } = run([
      'check-scope', repoRoot, 'DEMO-001',
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--branch/i);
  });

  it('extension bucket receives files touched but not declared in any scope', () => {
    mkdirSync(join(repoRoot, 'lib'), { recursive: true });
    writeFileSync(join(repoRoot, 'lib', 'unexpected.ts'), 'export const y = 2;');
    execSync('git add . && git commit -q -m "add lib/unexpected.ts"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.extension).toContain('lib/unexpected.ts');
    expect(result.own).toEqual([]);
  });

  // CLV-92: merged sibling filter
  it('merged sibling with overlapping files_touched does NOT produce a contested result', () => {
    // Add a sibling task on main with status 'merged' that claims lib/foo.ts
    execSync('git checkout -q main', { cwd: repoRoot });
    writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-002.json'), JSON.stringify({
      type: 'task', project: 'DEMO', id: 'DEMO-002',
      title: 'sibling', status: 'merged', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['a'], definition_of_done: ['d'],
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-1' } },
      scope: { files_touched: ['lib/foo.ts'] },
    }));
    execSync('git add . && git commit -q -m "add merged sibling"', { cwd: repoRoot });
    execSync('git checkout -q cloverleaf/DEMO-001', { cwd: repoRoot });

    // Touch lib/foo.ts on the feature branch
    mkdirSync(join(repoRoot, 'lib'), { recursive: true });
    writeFileSync(join(repoRoot, 'lib', 'foo.ts'), 'export const x = 1;');
    execSync('git add . && git commit -q -m "touch lib/foo.ts"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // lib/foo.ts is in DEMO-001's own scope — must be in own, NOT contested
    expect(result.own).toContain('lib/foo.ts');
    expect(result.contested).toEqual([]);
  });

  it('non-merged sibling (status: review) with overlapping files_touched DOES produce a contested result', () => {
    // Add a sibling task on main with status 'review' that claims lib/bar.ts
    execSync('git checkout -q main', { cwd: repoRoot });
    writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-003.json'), JSON.stringify({
      type: 'task', project: 'DEMO', id: 'DEMO-003',
      title: 'sibling-review', status: 'review', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['a'], definition_of_done: ['d'],
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-1' } },
      scope: { files_touched: ['lib/bar.ts'] },
    }));
    execSync('git add . && git commit -q -m "add review sibling"', { cwd: repoRoot });
    execSync('git checkout -q cloverleaf/DEMO-001', { cwd: repoRoot });

    // Touch lib/bar.ts on the feature branch (not in DEMO-001's own scope)
    mkdirSync(join(repoRoot, 'lib'), { recursive: true });
    writeFileSync(join(repoRoot, 'lib', 'bar.ts'), 'export const z = 3;');
    execSync('git add . && git commit -q -m "touch lib/bar.ts"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // lib/bar.ts is claimed by DEMO-003 (review) → must appear in contested
    const contestedFiles = result.contested.map((e: { file: string }) => e.file);
    expect(contestedFiles).toContain('lib/bar.ts');
  });

  // merge=union awareness (reference-impl 0.8.2)

  it('shared file (merge=union via root .gitattributes) + sibling claim → extension, not contested', () => {
    // Record the sibling on main first.
    execSync('git checkout -q main', { cwd: repoRoot });
    writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-002.json'), JSON.stringify({
      type: 'task', project: 'DEMO', id: 'DEMO-002',
      title: 'bump sibling', status: 'review', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['a'], definition_of_done: ['d'],
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-1' } },
      scope: { files_touched: ['CHANGELOG.md'] },
    }));
    execSync('git add . && git commit -q -m "add bump sibling"', { cwd: repoRoot });
    execSync('git checkout -q cloverleaf/DEMO-001', { cwd: repoRoot });

    // On the feature branch, add .gitattributes annotating CHANGELOG.md merge=union,
    // plus the CHANGELOG.md edit itself.
    writeFileSync(join(repoRoot, '.gitattributes'), 'CHANGELOG.md merge=union\n');
    writeFileSync(join(repoRoot, 'CHANGELOG.md'), '## [Unreleased]\n- added foo\n');
    execSync('git add . && git commit -q -m "add .gitattributes + touch CHANGELOG.md"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // CHANGELOG.md is annotated merge=union → must land in extension, not contested
    expect(result.contested).toEqual([]);
    expect(result.extension).toContain('CHANGELOG.md');
  });

  it('non-shared file (no merge=union) + sibling claim → contested (regression guard)', () => {
    // No .gitattributes file. Sibling claims lib/conflict.ts.
    execSync('git checkout -q main', { cwd: repoRoot });
    writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-003.json'), JSON.stringify({
      type: 'task', project: 'DEMO', id: 'DEMO-003',
      title: 'conflict sibling', status: 'review', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['a'], definition_of_done: ['d'],
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-1' } },
      scope: { files_touched: ['lib/conflict.ts'] },
    }));
    execSync('git add . && git commit -q -m "add conflict sibling"', { cwd: repoRoot });
    execSync('git checkout -q cloverleaf/DEMO-001', { cwd: repoRoot });

    // Touch lib/conflict.ts on the feature branch
    mkdirSync(join(repoRoot, 'lib'), { recursive: true });
    writeFileSync(join(repoRoot, 'lib', 'conflict.ts'), 'export const z = 3;');
    execSync('git add . && git commit -q -m "touch lib/conflict.ts"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    const contestedFiles = result.contested.map((e: { file: string }) => e.file);
    expect(contestedFiles).toContain('lib/conflict.ts');
  });

  it('subdir .gitattributes: merge=union inherits to nested files', () => {
    // .gitattributes inside pkg/, not at root. git check-attr should resolve correctly.
    // First record the sibling on main:
    execSync('git checkout -q main', { cwd: repoRoot });
    writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-004.json'), JSON.stringify({
      type: 'task', project: 'DEMO', id: 'DEMO-004',
      title: 'subdir bump sibling', status: 'review', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['a'], definition_of_done: ['d'],
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-1' } },
      scope: { files_touched: ['pkg/CHANGELOG.md'] },
    }));
    execSync('git add . && git commit -q -m "add subdir bump sibling"', { cwd: repoRoot });
    execSync('git checkout -q cloverleaf/DEMO-001', { cwd: repoRoot });

    // On the feature branch, create pkg/, the subdir .gitattributes, AND the CHANGELOG.
    mkdirSync(join(repoRoot, 'pkg'), { recursive: true });
    writeFileSync(join(repoRoot, 'pkg', '.gitattributes'), 'CHANGELOG.md merge=union\n');
    writeFileSync(join(repoRoot, 'pkg', 'CHANGELOG.md'), '## [Unreleased]\n- subdir change\n');
    execSync('git add . && git commit -q -m "add pkg/.gitattributes + pkg/CHANGELOG.md"', { cwd: repoRoot });

    const { stdout, exitCode } = run([
      'check-scope', repoRoot, 'DEMO-001', '--branch', 'cloverleaf/DEMO-001',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // Subdir .gitattributes should resolve pkg/CHANGELOG.md as merge=union
    expect(result.contested).toEqual([]);
    expect(result.extension).toContain('pkg/CHANGELOG.md');
  });
});

// ---------------------------------------------------------------------------
// CLV-98 v0.7.5 Task 3: rfc-tasks subcommand
// ---------------------------------------------------------------------------

describe('cli — rfc-tasks (v0.7.5)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-cli-rfc-tasks-'));
    mkdirSync(join(tmp, '.cloverleaf', 'rfcs'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'plans'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writeRfc(id: string, status: string): void {
    writeFileSync(join(tmp, `.cloverleaf/rfcs/${id}.json`), JSON.stringify({
      type: 'rfc', project: 'CC', id, status,
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    }) + '\n');
  }

  function writeStandaloneTask(id: string, rfcId: string, status: string): void {
    writeFileSync(join(tmp, `.cloverleaf/tasks/${id}.json`), JSON.stringify({
      type: 'task', project: 'CC', id, status,
      context: { rfc: { project: 'CC', id: rfcId } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    }) + '\n');
  }

  it('rfc-tasks emits compact JSON by default', () => {
    writeRfc('CC-21', 'approved');
    writeStandaloneTask('CC-100', 'CC-21', 'merged');

    const r = run(['rfc-tasks', tmp, 'CC-21']);
    expect(r.exitCode).toBe(0);
    // Compact = no intermediate newlines (trailing \n from process.stdout.write is OK)
    expect(r.stdout.trimEnd()).not.toMatch(/\n/);
    const view = JSON.parse(r.stdout);
    expect(view.summary.can_auto_advance_rfc).toBe(true);
    expect(view.standalone_tasks[0].id).toBe('CC-100');
  });

  it('rfc-tasks --pretty emits indented JSON', () => {
    writeRfc('CC-21', 'approved');
    writeStandaloneTask('CC-100', 'CC-21', 'merged');

    const r = run(['rfc-tasks', tmp, 'CC-21', '--pretty']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/\n/); // multi-line
    expect(r.stdout).toMatch(/^\{\n  "rfc"/);
  });

  it('rfc-tasks exits 2 with actionable stderr when RFC missing', () => {
    const r = run(['rfc-tasks', tmp, 'CC-999']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toLowerCase()).toMatch(/rfc.*cc-999.*not found/);
  });

  it('rfc-tasks usage error when args missing', () => {
    const r = run(['rfc-tasks']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/rfc-tasks/);
  });
});

describe('cli — secret-scan (v0.8.0)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-secret-scan-'));
    execSync('git init -q -b main', { cwd: tmp });
    execSync('git config user.email t@t.t', { cwd: tmp });
    execSync('git config user.name t', { cwd: tmp });
    writeFileSync(join(tmp, 'a.txt'), 'hello\n');
    execSync('git add -A && git commit -q -m init', { cwd: tmp });
    execSync('git checkout -q -b cloverleaf/T1', { cwd: tmp });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('emits a blocker finding for a hardcoded key in the branch diff', () => {
    writeFileSync(join(tmp, 'cfg.py'), 'KEY = "AKIAIOSFODNN7EXAMPLE2"\n');
    execSync('git add -A && git commit -q -m add', { cwd: tmp });
    const r = run(['secret-scan', tmp, '--branch', 'cloverleaf/T1']);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.findings.some((f: { rule: string }) => f.rule === 'aws-access-key-id')).toBe(true);
  });

  it('emits zero findings for a clean diff', () => {
    writeFileSync(join(tmp, 'b.txt'), 'just text\n');
    execSync('git add -A && git commit -q -m add', { cwd: tmp });
    const r = run(['secret-scan', tmp, '--branch', 'cloverleaf/T1']);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).findings).toEqual([]);
  });

  it('usage error when --branch missing', () => {
    const r = run(['secret-scan', tmp]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/secret-scan/);
  });
});

describe('cli — classify-security (v0.8.0)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-classify-sec-'));
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    execSync('git init -q -b main', { cwd: tmp });
    execSync('git config user.email t@t.t', { cwd: tmp });
    execSync('git config user.name t', { cwd: tmp });
    writeFileSync(join(tmp, 'seed.txt'), 'x\n');
    execSync('git add -A && git commit -q -m init', { cwd: tmp });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writeTask(id: string, securityClass?: string): void {
    const doc: Record<string, unknown> = {
      type: 'task', id, project: 'CC', status: 'automated-gates',
      owner: { kind: 'agent', id: 'implementer' }, title: 't',
      context: { rfc: { project: 'CC', id: 'CC-1' } },
      acceptance_criteria: ['a'], definition_of_done: ['d'], risk_class: 'low',
    };
    if (securityClass) doc.security_class = securityClass;
    writeFileSync(join(tmp, `.cloverleaf/tasks/${id}.json`), JSON.stringify(doc) + '\n');
  }

  it('declared high → effective high (no branch needed)', () => {
    writeTask('CC-1', 'high');
    const r = run(['classify-security', tmp, 'CC-1']);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).effective).toBe('high');
  });

  it('declared low + sensitive path in diff → effective high (diff_detected)', () => {
    writeTask('CC-2', 'low');
    execSync('git checkout -q -b cloverleaf/CC-2', { cwd: tmp });
    mkdirSync(join(tmp, 'scripts'), { recursive: true });
    writeFileSync(join(tmp, 'scripts/deploy.sh'), 'echo deploy\n');
    execSync('git add -A && git commit -q -m add', { cwd: tmp });
    const r = run(['classify-security', tmp, 'CC-2', '--branch', 'cloverleaf/CC-2']);
    const out = JSON.parse(r.stdout);
    expect(out.diff_detected).toBe(true);
    expect(out.effective).toBe('high');
    expect(out.matched_paths).toContain('scripts/deploy.sh');
  });

  it('declared low + benign diff → effective low', () => {
    writeTask('CC-3', 'low');
    execSync('git checkout -q -b cloverleaf/CC-3', { cwd: tmp });
    writeFileSync(join(tmp, 'notes.txt'), 'benign\n');
    execSync('git add -A && git commit -q -m add', { cwd: tmp });
    const r = run(['classify-security', tmp, 'CC-3', '--branch', 'cloverleaf/CC-3']);
    expect(JSON.parse(r.stdout).effective).toBe('low');
  });

  it('exits 2 when task missing', () => {
    const r = run(['classify-security', tmp, 'CC-999']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toLowerCase()).toMatch(/task.*cc-999.*not found/);
  });
});

describe('cli — security-gate wiring (v0.8.1)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-sg-'));
    mkdirSync(join(tmp, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
    writeFileSync(
      join(tmp, '.cloverleaf', 'projects', 'SG.json'),
      JSON.stringify({ key: 'SG', name: 'SecurityGate' })
    );
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writeTask(
    id: string,
    status: string,
    securityClass: 'low' | 'high',
    verdict: 'pass' | 'bounce' | 'escalate' | null | undefined
  ): void {
    const doc: Record<string, unknown> = {
      type: 'task',
      id,
      project: 'SG',
      status,
      owner: { kind: 'agent', id: 'implementer' },
      title: 'sg test task',
      context: { rfc: { project: 'SG', id: 'SG-RFC-1' } },
      acceptance_criteria: ['ac'],
      definition_of_done: ['dod'],
      risk_class: 'high',
      security_class: securityClass,
    };
    if (verdict !== undefined) {
      doc.security_review_verdict = verdict;
    }
    writeFileSync(
      join(tmp, '.cloverleaf', 'tasks', `${id}.json`),
      JSON.stringify(doc) + '\n'
    );
  }

  it('advance-status refuses automated-gates → ui-review on high+null with a security-gate error', () => {
    writeTask('SG-1', 'automated-gates', 'high', null);
    const r = run(['advance-status', tmp, 'SG-1', 'ui-review', 'agent', '', 'full_pipeline']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/security.gate|security_review_verdict/);
  });

  it('advance-status allows automated-gates → ui-review on high+pass', () => {
    writeTask('SG-2', 'automated-gates', 'high', 'pass');
    const r = run(['advance-status', tmp, 'SG-2', 'ui-review', 'agent', '', 'full_pipeline']);
    expect(r.exitCode).toBe(0);
    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'SG-2.json'), 'utf-8'));
    expect(task.status).toBe('ui-review');
  });

  it('advance-status allows automated-gates → ui-review on low+null', () => {
    writeTask('SG-3', 'automated-gates', 'low', null);
    const r = run(['advance-status', tmp, 'SG-3', 'ui-review', 'agent', '', 'full_pipeline']);
    expect(r.exitCode).toBe(0);
  });

  it('advance-status allows automated-gates → implementing (escape hatch) even on high+null', () => {
    writeTask('SG-4', 'automated-gates', 'high', null);
    const r = run(['advance-status', tmp, 'SG-4', 'implementing', 'agent']);
    expect(r.exitCode).toBe(0);
    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'SG-4.json'), 'utf-8'));
    expect(task.status).toBe('implementing');
  });
});

// ---------------------------------------------------------------------------
// CLV-104: advance-status: classify-security writeback
// ---------------------------------------------------------------------------

describe('advance-status: classify-security writeback', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-wb-'));
    mkdirSync(join(tmp, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
    writeFileSync(
      join(tmp, '.cloverleaf', 'projects', 'WB.json'),
      JSON.stringify({ key: 'WB', name: 'WritebackTest' })
    );

    // Init git repo so the writeback commit can succeed.
    execSync('git init -q -b main', { cwd: tmp });
    execSync('git config user.email test@test', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    writeFileSync(join(tmp, 'README.md'), 'init\n');
    execSync('git add . && git commit -q -m initial', { cwd: tmp });
    execSync('git checkout -q -b cloverleaf/WB-1', { cwd: tmp });

    // Add a sensitive file to the feature branch so git diff detects it.
    mkdirSync(join(tmp, 'scripts'), { recursive: true });
    writeFileSync(join(tmp, 'scripts', 'deploy.sh'), '#!/bin/bash\necho deploy\n');
    execSync('git add . && git commit -q -m "add deploy script"', { cwd: tmp });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    __setMockClassifyError(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeWbTask(
    id: string,
    status: string,
    securityClass: 'low' | 'high',
    verdict: 'pass' | 'bounce' | 'escalate' | null | undefined
  ): void {
    const doc: Record<string, unknown> = {
      type: 'task', id, project: 'WB', status,
      owner: { kind: 'agent', id: 'implementer' },
      title: 'wb test task',
      context: { rfc: { project: 'WB', id: 'WB-RFC-1' } },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
      risk_class: 'high', security_class: securityClass,
    };
    if (verdict !== undefined) doc.security_review_verdict = verdict;
    writeFileSync(join(tmp, '.cloverleaf', 'tasks', `${id}.json`), JSON.stringify(doc) + '\n');
    execSync('git add . && git commit -q -m "write task"', { cwd: tmp });
  }

  it('declared=low + sensitive diff → writeback fires at documenting→council (security_class becomes high)', () => {
    // git diff main..cloverleaf/WB-1 will include scripts/deploy.sh which matches **/deploy*.sh
    writeWbTask('WB-1', 'documenting', 'low', null);

    // Advance documenting → council: writeback fires and upgrades security_class to high.
    const r = run(['advance-status', tmp, 'WB-1', 'council', 'agent']);
    expect(r.exitCode).toBe(0);

    // Reload from disk — security_class must have been upgraded.
    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'WB-1.json'), 'utf-8'));
    expect(task.security_class).toBe('high');
  });

  it('declared=low + benign diff → no writeback, advance succeeds', () => {
    // Use the mock to inject a benign (non-sensitive) file list; classifyTaskSecurity
    // will return effective='low', so no writeback fires and the advance succeeds.
    const tmp3 = mkdtempSync(join(tmpdir(), 'cl-wb-benign-'));
    try {
      mkdirSync(join(tmp3, '.cloverleaf', 'projects'), { recursive: true });
      mkdirSync(join(tmp3, '.cloverleaf', 'tasks'), { recursive: true });
      mkdirSync(join(tmp3, '.cloverleaf', 'events'), { recursive: true });
      writeFileSync(
        join(tmp3, '.cloverleaf', 'projects', 'WB.json'),
        JSON.stringify({ key: 'WB', name: 'WritebackTest' })
      );
      const doc: Record<string, unknown> = {
        type: 'task', id: 'WB-2', project: 'WB', status: 'documenting',
        owner: { kind: 'agent', id: 'implementer' },
        title: 'wb test task',
        context: { rfc: { project: 'WB', id: 'WB-RFC-1' } },
        acceptance_criteria: ['ac'], definition_of_done: ['dod'],
        risk_class: 'high', security_class: 'low', security_review_verdict: null,
      };
      writeFileSync(join(tmp3, '.cloverleaf', 'tasks', 'WB-2.json'), JSON.stringify(doc) + '\n');
      // Inject a benign file list; none match path_patterns, so effective='low'.
      __setMockChangedFiles(['README.md']);
      const result = advanceStatus(tmp3, 'WB-2', 'council', 'agent');
      expect(result.status).toBe('council');
      const task = JSON.parse(readFileSync(join(tmp3, '.cloverleaf', 'tasks', 'WB-2.json'), 'utf-8'));
      expect(task.status).toBe('council');
      expect(task.security_class).toBe('low');
    } finally {
      __setMockChangedFiles(null);
      rmSync(tmp3, { recursive: true, force: true });
    }
  });

  it('classify-security exception → stderr contains classify-security and high; writeback still fires at council entry', () => {
    // Force classifyTaskSecurity to throw via the testing seam to exercise the
    // error-fallback path in advanceStatus. We call advanceStatus directly (not via CLI).
    const tmp4 = mkdtempSync(join(tmpdir(), 'cl-wb-exc-'));
    // Capture stderr writes so we can assert on them.
    let stderrCapture = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    const patchedWrite = (chunk: Uint8Array | string, ...rest: unknown[]): boolean => {
      stderrCapture += String(chunk);
      // @ts-expect-error — we pass rest through even though types are tricky
      return origWrite(chunk, ...rest);
    };
    process.stderr.write = patchedWrite as typeof process.stderr.write;

    __setMockClassifyError(new Error('mock git error: repository not found'));
    try {
      mkdirSync(join(tmp4, '.cloverleaf', 'projects'), { recursive: true });
      mkdirSync(join(tmp4, '.cloverleaf', 'tasks'), { recursive: true });
      mkdirSync(join(tmp4, '.cloverleaf', 'events'), { recursive: true });
      writeFileSync(
        join(tmp4, '.cloverleaf', 'projects', 'WB.json'),
        JSON.stringify({ key: 'WB', name: 'WritebackTest' })
      );
      // Task with security_class: 'low' — error path treats effective='high' and upgrades.
      const doc: Record<string, unknown> = {
        type: 'task', id: 'WB-3', project: 'WB', status: 'documenting',
        owner: { kind: 'agent', id: 'implementer' },
        title: 'wb exc task',
        context: { rfc: { project: 'WB', id: 'WB-RFC-1' } },
        acceptance_criteria: ['ac'], definition_of_done: ['dod'],
        risk_class: 'high', security_class: 'low', security_review_verdict: null,
      };
      writeFileSync(join(tmp4, '.cloverleaf', 'tasks', 'WB-3.json'), JSON.stringify(doc) + '\n');

      // advanceStatus catches the throw, emits stderr, treats effective='high'.
      // Writeback fires (best-effort git commit skipped — no git repo).
      // The advance documenting → council succeeds (no mechanical gate); security_class is upgraded.
      advanceStatus(tmp4, 'WB-3', 'council', 'agent');

      // Stderr must mention 'classify-security' and 'high'.
      expect(stderrCapture).toMatch(/classify-security/);
      expect(stderrCapture).toMatch(/high/);

      // Writeback upgraded security_class to high.
      const task = JSON.parse(readFileSync(join(tmp4, '.cloverleaf', 'tasks', 'WB-3.json'), 'utf-8'));
      expect(task.security_class).toBe('high');
    } finally {
      process.stderr.write = origWrite as typeof process.stderr.write;
      __setMockClassifyError(null);
      rmSync(tmp4, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CLV-104: advance-status: verdict reset on review → automated-gates
// ---------------------------------------------------------------------------

describe('advance-status: verdict reset on review → automated-gates', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-vr-'));
    mkdirSync(join(tmp, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
    writeFileSync(
      join(tmp, '.cloverleaf', 'projects', 'VR.json'),
      JSON.stringify({ key: 'VR', name: 'VerdictReset' })
    );
    execSync('git init -q -b main', { cwd: tmp });
    execSync('git config user.email test@test', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    writeFileSync(join(tmp, 'seed.txt'), 'x\n');
    execSync('git add . && git commit -q -m init', { cwd: tmp });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writeVrTask(
    id: string,
    status: string,
    verdict: 'pass' | 'bounce' | 'escalate' | null | undefined
  ): void {
    const doc: Record<string, unknown> = {
      type: 'task', id, project: 'VR', status,
      owner: { kind: 'agent', id: 'implementer' },
      title: 'vr test task',
      context: { rfc: { project: 'VR', id: 'VR-RFC-1' } },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
      risk_class: 'high', security_class: 'low',
    };
    if (verdict !== undefined) doc.security_review_verdict = verdict;
    writeFileSync(join(tmp, '.cloverleaf', 'tasks', `${id}.json`), JSON.stringify(doc) + '\n');
    execSync('git add . && git commit -q -m "write task"', { cwd: tmp });
  }

  it('review → automated-gates resets security_review_verdict=pass to null; single commit with both messages', () => {
    writeVrTask('VR-1', 'review', 'pass');
    const r = run(['advance-status', tmp, 'VR-1', 'automated-gates', 'agent']);
    expect(r.exitCode).toBe(0);

    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'VR-1.json'), 'utf-8'));
    expect(task.status).toBe('automated-gates');
    expect(task.security_review_verdict).toBeNull();

    // Verify a single commit with the combined message.
    const log = execSync('git log --oneline -1', { cwd: tmp, encoding: 'utf-8' }).trim();
    expect(log).toMatch(/status review → automated-gates/);
    expect(log).toMatch(/security_review_verdict → null/);
  });

  it('verdict reset is idempotent: verdict=null remains null after review → automated-gates', () => {
    writeVrTask('VR-2', 'review', null);
    const r = run(['advance-status', tmp, 'VR-2', 'automated-gates', 'agent']);
    expect(r.exitCode).toBe(0);

    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'VR-2.json'), 'utf-8'));
    expect(task.status).toBe('automated-gates');
    expect(task.security_review_verdict).toBeNull();
  });

  it('security-review → automated-gates does NOT reset security_review_verdict', () => {
    writeVrTask('VR-3', 'security-review', 'pass');
    const r = run(['advance-status', tmp, 'VR-3', 'automated-gates', 'agent']);
    expect(r.exitCode).toBe(0);

    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'VR-3.json'), 'utf-8'));
    expect(task.status).toBe('automated-gates');
    expect(task.security_review_verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// CLV-105: advance-status: security-gate refusal exit code
// ---------------------------------------------------------------------------

describe('CLI advance-status: security-gate refusal exit code', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-sgec-'));
    mkdirSync(join(tmp, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
    writeFileSync(
      join(tmp, '.cloverleaf', 'projects', 'SGE.json'),
      JSON.stringify({ key: 'SGE', name: 'SecurityGateExit' })
    );
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('high+null task attempting a guarded transition exits with code 2 and canonical stderr', () => {
    writeFileSync(
      join(tmp, '.cloverleaf', 'tasks', 'SGE-1.json'),
      JSON.stringify({
        type: 'task',
        id: 'SGE-1',
        project: 'SGE',
        status: 'automated-gates',
        owner: { kind: 'agent', id: 'implementer' },
        title: 'sg exit test',
        context: { rfc: { project: 'SGE', id: 'SGE-RFC-1' } },
        acceptance_criteria: ['ac'],
        definition_of_done: ['dod'],
        risk_class: 'high',
        security_class: 'high',
        security_review_verdict: null,
      }) + '\n'
    );

    const r = run(['advance-status', tmp, 'SGE-1', 'ui-review', 'agent', '', 'full_pipeline']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/security_review_verdict/);
    expect(r.stderr).toMatch(/pass/);
    expect(r.stderr).toMatch(/Advance to security-review first/i);
  });
});

// ---------------------------------------------------------------------------
// CLV-105: set-task-field subcommand
// ---------------------------------------------------------------------------

describe('CLI set-task-field', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-stf-'));
    mkdirSync(join(tmp, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    writeFileSync(
      join(tmp, '.cloverleaf', 'projects', 'STF.json'),
      JSON.stringify({ key: 'STF', name: 'SetTaskField' })
    );
    writeFileSync(
      join(tmp, '.cloverleaf', 'tasks', 'STF-1.json'),
      JSON.stringify({
        type: 'task',
        id: 'STF-1',
        project: 'STF',
        status: 'security-review',
        owner: { kind: 'agent', id: 'implementer' },
        title: 'set field test',
        context: { rfc: { project: 'STF', id: 'STF-RFC-1' } },
        acceptance_criteria: ['ac'],
        definition_of_done: ['dod'],
        risk_class: 'high',
        security_class: 'high',
        security_review_verdict: null,
      }) + '\n'
    );
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes security_review_verdict=pass and persists it as string "pass"', () => {
    const r = run(['set-task-field', tmp, 'STF-1', 'security_review_verdict', 'pass']);
    expect(r.exitCode).toBe(0);
    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'STF-1.json'), 'utf-8'));
    expect(task.security_review_verdict).toBe('pass');
  });

  it('writes the literal string "null" and persists it as JSON null (not string)', () => {
    // First set a non-null value
    run(['set-task-field', tmp, 'STF-1', 'security_review_verdict', 'pass']);
    // Then set to null
    const r = run(['set-task-field', tmp, 'STF-1', 'security_review_verdict', 'null']);
    expect(r.exitCode).toBe(0);
    const task = JSON.parse(readFileSync(join(tmp, '.cloverleaf', 'tasks', 'STF-1.json'), 'utf-8'));
    expect(task.security_review_verdict).toBeNull();
    expect(typeof task.security_review_verdict).not.toBe('string');
  });

  it('rejects "status" (not on the allowlist) with a non-zero exit and stderr naming allowed fields', () => {
    const r = run(['set-task-field', tmp, 'STF-1', 'status', 'merged']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/security_review_verdict/);
  });
});

describe('council CLI stderr hygiene (F1)', () => {
  // A non-git temp repo with a consumer council.json + a review task, and NO
  // cloverleaf/<task> branch → every council git-diff range is unresolvable.
  function councilRepo(): string {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-f1-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify({
        id: 'DEMO-001', type: 'task', status: 'review', project: 'DEMO', title: 't',
        owner: { kind: 'agent', id: 'unassigned' },
        context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
        acceptance_criteria: ['a'], definition_of_done: ['d'],
        risk_class: 'high', security_class: 'high',
      }),
    );
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'config', 'council.json'),
      JSON.stringify({
        profiles: { p: { rounds: [[{ member: 'reviewer' }, { member: 'qa' }]], aggregation: 'any-veto' } },
        gates: { 'task.review': 'p' },
      }),
    );
    return repoRoot;
  }

  const GIT_NOISE = /fatal|Not a git repository|--no-index|usage: git diff/;

  it('council-plan does not leak a git usage block to stderr (council.ts site)', () => {
    const repoRoot = councilRepo();
    const res = spawnSync('npx', ['tsx', CLI, 'council-plan', repoRoot, 'DEMO-001', 'task.review'], {
      encoding: 'utf-8',
    });
    expect(res.stderr).not.toMatch(GIT_NOISE);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('apply-council-verdict does not leak a git usage block to stderr (security-classify.ts site)', () => {
    const repoRoot = councilRepo();
    const verdict = JSON.stringify({
      verdict: 'pass', rule: 'any-veto', rationale: 'ok',
      members: [{ member: 'reviewer', verdict: 'pass' }, { member: 'qa', verdict: 'pass' }],
    });
    const res = spawnSync(
      'npx', ['tsx', CLI, 'apply-council-verdict', repoRoot, 'DEMO-001', 'task.review', verdict],
      { encoding: 'utf-8' },
    );
    expect(res.stderr).not.toMatch(GIT_NOISE);
    rmSync(repoRoot, { recursive: true, force: true });
  });
});

describe('cli — qa-report', () => {
  it('exits 2 with usage when no args are given', () => {
    const { exitCode, stderr } = run(['qa-report']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/qa-report requires <runs\.json> <out\.html>/);
  });

  it('exits 2 with usage when only one arg is given', () => {
    const { exitCode, stderr } = run(['qa-report', 'only.json']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/qa-report requires <runs\.json> <out\.html>/);
  });
});

// ---------------------------------------------------------------------------
// B2: validate-council subcommand
// ---------------------------------------------------------------------------

describe('cli — validate-council', () => {
  it('exits 0 for a kind-homogeneous code profile bound to task.review', () => {
    const repo = mkdtempSync(join(tmpdir(), 'clv-vc-ok-'));
    mkdirSync(join(repo, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repo, '.cloverleaf', 'config', 'council.json'), JSON.stringify(
      { profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } }, gates: { 'task.review': 'p' } }));
    try {
      const { status, stdout } = (() => {
        const r = run(['validate-council', repo]);
        return { status: r.exitCode, stdout: r.stdout };
      })();
      expect(status).toBe(0);
      expect(stdout).toMatch(/OK/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('exits 1 when a plan gate is bound to a code-kind profile', () => {
    const repo = mkdtempSync(join(tmpdir(), 'clv-vc-fail-'));
    mkdirSync(join(repo, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repo, '.cloverleaf', 'config', 'council.json'), JSON.stringify(
      { profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } }, gates: { 'plan.task_batch': 'p' } }));
    try {
      const { status, stderr } = (() => {
        const r = run(['validate-council', repo]);
        return { status: r.exitCode, stderr: r.stderr };
      })();
      expect(status).toBe(1);
      expect(stderr).toMatch(/council-config/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

