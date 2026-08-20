import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { StatusTransitions } from '@cloverleaf/standard/validators/index.js';

/**
 * Cross-boundary backstop: every FSM transition a skill documents must be one the
 * Standard's state machines actually permit, and /cloverleaf-gate's human-decision
 * mapping must be the mapping those state machines imply.
 *
 * ## Why this suite exists
 *
 * /cloverleaf-gate is the only skill mapping a multi-way human decision
 * (approve|reject|revise) onto FSM statuses, and that mapping lives ONLY in its
 * prose — there is no decision→status map anywhere in lib/. Two mutations of it
 * (`approve`→rejected, `revise`→approved) are LEGAL transitions, so the runtime
 * validator in lib/work-item.ts accepts them silently. Before this suite, both
 * passed 539 tests untouched.
 *
 * ## Anchoring
 *
 * Expected values are DERIVED from the Standard's state machines, never restated
 * here. A guard that restated the mapping would go green whenever skill and test
 * drifted together — the failure mode that made an earlier roster guard useless.
 *
 * ## Coverage bounds — what a green run does NOT prove
 *
 * - Not that the skills are correct; only that every documented transition is one
 *   the Standard permits, and that the gate mapping matches the derived one.
 * - Tier 2 cannot catch a wrong target that is legal for the same (actor, gate)
 *   triple. Tier 1 covers that for /cloverleaf-gate; no other skill has an
 *   equivalent multi-way mapping.
 * - Tier 3 (walk-validation) covers LINEAR_SKILLS only — currently cloverleaf-spike.
 * - Prose preconditions other than the two in Tier 1b remain unpinned here.
 */

const ROOT = resolve(__dirname, '..');
const req = createRequire(import.meta.url);
const STANDARD_DIR = req
  .resolve('@cloverleaf/standard/package.json')
  .replace(/\/package\.json$/, '');

type WorkItemType = 'rfc' | 'plan' | 'spike' | 'task';

function stateMachine(type: WorkItemType): StatusTransitions {
  return JSON.parse(
    readFileSync(`${STANDARD_DIR}/state-machines/${type}.json`, 'utf-8'),
  ) as StatusTransitions;
}

function skill(name: string): string {
  return readFileSync(resolve(ROOT, 'skills', name, 'SKILL.md'), 'utf-8');
}

/** Slice a numbered step (`N. …`) out of a skill body, up to the next step or heading. */
function step(body: string, n: number): string {
  const m = body.match(
    new RegExp(`^${n}\\. [\\s\\S]*?(?=^\\d+\\. |^## |$(?![\\s\\S]))`, 'm'),
  );
  return m ? m[0] : '';
}

/**
 * The fenced bash block inside a slice. Assertions target THIS, never the slice
 * itself: step headings repeat status tokens, so a slice-level match passes on a
 * file whose code has been gutted. That cost a missed mutation during prototyping.
 */
function bashBlock(text: string): string {
  const m = text.match(/```bash\n([\s\S]*?)```/);
  return m ? m[1] : '';
}

interface AdvanceCall {
  typeToken: string;
  status: string;
  actor: string;
  gateToken: string | null;
}

/**
 * Line-anchored on purpose: an unanchored form crosses the newline when a call has
 * no gate argument and captures the closing fence as the gate.
 */
const ADVANCE =
  /cloverleaf-cli[ \t]+advance-(\S+)[ \t]+\S+[ \t]+\S+[ \t]+(\S+)[ \t]+(\S+)(?:[ \t]+(\S+))?[ \t]*$/gm;

function advances(text: string): AdvanceCall[] {
  return [...text.matchAll(ADVANCE)].map((m) => ({
    typeToken: m[1],
    status: m[2],
    actor: m[3],
    gateToken: m[4] ?? null,
  }));
}

/** `advance-<suffix>` → the state machine(s) it drives. `$TYPE` is polymorphic. */
const TYPE_OF: Record<string, WorkItemType[]> = {
  rfc: ['rfc'],
  plan: ['plan'],
  spike: ['spike'],
  status: ['task'],
  $TYPE: ['rfc', 'plan'],
};

describe('skill FSM transitions: extraction', () => {
  it('extracts the three gated calls in cloverleaf-gate', () => {
    const calls = advances(skill('cloverleaf-gate'));
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.gateToken === '$GATE')).toBe(true);
  });

  it('does not bleed the closing fence into a call that has no gate argument', () => {
    // cloverleaf-spike's calls end at the actor. An unanchored regex crosses the
    // newline here and captures the fence as the gate — this is the regression pin.
    const calls = advances(skill('cloverleaf-spike'));
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.gateToken)).toEqual([null, null]);
  });

  it('slices a step and finds its bash block', () => {
    const s5 = step(skill('cloverleaf-gate'), 5);
    expect(s5).toContain('Verify the item');
    expect(bashBlock(s5)).toContain('STATUS');
  });
});

/**
 * The mapping the Standard IMPLIES for a gate, derived — never restated.
 *
 * Candidates are the human transitions out of `gate-pending` carrying this gate.
 * `approve`/`reject` are the candidates named for them; `revise` is the sole
 * remainder, if exactly one remains. `abandoned` is excluded automatically because
 * its transition carries no `gate` field.
 *
 * Measured: rfc → {approved, rejected, drafting}; plan → {approved, rejected, null}.
 * The plan `null` is WHY the skill pins revise to `advance-rfc`.
 */
function deriveGateMapping(type: WorkItemType, gate: string) {
  const candidates = stateMachine(type).transitions.filter(
    (t) => t.from === 'gate-pending' && t.gate === gate && (t.allowed_actors ?? []).includes('human'),
  );
  const approve = candidates.find((t) => t.to === 'approved');
  const reject = candidates.find((t) => t.to === 'rejected');
  const rest = candidates.filter((t) => t !== approve && t !== reject);
  return {
    approve: approve?.to ?? null,
    reject: reject?.to ?? null,
    revise: rest.length === 1 ? rest[0].to : null,
  };
}

/** Parse step 7's `case "$ACTION" in … esac` into action → advance call. */
function parseGateMapping(body: string): Record<string, AdvanceCall> {
  const block = step(body, 7).match(/case\s+"\$ACTION"\s+in([\s\S]*?)esac/);
  if (!block) return {};
  const out: Record<string, AdvanceCall> = {};
  for (const branch of block[1].matchAll(/^\s{2,}(\w+)\)\s*$([\s\S]*?);;/gm)) {
    const [call] = advances(branch[2]);
    if (call) out[branch[1]] = call;
  }
  return out;
}

describe('Tier 1: /cloverleaf-gate maps human decisions the way the Standard implies', () => {
  const body = skill('cloverleaf-gate');
  const mapping = parseGateMapping(body);
  const rfc = deriveGateMapping('rfc', 'rfc_strategy_gate');
  const plan = deriveGateMapping('plan', 'task_batch_gate');

  it('parses exactly approve, reject and revise from step 7 (anti-vacuity)', () => {
    expect(Object.keys(mapping).sort()).toEqual(['approve', 'reject', 'revise']);
  });

  it('derives a non-empty mapping from the Standard (anti-vacuity)', () => {
    expect(rfc.approve).toBeTruthy();
    expect(rfc.reject).toBeTruthy();
    expect(rfc.revise).toBeTruthy();
    expect(plan.approve).toBeTruthy();
  });

  for (const action of ['approve', 'reject'] as const) {
    it(`${action} advances to the status the Standard implies, for BOTH rfc and plan`, () => {
      expect(mapping[action].status).toBe(rfc[action]);
      expect(mapping[action].status).toBe(plan[action]);
    });

    it(`${action} uses the polymorphic $TYPE, since it is valid for both types`, () => {
      expect(mapping[action].typeToken).toBe('$TYPE');
    });
  }

  it('revise advances to the RFC revise target the Standard implies', () => {
    expect(mapping.revise.status).toBe(rfc.revise);
  });

  it('revise is pinned to advance-rfc BECAUSE plan has no revise transition', () => {
    expect(plan.revise).toBeNull();
    expect(mapping.revise.typeToken).toBe('rfc');
  });

  for (const action of ['approve', 'reject', 'revise'] as const) {
    it(`${action} is performed by the human actor`, () => {
      expect(mapping[action].actor).toBe('human');
    });
  }
});
