import type { Finding } from './feedback.js';
import type { BrowserEngine } from './ui-review-config.js';

// ---------------------------------------------------------------------------
// Browser escalation
// ---------------------------------------------------------------------------

/**
 * Build an escalation Finding for a missing Playwright browser binary.
 *
 * The finding names the missing engine and includes the install command per
 * the CLV-9 RFC and CLV-10 spike:
 *   - All platforms:  `npx playwright install webkit firefox`
 *   - Linux only:     `npx playwright install-deps webkit`
 *
 * @param engine   The browser engine that is missing.
 * @param platform The platform string (defaults to `process.platform`). Pass
 *                 "linux" explicitly to include the install-deps hint; all
 *                 other values are treated as non-Linux.
 */
export function buildBrowserEscalationFinding(
  engine: BrowserEngine,
  platform: string = process.platform,
): Finding {
  const isLinux = platform === 'linux';
  const installCmd = 'npx playwright install webkit firefox';
  const depsHint = isLinux
    ? ` On Linux, also run: npx playwright install-deps webkit`
    : '';
  return {
    severity: 'error',
    rule: 'browser-missing',
    message:
      `Playwright ${engine} not installed. Run '${installCmd}' on this machine.${depsHint}`,
    metadata: { engine, installCommand: installCmd },
  };
}

// ---------------------------------------------------------------------------
// maxCombinations cap enforcement
// ---------------------------------------------------------------------------

/**
 * Represents an affected route with a diff-size weight used for sorting
 * when maxCombinations cap is applied.
 */
export interface RouteWithDiffSize {
  route: string;
  /** Number of changed lines (or any monotonic proxy for diff size). */
  diffSize: number;
}

/**
 * Result of applying the maxCombinations cap.
 */
export interface CapResult {
  /** Routes that should be processed (up to the cap). */
  routes: string[];
  /**
   * One `warning`-severity Finding per skipped route, with rule
   * `ui-review-cap` and a message containing the route name plus the
   * combination count vs cap.
   */
  skippedFindings: Finding[];
}

/**
 * Enforce the maxCombinations cap.
 *
 * When `routes.length × viewportCount × browserCount > maxCombinations`,
 * the affected routes are sorted by diff size (most-changed first) and only
 * the first `floor(maxCombinations / (viewportCount × browserCount))` routes
 * are processed. One `warning`-severity finding with rule `ui-review-cap` is
 * emitted per skipped route.
 *
 * @param routes          Affected routes with their diff sizes.
 * @param viewportCount   Number of viewports configured.
 * @param browserCount    Number of browser engines configured.
 * @param maxCombinations Maximum allowed combinations (routes × viewports × browsers).
 * @returns               `{ routes, skippedFindings }` ready for use by the reviewer.
 */
export function applyMaxCombinationsCap(
  routes: RouteWithDiffSize[],
  viewportCount: number,
  browserCount: number,
  maxCombinations: number,
): CapResult {
  const totalCombinations = routes.length * viewportCount * browserCount;

  if (totalCombinations <= maxCombinations) {
    return {
      routes: routes.map((r) => r.route),
      skippedFindings: [],
    };
  }

  const perRouteSlots = viewportCount * browserCount;
  const maxRoutes = Math.floor(maxCombinations / perRouteSlots);

  // Sort most-changed first, then take first maxRoutes routes.
  const sorted = [...routes].sort((a, b) => b.diffSize - a.diffSize);
  const kept = sorted.slice(0, maxRoutes);
  const skipped = sorted.slice(maxRoutes);

  const skippedFindings: Finding[] = skipped.map((r) => ({
    severity: 'warning',
    rule: 'ui-review-cap',
    message:
      `Route ${r.route} skipped: combination count ${totalCombinations} exceeds ` +
      `maxCombinations (${maxCombinations}); review manually or raise the cap.`,
    metadata: {
      route: r.route,
      combinationCount: totalCombinations,
      maxCombinations,
    },
  }));

  return {
    routes: kept.map((r) => r.route),
    skippedFindings,
  };
}
