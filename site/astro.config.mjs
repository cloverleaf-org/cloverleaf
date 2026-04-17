import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
  base: '/',
  trailingSlash: 'never',
  build: {
    inlineStylesheets: 'auto'
  }
});
