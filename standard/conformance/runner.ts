import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import { makeAjv } from './helpers/ajv-instance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const VALID = resolve(ROOT, 'examples', 'valid');
const INVALID = resolve(ROOT, 'examples', 'invalid');
const CONTRACTS = resolve(ROOT, 'agent-contracts');
const SCHEMA_BASE = 'https://cloverleaf.example/schemas/';

let failures = 0;
let checks = 0;

const ajv = makeAjv();

function fail(msg: string): void {
  console.error(`  FAIL: ${msg}`);
  failures += 1;
}

function ok(msg: string): void {
  console.log(`  ok:   ${msg}`);
}

/** Walk per-schema subdirectories. Returns { schemaName, filePath } pairs. */
function walkExamples(root: string): Array<{ schemaName: string; filePath: string }> {
  const out: Array<{ schemaName: string; filePath: string }> = [];
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root)) {
    const subdir = resolve(root, dir);
    if (!statSync(subdir).isDirectory()) continue;
    for (const f of readdirSync(subdir).filter((f) => f.endsWith('.json'))) {
      out.push({ schemaName: dir, filePath: resolve(subdir, f) });
    }
  }
  return out;
}

console.log('Validating valid/ examples');
for (const { schemaName, filePath } of walkExamples(VALID)) {
  checks += 1;
  const id = `${SCHEMA_BASE}${schemaName}.schema.json`;
  const validate = ajv.getSchema(id);
  const rel = relative(ROOT, filePath);
  if (!validate) {
    fail(`${rel}: schema not registered (${id})`);
    continue;
  }
  const doc = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (!validate(doc)) {
    fail(`${rel}: expected valid, got errors: ${JSON.stringify(validate.errors)}`);
  } else {
    ok(rel);
  }
}

console.log('Validating invalid/ examples (must reject)');
for (const { schemaName, filePath } of walkExamples(INVALID)) {
  checks += 1;
  const id = `${SCHEMA_BASE}${schemaName}.schema.json`;
  const validate = ajv.getSchema(id);
  const rel = relative(ROOT, filePath);
  if (!validate) {
    fail(`${rel}: schema not registered (${id})`);
    continue;
  }
  const doc = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (validate(doc)) {
    fail(`${rel}: expected invalid, but validated`);
  } else {
    ok(rel);
  }
}

console.log('Validating OpenAPI contracts');
if (existsSync(CONTRACTS)) {
  for (const f of readdirSync(CONTRACTS).filter((f) => f.endsWith('.openapi.yaml'))) {
    checks += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const api = (await SwaggerParser.validate(resolve(CONTRACTS, f), {
        resolve: { external: false },
      })) as { openapi?: string };
      if (!api.openapi || !api.openapi.startsWith('3.1.')) {
        fail(`${f}: not OpenAPI 3.1`);
      } else {
        ok(`${f}`);
      }
    } catch (err) {
      fail(`${f}: ${(err as Error).message}`);
    }
  }
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
