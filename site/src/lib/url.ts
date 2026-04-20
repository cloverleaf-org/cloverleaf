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
  return `${base}${path}`;
}
