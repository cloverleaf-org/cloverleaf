/**
 * Turn a URL path into a filesystem-safe slug used in baseline/diff filenames.
 * - "/" → "index"
 * - "/faq/" → "faq"
 * - "/guide/chapter-3/" → "guide-chapter-3"
 * - "/docs/v1.2/getting started/" → "docs-v1-2-getting-started"
 * Query/hash are stripped.
 */
export function slugifyRoute(route: string): string {
  const pathOnly = route.split(/[?#]/)[0];
  if (pathOnly === '/' || pathOnly === '') return 'index';
  const trimmed = pathOnly.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return 'index';
  const slugged = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9/-]+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slugged || 'index';
}
