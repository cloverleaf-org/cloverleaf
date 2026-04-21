import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(here, '..', 'config', 'affected-routes.json');

export interface AffectedRoutesConfig {
  pageRoots: string[];
  globalPatterns: string[];
  routeScope: string[];
  contentRoutes: Record<string, string>;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = escaped
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${regex}$`);
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(file));
}

function routeForPage(file: string, pageRoot: string): string | null {
  if (!file.startsWith(pageRoot)) return null;
  const rel = file.slice(pageRoot.length);
  const withoutExt = rel.replace(/\.(astro|mdx)$/, '');
  if (!withoutExt || withoutExt === rel) return null;
  if (withoutExt === 'index') return '/';
  return `/${withoutExt}/`;
}

export function loadDefaultConfig(): AffectedRoutesConfig {
  if (!existsSync(DEFAULT_CONFIG)) {
    throw new Error(`affected-routes config not found at ${DEFAULT_CONFIG}`);
  }
  const doc = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf-8')) as Partial<AffectedRoutesConfig>;
  return {
    pageRoots: Array.isArray(doc.pageRoots) ? doc.pageRoots : [],
    globalPatterns: Array.isArray(doc.globalPatterns) ? doc.globalPatterns : [],
    routeScope: Array.isArray(doc.routeScope) ? doc.routeScope : [],
    contentRoutes: (doc.contentRoutes && typeof doc.contentRoutes === 'object' && !Array.isArray(doc.contentRoutes))
      ? doc.contentRoutes
      : {},
  };
}

export function loadAffectedRoutesConfig(repoRoot: string): AffectedRoutesConfig {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'affected-routes.json');
  if (existsSync(consumerPath)) {
    try {
      const doc = JSON.parse(readFileSync(consumerPath, 'utf-8')) as Partial<AffectedRoutesConfig>;
      return {
        pageRoots: Array.isArray(doc.pageRoots) ? doc.pageRoots : [],
        globalPatterns: Array.isArray(doc.globalPatterns) ? doc.globalPatterns : [],
        routeScope: Array.isArray(doc.routeScope) ? doc.routeScope : [],
        contentRoutes: (doc.contentRoutes && typeof doc.contentRoutes === 'object' && !Array.isArray(doc.contentRoutes))
          ? doc.contentRoutes
          : {},
      };
    } catch {
      // fall through
    }
  }
  return loadDefaultConfig();
}

export function computeAffectedRoutes(
  changedFiles: string[],
  config: AffectedRoutesConfig
): string[] | 'all' {
  const routes = new Set<string>();
  let inScopeButUnmatched = false;

  for (const file of changedFiles) {
    if (matchesAny(file, config.globalPatterns)) {
      return 'all';
    }
    let mapped: string | null = null;
    for (const root of config.pageRoots) {
      const r = routeForPage(file, root);
      if (r) {
        mapped = r;
        break;
      }
    }
    if (mapped) {
      routes.add(mapped);
      continue;
    }
    // contentRoutes: map content-collection files to specific routes
    for (const [pattern, route] of Object.entries(config.contentRoutes)) {
      if (globToRegex(pattern).test(file)) {
        routes.add(route);
        mapped = route;
        break;
      }
    }
    if (mapped) continue;
    if (matchesAny(file, config.routeScope)) {
      inScopeButUnmatched = true;
    }
  }

  if (inScopeButUnmatched) {
    return 'all';
  }
  return Array.from(routes).sort();
}
