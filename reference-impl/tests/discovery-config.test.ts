import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDiscoveryConfig } from '../lib/discovery-config.js';

describe('loadDiscoveryConfig', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-dconf-'));
    mkdirSync(join(tmp, '.cloverleaf', 'config'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('returns package default when no consumer override', () => {
    const c = loadDiscoveryConfig(tmp);
    expect(c.docContextUri).toBe('');
    expect(c.projectId).toBe('');
    expect(c.idStart).toBe(1);
  });

  it('consumer override fully replaces package default', () => {
    writeFileSync(
      join(tmp, '.cloverleaf/config/discovery.json'),
      JSON.stringify({ docContextUri: 'docs/', projectId: 'CLV', idStart: 9 })
    );
    const c = loadDiscoveryConfig(tmp);
    expect(c.docContextUri).toBe('docs/');
    expect(c.projectId).toBe('CLV');
    expect(c.idStart).toBe(9);
  });
});
