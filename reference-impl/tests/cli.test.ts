import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '..', 'lib', 'cli.ts');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
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
});
