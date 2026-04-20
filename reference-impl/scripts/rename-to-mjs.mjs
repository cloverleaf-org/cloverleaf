#!/usr/bin/env node
import { readdirSync, renameSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname } from 'node:path';

const here = pathDirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) {
      const newPath = full.replace(/\.js$/, '.mjs');
      // Rewrite imports from './x.js' to './x.mjs' inline
      const content = readFileSync(full, 'utf-8').replace(
        /from\s+['"](\.[^'"]+?)\.js['"]/g,
        (_m, p) => `from '${p}.mjs'`
      );
      writeFileSync(full, content);
      renameSync(full, newPath);
    }
  }
}

walk(dist);

// Ensure cli.mjs has exactly one shebang (#!/usr/bin/env node) + executable bit
const cli = join(dist, 'cli.mjs');
let head = readFileSync(cli, 'utf-8');
// Strip any existing shebang lines (tsc may preserve the source-file shebang as a comment)
head = head.replace(/^#!.*\n/gm, '');
writeFileSync(cli, '#!/usr/bin/env node\n' + head);
chmodSync(cli, 0o755);
console.log('Renamed .js → .mjs in dist/; added shebang to cli.mjs');
