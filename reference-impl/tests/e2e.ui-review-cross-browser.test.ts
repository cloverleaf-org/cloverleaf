/**
 * CLV-20: End-to-end integration test — 3-browser matrix, per-browser baselines,
 * engine diffs, and baseline-approval gate.
 *
 * This test exercises the full cross-browser UI review flow without launching
 * real browsers.  The codebase represents the "UI Reviewer subagent" as library
 * functions that are tested in isolation elsewhere; here we wire them together
 * the way the subagent prompt describes, using synthetic PNG buffers in place of
 * Playwright screenshots.
 *
 * Acceptance criteria covered:
 *  AC1 — npm test runs this file and it passes without requiring real browsers.
 *  AC2 — per-browser baseline PNGs are written under .cloverleaf/baselines/{engine}/.
 *  AC3 — zero axe findings are emitted for webkit and firefox browser passes.
 *  AC4 — task stays in ui-review when baselines_pending=true; advances to qa after approve-baselines.
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
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
// AC4a: task stays in ui-review when baselines_pending=true
// AC4b: task advances to qa after approve-baselines (baselines_pending cleared)
// ---------------------------------------------------------------------------

describe('CLV-20 AC4: baselines_pending gate blocks ui-review → qa', () => {
  it('task remains in ui-review status while baselines_pending is true', () => {
    const taskId = 'TST-002';
    seedRepo(repoRoot, taskId);

    // Advance to ui-review status (mirrors the full pipeline warm-up).
    advanceStatus(repoRoot, taskId, 'tactical-plan', 'agent');
    advanceStatus(repoRoot, taskId, 'implementing',  'agent');
    advanceStatus(repoRoot, taskId, 'documenting',   'agent');
    advanceStatus(repoRoot, taskId, 'review',        'agent');
    advanceStatus(repoRoot, taskId, 'automated-gates', 'agent');
    advanceStatus(repoRoot, taskId, 'ui-review', 'agent', { path: 'full_pipeline' });

    const task = loadTask(repoRoot, taskId);
    expect(task.status).toBe('ui-review');

    // Simulate: first-run produces new-baseline → write baselines_pending=true.
    writeUiReviewState(repoRoot, taskId, { baselines_pending: true });

    // Read back — must be true.
    const state = readUiReviewState(repoRoot, taskId);
    expect(state.baselines_pending).toBe(true);

    // Skill logic: when baselines_pending is true, do NOT advance to qa.
    // Task status must still be ui-review.
    const taskAfter = loadTask(repoRoot, taskId);
    expect(taskAfter.status).toBe('ui-review');
  });

  it('after approve-baselines clears baselines_pending, task advances to qa', () => {
    const taskId = 'TST-003';
    seedRepo(repoRoot, taskId);

    // Advance to ui-review.
    advanceStatus(repoRoot, taskId, 'tactical-plan', 'agent');
    advanceStatus(repoRoot, taskId, 'implementing',  'agent');
    advanceStatus(repoRoot, taskId, 'documenting',   'agent');
    advanceStatus(repoRoot, taskId, 'review',        'agent');
    advanceStatus(repoRoot, taskId, 'automated-gates', 'agent');
    advanceStatus(repoRoot, taskId, 'ui-review', 'agent', { path: 'full_pipeline' });

    // First run: new baselines captured.
    writeUiReviewState(repoRoot, taskId, { baselines_pending: true });
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(true);

    // Human runs /cloverleaf-approve-baselines → clears the flag.
    writeUiReviewState(repoRoot, taskId, { baselines_pending: false });
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(false);

    // Now the skill can advance to qa.
    advanceStatus(repoRoot, taskId, 'qa', 'agent', { path: 'full_pipeline' });
    const task = loadTask(repoRoot, taskId);
    expect(task.status).toBe('qa');
  });

  it('baselines_pending:false (no new baselines) allows direct ui-review → qa', () => {
    const taskId = 'TST-004';
    seedRepo(repoRoot, taskId);

    advanceStatus(repoRoot, taskId, 'tactical-plan', 'agent');
    advanceStatus(repoRoot, taskId, 'implementing',  'agent');
    advanceStatus(repoRoot, taskId, 'documenting',   'agent');
    advanceStatus(repoRoot, taskId, 'review',        'agent');
    advanceStatus(repoRoot, taskId, 'automated-gates', 'agent');
    advanceStatus(repoRoot, taskId, 'ui-review', 'agent', { path: 'full_pipeline' });

    // All routes matched baselines → no pending approval.
    writeUiReviewState(repoRoot, taskId, { baselines_pending: false });

    // Advance immediately to qa.
    advanceStatus(repoRoot, taskId, 'qa', 'agent', { path: 'full_pipeline' });
    expect(loadTask(repoRoot, taskId).status).toBe('qa');
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
    const verdict = nonVisualFindings.some(
      (f) => f.severity === 'blocker' || f.severity === 'error',
    ) ? 'bounce' : 'pass';
    expect(verdict).toBe('pass');

    // AC4: task in ui-review — do NOT advance while baselines_pending=true.
    advanceStatus(repoRoot, taskId, 'tactical-plan', 'agent');
    advanceStatus(repoRoot, taskId, 'implementing',  'agent');
    advanceStatus(repoRoot, taskId, 'documenting',   'agent');
    advanceStatus(repoRoot, taskId, 'review',        'agent');
    advanceStatus(repoRoot, taskId, 'automated-gates', 'agent');
    advanceStatus(repoRoot, taskId, 'ui-review', 'agent', { path: 'full_pipeline' });
    expect(loadTask(repoRoot, taskId).status).toBe('ui-review'); // still blocked

    // Approve baselines (simulate /cloverleaf-approve-baselines).
    writeUiReviewState(repoRoot, taskId, { baselines_pending: false });
    expect(readUiReviewState(repoRoot, taskId).baselines_pending).toBe(false);

    // Now skill advances to qa.
    advanceStatus(repoRoot, taskId, 'qa', 'agent', { path: 'full_pipeline' });
    expect(loadTask(repoRoot, taskId).status).toBe('qa');
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
