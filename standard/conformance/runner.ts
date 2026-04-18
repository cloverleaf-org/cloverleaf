import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import { makeAjv } from './helpers/ajv-instance.js';
import {
  SCHEMA_LEVEL,
  VALIDATOR_LEVEL,
  CONTRACT_LEVEL,
  SCENARIO_LEVELS,
  includesLevel,
  parseLevelArg,
  type Level,
} from './level-map.js';
import {
  validateDagAcyclic,
  validatePlanTasksMatchDag,
  validateStatusByType,
  validateRelationshipMirror,
  validateIdPattern,
  validateCrossProjectRef,
  validateGateDecisionValidity,
  validateStatusTransitionLegality,
  type Plan, type Project, type StatusTransitions, type WorkItem,
  type StatusTransitionEvent, type GateDecisionEvent, type Task,
  refKey
} from '../validators/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const VALID = resolve(ROOT, 'examples', 'valid');
const INVALID = resolve(ROOT, 'examples', 'invalid');
const SCENARIOS = resolve(ROOT, 'examples', 'scenarios');
const STATE_MACHINES = resolve(ROOT, 'state-machines');
const CONTRACTS = resolve(ROOT, 'agent-contracts');
const SCHEMA_BASE = 'https://cloverleaf.example/schemas/';

let failures = 0;
let checks = 0;

const ajv = makeAjv();

const levelArg = (() => {
  const raw = process.argv.find((a) => a.startsWith('--level='));
  if (!raw) return 'all' as const;
  const parsed = parseLevelArg(raw.slice('--level='.length));
  if (parsed === null) {
    console.error(`Invalid --level value. Use 1, 2, 3, or all.`);
    process.exit(2);
  }
  return parsed;
})();

if (levelArg !== 'all') {
  console.log(`Running conformance suite at level: ${levelArg}`);
}

function schemaInLevel(schemaName: string): boolean {
  if (levelArg === 'all') return true;
  const lvl = SCHEMA_LEVEL[schemaName];
  if (!lvl) return false;
  return includesLevel(lvl, levelArg as Level);
}

function contractInLevel(contractName: string): boolean {
  if (levelArg === 'all') return true;
  const lvl = CONTRACT_LEVEL[contractName];
  if (!lvl) return false;
  return includesLevel(lvl, levelArg as Level);
}

function scenarioInLevel(scenarioName: string): boolean {
  if (levelArg === 'all') return true;
  const levels = SCENARIO_LEVELS[scenarioName];
  if (!levels) return false;
  return levels.some((l) => includesLevel(l, levelArg as Level));
}

function validatorInLevel(validatorName: string): boolean {
  if (levelArg === 'all') return true;
  const lvl = VALIDATOR_LEVEL[validatorName];
  if (!lvl) return false;
  return includesLevel(lvl, levelArg as Level);
}

function fail(msg: string): void {
  console.error(`  FAIL: ${msg}`);
  failures += 1;
}

function ok(msg: string): void {
  console.log(`  ok:   ${msg}`);
}

function walkExamples(root: string): Array<{ schemaName: string; filePath: string }> {
  const out: Array<{ schemaName: string; filePath: string }> = [];
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root)) {
    const subdir = resolve(root, dir);
    if (!statSync(subdir).isDirectory()) continue;
    for (const f of readdirSync(subdir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))) {
      out.push({ schemaName: dir, filePath: resolve(subdir, f) });
    }
  }
  return out;
}

console.log('Validating valid/ examples');
for (const { schemaName, filePath } of walkExamples(VALID)) {
  if (!schemaInLevel(schemaName)) continue;
  checks += 1;
  const id = `${SCHEMA_BASE}${schemaName}.schema.json`;
  const validate = ajv.getSchema(id);
  const rel = relative(ROOT, filePath);
  if (!validate) { fail(`${rel}: schema not registered (${id})`); continue; }
  const doc = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (!validate(doc)) {
    fail(`${rel}: expected valid, got errors: ${JSON.stringify(validate.errors)}`);
  } else { ok(rel); }
}

console.log('Validating invalid/ examples (must reject)');
for (const { schemaName, filePath } of walkExamples(INVALID)) {
  if (!schemaInLevel(schemaName)) continue;
  checks += 1;
  const id = `${SCHEMA_BASE}${schemaName}.schema.json`;
  const validate = ajv.getSchema(id);
  const rel = relative(ROOT, filePath);
  if (!validate) { fail(`${rel}: schema not registered (${id})`); continue; }
  const doc = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (validate(doc)) {
    fail(`${rel}: expected invalid, but validated`);
  } else { ok(rel); }
}

console.log('Validating OpenAPI contracts');
if (existsSync(CONTRACTS)) {
  for (const f of readdirSync(CONTRACTS).filter((f) => f.endsWith('.openapi.yaml'))) {
    const contractName = f.replace(/\.openapi\.yaml$/, '');
    if (!contractInLevel(contractName)) continue;
    checks += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const api = (await SwaggerParser.validate(resolve(CONTRACTS, f), {
        resolve: { external: false }
      })) as { openapi?: string };
      if (!api.openapi || !api.openapi.startsWith('3.1.')) {
        fail(`${f}: not OpenAPI 3.1`);
      } else { ok(`${f}`); }
    } catch (err) {
      fail(`${f}: ${(err as Error).message}`);
    }
  }
}

console.log('Validating scenarios/ (schemas + validators)');
if (existsSync(SCENARIOS)) {
  for (const scenario of readdirSync(SCENARIOS)) {
    const scenarioRoot = resolve(SCENARIOS, scenario);
    if (!statSync(scenarioRoot).isDirectory()) continue;
    if (!scenarioInLevel(scenario)) continue;
    await validateScenario(scenarioRoot, scenario);
  }
}

async function validateScenario(scenarioRoot: string, name: string): Promise<void> {
  const projects: Project[] = [];
  const workItems = new Map<string, WorkItem>();

  // Map subdir → schema name
  const subdirToSchema: Record<string, string> = {
    projects: 'project',
    rfcs: 'rfc',
    spikes: 'spike',
    plans: 'plan',
    tasks: 'task',
    rules: '',
    events: '',
    feedback: 'feedback'
  };

  for (const subdir of Object.keys(subdirToSchema)) {
    const dir = resolve(scenarioRoot, subdir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.meta.json'))) {
      const path = resolve(dir, f);
      const rel = relative(ROOT, path);
      const doc = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      let schemaName = subdirToSchema[subdir];
      if (subdir === 'rules') {
        schemaName = basename(f, '.json') === 'risk-classifier' ? 'risk-classifier-rules' : 'path-rules';
      } else if (subdir === 'events') {
        const d = doc as { event_type?: string };
        schemaName = d.event_type === 'gate_decision' ? 'gate-decision-event' : 'status-transition-event';
      }
      if (schemaName && !schemaInLevel(schemaName)) continue;
      checks += 1;
      const schemaId = `${SCHEMA_BASE}${schemaName}.schema.json`;
      const validate = ajv.getSchema(schemaId);
      if (!validate) { fail(`${rel}: schema not registered (${schemaId})`); continue; }
      if (!validate(doc)) {
        fail(`${rel}: ${JSON.stringify(validate.errors)}`);
        continue;
      }
      ok(rel);
      if (subdir === 'projects') projects.push(doc as Project);
      if (['rfcs', 'spikes', 'plans', 'tasks'].includes(subdir)) {
        const wi = doc as WorkItem;
        workItems.set(refKey({ project: wi.project, id: wi.id }), wi);
      }
    }
  }

  await runValidators(scenarioRoot, name, projects, workItems);
}

async function runValidators(
  scenarioRoot: string,
  name: string,
  projects: Project[],
  workItems: Map<string, WorkItem>
): Promise<void> {
  for (const wi of workItems.values()) {
    if (wi.type !== 'plan') continue;
    if (!validatorInLevel('dag-acyclic')) continue;
    checks += 1;
    const result = validateDagAcyclic((wi as Plan).task_dag);
    if (!result.ok) {
      fail(`scenarios/${name} #1 dag-acyclic on ${wi.id}: ${result.violations[0].message}`);
    } else {
      ok(`scenarios/${name} #1 dag-acyclic on ${wi.id}`);
    }
  }

  for (const wi of workItems.values()) {
    if (wi.type !== 'plan') continue;
    if (!validatorInLevel('plan-tasks-match-dag')) continue;
    checks += 1;
    const result = validatePlanTasksMatchDag(wi as Plan);
    if (!result.ok) {
      fail(`scenarios/${name} #2 plan-tasks-match-dag on ${wi.id}: ${result.violations[0].message}`);
    } else {
      ok(`scenarios/${name} #2 plan-tasks-match-dag on ${wi.id}`);
    }
  }

  for (const wi of workItems.values()) {
    if (!validatorInLevel('status-by-type')) continue;
    checks += 1;
    const result = validateStatusByType(wi);
    if (!result.ok) {
      fail(`scenarios/${name} #3 status-by-type on ${wi.id}: ${result.violations[0].message}`);
    } else {
      ok(`scenarios/${name} #3 status-by-type on ${wi.id}`);
    }
  }

  for (const wi of workItems.values()) {
    if (!wi.relationships || wi.relationships.length === 0) continue;
    if (!validatorInLevel('relationship-mirror')) continue;
    checks += 1;
    const result = validateRelationshipMirror(wi, workItems);
    if (!result.ok) {
      fail(`scenarios/${name} #4 relationship-mirror on ${wi.id}: ${result.violations[0].message}`);
    } else {
      ok(`scenarios/${name} #4 relationship-mirror on ${wi.id}`);
    }
  }

  for (const wi of workItems.values()) {
    const project = projects.find((p) => p.key === wi.project);
    if (!project) continue;
    if (!validatorInLevel('id-pattern')) continue;
    checks += 1;
    const result = validateIdPattern(wi, project);
    if (!result.ok) {
      fail(`scenarios/${name} #5 id-pattern on ${wi.id}: ${result.violations[0].message}`);
    } else {
      ok(`scenarios/${name} #5 id-pattern on ${wi.id}`);
    }
  }

  for (const wi of workItems.values()) {
    for (const rel of wi.relationships ?? []) {
      if (!validatorInLevel('cross-project-ref')) continue;
      checks += 1;
      const result = validateCrossProjectRef(rel.target, projects);
      if (!result.ok) {
        fail(`scenarios/${name} #6 cross-project-ref on ${wi.id}: ${result.violations[0].message}`);
      } else {
        ok(`scenarios/${name} #6 cross-project-ref on ${wi.id} → ${rel.target.project}::${rel.target.id}`);
      }
    }
  }

  const eventsDir = resolve(scenarioRoot, 'events');
  if (existsSync(eventsDir)) {
    for (const f of readdirSync(eventsDir).filter((x) => x.endsWith('.json'))) {
      const doc = JSON.parse(readFileSync(resolve(eventsDir, f), 'utf-8')) as { event_type: string };
      if (doc.event_type === 'gate_decision') {
        if (!validatorInLevel('gate-decision-validity')) continue;
        checks += 1;
        const result = validateGateDecisionValidity(doc as GateDecisionEvent);
        if (!result.ok) {
          fail(`scenarios/${name} #7 gate-decision-validity ${f}: ${result.violations[0].message}`);
        } else {
          ok(`scenarios/${name} #7 gate-decision-validity ${f}`);
        }
      } else if (doc.event_type === 'status_transition') {
        if (!validatorInLevel('status-transition-legality')) continue;
        const event = doc as StatusTransitionEvent;
        const machinePath = resolve(STATE_MACHINES, `${event.work_item_type}.json`);
        if (!existsSync(machinePath)) continue;
        const machine = JSON.parse(readFileSync(machinePath, 'utf-8')) as StatusTransitions;
        const referenced = workItems.get(refKey(event.work_item_id));
        checks += 1;
        const result = validateStatusTransitionLegality(
          event,
          machine,
          referenced && referenced.type === 'task' ? (referenced as Task) : undefined
        );
        if (!result.ok) {
          fail(`scenarios/${name} #8 status-transition-legality ${f}: ${result.violations[0].message}`);
        } else {
          ok(`scenarios/${name} #8 status-transition-legality ${f}`);
        }
      }
    }
  }
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
