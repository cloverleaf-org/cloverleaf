import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMAS = resolve(__dirname, '..', '..', 'schemas');

export function makeAjv(): Ajv {
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  if (existsSync(SCHEMAS)) {
    for (const f of readdirSync(SCHEMAS).filter((f) => f.endsWith('.schema.json'))) {
      const schema = JSON.parse(readFileSync(resolve(SCHEMAS, f), 'utf-8'));
      ajv.addSchema(schema);
    }
  }
  return ajv;
}
