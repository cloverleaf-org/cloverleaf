import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCouncilPlan, applyCouncilVerdict } from '../lib/council.js';
import { loadTask } from '../lib/task.js';

const base = {
  type: 'task', project: 'DEMO', title: 't', owner: { kind: 'agent', id: 'x' },
  context: { rfc: { project: 'DEMO', id: 'DEMO-1' } }, acceptance_criteria: ['a'], definition_of_done: ['d'],
};
// A neutral (empty) affected-routes config: with no page roots / global patterns /
// route scope, no changed path maps to a route → ui_changes is false. We install it
// by default so the council-only dimensions (risk_class→lane, security_class→member,
// disposition) are isolated from the shipped affected-routes globs (whose
// routeScope:["src/**"] would otherwise make src/x.ts UI-affecting). The ui-inclusion
// case below supplies its own explicit routes config to exercise ui-when-changes.
const NEUTRAL_ROUTES = { pageRoots: [], globalPatterns: [], routeScope: [], contentRoutes: {} };

function repoWithTask(
  task: Record<string, unknown>,
  routesConfig: unknown = NEUTRAL_ROUTES,
): string {
  const repo = mkdtempSync(join(tmpdir(), 'clv-backcompat-'));
  mkdirSync(join(repo, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repo, '.cloverleaf', 'events'), { recursive: true });
  mkdirSync(join(repo, '.cloverleaf', 'config'), { recursive: true });
  writeFileSync(join(repo, '.cloverleaf', 'tasks', `${task.id}.json`), JSON.stringify(task));
  writeFileSync(join(repo, '.cloverleaf', 'config', 'affected-routes.json'), JSON.stringify(routesConfig));
  return repo;
}
const members = (plan: { rounds: { member: string }[][] }) => plan.rounds.map((r) => r.map((m) => m.member));

describe('default council back-compat (shipped config, no consumer override)', () => {
  it('low + sec-low → delivery-fast, reviewer only', () => {
    const repo = repoWithTask({ ...base, id: 'DEMO-001', status: 'council', risk_class: 'low', security_class: 'low' });
    const plan = resolveCouncilPlan(repo, 'DEMO-001', 'task.review', { changedFiles: ['src/x.ts'] });
    expect(plan.source).toBe('default');
    expect(plan.profile).toBe('delivery-fast');
    expect(members(plan)).toEqual([['reviewer']]);
    rmSync(repo, { recursive: true, force: true });
  });

  it('low + sec-high → delivery-fast, reviewer then security', () => {
    const repo = repoWithTask({ ...base, id: 'DEMO-002', status: 'council', risk_class: 'low', security_class: 'high' });
    const plan = resolveCouncilPlan(repo, 'DEMO-002', 'task.review', { changedFiles: ['src/x.ts'] });
    expect(plan.profile).toBe('delivery-fast');
    expect(members(plan)).toEqual([['reviewer'], ['security']]);
    rmSync(repo, { recursive: true, force: true });
  });

  it('high + sec-low + no-ui → delivery-full, reviewer then qa', () => {
    const repo = repoWithTask({ ...base, id: 'DEMO-003', status: 'council', risk_class: 'high', security_class: 'low' });
    const plan = resolveCouncilPlan(repo, 'DEMO-003', 'task.review', { changedFiles: ['src/x.ts'] });
    expect(plan.profile).toBe('delivery-full');
    expect(members(plan)).toEqual([['reviewer'], ['qa']]);
    rmSync(repo, { recursive: true, force: true });
  });

  it('high + sec-high + no-ui → delivery-full, reviewer then security + qa', () => {
    const repo = repoWithTask({ ...base, id: 'DEMO-004', status: 'council', risk_class: 'high', security_class: 'high' });
    const plan = resolveCouncilPlan(repo, 'DEMO-004', 'task.review', { changedFiles: ['src/x.ts'] });
    expect(plan.profile).toBe('delivery-full');
    expect(members(plan)).toEqual([['reviewer'], ['security', 'qa']]);
    rmSync(repo, { recursive: true, force: true });
  });

  it('high + sec-low + ui → delivery-full, reviewer then ui + qa', () => {
    // Complements the "no-ui" cases: proves the shipped default's ui-when-changes
    // wiring reproduces today. Deterministic — an explicit page-root config maps the
    // changed page file to a real route (src/pages/x.astro → /x/) so ui_changes=true,
    // rather than relying on the shipped src/** → 'all' glob (brittle).
    const repo = repoWithTask(
      { ...base, id: 'DEMO-007', status: 'council', risk_class: 'high', security_class: 'low' },
      { pageRoots: ['src/pages/'], globalPatterns: [], routeScope: [], contentRoutes: {} },
    );
    const plan = resolveCouncilPlan(repo, 'DEMO-007', 'task.review', { changedFiles: ['src/pages/x.astro'] });
    expect(plan.profile).toBe('delivery-full');
    expect(members(plan)).toEqual([['reviewer'], ['ui', 'qa']]);
    rmSync(repo, { recursive: true, force: true });
  });

  it('a decisive pass advances council → final-gate for BOTH lanes', () => {
    for (const [id, risk] of [['DEMO-005', 'low'], ['DEMO-006', 'high']] as const) {
      const repo = repoWithTask({ ...base, id, status: 'council', risk_class: risk, security_class: 'low' });
      const r = applyCouncilVerdict(repo, id, 'task.review', { verdict: 'pass', rule: 'any-veto', rationale: 'ok', members: [{ member: 'reviewer', verdict: 'pass' }] });
      expect(r.walk).toEqual(['council', 'final-gate']);
      expect(loadTask(repo, id).status).toBe('final-gate');
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
