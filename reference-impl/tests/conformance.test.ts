import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const STANDARD_ROOT = resolve(__dirname, '..', '..', 'standard');

describe('conformance', () => {
  it('@cloverleaf/standard validate:examples --level=2 passes', () => {
    expect(existsSync(STANDARD_ROOT)).toBe(true);
    const cmd = `cd ${STANDARD_ROOT} && npm run validate:examples -- --level=2`;
    let output = '';
    try {
      output = execSync(cmd, { encoding: 'utf-8' });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      throw new Error(`Conformance runner failed: ${e.stderr || e.stdout}`);
    }
    expect(output).toMatch(/0 failures/);
  });
});
