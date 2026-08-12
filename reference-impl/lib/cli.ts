#!/usr/bin/env -S npx tsx
/**
 * Cloverleaf CLI dispatcher.
 *
 * Usage: cli.ts <command> [args...]
 *
 * Commands:
 *   load-task <repoRoot> <taskId>
 *   infer-project <repoRoot>
 *   next-task-id <repoRoot> [--project=<p>]
 *   advance-status <repoRoot> <taskId> <toStatus> <actor> [gate]
 *   write-feedback <repoRoot> <taskId> <envelopeJsonPath>
 *   latest-feedback <repoRoot> <taskId>
 *   emit-gate-decision <repoRoot> <workItemId> <gate> <decision> <actor> [--comment=<str>]
 *   ui-review-config --repo-root <repoRoot>
 *   read-ui-review-state <repoRoot> <taskId>
 *   write-ui-review-state <repoRoot> <taskId> <baselines_pending>
 *   write-baseline <repoRoot> <taskId> <browser> <slug> <viewport> <sourceFile>
 *   plugin-root
 *   load-rfc <repoRoot> <id>
 *   save-rfc <repoRoot> <filePath>
 *   advance-rfc <repoRoot> <id> <toStatus> <agent|human> [gate]
 *   rfc-tasks <repoRoot> <rfcId> [--pretty]
 *   load-spike <repoRoot> <id>
 *   save-spike <repoRoot> <filePath>
 *   advance-spike <repoRoot> <id> <toStatus> <agent|human>
 *   load-plan <repoRoot> <id>
 *   save-plan <repoRoot> <filePath>
 *   advance-plan <repoRoot> <id> <toStatus> <agent|human> [gate]
 *   materialise-tasks <repoRoot> <planId>
 *   next-work-item-id <repoRoot> <project>
 *   discovery-config --repo-root <repoRoot>
 *   prep-worktree <mainRoot> <worktreePath>
 *   qa-report <runs.json> <out.html>
 *   dag-ready-tasks <repoRoot> <planId> <maxConcurrent>
 *   dag-detect-cycle <repoRoot> <planId>
 *   walk-state-read <repoRoot> <planId>
 *   walk-state-write <repoRoot> <walkStateJsonPath>
 *   walker-default-concurrency [--explain]
 *   check-scope <repoRoot> <taskId> --branch <branchName>
 *   extend-scope <repoRoot> <taskId> --add <file>... --reason <text>
 *   secret-scan <repoRoot> --branch <branch>
 *   classify-security <repoRoot> <taskId> [--branch <branch>]
 *   set-task-field <repoRoot> <taskId> <field> <value>
 *   council-plan <repoRoot> <taskId> [gateKey] [--changed-files=a,b,c]
 *   aggregate-verdicts <membersJson> <rule> [--weighted-threshold=N]
 *   apply-council-verdict <repoRoot> <taskId> <gate> <councilVerdictJson>
 *   chair-context <chairMemberInputsJson>
 *   chair-verdict <chairRawJson> <membersJson>
 *   validate-council <repoRoot>
 */

import { readFileSync, mkdirSync, copyFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { loadTask, saveTask } from './task.js';
import { advanceStatus } from './task.js';
import { emitGateDecision } from './events.js';
import { writeFeedback, latestFeedback } from './feedback.js';
import { nextTaskId, inferProject, nextWorkItemId } from './ids.js';
import { matchesUiPaths } from './ui-paths.js';
import { loadUiPathsConfig } from './ui-paths.js';
import { computeAffectedRoutes } from './affected-routes.js';
import { loadAffectedRoutesConfig } from './affected-routes.js';
import { loadUiReviewConfig } from './ui-review-config.js';
import { getPluginRoot } from './plugin-path.js';
import type { FeedbackEnvelope } from './feedback.js';
import { loadRfc, saveRfc, advanceRfcStatus, type RfcDoc } from './rfc.js';
import { loadSpike, saveSpike, advanceSpikeStatus, type SpikeDoc } from './spike.js';
import { loadPlan, savePlan, advancePlanStatus, materialiseTasksFromPlan, type PlanDoc } from './plan.js';
import { loadDiscoveryConfig } from './discovery-config.js';
import { prepWorktree } from './prep-worktree.js';
import { writeQaReportFromFile } from './qa-report.js';
import { readUiReviewState, writeUiReviewState } from './ui-review-state.js';
import { buildBaselinePath } from './visual-diff.js';
import { computeReadyTasks, detectCycle } from './dag-walker.js';
import { readWalkState, writeWalkState, walkStatePath } from './walk-state.js';
import { loadWalkerConfig } from './walker-config.js';
import { classifyFiles, normalizePath } from './scope-check.js';
import type { SiblingScope } from './scope-check.js';
import { computeRfcTasksView, type RfcTasksView } from './rfc-tasks.js';
import { loadSecretPatternsConfig, scanSecrets } from './secret-scan.js';
import { classifyTaskSecurity } from './security-classify.js';
import { resolveCouncilPlan, applyCouncilVerdict, GATE_DESCRIPTORS } from './council.js';
import { loadCouncilConfigWithSource } from './council-config.js';
import { validateCouncilConfig } from '@cloverleaf/standard/validators/index.js';
import { aggregate, type MemberVerdict, type ThresholdRule, type CouncilVerdict } from './aggregation.js';
import { buildChairContext, finalizeChairVerdict, type ChairMemberInput, type ChairRawVerdict } from './chair.js';

function die(msg: string, code = 1): never {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function usage(msg?: string): never {
  if (msg) process.stderr.write(msg + '\n');
  process.stderr.write(
    'Usage: cli.ts <command> [args...]\n' +
      'Commands:\n' +
      '  load-task <repoRoot> <taskId>\n' +
      '  infer-project <repoRoot>\n' +
      '  next-task-id <repoRoot> [--project=<p>]\n' +
      '  advance-status <repoRoot> <taskId> <toStatus> <actor> [gate]\n' +
      '  write-feedback <repoRoot> <taskId> <envelopeJsonPath>\n' +
      '  latest-feedback <repoRoot> <taskId>\n' +
      '  emit-gate-decision <repoRoot> <workItemId> <gate> <decision> <actor> [--comment=<str>]\n' +
      '  ui-review-config --repo-root <repoRoot>\n' +
      '  read-ui-review-state <repoRoot> <taskId>\n' +
      '  write-ui-review-state <repoRoot> <taskId> <baselines_pending>\n' +
      '  write-baseline <repoRoot> <taskId> <browser> <slug> <viewport> <sourceFile>\n' +
      '  plugin-root\n' +
      '  load-rfc <repoRoot> <id>\n' +
      '  save-rfc <repoRoot> <filePath>\n' +
      '  advance-rfc <repoRoot> <id> <toStatus> <agent|human> [gate]\n' +
      '  rfc-tasks <repoRoot> <rfcId> [--pretty]\n' +
      '  load-spike <repoRoot> <id>\n' +
      '  save-spike <repoRoot> <filePath>\n' +
      '  advance-spike <repoRoot> <id> <toStatus> <agent|human>\n' +
      '  load-plan <repoRoot> <id>\n' +
      '  save-plan <repoRoot> <filePath>\n' +
      '  advance-plan <repoRoot> <id> <toStatus> <agent|human> [gate]\n' +
      '  materialise-tasks <repoRoot> <planId>\n' +
      '  next-work-item-id <repoRoot> <project>\n' +
      '  discovery-config --repo-root <repoRoot>\n' +
      '  prep-worktree <mainRoot> <worktreePath>\n' +
      '  qa-report <runs.json> <out.html>\n' +
      '  dag-ready-tasks <repoRoot> <planId> <maxConcurrent>\n' +
      '  dag-detect-cycle <repoRoot> <planId>\n' +
      '  walk-state-read <repoRoot> <planId>\n' +
      '  walk-state-write <repoRoot> <walkStateJsonPath>\n' +
      '  walker-default-concurrency [--explain]\n' +
      '  check-scope <repoRoot> <taskId> --branch <branchName>\n' +
      '  extend-scope <repoRoot> <taskId> --add <file>... --reason <text>\n' +
      '  secret-scan <repoRoot> --branch <branch>\n' +
      '  classify-security <repoRoot> <taskId> [--branch <branch>]\n' +
      '  council-plan <repoRoot> <taskId> [gateKey] [--changed-files=a,b,c]\n' +
      '  aggregate-verdicts <membersJson> <rule> [--weighted-threshold=N]\n' +
      '  apply-council-verdict <repoRoot> <taskId> <gate> <councilVerdictJson>\n' +
      '  chair-context <chairMemberInputsJson>\n' +
      '  chair-verdict <chairRawJson> <membersJson>\n' +
      '  set-task-field <repoRoot> <taskId> <field> <value>\n' +
      '  validate-council <repoRoot>\n'
  );
  process.exit(2);
}

const [, , command, ...rest] = process.argv;

if (!command) {
  usage('Error: no command given');
}

try {
  switch (command) {
    case 'load-task': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, taskId] = positional;
      if (!repoRoot || !taskId) usage('load-task requires <repoRoot> <taskId>');
      const pretty = flags.includes('--pretty');
      const task = loadTask(repoRoot, taskId);
      process.stdout.write((pretty ? JSON.stringify(task, null, 2) : JSON.stringify(task)) + '\n');
      break;
    }

    case 'infer-project': {
      const [repoRoot] = rest;
      if (!repoRoot) usage('infer-project requires <repoRoot>');
      const project = inferProject(repoRoot);
      process.stdout.write(project + '\n');
      break;
    }

    case 'next-task-id': {
      // rest may contain --project=<p> flag among positional args
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot] = positional;
      if (!repoRoot) usage('next-task-id requires <repoRoot>');
      const projectFlag = flags.find((f) => f.startsWith('--project='));
      const explicitProject = projectFlag ? projectFlag.replace('--project=', '') : undefined;
      const project = inferProject(repoRoot, explicitProject);
      const id = nextTaskId(repoRoot, project);
      process.stdout.write(id + '\n');
      break;
    }

    case 'advance-status': {
      const [repoRoot, taskId, toStatus, actorArg, gate] = rest;
      if (!repoRoot || !taskId || !toStatus || !actorArg)
        usage('advance-status requires <repoRoot> <taskId> <toStatus> <actor> [gate]');
      if (actorArg !== 'agent' && actorArg !== 'human') {
        die(`actor must be 'agent' or 'human' (got '${actorArg}')`, 2);
      }
      const actor: 'agent' | 'human' = actorArg;
      const opts: { gate?: string } = {};
      if (gate) opts.gate = gate;
      const updated = advanceStatus(repoRoot, taskId, toStatus, actor, opts);
      process.stdout.write(updated.status + '\n');
      break;
    }

    case 'write-feedback': {
      const positional = rest.filter((a: string) => !a.startsWith('--'));
      const flags = rest.filter((a: string) => a.startsWith('--'));
      const [repoRoot, taskId, envelopeJsonPath] = positional;
      if (!repoRoot || !taskId || !envelopeJsonPath)
        usage('write-feedback requires <repoRoot> <taskId> <envelopeJsonPath>');
      const prefixFlag = flags.find((f: string) => f.startsWith('--prefix='));
      const prefix = prefixFlag ? prefixFlag.split('=')[1] : 'r';
      const envelope = JSON.parse(readFileSync(envelopeJsonPath, 'utf-8')) as FeedbackEnvelope;
      const match = taskId.match(/^(.+)-\d+$/);
      if (!match) die(`Invalid taskId format: ${taskId}`);
      const project = match[1];
      const writtenPath = writeFeedback(repoRoot, { project, taskId, envelope, prefix });
      process.stdout.write(writtenPath + '\n');
      break;
    }

    case 'latest-feedback': {
      const [repoRoot, taskId] = rest;
      if (!repoRoot || !taskId) usage('latest-feedback requires <repoRoot> <taskId>');
      const envelope = latestFeedback(repoRoot, taskId);
      if (envelope === null) {
        process.stdout.write('');
      } else {
        process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
      }
      break;
    }

    case 'emit-gate-decision': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, workItemId, gate, decision, actorArg] = positional;
      if (!repoRoot || !workItemId || !gate || !decision || !actorArg)
        usage(
          'emit-gate-decision requires <repoRoot> <workItemId> <gate> <decision> <actor> [--comment=<str>]'
        );
      const validDecisions = ['approve', 'reject', 'revise', 'split', 'abandon', 'escalate'];
      if (!validDecisions.includes(decision)) {
        die(`decision must be one of: ${validDecisions.join(', ')}, got: ${decision}`);
      }
      if (actorArg !== 'agent' && actorArg !== 'human' && actorArg !== 'system') {
        die(`actor must be "agent", "human", or "system", got: ${actorArg}`);
      }
      const commentFlag = flags.find((f) => f.startsWith('--comment='));
      const comment = commentFlag ? commentFlag.replace('--comment=', '') : undefined;

      // Derive project from workItemId (e.g. "DEMO-001" → "DEMO")
      const wiMatch = workItemId.match(/^(.+)-\d+$/);
      if (!wiMatch) die(`Cannot derive project from workItemId: ${workItemId}`);
      const project = wiMatch[1];

      const writtenPath = emitGateDecision(repoRoot, {
        project,
        workItemType: 'task',
        workItemId,
        gate,
        decision: decision as 'approve' | 'reject' | 'revise' | 'split' | 'abandon' | 'escalate',
        actor: actorArg as 'agent' | 'human' | 'system',
        reasoning: comment,
      });
      process.stdout.write(writtenPath + '\n');
      break;
    }

    case 'detect-ui-paths': {
      const [repoRoot, taskId] = rest;
      if (!repoRoot || !taskId) {
        console.error('usage: detect-ui-paths <repo_root> <task-id>');
        process.exit(1);
      }
      const branch = `cloverleaf/${taskId}`;
      let changed: string[];
      try {
        const out = execSync(`git diff --name-only main..${branch}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
      } catch (e: unknown) {
        const err = e as { stderr?: Buffer | string; message?: string };
        const stderrStr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '';
        console.error(`branch ${branch} not found: ${stderrStr || err.message || 'unknown'}`);
        process.exit(2);
      }
      const { patterns } = loadUiPathsConfig(repoRoot);
      const result = matchesUiPaths(changed, patterns);
      process.stdout.write(`${result}\n`);
      process.exit(0);
    }

    case 'affected-routes': {
      const [repoRoot, taskId] = rest;
      if (!repoRoot || !taskId) {
        console.error('usage: affected-routes <repo_root> <task-id>');
        process.exit(1);
      }
      const branch = `cloverleaf/${taskId}`;
      let changed: string[];
      try {
        const out = execSync(`git diff --name-only main..${branch}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
      } catch (e: unknown) {
        const err = e as { stderr?: Buffer | string; message?: string };
        const stderrStr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '';
        console.error(`branch ${branch} not found: ${stderrStr || err.message || 'unknown'}`);
        process.exit(2);
      }
      const config = loadAffectedRoutesConfig(repoRoot);
      const result = computeAffectedRoutes(changed, config);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(0);
    }

    case 'ui-review-config': {
      const flags = rest.filter((a) => a.startsWith('--'));
      const repoRootFlag = flags.find((f) => f.startsWith('--repo-root=') || f === '--repo-root');
      let repoRoot: string | undefined;
      if (repoRootFlag === '--repo-root') {
        repoRoot = rest[rest.indexOf('--repo-root') + 1];
      } else if (repoRootFlag) {
        repoRoot = repoRootFlag.replace('--repo-root=', '');
      } else {
        repoRoot = rest.filter((a) => !a.startsWith('--'))[0];
      }
      if (!repoRoot) {
        console.error('usage: ui-review-config --repo-root <repoRoot>');
        process.exit(1);
      }
      const config = loadUiReviewConfig(repoRoot);
      process.stdout.write(JSON.stringify(config, null, 2));
      process.exit(0);
    }

    case 'read-ui-review-state': {
      const [repoRoot, taskId] = rest;
      if (!repoRoot || !taskId) usage('read-ui-review-state requires <repoRoot> <taskId>');
      const state = readUiReviewState(repoRoot, taskId);
      process.stdout.write(JSON.stringify(state, null, 2) + '\n');
      break;
    }

    case 'write-ui-review-state': {
      const [repoRoot, taskId, pendingArg] = rest;
      if (!repoRoot || !taskId || pendingArg === undefined)
        usage('write-ui-review-state requires <repoRoot> <taskId> <baselines_pending>');
      const baselines_pending = pendingArg === 'true' || pendingArg === '1';
      writeUiReviewState(repoRoot, taskId, { baselines_pending });
      break;
    }

    case 'write-baseline': {
      const [repoRoot, taskId, browser, slug, viewport, sourceFile] = rest;
      if (!repoRoot || !taskId || !browser || !slug || !viewport || !sourceFile)
        usage(
          'write-baseline requires <repoRoot> <taskId> <browser> <slug> <viewport> <sourceFile>'
        );
      // Guard: refuse writes under .cloverleaf/baselines/ when baselines_pending is true.
      // This prevents the UI Reviewer from bypassing the human baseline-approval gate.
      const uiState = readUiReviewState(repoRoot, taskId);
      if (uiState.baselines_pending) {
        die(
          `write-baseline refused: baselines_pending is true for task ${taskId}.\n` +
            `A human must approve the pending baselines via the baseline-approval gate before new baselines can be written.\n` +
            `Run: cloverleaf-cli write-ui-review-state <repoRoot> ${taskId} false` +
            ` after the human approves the baselines.`
        );
      }
      const destPath = buildBaselinePath(repoRoot, browser, slug, viewport);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(sourceFile, destPath);
      process.stdout.write(destPath + '\n');
      break;
    }

    case 'plugin-root': {
      process.stdout.write(getPluginRoot());
      process.exit(0);
    }

    case 'load-rfc': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, id] = positional;
      if (!repoRoot || !id) usage('load-rfc <repoRoot> <id>');
      const pretty = flags.includes('--pretty');
      const doc = loadRfc(repoRoot, id);
      process.stdout.write((pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc)) + '\n');
      break;
    }

    case 'save-rfc': {
      const [repoRoot, filePath] = rest;
      if (!repoRoot || !filePath) usage('save-rfc <repoRoot> <filePath>');
      const rfc = JSON.parse(readFileSync(filePath, 'utf-8')) as RfcDoc;
      saveRfc(repoRoot, rfc);
      break;
    }

    case 'advance-rfc': {
      const [repoRoot, id, toStatus, actor, gate] = rest;
      if (!repoRoot || !id || !toStatus || !actor) usage('advance-rfc <repoRoot> <id> <toStatus> <agent|human> [gate]');
      if (actor !== 'agent' && actor !== 'human') usage('advance-rfc: actor must be agent or human');
      const opts = gate ? { gate } : {};
      advanceRfcStatus(repoRoot, id, toStatus, actor as 'agent' | 'human', opts);
      break;
    }

    case 'rfc-tasks': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, rfcId] = positional;
      if (!repoRoot || !rfcId) usage('rfc-tasks <repoRoot> <rfcId> [--pretty]');
      const pretty = flags.includes('--pretty');
      let view: RfcTasksView;
      try {
        view = computeRfcTasksView(repoRoot, rfcId);
      } catch (err) {
        process.stderr.write(`cloverleaf-cli rfc-tasks: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(2);
      }
      process.stdout.write(pretty ? JSON.stringify(view, null, 2) : JSON.stringify(view));
      process.stdout.write('\n');
      break;
    }

    case 'load-spike': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, id] = positional;
      if (!repoRoot || !id) usage('load-spike <repoRoot> <id>');
      const pretty = flags.includes('--pretty');
      const doc = loadSpike(repoRoot, id);
      process.stdout.write((pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc)) + '\n');
      break;
    }

    case 'save-spike': {
      const [repoRoot, filePath] = rest;
      if (!repoRoot || !filePath) usage('save-spike <repoRoot> <filePath>');
      const spike = JSON.parse(readFileSync(filePath, 'utf-8')) as SpikeDoc;
      saveSpike(repoRoot, spike);
      break;
    }

    case 'advance-spike': {
      const [repoRoot, id, toStatus, actor] = rest;
      if (!repoRoot || !id || !toStatus || !actor) usage('advance-spike <repoRoot> <id> <toStatus> <agent|human>');
      if (actor !== 'agent' && actor !== 'human') usage('advance-spike: actor must be agent or human');
      advanceSpikeStatus(repoRoot, id, toStatus, actor as 'agent' | 'human');
      break;
    }

    case 'load-plan': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, id] = positional;
      if (!repoRoot || !id) usage('load-plan <repoRoot> <id>');
      const pretty = flags.includes('--pretty');
      const doc = loadPlan(repoRoot, id);
      process.stdout.write((pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc)) + '\n');
      break;
    }

    case 'save-plan': {
      const [repoRoot, filePath] = rest;
      if (!repoRoot || !filePath) usage('save-plan <repoRoot> <filePath>');
      const plan = JSON.parse(readFileSync(filePath, 'utf-8')) as PlanDoc;
      savePlan(repoRoot, plan);
      break;
    }

    case 'advance-plan': {
      const [repoRoot, id, toStatus, actor, gate] = rest;
      if (!repoRoot || !id || !toStatus || !actor) usage('advance-plan <repoRoot> <id> <toStatus> <agent|human> [gate]');
      if (actor !== 'agent' && actor !== 'human') usage('advance-plan: actor must be agent or human');
      const opts = gate ? { gate } : {};
      advancePlanStatus(repoRoot, id, toStatus, actor as 'agent' | 'human', opts);
      break;
    }

    case 'materialise-tasks': {
      const [repoRoot, planId] = rest;
      if (!repoRoot || !planId) usage('materialise-tasks <repoRoot> <planId>');
      const plan = loadPlan(repoRoot, planId);
      const ids = materialiseTasksFromPlan(repoRoot, plan);
      process.stdout.write(JSON.stringify({ task_ids: ids }));
      break;
    }

    case 'next-work-item-id': {
      const [repoRoot, project] = rest;
      if (!repoRoot || !project) usage('next-work-item-id <repoRoot> <project>');
      process.stdout.write(nextWorkItemId(repoRoot, project));
      break;
    }

    case 'discovery-config': {
      const idx = rest.indexOf('--repo-root');
      if (idx < 0 || !rest[idx + 1]) usage('discovery-config --repo-root <repoRoot>');
      const c = loadDiscoveryConfig(rest[idx + 1]);
      process.stdout.write(JSON.stringify(c, null, 2));
      break;
    }

    case 'prep-worktree': {
      const [mainRoot, worktreePath] = rest;
      if (!mainRoot || !worktreePath) usage('prep-worktree requires <mainRoot> <worktreePath>');
      prepWorktree(mainRoot, worktreePath);
      break;
    }

    case 'qa-report': {
      const [runsJsonPath, outHtmlPath] = rest;
      if (!runsJsonPath || !outHtmlPath) usage('qa-report requires <runs.json> <out.html>');
      writeQaReportFromFile(runsJsonPath, outHtmlPath);
      break;
    }

    case 'dag-ready-tasks': {
      const [repoRoot, planId, maxConcurrentStr] = rest;
      if (!repoRoot || !planId || !maxConcurrentStr)
        usage('dag-ready-tasks requires <repoRoot> <planId> <maxConcurrent>');
      const maxConcurrent = parseInt(maxConcurrentStr, 10);
      if (Number.isNaN(maxConcurrent) || maxConcurrent < 1)
        die(`maxConcurrent must be a positive integer, got ${maxConcurrentStr}`);
      const plan = loadPlan(repoRoot, planId);
      const state = readWalkState(repoRoot, planId) ?? {
        plan_id: planId,
        started: new Date().toISOString(),
        max_concurrent: maxConcurrent,
        tasks: {},
      };
      const ready = computeReadyTasks(plan, state, maxConcurrent);
      if (ready.length > 0) process.stdout.write(ready.join('\n') + '\n');
      break;
    }

    case 'dag-detect-cycle': {
      const [repoRoot, planId] = rest;
      if (!repoRoot || !planId) usage('dag-detect-cycle requires <repoRoot> <planId>');
      const plan = loadPlan(repoRoot, planId);
      const cycle = detectCycle(plan);
      if (cycle) {
        process.stdout.write(cycle.cycle.join(' → ') + '\n');
        process.exit(1);
      }
      break;
    }

    case 'walk-state-read': {
      const [repoRoot, planId] = rest;
      if (!repoRoot || !planId) usage('walk-state-read requires <repoRoot> <planId>');
      const state = readWalkState(repoRoot, planId);
      if (state === null) {
        die(`walk-state not found for plan ${planId} at ${walkStatePath(repoRoot, planId)}`, 2);
      }
      process.stdout.write(JSON.stringify(state, null, 2) + '\n');
      break;
    }

    case 'walk-state-write': {
      const [repoRoot, walkStateJsonPath] = rest;
      if (!repoRoot || !walkStateJsonPath)
        usage('walk-state-write requires <repoRoot> <walkStateJsonPath>');
      const raw = readFileSync(walkStateJsonPath, 'utf-8');
      const state = JSON.parse(raw);
      if (!state.plan_id || typeof state.plan_id !== 'string')
        die('walk-state JSON must include plan_id (string)');
      writeWalkState(repoRoot, state);
      break;
    }

    case 'walker-default-concurrency': {
      const explain = rest.includes('--explain');
      let cfg: { maxConcurrent: number; source: 'user' | 'default'; path: string };
      try {
        cfg = loadWalkerConfig();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(msg + '\n');
        process.exit(1);
      }
      if (explain) {
        const location =
          cfg.source === 'user' ? `from ${cfg.path}` : 'default';
        process.stdout.write(`max_concurrent=${cfg.maxConcurrent} (${location})\n`);
      } else {
        process.stdout.write(`${cfg.maxConcurrent}\n`);
      }
      process.exit(0);
    }

    case 'check-scope': {
      // check-scope <repoRoot> <taskId> --branch <branchName>
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, taskId] = positional;
      if (!repoRoot || !taskId) usage('check-scope requires <repoRoot> <taskId> --branch <branchName>');

      const branchFlag = flags.find((f) => f === '--branch');
      const branchIdx = rest.indexOf('--branch');
      const branchName = branchFlag !== undefined && branchIdx >= 0 ? rest[branchIdx + 1] : undefined;
      if (!branchName) {
        process.stderr.write('check-scope: missing --branch <branchName>\n');
        process.exit(2);
      }

      // 1. Read task doc from feature branch via git show
      let taskDoc: ReturnType<typeof loadTask>;
      try {
        const taskPath = `.cloverleaf/tasks/${taskId}.json`;
        const raw = execSync(`git show ${branchName}:${taskPath}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        taskDoc = JSON.parse(raw) as ReturnType<typeof loadTask>;
      } catch {
        try {
          // Fall back to checking if the branch exists at all
          execSync(`git rev-parse --verify ${branchName}`, {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          // Branch exists but no task doc
          process.stderr.write(`check-scope: task doc not found for ${taskId} on branch ${branchName}\n`);
        } catch {
          process.stderr.write(`check-scope: branch ${branchName} not found\n`);
        }
        process.exit(1);
      }

      // 2. Read sibling scopes from main
      const siblingScopes: SiblingScope[] = [];
      try {
        // List all task files visible on main
        const lsOut = execSync(`git ls-tree -r --name-only main -- .cloverleaf/tasks/`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const taskFiles = lsOut.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const f of taskFiles) {
          const tid = f.replace(/^\.cloverleaf\/tasks\//, '').replace(/\.json$/, '');
          if (tid === taskId) continue; // skip self
          try {
            const raw = execSync(`git show main:${f}`, {
              cwd: repoRoot,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            const sibling = JSON.parse(raw) as Record<string, unknown>;
            // Skip siblings that are already merged — they no longer contest scope
            if (sibling['status'] === 'merged') continue;
            const scope = sibling['scope'] as Record<string, unknown> | undefined;
            const files = Array.isArray(scope?.['files_touched'])
              ? (scope!['files_touched'] as unknown[]).filter((x): x is string => typeof x === 'string')
              : [];
            if (files.length > 0) {
              siblingScopes.push({ taskId: tid, files });
            }
          } catch {
            // Skip task files that can't be read
          }
        }
      } catch {
        // main may not exist yet; treat as no siblings
      }

      // 3. Get modified files via git diff main..<branch>
      let modifiedFiles: string[] = [];
      try {
        const diffOut = execSync(`git diff --name-only main..${branchName}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        modifiedFiles = diffOut.split('\n').map((l) => l.trim()).filter(Boolean);
      } catch {
        // No diff is fine (empty branch)
      }

      // 4. Compute sharedFiles via git check-attr (merge=union honors user's multi-writer intent)
      let sharedFiles = new Set<string>();
      if (modifiedFiles.length > 0) {
        try {
          const out = execFileSync(
            'git',
            ['-C', repoRoot, 'check-attr', '-z', 'merge', '--', ...modifiedFiles],
            { encoding: 'utf-8' },
          );
          // -z output: NUL-separated triplets: path\0attr\0value\0
          const parts = out.split('\0');
          for (let i = 0; i + 2 < parts.length; i += 3) {
            const path = parts[i];
            const attr = parts[i + 1];
            const value = parts[i + 2];
            if (attr === 'merge' && value === 'union') {
              sharedFiles.add(normalizePath(path));
            }
          }
        } catch (err) {
          process.stderr.write(
            `cloverleaf-cli check-scope: git check-attr failed (${err instanceof Error ? err.message : String(err)}); proceeding with no shared-file annotations.\n`,
          );
          sharedFiles = new Set();
        }
      }

      // 5. Classify and output
      const result = classifyFiles(taskDoc, modifiedFiles, siblingScopes, sharedFiles);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    }

    case 'extend-scope': {
      // extend-scope <repoRoot> <taskId> --add <file>... --reason <text>
      const positional = rest.filter((a) => !a.startsWith('--'));
      const [repoRoot, taskId] = positional;
      if (!repoRoot || !taskId) usage('extend-scope requires <repoRoot> <taskId> --add <file>... --reason <text>');

      // Parse --reason (takes everything after --reason up to another flag)
      const reasonIdx = rest.indexOf('--reason');
      if (reasonIdx < 0 || !rest[reasonIdx + 1]) {
        process.stderr.write('extend-scope: missing --reason <text>\n');
        process.exit(2);
      }
      // Collect reason: everything after --reason that doesn't start with --
      const reasonParts: string[] = [];
      for (let i = reasonIdx + 1; i < rest.length; i++) {
        if (rest[i].startsWith('--')) break;
        reasonParts.push(rest[i]);
      }
      const reason = reasonParts.join(' ');
      if (!reason) {
        process.stderr.write('extend-scope: --reason requires a non-empty value\n');
        process.exit(2);
      }

      // Parse --add <file>... (all values after --add that don't start with --)
      const addIdx = rest.indexOf('--add');
      if (addIdx < 0) {
        process.stderr.write('extend-scope: missing --add <file>...\n');
        process.exit(2);
      }
      const addFiles: string[] = [];
      for (let i = addIdx + 1; i < rest.length; i++) {
        if (rest[i].startsWith('--')) break;
        addFiles.push(rest[i]);
      }
      if (addFiles.length === 0) {
        process.stderr.write('extend-scope: --add requires at least one file\n');
        process.exit(2);
      }

      // Load task doc
      const task = loadTask(repoRoot, taskId);

      // Get current scope.files_touched
      const scope = (task['scope'] ?? {}) as Record<string, unknown>;
      const currentFiles = Array.isArray(scope['files_touched'])
        ? (scope['files_touched'] as unknown[]).filter((f): f is string => typeof f === 'string')
        : [];

      // Set-union and sort/dedup
      const merged = Array.from(new Set([...currentFiles, ...addFiles])).sort();

      // Check if idempotent (no change needed)
      const newlyAdded = addFiles.filter((f) => !currentFiles.includes(f));

      // Always update and save (even if idempotent, shape is canonical)
      const updatedTask = {
        ...task,
        scope: { ...scope, files_touched: merged },
      };
      saveTask(repoRoot, updatedTask);

      // Append audit entry
      // Find plan ID from task.parent or task.context
      const parent = task['parent'] as { project?: string; id?: string } | undefined;
      const planId = parent?.id ?? taskId; // fallback to taskId if no parent

      const auditDir = join(repoRoot, '.cloverleaf', 'runs', 'plan', planId);
      mkdirSync(auditDir, { recursive: true });
      const auditPath = join(auditDir, 'audit.jsonl');

      const auditEntry = {
        ts: new Date().toISOString(),
        kind: 'extend-scope',
        task_id: taskId,
        files: newlyAdded,
        reason,
      };
      appendFileSync(auditPath, JSON.stringify(auditEntry) + '\n');

      process.exit(0);
    }

    case 'secret-scan': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const branchIdx = rest.indexOf('--branch');
      const branch = branchIdx >= 0 ? rest[branchIdx + 1] : undefined;
      const [repoRoot] = positional;
      if (!repoRoot || !branch) usage('secret-scan <repoRoot> --branch <branch>');
      const cfg = loadSecretPatternsConfig(repoRoot);
      // Scan added/changed lines only (the '+' lines of the diff, minus the +++ header),
      // so we flag what THIS task introduced, not pre-existing secrets.
      const diff = execSync(`git -C ${repoRoot} diff --unified=0 main..${branch}`, { encoding: 'utf-8' });
      const addedByFile: Record<string, string[]> = {};
      let curFile = '';
      for (const line of diff.split('\n')) {
        if (line.startsWith('+++ b/')) { curFile = line.slice(6); addedByFile[curFile] = []; }
        else if (line.startsWith('+') && !line.startsWith('+++')) { (addedByFile[curFile] ||= []).push(line.slice(1)); }
      }
      const findings = Object.entries(addedByFile).flatMap(([f, lines]) => scanSecrets(lines.join('\n'), cfg, f));
      process.stdout.write(JSON.stringify({ findings }) + '\n');
      break;
    }

    case 'classify-security': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const branchIdx = rest.indexOf('--branch');
      const branch = branchIdx >= 0 ? rest[branchIdx + 1] : undefined;
      const [repoRoot, taskId] = positional;
      if (!repoRoot || !taskId) usage('classify-security <repoRoot> <taskId> [--branch <branch>]');
      let result;
      try {
        result = classifyTaskSecurity(repoRoot, taskId, branch ? { branch } : undefined);
      } catch (err) {
        process.stderr.write(`cloverleaf-cli classify-security: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(2);
      }
      process.stdout.write(JSON.stringify(result) + '\n');
      break;
    }

    case 'council-plan': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [repoRoot, taskId, gateKey] = positional;
      if (!repoRoot || !taskId) usage('council-plan requires <repoRoot> <taskId> [gateKey]');
      const cf = flags.find((f) => f.startsWith('--changed-files='));
      const changedFiles = cf !== undefined
        ? cf.replace('--changed-files=', '').split(',').filter(Boolean)
        : undefined;
      const plan = resolveCouncilPlan(
        repoRoot, taskId, gateKey || 'task.review',
        changedFiles !== undefined ? { changedFiles } : {},
      );
      process.stdout.write(JSON.stringify(plan) + '\n');
      break;
    }

    case 'aggregate-verdicts': {
      const positional = rest.filter((a) => !a.startsWith('--'));
      const flags = rest.filter((a) => a.startsWith('--'));
      const [membersJson, ruleArg] = positional;
      if (!membersJson || !ruleArg) usage('aggregate-verdicts requires <membersJson> <rule>');
      const members = JSON.parse(membersJson) as MemberVerdict[];
      let rule: ThresholdRule;
      if (ruleArg.startsWith('quorum:')) {
        const quorumN = parseInt(ruleArg.split(':')[1], 10);
        if (Number.isNaN(quorumN) || quorumN < 1) {
          usage(`aggregate-verdicts: quorum value must be a positive integer, got '${ruleArg}'`);
        }
        rule = { quorum: quorumN };
      } else {
        rule = ruleArg as ThresholdRule;
      }
      const wt = flags.find((f) => f.startsWith('--weighted-threshold='));
      const opts = wt ? { weightedThreshold: parseFloat(wt.replace('--weighted-threshold=', '')) } : {};
      process.stdout.write(JSON.stringify(aggregate(members, rule, opts)) + '\n');
      break;
    }

    case 'apply-council-verdict': {
      const [repoRoot, taskId, gate, verdictJson] = rest;
      if (!repoRoot || !taskId || !gate || !verdictJson)
        usage('apply-council-verdict requires <repoRoot> <taskId> <gate> <councilVerdictJson>');
      const council = JSON.parse(verdictJson) as CouncilVerdict;
      const result = applyCouncilVerdict(repoRoot, taskId, gate, council);
      process.stdout.write(JSON.stringify(result) + '\n');
      break;
    }

    case 'chair-context': {
      const [inputsJson] = rest;
      if (!inputsJson) usage('chair-context requires <chairMemberInputsJson>');
      const inputs = JSON.parse(inputsJson) as ChairMemberInput[];
      process.stdout.write(buildChairContext(inputs) + '\n');
      break;
    }

    case 'chair-verdict': {
      const [rawJson, membersJson] = rest;
      if (!rawJson || !membersJson) usage('chair-verdict requires <chairRawJson> <membersJson>');
      const raw = JSON.parse(rawJson) as ChairRawVerdict;
      const members = JSON.parse(membersJson) as MemberVerdict[];
      process.stdout.write(JSON.stringify(finalizeChairVerdict(raw, members)) + '\n');
      break;
    }

    case 'set-task-field': {
      const [repoRoot, taskId, field, value] = rest;
      if (!repoRoot || !taskId || !field || value === undefined)
        usage('set-task-field requires <repoRoot> <taskId> <field> <value>');
      const ALLOWED_FIELDS = new Set(['security_review_verdict']);
      if (!ALLOWED_FIELDS.has(field)) {
        die(
          `set-task-field: unknown field '${field}'. Allowed fields: ${Array.from(ALLOWED_FIELDS).join(', ')}`
        );
      }
      const task = loadTask(repoRoot, taskId);
      const parsed: unknown = value === 'null' ? null : value;
      (task as Record<string, unknown>)[field] = parsed;
      saveTask(repoRoot, task);
      break;
    }

    case 'validate-council': {
      const [repoRoot] = rest;
      if (!repoRoot) usage('validate-council requires <repoRoot>');
      const { config } = loadCouncilConfigWithSource(repoRoot);
      const gd = Object.fromEntries(
        Object.entries(GATE_DESCRIPTORS).map(([k, d]) => [k, { kind: d.kind ?? 'code' }]),
      );
      const result = validateCouncilConfig(config as never, gd);
      if (result.ok) {
        process.stdout.write('council config OK\n');
      } else {
        for (const v of result.violations) process.stderr.write(`${v.rule}: ${v.message}\n`);
        process.exit(1);
      }
      break;
    }

    default:
      usage(`Unknown command: ${command}`);
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  // SECURITY_GATE errors: write the bare validator message to stderr and exit 2
  if ((err as { code?: string }).code === 'SECURITY_GATE') {
    process.stderr.write(msg + '\n');
    process.exit(2);
  }
  // Surface "illegal transition" errors with the right language
  const lower = msg.toLowerCase();
  if (lower.includes('illegal') || lower.includes('not allowed')) {
    die(`Illegal transition: ${msg}`);
  }
  die(`Error: ${msg}`);
}
