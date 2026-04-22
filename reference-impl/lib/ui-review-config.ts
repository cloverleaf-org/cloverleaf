import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DEFAULT = join(here, '..', 'config', 'ui-review.json');

export interface Viewport {
  width: number;
  height: number;
}

/** Valid Playwright browser engine strings. */
export type BrowserEngine = 'chromium' | 'webkit' | 'firefox';

export interface UiReviewConfig {
  /** Browser engines to run visual-diff + axe across. Default: ["chromium"]. */
  browsers: BrowserEngine[];
  viewports: Record<string, Viewport>;
  visualDiff: {
    enabled: boolean;
    threshold: number;
    maxDiffRatio: number;
    mask: string[];
  };
  axe: {
    viewports: string[];
    /** Browser engine to use for axe accessibility runs. Default: "chromium". */
    browser: BrowserEngine;
    dedupeBy: ('ruleId' | 'target')[];
    ignored: Array<{ ruleId: string; target: string }>;
  };
  /**
   * Maximum number of (browser × viewport) combinations to run.
   * The skill will skip combinations beyond this limit to avoid runaway runtimes.
   * Default: 90.
   */
  maxCombinations: number;
}

const HARDCODED_FALLBACK: UiReviewConfig = {
  browsers: ['chromium'],
  viewports: {
    mobile:  { width: 375,  height: 667  },
    tablet:  { width: 768,  height: 1024 },
    desktop: { width: 1280, height: 800  },
  },
  visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
  axe: {
    viewports: ['desktop'],
    browser: 'chromium',
    dedupeBy: ['ruleId', 'target'],
    ignored: [],
  },
  maxCombinations: 90,
};

function applyDefaults(doc: Partial<UiReviewConfig>): UiReviewConfig {
  // browsers — default ["chromium"]
  if (!Array.isArray(doc.browsers)) {
    (doc as UiReviewConfig).browsers = ['chromium'];
  }

  // viewports — fall through to hardcoded if omitted entirely
  if (!doc.viewports) {
    (doc as UiReviewConfig).viewports = HARDCODED_FALLBACK.viewports;
  }

  // visualDiff
  if (!doc.visualDiff) {
    (doc as UiReviewConfig).visualDiff = { ...HARDCODED_FALLBACK.visualDiff };
  }

  // axe sub-fields
  if (!doc.axe) {
    (doc as UiReviewConfig).axe = { ...HARDCODED_FALLBACK.axe };
  } else {
    // Back-compat: ignored omitted in older overrides
    if (!('ignored' in doc.axe)) {
      (doc.axe as UiReviewConfig['axe']).ignored = [];
    }
    // axe.browser — default "chromium"
    if (!('browser' in doc.axe)) {
      (doc.axe as UiReviewConfig['axe']).browser = 'chromium';
    }
  }

  // maxCombinations — default 90
  if (typeof doc.maxCombinations !== 'number') {
    (doc as UiReviewConfig).maxCombinations = 90;
  }

  return doc as UiReviewConfig;
}

function readAsConfig(path: string): UiReviewConfig | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<UiReviewConfig>;
    return applyDefaults(raw);
  } catch {
    return null;
  }
}

export function loadUiReviewConfig(repoRoot: string): UiReviewConfig {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'ui-review.json');
  if (existsSync(consumerPath)) {
    const parsed = readAsConfig(consumerPath);
    if (parsed) return parsed;
  }
  if (existsSync(PACKAGE_DEFAULT)) {
    const parsed = readAsConfig(PACKAGE_DEFAULT);
    if (parsed) return parsed;
  }
  return HARDCODED_FALLBACK;
}
