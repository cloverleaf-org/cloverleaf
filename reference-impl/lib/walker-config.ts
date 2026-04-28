import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface WalkerConfig {
  maxConcurrent: number;
  source: 'user' | 'default';
  /** Absolute resolved path to the walker.json file (whether it exists or not). */
  path: string;
}

/**
 * Resolve the absolute path to the walker config file.
 * Respects XDG_CONFIG_HOME if set; otherwise falls back to $HOME/.config.
 */
export function walkerConfigPath(): string {
  const xdgConfigHome = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  return join(xdgConfigHome, 'cloverleaf', 'walker.json');
}

/**
 * Load and validate the walker configuration.
 *
 * Resolution rules:
 * - File absent (ENOENT) → { maxConcurrent: 3, source: 'default' }
 * - File present, no max_concurrent field → { maxConcurrent: 3, source: 'default' }
 * - File present, valid positive integer → { maxConcurrent: N, source: 'user' }
 * - Malformed JSON → throws with file path and parser detail
 * - Invalid max_concurrent (0, negative, float, string, null) → throws with field path and actual value
 *
 * No AJV dependency — hand-rolled validation.
 */
export function loadWalkerConfig(): WalkerConfig {
  const configPath = walkerConfigPath();

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return { maxConcurrent: 3, source: 'default', path: configPath };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `walker config at ${configPath} contains malformed JSON: ${detail}`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `walker config at ${configPath}: expected a JSON object, got ${JSON.stringify(parsed)}`
    );
  }

  const doc = parsed as Record<string, unknown>;

  if (!('max_concurrent' in doc)) {
    return { maxConcurrent: 3, source: 'default', path: configPath };
  }

  const value = doc['max_concurrent'];

  if (typeof value !== 'number') {
    throw new Error(
      `walker config at ${configPath}: max_concurrent must be a positive integer, got ${JSON.stringify(value)}`
    );
  }

  if (!Number.isInteger(value)) {
    throw new Error(
      `walker config at ${configPath}: max_concurrent must be a positive integer (no floats), got ${value}`
    );
  }

  if (value <= 0) {
    throw new Error(
      `walker config at ${configPath}: max_concurrent must be a positive integer (> 0), got ${value}`
    );
  }

  return { maxConcurrent: value, source: 'user', path: configPath };
}
