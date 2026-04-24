import { describe, it, expect } from 'vitest';
import {
  buildBrowserEscalationFinding,
  applyMaxCombinationsCap,
  type RouteWithDiffSize,
} from '../lib/ui-browser.js';

// ---------------------------------------------------------------------------
// buildBrowserEscalationFinding
// ---------------------------------------------------------------------------

describe('buildBrowserEscalationFinding', () => {
  it('names the missing engine in the message', () => {
    const f = buildBrowserEscalationFinding('webkit');
    expect(f.message).toContain('webkit');
  });

  it('includes the playwright install command in the message', () => {
    const f = buildBrowserEscalationFinding('firefox');
    expect(f.message).toContain('npx playwright install webkit firefox');
  });

  it('includes the install command for chromium too', () => {
    const f = buildBrowserEscalationFinding('chromium');
    expect(f.message).toContain('npx playwright install webkit firefox');
  });

  it('uses severity "error" (escalation finding)', () => {
    const f = buildBrowserEscalationFinding('webkit');
    expect(f.severity).toBe('error');
  });

  it('uses rule "browser-missing"', () => {
    const f = buildBrowserEscalationFinding('webkit');
    expect(f.rule).toBe('browser-missing');
  });

  it('on Linux includes the install-deps hint for webkit', () => {
    const f = buildBrowserEscalationFinding('webkit', 'linux');
    expect(f.message).toContain('npx playwright install-deps webkit');
  });

  it('on macOS does NOT include the install-deps hint', () => {
    const f = buildBrowserEscalationFinding('webkit', 'darwin');
    expect(f.message).not.toContain('install-deps');
  });

  it('on Windows does NOT include the install-deps hint', () => {
    const f = buildBrowserEscalationFinding('webkit', 'win32');
    expect(f.message).not.toContain('install-deps');
  });

  it('includes engine in metadata', () => {
    const f = buildBrowserEscalationFinding('firefox');
    expect(f.metadata?.engine).toBe('firefox');
  });
});

// ---------------------------------------------------------------------------
// applyMaxCombinationsCap
// ---------------------------------------------------------------------------

describe('applyMaxCombinationsCap', () => {
  const routes = (...pairs: [string, number][]): RouteWithDiffSize[] =>
    pairs.map(([route, diffSize]) => ({ route, diffSize }));

  it('returns all routes unchanged when combinations are within cap', () => {
    // 3 routes × 3 viewports × 3 browsers = 27, cap = 27
    const result = applyMaxCombinationsCap(routes(['/a/', 10], ['/b/', 5], ['/c/', 3]), 3, 3, 27);
    expect(result.routes).toHaveLength(3);
    expect(result.skippedFindings).toHaveLength(0);
  });

  it('returns all routes when combinations exactly equal the cap', () => {
    // 2 routes × 3 viewports × 3 browsers = 18, cap = 18
    const result = applyMaxCombinationsCap(routes(['/a/', 10], ['/b/', 5]), 3, 3, 18);
    expect(result.routes).toHaveLength(2);
    expect(result.skippedFindings).toHaveLength(0);
  });

  it('skips routes beyond floor(cap / (viewports × browsers))', () => {
    // 4 routes × 3 viewports × 3 browsers = 36, cap = 27
    // floor(27 / (3×3)) = 3 routes kept, 1 skipped
    const result = applyMaxCombinationsCap(
      routes(['/a/', 100], ['/b/', 80], ['/c/', 60], ['/d/', 20]),
      3,
      3,
      27,
    );
    expect(result.routes).toHaveLength(3);
    expect(result.skippedFindings).toHaveLength(1);
  });

  it('sorts routes by diff size descending (most-changed processed first)', () => {
    // 4 routes, cap allows 3 — smallest-diff route must be the one skipped
    const result = applyMaxCombinationsCap(
      routes(['/a/', 10], ['/b/', 100], ['/c/', 50], ['/d/', 5]),
      3,
      3,
      27,
    );
    // The kept routes are /b/ (100), /c/ (50), /a/ (10) — most-changed first
    expect(result.routes).toContain('/b/');
    expect(result.routes).toContain('/c/');
    expect(result.routes).toContain('/a/');
    expect(result.routes).not.toContain('/d/');
  });

  it('emits exactly 1 warning finding per skipped route', () => {
    // 5 routes × 3 viewports × 2 browsers = 30, cap = 18 → floor(18/6) = 3 kept, 2 skipped
    const result = applyMaxCombinationsCap(
      routes(['/a/', 50], ['/b/', 40], ['/c/', 30], ['/d/', 20], ['/e/', 10]),
      3,
      2,
      18,
    );
    expect(result.skippedFindings).toHaveLength(2);
  });

  it('skipped findings have severity "warning"', () => {
    const result = applyMaxCombinationsCap(
      routes(['/a/', 100], ['/b/', 80], ['/c/', 60], ['/d/', 20]),
      3,
      3,
      27,
    );
    for (const f of result.skippedFindings) {
      expect(f.severity).toBe('warning');
    }
  });

  it('skipped findings have rule "ui-review-cap"', () => {
    const result = applyMaxCombinationsCap(
      routes(['/a/', 100], ['/b/', 80], ['/c/', 60], ['/d/', 20]),
      3,
      3,
      27,
    );
    for (const f of result.skippedFindings) {
      expect(f.rule).toBe('ui-review-cap');
    }
  });

  it('skipped finding message includes the route name', () => {
    const result = applyMaxCombinationsCap(
      routes(['/a/', 100], ['/b/', 80], ['/c/', 60], ['/d/', 20]),
      3,
      3,
      27,
    );
    // /d/ is the smallest, so it's skipped
    expect(result.skippedFindings[0].message).toContain('/d/');
  });

  it('skipped finding message includes current count vs cap', () => {
    // 4 routes × 3 × 3 = 36 vs cap 27
    const result = applyMaxCombinationsCap(
      routes(['/a/', 100], ['/b/', 80], ['/c/', 60], ['/d/', 20]),
      3,
      3,
      27,
    );
    expect(result.skippedFindings[0].message).toContain('36');
    expect(result.skippedFindings[0].message).toContain('27');
  });

  it('skipped finding metadata includes route, combinationCount, maxCombinations', () => {
    const result = applyMaxCombinationsCap(
      routes(['/a/', 100], ['/b/', 80], ['/c/', 60], ['/d/', 20]),
      3,
      3,
      27,
    );
    const meta = result.skippedFindings[0].metadata as Record<string, unknown>;
    expect(meta.route).toBe('/d/');
    expect(meta.combinationCount).toBe(36);
    expect(meta.maxCombinations).toBe(27);
  });

  it('cap=27 with 4 routes, 3 viewports, 3 browsers: exactly 1 route skipped (CLV-18 AC)', () => {
    // Acceptance criteria: 4 routes × 3 viewports × 3 browsers = 36 vs cap 27
    // floor(27 / (3×3)) = 3 routes, 1 skipped
    const result = applyMaxCombinationsCap(
      routes(['/route-a/', 200], ['/route-b/', 150], ['/route-c/', 100], ['/route-d/', 50]),
      3,
      3,
      27,
    );
    expect(result.routes).toHaveLength(3);
    expect(result.skippedFindings).toHaveLength(1);
    expect(result.skippedFindings[0].rule).toBe('ui-review-cap');
    // /route-d/ is smallest-diff, must be skipped
    expect(result.skippedFindings[0].message).toContain('/route-d/');
  });

  it('preserves all routes and no skipped findings for zero-route input', () => {
    const result = applyMaxCombinationsCap([], 3, 3, 27);
    expect(result.routes).toHaveLength(0);
    expect(result.skippedFindings).toHaveLength(0);
  });

  it('handles single-browser, single-viewport correctly', () => {
    // 5 routes × 1 × 1 = 5, cap = 3 → 2 skipped
    const result = applyMaxCombinationsCap(
      routes(['/a/', 50], ['/b/', 40], ['/c/', 30], ['/d/', 20], ['/e/', 10]),
      1,
      1,
      3,
    );
    expect(result.routes).toHaveLength(3);
    expect(result.skippedFindings).toHaveLength(2);
  });
});
