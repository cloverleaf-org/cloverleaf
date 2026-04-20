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
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadTask } from './state.js';
import { advanceStatus } from './state.js';
import { emitGateDecision } from './events.js';
import { writeFeedback, latestFeedback } from './feedback.js';
import { nextTaskId, inferProject } from './ids.js';
import { matchesUiPaths, loadDefaultPatterns } from './ui-paths.js';
import type { FeedbackEnvelope } from './feedback.js';

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
      '  emit-gate-decision <repoRoot> <workItemId> <gate> <decision> <actor> [--comment=<str>]\n'
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
      const patterns = loadDefaultPatterns();
      const result = matchesUiPaths(changed, patterns);
      process.stdout.write(`${result}\n`);
      process.exit(0);
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
