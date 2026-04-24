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

  it('exits non-zero with a clear error when the worktree is not primed', () => {
    // Missing package.json is enough for prep-worktree to bail — exercising the CLI wiring,
    // not the lib itself (lib has its own unit tests).
    const mainTmp = mkdtempSync(join(tmpdir(), 'cli-prep-main-'));
    const wtTmp = mkdtempSync(join(tmpdir(), 'cli-prep-wt-'));
    try {
      const { exitCode, stderr } = run(['prep-worktree', mainTmp, wtTmp]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/package\.json|node_modules/);
    } finally {
      rmSync(mainTmp, { recursive: true, force: true });
      rmSync(wtTmp, { recursive: true, force: true });
    }
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
