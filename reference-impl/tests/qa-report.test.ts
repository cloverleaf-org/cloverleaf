import { describe, it, expect } from 'vitest';
import { renderQaReport, type QaRunResult } from '../lib/qa-report.js';

const fixtureRun: QaRunResult = {
  ruleId: 'test',
  command: 'npm test',
  cwd: 'reference-impl',
  durationMs: 12345,
  passed: true,
  stdoutTail: 'All tests passed\n',
  stderrTail: '',
};

describe('renderQaReport', () => {
  it('returns an HTML document string', () => {
    const html = renderQaReport([fixtureRun]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes each run row with rule + command + duration + status', () => {
    const html = renderQaReport([fixtureRun]);
    expect(html).toContain('test');
    expect(html).toContain('npm test');
    expect(html).toContain('12345');
    expect(html.toLowerCase()).toMatch(/pass/);
  });

  it('marks failed runs visibly', () => {
    const failRun: QaRunResult = { ...fixtureRun, passed: false, stderrTail: 'FAILED\n' };
    const html = renderQaReport([failRun]);
    expect(html.toLowerCase()).toMatch(/fail/);
    expect(html).toContain('FAILED');
  });

  it('escapes HTML-unsafe characters in stdout/stderr', () => {
    const run: QaRunResult = { ...fixtureRun, stdoutTail: '<script>alert(1)</script>' };
    const html = renderQaReport([run]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders an empty-state when no runs', () => {
    const html = renderQaReport([]);
    expect(html.toLowerCase()).toMatch(/no.*(runs|results)/);
  });
});
