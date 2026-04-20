# Cloverleaf site

The methodology site for Cloverleaf. Four pages (`/`, `/guide`, `/start`, `/faq`), rendered via Astro 5 with zero client-side JS.

## Development

```bash
cd site
npm install
npm run dev
```

The dev server listens on `http://localhost:4321/cloverleaf/` by default (see `astro.config.mjs` — `base: '/cloverleaf'`).

## Build

```bash
npm run build
```

Produces a static site in `dist/`, deployed to GitHub Pages via `.github/workflows/site.yml`.
