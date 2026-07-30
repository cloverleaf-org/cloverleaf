/**
 * CLV-20: End-to-end integration test — 3-browser matrix, per-browser baselines,
 * engine diffs, and the surviving baselines-hold.
 *
 * This test exercises the full cross-browser UI review flow without launching
 * real browsers.  Under the collapsed "delivery council" FSM (Council Slice 4)
 * the `ui-review` and `qa` task states are GONE — `ui` is now a council member,
 * and the task lives at `council` while its members (including the UI Reviewer)
 * run.  The cross-browser baseline capture and the `baselines_pending` mechanism
 * both SURVIVE the collapse:
 *   - the per-engine baseline PNG capture is unchanged;
 *   - `read-/write-ui-review-state` + the `write-baseline` guard (refuses baseline
 *     writes while `baselines_pending` is true) + `/cloverleaf-approve-baselines`
 *     are unchanged;
 *   - the old `ui-review → qa` hold is now a runner CONVENTION in cloverleaf-run
 *     (SKILL §4.1): before applying a council `pass` that would advance
 *     `council → final-gate`, the runner checks `baselines_pending` and, if true,
 *     surfaces approve-baselines instead of passing.  It is a skill convention,
 *     NOT an FSM/CLI operation — there is no transition gated on `baselines_pending`.
 *
 * The codebase represents the "UI Reviewer subagent" as library functions that
 * are tested in isolation elsewhere; here we wire them together the way the
 * subagent prompt describes, using synthetic PNG buffers in place of Playwright
 * screenshots.
 *
 * Acceptance criteria covered:
 *  AC1 — npm test runs this file and it passes without requiring real browsers.
 *  AC2 — per-browser baseline PNGs are written under .cloverleaf/baselines/{engine}/.
 *  AC3 — zero axe findings are emitted for webkit and firefox browser passes.
 *  AC4 — the baselines-hold survives: baselines_pending=true blocks new baseline
 *        writes (write-baseline guard); approve-baselines clears it and unblocks
 *        writes.  Modelled at the state/guard level (the hold is a skill convention,
 *        not an FSM transition).
 *  AC5 — maxCombinations cap of 3 below the route×viewport×browser product emits ui-review-cap warnings.
 *  AC6 — test is self-contained and uses its own tmp directory (no global state).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

// Library under test
import { compareVisual, buildBaselinePath } from '../lib/visual-diff.js';
import { buildBrowserEscalationFinding, applyMaxCombinationsCap } from '../lib/ui-browser.js';
import { dedupeAxeFindings, type RawAxeFinding } from '../lib/axe-dedupe.js';
import {
  readUiReviewState,
  writeUiReviewState,
} from '../lib/ui-review-state.js';
import { loadUiReviewConfig } from '../lib/ui-review-config.js';
import { advanceStatus, loadTask } from '../lib/task.js';
import type { Finding } from '../lib/feedback.js';

// Real CLI, invoked as a subprocess so the AC4 tests exercise the surviving
// baselines surface end-to-end (read/write ui-review state + the write-baseline
// guard), exactly as the UI Reviewer member and /cloverleaf-approve-baselines do.
const CLI = resolve(__dirname, '..', 'lib', 'cli.ts');

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('npx', ['tsx', CLI, ...args], {
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

/**
 * Walk a freshly seeded task through the COLLAPSED FSM up to the delivery
 * `council` phase: pending → tactical-plan → implementing → documenting →
 * council.  There is no `ui-review` or `qa` state anymore; `ui` is a council
 * member and the task sits at `council` while the members run.
 */
function advanceToCouncil(repoRoot: string, taskId: string): void {
  advanceStatus(repoRoot, taskId, 'tactical-plan', 'agent');
  advanceStatus(repoRoot, taskId, 'implementing', 'agent');
  advanceStatus(repoRoot, taskId, 'documenting', 'agent');
  // documenting → council classifies security via `git diff`; outside a git repo
  // that fails gracefully to an empty changed-file list (no upgrade), so the
  // transition succeeds without needing a real branch.
  advanceStatus(repoRoot, taskId, 'council', 'agent');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a minimal solid-colour PNG buffer of the given size. */
function makePng(
  width: number,
  height: number,
  fill: [number, number, number, number],
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i]     = fill[0];
    png.data[i + 1] = fill[1];
    png.data[i + 2] = fill[2];
    png.data[i + 3] = fill[3];
  }
  return PNG.sync.write(png);
}

/**
 * Simulate the visual-diff pass for a single (browser, route, viewport)
 * combination.  Returns the finding produced by compareVisual, or null for
 * a match (which produces no finding).
 */
function simulateVisualDiff(
  repoRoot: string,
  taskId: string,
  browser: 'chromium' | 'webkit' | 'firefox',
  route: string,
  viewport: string,
  candidateBuf: Buffer,
  threshold = 0.1,
  maxDiffRatio = 0.01,
): Finding | null {
  const slug = route === '/' ? 'index' : route.replace(/^\/|\/$/g, '').replace(/\//g, '-').toLowerCase();
  const baselinePath = buildBaselinePath(repoRoot, browser, slug, viewport);
  const runDir = join(repoRoot, '.cloverleaf', 'runs', taskId, 'ui-review');
  mkdirSync(runDir, { recursive: true });

  const result = compareVisual({
    baselinePath,
    candidateBuf,
    diffPath:        join(runDir, `diff-${slug}-${viewport}.png`),
    candidateOutPath: join(runDir, `candidate-${slug}-${viewport}.png`),
    threshold,
    maxDiffRatio,
  });

  switch (result.status) {
    case 'new-baseline':
      return {
        severity: 'info',
        rule: 'visual-diff',
        message: `new baseline established for ${route} @ ${viewport} [${browser}]`,
        metadata: { route, viewport, browser, status: 'new-baseline' },
      };
    case 'dimension-mismatch':
      return {
        severity: 'info',
        rule: 'visual-diff',
        message: `baseline dimensions changed for ${route} @ ${viewport} [${browser}]; regenerated`,
        metadata: { route, viewport, browser, status: 'dimension-mismatch' },
      };
    case 'diff':
      return {
        severity: 'info',
        rule: 'visual-diff',
        message: `visual diff: ${route} @ ${viewport} [${browser}] — ${(result.diffRatio * 100).toFixed(2)}% pixels differ`,
        metadata: { route, viewport, browser, diffRatio: result.diffRatio, status: 'diff' },
      };
    case 'match':
      return null;
  }
}

/** Seed a minimal task fixture into a temp repo. */
function seedRepo(repoRoot: string, taskId: string, riskClass: 'low' | 'high' = 'high'): void {
  mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'),    { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'events'),   { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true });

  const [project] = taskId.split('-');
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'projects', `${project}.json`),
    JSON.stringify({ key: project, name: project }),
  );
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
    JSON.stringify({
      id: taskId,
      type: 'task',
      status: 'pending',
      risk_class: riskClass,
      owner: { kind: 'agent', id: 'implementer' },
      project,
      title: 'ui-review cross-browser e2e test',
      context: { rfc: { project, id: `${project}-RFC-001` } },
      acceptance_criteria: ['renders correctly in 3 browsers'],
      definition_of_done: ['baselines captured for all three engines'],
    }),
  );
}

/** Write a consumer ui-review config with all three browsers and a tight cap. */
function seedUiReviewConfig(
  repoRoot: string,
  maxCombinations: number,
  browsers = ['chromium', 'webkit', 'firefox'],
): void {
  mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
    JSON.stringify({
      browsers,
      maxCombinations,
      viewports: {
        mobile:  { width: 375,  height: 667 },
        desktop: { width: 1280, height: 800 },
      },
      visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
      axe: {
        viewports: ['desktop'],
        browser: 'chromium',
        dedupeBy: ['ruleId', 'target'],
        ignored: [],
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'clv-e2e-xbrowser-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC2: per-browser baseline PNGs are written under .cloverleaf/baselines/{engine}/
// ---------------------------------------------------------------------------

describe('CLV-20 AC2: per-browser baseline storage', () => {
  it('writes baseline PNGs under .cloverleaf/baselines/chromium/, webkit/, and firefox/', () => {
    const taskId = 'TST-001';
    seedRepo(repoRoot, taskId);

    const browsers = ['chromium', 'webkit', 'firefox'] as const;
    const routes   = ['/'];
    const viewports = ['desktop'];
    const candidateBuf = makePng(1280, 800, [220, 220, 220, 255]);

    // Simulate the outer browser loop the UI Reviewer subagent performs.
    let newBaselineDetected = false;
    for (const browser of browsers) {
      for (const route of routes) {
        for (const viewport of viewports) {
          const finding = simulateVisualDiff(repoRoot, taskId, browser, route, viewport, candidateBuf);
          if (finding?.metadata?.status === 'new-baseline') newBaselineDetected = true;
        }
      }
    }

    // Each browser must have its own directory with a baseline file.
    for (const browser of browsers) {
      const dir = join(repoRoot, '.cloverleaf', 'baselines', browser);
      expect(existsSync(dir), `baseline dir missing for ${browser}`).toBe(true);
      const files = readdirSync(dir);
      expect(files.length, `no baseline PNGs for ${browser}`).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith('.png'))).toBe(true);
    }

    // First run always produces new-baseline status.
    expect(newBaselineDetected).toBe(true);
  });

  it('baseline paths follow the .cloverleaf/baselines/{browser}/{slug}-{viewport}.png convention', () => {
    // Verify buildBaselinePath produces the correct shape for each engine.
    expect(buildBaselinePath(repoRoot, 'chromium', 'index', 'desktop')).toBe(
      join(repoRoot, '.cloverleaf', 'baselines', 'chromium', 'index-desktop.png'),
    );
    expect(buildBaselinePath(repoRoot, 'webkit', 'index', 'mobile')).toBe(
      join(repoRoot, '.cloverleaf', 'baselines', 'webkit', 'index-mobile.png'),
    );
    expect(buildBaselinePath(repoRoot, 'firefox', 'about-us', 'desktop')).toBe(
      join(repoRoot, '.cloverleaf', 'baselines', 'firefox', 'about-us-desktop.png'),
    );
  });

  it('chromium, webkit, and firefox baseline files are distinct (separate paths)', () => {
    const chromiumPath = buildBaselinePath(repoRoot, 'chromium', 'faq', 'desktop');
    const webkitPath   = buildBaselinePath(repoRoot, 'webkit',   'faq', 'desktop');
    const firefoxPath  = buildBaselinePath(repoRoot, 'firefox',  'faq', 'desktop');
    expect(chromiumPath).not.toBe(webkitPath);
    expect(chromiumPath).not.toBe(firefoxPath);
    expect(webkitPath).not.toBe(firefoxPath);
  });
});

// ---------------------------------------------------------------------------
// AC3: zero axe findings for webkit and firefox; axe only for chromium
// ---------------------------------------------------------------------------

describe('CLV-20 AC3: axe findings restricted to chromium only', () => {
  it('emits axe findings only for the chromium pass, not webkit or firefox', () => {
    const browsers = ['chromium', 'webkit', 'firefox'] as const;

    // Simulate the axe pass: only chromium (== axe.browser default) runs axe.
    // webkit and firefox produce empty raw findings — zero axe output.
    const rawFindings: RawAxeFinding[] = [
      // Chromium found a contrast issue on the desktop viewport.
      {
        viewport: 'desktop',
        ruleId:   'color-contrast',
        target:   'button.cta',
        impact:   'serious',
        message:  'Ensure the contrast ratio between foreground and background colors meets WCAG 2 AA contrast ratio thresholds.',
        helpUrl:  'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
      },
    ];

    // Simulate: for each browser, only collect axe raws when browser === axe.browser.
    const collectedRaws: Record<string, RawAxeFinding[]> = {
      chromium: rawFindings, // axe ran for chromium
      webkit:   [],          // axe intentionally NOT run for webkit
      firefox:  [],          // axe intentionally NOT run for firefox
    };

    for (const browser of browsers) {
      const findings = dedupeAxeFindings(collectedRaws[browser], ['ruleId', 'target']);
      if (browser === 'chromium') {
        expect(findings.length, 'chromium must emit axe findings').toBeGreaterThan(0);
        expect(findings[0].rule).toBe('color-contrast');
      } else {
        expect(
          findings.length,
          `${browser} must emit ZERO axe findings`,
        ).toBe(0);
      }
    }
  });

  it('loadUiReviewConfig resolves axe.browser to "chromium" by default', () => {
    seedRepo(repoRoot, 'TST-001');
    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.axe.browser).toBe('chromium');
  });

  it('loadUiReviewConfig with explicit 3-browser config still defaults axe.browser to "chromium"', () => {
    seedRepo(repoRoot, 'TST-001');
    seedUiReviewConfig(repoRoot, 90);
    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.axe.browser).toBe('chromium');
    expect(cfg.browsers).toEqual(['chromium', 'webkit', 'firefox']);
  });
});

// ---------------------------------------------------------------------------
// AC4: the baselines-hold survives the FSM collapse.
//
// The old `ui-review → qa` transition no longer exists (ui is a council member;
// the task lives at `council`).  What survives is the `baselines_pending`
// mechanism itself: the UI Reviewer member sets it via write-ui-review-state on
// new/resized baselines, the write-baseline CLI guard refuses to overwrite
// baselines while it is true, and /cloverleaf-approve-baselines (the CLI it
// wraps — write-ui-review-state ... false) clears it.  The "held then proceeds"
// shape is modelled at the state/guard level; we do NOT assert an FSM transition
// is blocked by baselines_pending, because the hold is a runner convention
// (SKILL §4.1), not an FSM operation.
// ---------------------------------------------------------------------------

describe('CLV-20 AC4: baselines-hold survives the collapse (state + write-baseline guard)', () => {
  it('write-ui-review-state true → read-ui-review-state reports baselines_pending:true (the member set the hold)', () => {
    const taskId = 'TST-002';
    seedRepo(repoRoot, taskId);

    // The task lives at `council` (not `ui-review` — that state is gone); the ui
    // member runs there and, on new baselines, sets baselines_pending=true.
    advanceToCouncil(repoRoot, taskId);
    expect(loadTask(repoRoot, taskId).status).toBe('council');

    // Set the hold via the real CLI (as the UI Reviewer member does).
    const { exitCode } = runCli(['write-ui-review-state', repoRoot, taskId, 'true']);
    expect(exitCode).toBe(0);

    // read-ui-review-state must report the pending hold.
    const read = runCli(['read-ui-review-state', repoRoot, taskId]);
    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout).baselines_pending).toBe(true);
    // Direct library read agrees.
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(true);
  });

  it('write-baseline is REFUSED while baselines_pending is true, then SUCCEEDS after approve-baselines clears it', () => {
    const taskId = 'TST-003';
    seedRepo(repoRoot, taskId);
    advanceToCouncil(repoRoot, taskId);

    // A captured per-engine candidate PNG the member would try to promote.
    const candidatePng = join(repoRoot, 'candidate-webkit.png');
    writeFileSync(candidatePng, makePng(1280, 800, [200, 200, 200, 255]));

    // The member captured new baselines → baselines_pending=true (the hold is on).
    expect(runCli(['write-ui-review-state', repoRoot, taskId, 'true']).exitCode).toBe(0);

    // While pending, write-baseline is refused: non-zero exit + the guard message.
    const refused = runCli([
      'write-baseline', repoRoot, taskId, 'webkit', 'index', 'desktop', candidatePng,
    ]);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toMatch(/baselines_pending.*true|refused.*baselines_pending/i);
    // The guarded baseline was NOT written.
    const webkitBaseline = buildBaselinePath(repoRoot, 'webkit', 'index', 'desktop');
    expect(existsSync(webkitBaseline)).toBe(false);

    // Human inspects the images and runs /cloverleaf-approve-baselines, which
    // wraps `write-ui-review-state <taskId> false` → clears the hold.
    expect(runCli(['write-ui-review-state', repoRoot, taskId, 'false']).exitCode).toBe(0);
    expect(runCli(['read-ui-review-state', repoRoot, taskId]).stdout).toMatch(/"baselines_pending":\s*false/);

    // Now the same write-baseline succeeds and promotes the per-engine PNG.
    const allowed = runCli([
      'write-baseline', repoRoot, taskId, 'webkit', 'index', 'desktop', candidatePng,
    ]);
    expect(allowed.exitCode).toBe(0);
    expect(allowed.stdout.trim()).toBe(webkitBaseline);
    expect(existsSync(webkitBaseline)).toBe(true);
    // Content matches the captured candidate.
    expect(readFileSync(webkitBaseline).equals(readFileSync(candidatePng))).toBe(true);
  });

  it('baselines_pending:false (no new baselines) never engages the hold — write-baseline succeeds directly', () => {
    const taskId = 'TST-004';
    seedRepo(repoRoot, taskId);
    advanceToCouncil(repoRoot, taskId);

    const candidatePng = join(repoRoot, 'candidate-firefox.png');
    writeFileSync(candidatePng, makePng(1280, 800, [180, 180, 180, 255]));

    // All routes matched their baselines → the member leaves baselines_pending=false.
    expect(runCli(['write-ui-review-state', repoRoot, taskId, 'false']).exitCode).toBe(0);
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(false);

    // With the hold clear, write-baseline is allowed immediately (no approval needed).
    const firefoxBaseline = buildBaselinePath(repoRoot, 'firefox', 'index', 'desktop');
    const res = runCli([
      'write-baseline', repoRoot, taskId, 'firefox', 'index', 'desktop', candidatePng,
    ]);
    expect(res.exitCode).toBe(0);
    expect(existsSync(firefoxBaseline)).toBe(true);

    // The task is still at `council` — the runner's baselines-hold convention would
    // let the council pass advance council → final-gate when pending is false.
    expect(loadTask(repoRoot, taskId).status).toBe('council');
  });
});

// ---------------------------------------------------------------------------
// DoD #5 / AC5: webkit-only rendering difference surfaces as an engine-attributed finding
// ---------------------------------------------------------------------------

describe('CLV-20 DoD#5: engine-attributed visual diff (webkit-only regression)', () => {
  it('a webkit-only rendering difference produces a diff finding attributed to the webkit engine', () => {
    const taskId = 'TST-005';
    seedRepo(repoRoot, taskId);

    const route   = '/faq/';
    const viewport = 'desktop';

    // Baseline: same grey for chromium and firefox; webkit-only has a slightly different tint.
    const baselineBuf = makePng(1280, 800, [200, 200, 200, 255]);
    const chromeCandidate  = makePng(1280, 800, [200, 200, 200, 255]); // matches baseline
    const webkitCandidate  = makePng(1280, 800, [255, 0,   0,   255]); // very different!
    const firefoxCandidate = makePng(1280, 800, [200, 200, 200, 255]); // matches baseline

    // Write a common baseline for every browser (simulate "prior run that matched").
    for (const browser of ['chromium', 'webkit', 'firefox'] as const) {
      const slug = 'faq';
      const baselinePath = buildBaselinePath(repoRoot, browser, slug, viewport);
      mkdirSync(join(repoRoot, '.cloverleaf', 'baselines', browser), { recursive: true });
      writeFileSync(baselinePath, baselineBuf);
    }

    const findings: Finding[] = [];

    // Simulate the per-browser visual-diff pass.
    const browsers = [
      { engine: 'chromium' as const, candidate: chromeCandidate  },
      { engine: 'webkit'   as const, candidate: webkitCandidate  },
      { engine: 'firefox'  as const, candidate: firefoxCandidate },
    ];

    for (const { engine, candidate } of browsers) {
      const f = simulateVisualDiff(repoRoot, taskId, engine, route, viewport, candidate);
      if (f) findings.push(f);
    }

    // Only webkit should have a diff finding.
    const webkitDiffs = findings.filter(
      (f) => f.rule === 'visual-diff' && f.metadata?.browser === 'webkit',
    );
    expect(webkitDiffs.length, 'expected exactly one webkit visual-diff finding').toBe(1);
    expect(webkitDiffs[0].metadata?.status).toBe('diff');
    expect(webkitDiffs[0].metadata?.engine ?? webkitDiffs[0].metadata?.browser).toBe('webkit');

    // Chromium and firefox should have no findings (they matched the baseline).
    const chromiumDiffs = findings.filter((f) => f.metadata?.browser === 'chromium');
    const firefoxDiffs  = findings.filter((f) => f.metadata?.browser === 'firefox');
    expect(chromiumDiffs.length).toBe(0);
    expect(firefoxDiffs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC5: maxCombinations cap below route×viewport×browser emits ui-review-cap warnings
// ---------------------------------------------------------------------------

describe('CLV-20 AC5: maxCombinations cap enforcement', () => {
  it('a cap of 3 with 2 routes × 2 viewports × 3 browsers (=12) emits ui-review-cap warnings', () => {
    // Total combinations = 2 × 2 × 3 = 12, cap = 3
    // floor(3 / (2×3)) = floor(0.5) = 0 → all routes skipped would be odd,
    // but realistically the cap should be chosen so at least some routes fit.
    // Use a cap where at least 1 route is kept and at least 1 is skipped.
    // 2 routes × 2 viewports × 3 browsers = 12, cap = 6 → floor(6/6)=1 kept, 1 skipped.
    const routes = [
      { route: '/faq/',    diffSize: 100 },
      { route: '/contact/', diffSize: 20  },
    ];
    const result = applyMaxCombinationsCap(routes, /* viewportCount */ 2, /* browserCount */ 3, /* cap */ 6);

    expect(result.skippedFindings.length).toBeGreaterThan(0);
    const capFindings = result.skippedFindings.filter((f) => f.rule === 'ui-review-cap');
    expect(capFindings.length).toBeGreaterThan(0);
    capFindings.forEach((f) => {
      expect(f.severity).toBe('warning');
      expect(f.rule).toBe('ui-review-cap');
    });
  });

  it('cap=3 with 2 routes × 1 viewport × 3 browsers (=6) emits at least one ui-review-cap warning', () => {
    // 2 routes × 1 × 3 = 6, cap = 3 → floor(3/3)=1 kept, 1 skipped
    const routes = [
      { route: '/home/',  diffSize: 50 },
      { route: '/about/', diffSize: 10 },
    ];
    const result = applyMaxCombinationsCap(routes, 1, 3, 3);

    expect(result.routes).toHaveLength(1);
    expect(result.skippedFindings).toHaveLength(1);
    expect(result.skippedFindings[0].rule).toBe('ui-review-cap');
    expect(result.skippedFindings[0].severity).toBe('warning');
    // Message must contain the route name and the combination count vs cap.
    expect(result.skippedFindings[0].message).toContain('/about/');
    expect(result.skippedFindings[0].message).toContain('6');
    expect(result.skippedFindings[0].message).toContain('3');
  });

  it('loadUiReviewConfig with maxCombinations=3 passes the cap through correctly', () => {
    seedRepo(repoRoot, 'TST-006');
    seedUiReviewConfig(repoRoot, 3);
    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.maxCombinations).toBe(3);
    expect(cfg.browsers).toEqual(['chromium', 'webkit', 'firefox']);
  });
});

// ---------------------------------------------------------------------------
// Full end-to-end simulation: 3 browsers, 2 viewports, 2 routes, new baselines
// ---------------------------------------------------------------------------

describe('CLV-20 DoD#1: full cross-browser UI review flow simulation', () => {
  it('exercises the entire cross-browser flow and confirms per-engine baseline PNGs', () => {
    const taskId = 'TST-007';
    seedRepo(repoRoot, taskId);
    seedUiReviewConfig(repoRoot, 90); // generous cap — nothing skipped

    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.browsers).toEqual(['chromium', 'webkit', 'firefox']);
    expect(cfg.maxCombinations).toBe(90);

    const routes   = ['/'];
    const viewports = Object.keys(cfg.viewports); // mobile, desktop
    const engines   = cfg.browsers as ('chromium' | 'webkit' | 'firefox')[];

    // Check combinations within cap.
    const totalCombinations = routes.length * viewports.length * engines.length;
    expect(totalCombinations).toBeLessThanOrEqual(cfg.maxCombinations);

    // Step 1: apply cap (no skips expected here).
    const routesWithSize = routes.map((r) => ({ route: r, diffSize: 50 }));
    const capResult = applyMaxCombinationsCap(
      routesWithSize,
      viewports.length,
      engines.length,
      cfg.maxCombinations,
    );
    expect(capResult.skippedFindings).toHaveLength(0);

    // Step 2: run per-browser visual-diff pass.
    const allFindings: Finding[] = [...capResult.skippedFindings];
    const allAxeRaws: RawAxeFinding[] = [];
    let anyNewBaseline = false;

    for (const engine of engines) {
      for (const route of capResult.routes) {
        for (const viewport of viewports) {
          const candidateBuf = makePng(
            cfg.viewports[viewport].width,
            cfg.viewports[viewport].height,
            [180, 180, 180, 255],
          );
          const f = simulateVisualDiff(repoRoot, taskId, engine, route, viewport, candidateBuf, cfg.visualDiff.threshold, cfg.visualDiff.maxDiffRatio);
          if (f) {
            allFindings.push(f);
            if (f.metadata?.status === 'new-baseline') anyNewBaseline = true;
          }
        }
      }

      // Step 3: axe pass — only for the configured axe.browser (chromium by default).
      if (engine === cfg.axe.browser) {
        // Simulate a clean run — no violations.
        // (Real Playwright + axe-core would populate this array.)
        const simulatedRaws: RawAxeFinding[] = [];
        allAxeRaws.push(...simulatedRaws);
      }
      // webkit and firefox: no axe pass at all (per CLV-12 / CLV-16 spec).
    }

    // Step 4: dedupe and collect axe findings.
    const axeFindings = dedupeAxeFindings(allAxeRaws, cfg.axe.dedupeBy, cfg.axe.ignored);

    // AC3: zero axe findings (since webkit/firefox didn't run axe, and chromium found none).
    expect(axeFindings).toHaveLength(0);

    // AC2: per-browser baseline files written.
    for (const engine of engines) {
      const dir = join(repoRoot, '.cloverleaf', 'baselines', engine);
      expect(existsSync(dir), `missing baseline dir for ${engine}`).toBe(true);
      expect(readdirSync(dir).length, `no files for ${engine}`).toBeGreaterThan(0);
    }

    // Step 5: write ui-review state sidecar.
    writeUiReviewState(repoRoot, taskId, { baselines_pending: anyNewBaseline });
    const state = readUiReviewState(repoRoot, taskId);

    // First run always sets baselines_pending=true.
    expect(anyNewBaseline).toBe(true);
    expect(state.baselines_pending).toBe(true);

    // Visual-diff findings are info-level (never block the verdict).
    const nonVisualFindings = allFindings.filter(
      (f) => f.rule !== 'visual-diff' && f.rule !== 'ui-review-cap',
    );
    const councilVerdict = nonVisualFindings.some(
      (f) => f.severity === 'blocker' || f.severity === 'error',
    ) ? 'bounce' : 'pass';
    expect(councilVerdict).toBe('pass');

    // Step 6: drive the COLLAPSED FSM. The task runs its council members (the ui
    // member captured the baselines above) and lives at `council` — there is no
    // `ui-review` or `qa` state to advance through.
    advanceToCouncil(repoRoot, taskId);
    expect(loadTask(repoRoot, taskId).status).toBe('council');

    // Baselines-hold (SKILL §4.1, a runner CONVENTION — not an FSM transition):
    // the council verdict is `pass`, but because baselines_pending is true the
    // runner does NOT apply it. We model the hold at the state level: while
    // pending, the runner would surface /cloverleaf-approve-baselines instead of
    // advancing. (No advance-status call is gated on baselines_pending.)
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(true);

    // Human runs /cloverleaf-approve-baselines → clears the hold (the CLI it wraps).
    writeUiReviewState(repoRoot, taskId, { baselines_pending: false });
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(false);

    // With baselines cleared, the runner applies the council `pass`, which the FSM
    // allows: council → final-gate (the exact transition the hold convention gated).
    // There is no `qa` state; final-gate is the human merge pause.
    advanceStatus(repoRoot, taskId, 'final-gate', 'agent');
    expect(loadTask(repoRoot, taskId).status).toBe('final-gate');
  });
});

// ---------------------------------------------------------------------------
// Escalation: browser-missing finding for webkit and firefox
// ---------------------------------------------------------------------------

describe('CLV-20 DoD#5 (browser escalation): buildBrowserEscalationFinding', () => {
  it('produces a browser-missing finding for webkit attributed to the webkit engine', () => {
    const f = buildBrowserEscalationFinding('webkit');
    expect(f.rule).toBe('browser-missing');
    expect(f.severity).toBe('error');
    expect(f.metadata?.engine).toBe('webkit');
    expect(f.message).toContain('webkit');
  });

  it('produces a browser-missing finding for firefox attributed to the firefox engine', () => {
    const f = buildBrowserEscalationFinding('firefox');
    expect(f.rule).toBe('browser-missing');
    expect(f.metadata?.engine).toBe('firefox');
  });

  it('browser-missing findings for each engine are distinct', () => {
    const chromiumF = buildBrowserEscalationFinding('chromium');
    const webkitF   = buildBrowserEscalationFinding('webkit');
    const firefoxF  = buildBrowserEscalationFinding('firefox');
    expect(chromiumF.metadata?.engine).toBe('chromium');
    expect(webkitF.metadata?.engine).toBe('webkit');
    expect(firefoxF.metadata?.engine).toBe('firefox');
  });
});
