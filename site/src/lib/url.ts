export function url(path: string): string {
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('#') ||
    path.startsWith('mailto:')
  ) {
    return path;
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (!path.startsWith('/')) return path;
  // Matches astro.config.mjs trailingSlash: 'always' for pages.
  // Skip trailing slash for static files (anything with a .ext).
  if (path === '/') return `${base}/`;
  const withoutSlash = path.replace(/\/$/, '');
  const isFile = /\.[a-zA-Z0-9]+$/.test(withoutSlash);
  return isFile ? `${base}${withoutSlash}` : `${base}${withoutSlash}/`;
}
