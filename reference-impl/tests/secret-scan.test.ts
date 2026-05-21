import { describe, it, expect } from 'vitest';
import { scanSecrets, loadSecretPatternsConfig } from '../lib/secret-scan.js';

const cfg = loadSecretPatternsConfig(process.cwd()); // shipped default (no consumer override at cwd)

describe('scanSecrets', () => {
  it('flags an AWS access key id as blocker', () => {
    const findings = scanSecrets('const k = "AKIAIOSFODNN7EXAMPLE2";', cfg);
    expect(findings.some(f => f.rule === 'aws-access-key-id' && f.severity === 'blocker')).toBe(true);
  });

  it('flags a GitHub token as blocker', () => {
    const findings = scanSecrets('token: ghp_' + 'a'.repeat(36), cfg);
    expect(findings.some(f => f.rule === 'github-token' && f.severity === 'blocker')).toBe(true);
  });

  it('flags a private key header as blocker', () => {
    const findings = scanSecrets('-----BEGIN RSA PRIVATE KEY-----', cfg);
    expect(findings.some(f => f.rule === 'private-key-header')).toBe(true);
  });

  it('flags a credentialed connection string as error', () => {
    const findings = scanSecrets('DB=postgres://user:hunter2@db.example/app', cfg);
    expect(findings.some(f => f.rule === 'credentialed-conn-string' && f.severity === 'error')).toBe(true);
  });

  it('flags a generic secret assignment as error', () => {
    const findings = scanSecrets('password = "s3cretValue!"', cfg);
    expect(findings.some(f => f.rule === 'generic-secret-assignment' && f.severity === 'error')).toBe(true);
  });

  it('does NOT flag an env-var reference', () => {
    expect(scanSecrets('api_key = process.env.API_KEY', cfg)).toEqual([]);
  });

  it('does NOT flag a template placeholder', () => {
    expect(scanSecrets('password = "${DB_PASSWORD}"', cfg)).toEqual([]);
    expect(scanSecrets('token = "<your-token>"', cfg)).toEqual([]);
    expect(scanSecrets('secret = "changeme"', cfg)).toEqual([]);
  });

  it('reports the 1-based line number in location', () => {
    const findings = scanSecrets('line1\nAKIAIOSFODNN7EXAMPLE2\nline3', cfg);
    expect(findings[0].location?.line).toBe(2);
  });

  it('returns finding shape conforming to the feedback schema', () => {
    const f = scanSecrets('AKIAIOSFODNN7EXAMPLE2', cfg)[0];
    expect(f).toHaveProperty('severity');
    expect(f).toHaveProperty('message');
    expect(f).toHaveProperty('rule');
  });

  it('loadSecretPatternsConfig loads the shipped default patterns', () => {
    expect(cfg.patterns.length).toBeGreaterThan(0);
    expect(Array.isArray(cfg.placeholder_excludes)).toBe(true);
  });
});
