import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testSchema } from '../helpers/test-schema.js';

testSchema('status-transitions');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TASK_SM = resolve(__dirname, '..', '..', 'state-machines', 'task.json');

describe('task state-machine — security_gate annotation', () => {
  const sm = JSON.parse(readFileSync(TASK_SM, 'utf-8'));

  it('exactly three transitions carry security_gate===true', () => {
    const gated = sm.transitions.filter((t: { security_gate?: boolean }) => t.security_gate === true);
    expect(gated).toHaveLength(3);
  });

  it('security_gate transitions are automated-gates → ui-review (full_pipeline), → qa (full_pipeline), → merged (fast_lane)', () => {
    const gated: Array<{ from: string; to: string; path?: string }> = sm.transitions.filter(
      (t: { security_gate?: boolean }) => t.security_gate === true
    );
    const signatures = gated.map((t) => `${t.from}→${t.to}:${t.path ?? 'none'}`).sort();
    expect(signatures).toEqual([
      'automated-gates→merged:fast_lane',
      'automated-gates→qa:full_pipeline',
      'automated-gates→ui-review:full_pipeline',
    ]);
  });

  it('exactly one transition carries resets_security_verdict===true', () => {
    const resetting = sm.transitions.filter(
      (t: { resets_security_verdict?: boolean }) => t.resets_security_verdict === true
    );
    expect(resetting).toHaveLength(1);
  });

  it('the resets_security_verdict transition is review → automated-gates', () => {
    const resetting: Array<{ from: string; to: string }> = sm.transitions.filter(
      (t: { resets_security_verdict?: boolean }) => t.resets_security_verdict === true
    );
    expect(resetting[0].from).toBe('review');
    expect(resetting[0].to).toBe('automated-gates');
  });
});
