import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACTS = resolve(__dirname, '..', '..', 'agent-contracts');

/**
 * Run conformance tests for an agent OpenAPI contract.
 * - Validates the OpenAPI file is well-formed (parses + bundles + dereferences).
 *
 * External `$ref` resolution is disabled because Cloverleaf agent contracts
 * reference schemas under `https://cloverleaf.example/...` (an intentionally
 * non-resolvable placeholder domain). The file is still parsed and structurally
 * validated as OpenAPI 3.1.
 */
export function testOpenApi(agent: string): void {
  describe(`${agent} agent contract`, () => {
    const path = resolve(CONTRACTS, `${agent}.openapi.yaml`);
    it('parses and validates as OpenAPI 3.1', async () => {
      const api = (await SwaggerParser.validate(path, {
        resolve: { external: false },
        dereference: { external: false },
      } as never)) as { openapi: string };
      expect(api.openapi).toMatch(/^3\.1\./);
    });
  });
}
