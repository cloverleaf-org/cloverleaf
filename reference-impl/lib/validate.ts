import Ajv, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const pkgDir = req.resolve('@cloverleaf/standard/package.json').replace(/\/package\.json$/, '');

let ajvInstance: Ajv | null = null;
const compiledCache = new Map<string, ValidateFunction>();

function getAjv(): Ajv {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv({ strict: false, validateFormats: true, allErrors: true });
  addFormats(ajv);
  const schemaFiles = readdirSync(`${pkgDir}/schemas`).filter(f => f.endsWith('.schema.json'));
  for (const file of schemaFiles) {
    const schema = JSON.parse(readFileSync(`${pkgDir}/schemas/${file}`, 'utf-8'));
    ajv.addSchema(schema);
  }
  ajvInstance = ajv;
  return ajv;
}

function getValidator(schemaId: string): ValidateFunction {
  const cached = compiledCache.get(schemaId);
  if (cached) return cached;
  const ajv = getAjv();
  const validator = ajv.getSchema(schemaId);
  if (!validator) throw new Error(`Schema not registered: ${schemaId}`);
  compiledCache.set(schemaId, validator);
  return validator;
}

export function validateOrThrow(schemaId: string, doc: unknown): void {
  const validate = getValidator(schemaId);
  if (!validate(doc)) {
    const violations = (validate.errors ?? []).length;
    const detail = JSON.stringify(validate.errors, null, 2);
    throw new Error(
      `Schema validation failed: ${violations} violation(s) against ${schemaId}\n${detail}`
    );
  }
}
