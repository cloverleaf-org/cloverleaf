import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
  site: 'https://cloverleaf-org.github.io',
  base: '/cloverleaf',
  trailingSlash: 'never',
  build: {
    inlineStylesheets: 'auto'
  }
});
