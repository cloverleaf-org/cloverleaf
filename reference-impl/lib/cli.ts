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
 *   advance-status <repoRoot> <taskId> <toStatus> <actor> [gate] [path]
 *   write-feedback <repoRoot> <taskId> <envelopeJsonPath>
 *   latest-feedback <repoRoot> <taskId>
 *   emit-gate-decision <repoRoot> <workItemId> <gate> <decision> <actor> [--comment=<str>]
 *   ui-review-config --repo-root <repoRoot>
 *   read-ui-review-state <repoRoot> <taskId>
 *   write-ui-review-state <repoRoot> <taskId> <baselines_pending>
 *   plugin-root
 *   load-rfc <repoRoot> <id>
 *   save-rfc <repoRoot> <filePath>
 *   advance-rfc <repoRoot> <id> <toStatus> <agent|human> [gate]
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
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadTask } from './task.js';
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
import { readUiReviewState, writeUiReviewState } from './ui-review-state.js';

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
      '  advance-status <repoRoot> <taskId> <toStatus> <actor> [gate] [path]\n' +
      '  write-feedback <repoRoot> <taskId> <envelopeJsonPath>\n' +
      '  latest-feedback <repoRoot> <taskId>\n' +
      '  emit-gate-decision <repoRoot> <workItemId> <gate> <decision> <actor> [--comment=<str>]\n' +
      '  ui-review-config --repo-root <repoRoot>\n' +
      '  read-ui-review-state <repoRoot> <taskId>\n' +
      '  write-ui-review-state <repoRoot> <taskId> <baselines_pending>\n' +
      '  plugin-root\n' +
      '  load-rfc <repoRoot> <id>\n' +
      '  save-rfc <repoRoot> <filePath>\n' +
      '  advance-rfc <repoRoot> <id> <toStatus> <agent|human> [gate]\n' +
      '  load-spike <repoRoot> <id>\n' +
      '  save-spike <repoRoot> <filePath>\n' +
      '  advance-spike <repoRoot> <id> <toStatus> <agent|human>\n' +
      '  load-plan <repoRoot> <id>\n' +
      '  save-plan <repoRoot> <filePath>\n' +
      '  advance-plan <repoRoot> <id> <toStatus> <agent|human> [gate]\n' +
      '  materialise-tasks <repoRoot> <planId>\n' +
      '  next-work-item-id <repoRoot> <project>\n' +
      '  discovery-config --repo-root <repoRoot>\n' +
      '  prep-worktree <mainRoot> <worktreePath>\n'
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
      const [repoRoot, taskId] = rest;
      if (!repoRoot || !taskId) usage('load-task requires <repoRoot> <taskId>');
      const task = loadTask(repoRoot, taskId);
      process.stdout.write(JSON.stringify(task, null, 2) + '\n');
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
      const [repoRoot, taskId, toStatus, actorArg, gate, path] = rest;
      if (!repoRoot || !taskId || !toStatus || !actorArg)
        usage('advance-status requires <repoRoot> <taskId> <toStatus> <actor> [gate] [path]');
      if (actorArg !== 'agent' && actorArg !== 'human') {
        die(`actor must be 'agent' or 'human' (got '${actorArg}')`, 2);
      }
      const actor: 'agent' | 'human' = actorArg;
      const opts: { gate?: string; path?: 'fast_lane' | 'full_pipeline' } = {};
      if (gate) opts.gate = gate;
      if (path === 'fast_lane' || path === 'full_pipeline') opts.path = path;
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

    case 'plugin-root': {
      process.stdout.write(getPluginRoot());
      process.exit(0);
    }

    case 'load-rfc': {
      const [repoRoot, id] = rest;
      if (!repoRoot || !id) usage('load-rfc <repoRoot> <id>');
      process.stdout.write(JSON.stringify(loadRfc(repoRoot, id), null, 2));
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

    case 'load-spike': {
      const [repoRoot, id] = rest;
      if (!repoRoot || !id) usage('load-spike <repoRoot> <id>');
      process.stdout.write(JSON.stringify(loadSpike(repoRoot, id), null, 2));
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
      const [repoRoot, id] = rest;
      if (!repoRoot || !id) usage('load-plan <repoRoot> <id>');
      process.stdout.write(JSON.stringify(loadPlan(repoRoot, id), null, 2));
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

    default:
      usage(`Unknown command: ${command}`);
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  // Surface "illegal transition" errors with the right language
  const lower = msg.toLowerCase();
  if (lower.includes('illegal') || lower.includes('not allowed')) {
    die(`Illegal transition: ${msg}`);
  }
  die(`Error: ${msg}`);
}
