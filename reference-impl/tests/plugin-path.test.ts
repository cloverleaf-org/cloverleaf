import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { getPluginRoot } from '../lib/plugin-path.js';

describe('getPluginRoot', () => {
  it('returns an absolute path', () => {
    const root = getPluginRoot();
    expect(root.startsWith('/')).toBe(true);
  });

  it('returns an existing directory', () => {
    const root = getPluginRoot();
    expect(existsSync(root)).toBe(true);
  });

  it('returns the reference-impl dir (the lib/ parent) when running from source', () => {
    const root = getPluginRoot();
    expect(basename(root)).toBe('reference-impl');
    expect(existsSync(resolve(root, 'skills'))).toBe(true);
    expect(existsSync(resolve(root, 'prompts'))).toBe(true);
    expect(existsSync(resolve(root, 'config'))).toBe(true);
  });
});
