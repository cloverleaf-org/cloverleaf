import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWalkerConfig } from '../lib/walker-config.js';

describe('loadWalkerConfig', () => {
  let tmp: string;
  let savedXdg: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-walkercfg-'));
    savedXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = tmp;
  });

  afterEach(() => {
    if (savedXdg === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = savedXdg;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  // Case 1: file absent
  it('returns default 3 when config file is absent', () => {
    const result = loadWalkerConfig();
    expect(result.maxConcurrent).toBe(3);
    expect(result.source).toBe('default');
  });

  // Case 2: file present but empty object {}
  it('returns default 3 when config file has no max_concurrent field', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(join(tmp, 'cloverleaf', 'walker.json'), JSON.stringify({}));
    const result = loadWalkerConfig();
    expect(result.maxConcurrent).toBe(3);
    expect(result.source).toBe('default');
  });

  // Case 3: valid max_concurrent: 2
  it('returns { maxConcurrent: 2, source: "user" } when max_concurrent is 2', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(tmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: 2 })
    );
    const result = loadWalkerConfig();
    expect(result.maxConcurrent).toBe(2);
    expect(result.source).toBe('user');
  });

  // Case 4: malformed JSON
  it('throws with file path when config file contains malformed JSON', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(join(tmp, 'cloverleaf', 'walker.json'), '{ not valid json ');
    expect(() => loadWalkerConfig()).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(join(tmp, 'cloverleaf', 'walker.json')),
      })
    );
  });

  // Case 5: max_concurrent: 0
  it('throws with actual value when max_concurrent is 0', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(tmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: 0 })
    );
    expect(() => loadWalkerConfig()).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/max_concurrent.*0|0.*max_concurrent/),
      })
    );
  });

  // Case 6: max_concurrent: -1
  it('throws with actual value when max_concurrent is -1', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(tmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: -1 })
    );
    expect(() => loadWalkerConfig()).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/max_concurrent.*-1|-1.*max_concurrent/),
      })
    );
  });

  // Case 7: max_concurrent: "two"
  it('throws with actual value when max_concurrent is a string', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(tmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: 'two' })
    );
    expect(() => loadWalkerConfig()).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/max_concurrent.*two|two.*max_concurrent/),
      })
    );
  });

  // Case 8: max_concurrent: 2.5
  it('throws with actual value when max_concurrent is a float', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(tmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: 2.5 })
    );
    expect(() => loadWalkerConfig()).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/max_concurrent.*2\.5|2\.5.*max_concurrent/),
      })
    );
  });

  // Case 9: max_concurrent: null
  it('throws with actual value when max_concurrent is null', () => {
    mkdirSync(join(tmp, 'cloverleaf'), { recursive: true });
    writeFileSync(
      join(tmp, 'cloverleaf', 'walker.json'),
      JSON.stringify({ max_concurrent: null })
    );
    expect(() => loadWalkerConfig()).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/max_concurrent.*null|null.*max_concurrent/),
      })
    );
  });
});
