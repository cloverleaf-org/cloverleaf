import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SCHEMA_LEVEL,
  VALIDATOR_LEVEL,
  CONTRACT_LEVEL,
  STATE_MACHINE_LEVEL,
  SCENARIO_LEVELS,
  LEVELS,
  includesLevel,
  parseLevelArg,
} from '../level-map.js';

const STANDARD_ROOT = resolve(__dirname, '..', '..');

describe('level-map coverage', () => {
  it('assigns every schema file to a level', () => {
    const schemaDir = resolve(STANDARD_ROOT, 'schemas');
    const schemaFiles = readdirSync(schemaDir)
      .filter((f) => f.endsWith('.schema.json'))
      .map((f) => f.replace(/\.schema\.json$/, ''));
    for (const name of schemaFiles) {
      expect(SCHEMA_LEVEL[name], `schema "${name}" missing from SCHEMA_LEVEL`).toBeDefined();
    }
  });

  it('assigns every agent contract to a level', () => {
    const contractsDir = resolve(STANDARD_ROOT, 'agent-contracts');
    const contractFiles = readdirSync(contractsDir)
      .filter((f) => f.endsWith('.openapi.yaml'))
      .map((f) => f.replace(/\.openapi\.yaml$/, ''));
    for (const name of contractFiles) {
      expect(CONTRACT_LEVEL[name], `contract "${name}" missing from CONTRACT_LEVEL`).toBeDefined();
    }
  });

  it('assigns every state machine to a level', () => {
    const smDir = resolve(STANDARD_ROOT, 'state-machines');
    const smFiles = readdirSync(smDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    for (const name of smFiles) {
      expect(STATE_MACHINE_LEVEL[name], `state machine "${name}" missing from STATE_MACHINE_LEVEL`).toBeDefined();
    }
  });

  it('assigns every validator to a level', () => {
    const validatorDir = resolve(STANDARD_ROOT, 'validators');
    const validatorFiles = readdirSync(validatorDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .filter((name) => name !== 'index' && name !== 'types');
    for (const name of validatorFiles) {
      expect(VALIDATOR_LEVEL[name], `validator "${name}" missing from VALIDATOR_LEVEL`).toBeDefined();
    }
  });

  it('assigns every scenario directory to level(s)', () => {
    const scenariosDir = resolve(STANDARD_ROOT, 'examples', 'scenarios');
    if (!existsSync(scenariosDir)) return;
    const scenarioDirs = readdirSync(scenariosDir).filter((d) =>
      statSync(resolve(scenariosDir, d)).isDirectory()
    );
    for (const name of scenarioDirs) {
      expect(SCENARIO_LEVELS[name], `scenario "${name}" missing from SCENARIO_LEVELS`).toBeDefined();
    }
  });

  it('references only known level values', () => {
    const flatMaps = [SCHEMA_LEVEL, VALIDATOR_LEVEL, CONTRACT_LEVEL, STATE_MACHINE_LEVEL];
    for (const m of flatMaps) {
      for (const [, level] of Object.entries(m)) {
        expect(LEVELS).toContain(level);
      }
    }
    for (const [, levels] of Object.entries(SCENARIO_LEVELS)) {
      for (const level of levels) {
        expect(LEVELS).toContain(level);
      }
    }
  });
});

describe('includesLevel', () => {
  it('treats levels as supersets: L1 ⊂ L2 ⊂ L3', () => {
    expect(includesLevel('L1', 'L1')).toBe(true);
    expect(includesLevel('L1', 'L2')).toBe(true);
    expect(includesLevel('L1', 'L3')).toBe(true);
    expect(includesLevel('L2', 'L1')).toBe(false);
    expect(includesLevel('L2', 'L2')).toBe(true);
    expect(includesLevel('L2', 'L3')).toBe(true);
    expect(includesLevel('L3', 'L1')).toBe(false);
    expect(includesLevel('L3', 'L2')).toBe(false);
    expect(includesLevel('L3', 'L3')).toBe(true);
  });
});

describe('parseLevelArg', () => {
  it('parses valid level args', () => {
    expect(parseLevelArg('1')).toBe('L1');
    expect(parseLevelArg('2')).toBe('L2');
    expect(parseLevelArg('3')).toBe('L3');
    expect(parseLevelArg('all')).toBe('all');
  });

  it('returns null for invalid args', () => {
    expect(parseLevelArg('L1')).toBe(null);
    expect(parseLevelArg('4')).toBe(null);
    expect(parseLevelArg('')).toBe(null);
    expect(parseLevelArg('none')).toBe(null);
  });
});
