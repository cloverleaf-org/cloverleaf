import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DEFAULT = join(here, '..', 'config', 'ui-review.json');

export interface Viewport {
  width: number;
  height: number;
}

export interface UiReviewConfig {
  viewports: Record<string, Viewport>;
  visualDiff: {
    enabled: boolean;
    threshold: number;
    maxDiffRatio: number;
    mask: string[];
  };
  axe: {
    viewports: string[];
    dedupeBy: ('ruleId' | 'target')[];
    ignored: Array<{ ruleId: string; target: string }>;
  };
}

const HARDCODED_FALLBACK: UiReviewConfig = {
  viewports: {
    mobile:  { width: 375,  height: 667  },
    tablet:  { width: 768,  height: 1024 },
    desktop: { width: 1280, height: 800  },
  },
  visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
  axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'], ignored: [] },
};

function readAsConfig(path: string): UiReviewConfig | null {
  try {
    const doc = JSON.parse(readFileSync(path, 'utf-8')) as UiReviewConfig;
    // Back-compat: if ignored is missing from an older override, default it.
    if (doc.axe && !('ignored' in doc.axe)) {
      (doc.axe as UiReviewConfig['axe']).ignored = [];
    }
    return doc;
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
