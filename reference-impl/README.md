# @cloverleaf/reference-impl

Reference implementation of the Cloverleaf methodology as a set of Claude Code skills. This package implements the **Tight Loop** — Implementer + Reviewer — letting a user drive a Task from `pending` to `merged` with state, events, and feedback recorded in the repo under `.cloverleaf/`.

Implements [Cloverleaf Standard](../standard/) v0.3.0 at L2 (Exchange) conformance.

## Install

From this directory:

```bash
npm install            # pulls @cloverleaf/standard + deps
./install.sh           # symlinks skills into ~/.claude/plugins/cloverleaf/
# or:
./install.sh --project # local install into ./.claude/plugins/cloverleaf/
```

## Skills provided

| Slash command | Role |
|---|---|
| `/cloverleaf-new-task "<brief>"` | Scaffold a new Task JSON from a prose brief. |
| `/cloverleaf-implement <TASK-ID>` | Dispatch Implementer subagent; advances pending → review. |
| `/cloverleaf-review <TASK-ID>` | Dispatch Reviewer subagent; pass → automated-gates, bounce → implementing. |
| `/cloverleaf-merge <TASK-ID>` | Human gate; confirm and transition automated-gates → merged. |
| `/cloverleaf-run <TASK-ID>` | Orchestrator: loops implement → review with up to 3 bounces, pauses at the human merge gate. |

## Quick start — toy repo

```bash
cd examples/toy-repo
npm install
../../install.sh --project
```

In a Claude Code session in that directory:

```
/cloverleaf-run DEMO-001
```

Watch it walk the state machine, produce a branch `cloverleaf/DEMO-001` with a `multiply` function + tests, and pause at the merge gate.

## What's in v0.1.0

- Implementer + Reviewer agents (wired as subagents).
- Full state machine transitions from `pending` to `merged` (fast-lane path), with stub transitions through `documenting` and `automated-gates`.
- Per-project committed audit trail under `.cloverleaf/`.
- Max 3 bounces before `escalated`.

## What's NOT in v0.1.0

- Researcher, Plan, Documenter, UI Reviewer, QA agents (stub transitions only).
- HTTP endpoints for the agent OpenAPI contracts — skills are markdown-driven, not servers. L3 conformance deferred.
- `git push` / PR creation — branch stays local; user handles remote.
- Path-rules or risk-classifier-rules enforcement — fast-lane is hardcoded.

See [upcoming releases](../CHANGELOG.md) for the roadmap.

## Branch topology

State commits (`.cloverleaf/**`) always land on `main`. Code commits land on a per-task feature branch named `cloverleaf/<task-id>`.

- `main`: canonical audit trail. Every status-transition event, gate decision, and feedback envelope is committed here, in order.
- `cloverleaf/<task-id>`: code for one task. Branched from main; the Implementer agent lives here.

The skills handle the branch switching for you. After `/cloverleaf-implement <TASK-ID>` runs, you are back on main with the state updates committed; the `cloverleaf/<task-id>` branch holds the code ready for review. After `/cloverleaf-merge`, the audit trail reflects the merged state, and you push the code branch manually.

The Reviewer never switches branches. It reads files via `git show` and runs tests in a `git worktree add` sidecar to avoid clobbering main's `.cloverleaf/`.

## Package layout

- `lib/` — TypeScript library used by the CLI. State, events, feedback, IDs, paths.
- `skills/` — Claude Code skill markdown files.
- `prompts/` — Implementer/Reviewer subagent system prompts.
- `examples/toy-repo/` — standalone demo repo.
- `tests/` — Vitest suite.

## Development

```bash
npm test        # run the Vitest suite
npm run test:watch
```

## License

MIT — see [../LICENSE](../LICENSE).
