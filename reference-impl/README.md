# @cloverleaf/reference-impl

Reference implementation of the Cloverleaf methodology as a set of Claude Code skills. Lets a user drive a Task from `pending` to `merged` with state, events, and feedback recorded in the repo under `.cloverleaf/`.

Implements [Cloverleaf Standard](../standard/) v0.8.0 at L2 (Exchange) conformance.

## Install

From this directory:

```bash
npm install            # pulls @cloverleaf/standard + deps
./install.sh           # symlinks skills into ~/.claude/plugins/cloverleaf/
# or:
./install.sh --project # local install into ./.claude/plugins/cloverleaf/
```

## How delivery works

Every Task walks one path, whatever its risk:

```
pending → tactical-plan → implementing → documenting → council → final-gate → merged
```

`council` is a single parameterized phase. Which reviewers sit on it is configuration, not control flow: `config/council.json` defines the profiles, and the Task's `risk_class` selects one.

| `risk_class` | Profile | Round 1 | Round 2 |
|---|---|---|---|
| `low` | `delivery-fast` | Reviewer | Security, if `security_class` is `high` |
| `high` | `delivery-full` | Reviewer | Security (if `security_class` is `high`), UI (if the diff touches UI paths), and QA — dispatched concurrently |

Both shipped profiles aggregate with `any-veto`: one blocking member is enough to stop the round.

The council has three exits:

- **pass** → `final-gate`, where a human gives the single approval that merges the Task.
- **bounce** → `implementing`, carrying every member's feedback in one batch.
- **escalate** → `escalated`. Escalation is un-lowerable: no later member, chair, or aggregation rule can turn it back into a pass.

### Agents

| Agent | Status | Mechanism |
|---|---|---|
| Researcher | Real | Subagent; drafts an RFC body from its brief and runs Spikes against its unknowns |
| Plan | Real | Subagent; decomposes an approved RFC into a Plan with a `task_dag` |
| Implementer | Real | Subagent, code + tests on feature branch |
| Documenter | Real | Subagent, doc-only commits per file-path rules |
| Reviewer | Real | Subagent, read-only review of diff |
| Security Reviewer | Real | Deterministic secret scan + LLM vulnerability judgment |
| UI Reviewer | Real | Playwright + axe-core + pixelmatch; multi-browser outer loop (chromium/webkit/firefox), though `ui-review.json` ships chromium-only; axe-core runs on the `axe.browser` engine only; `maxCombinations` cap with per-route warnings |
| QA | Real | Per-package test runner via `git worktree` |
| Chair | Real | Deliberative judge; dispatched only when a council bounces under `aggregation: "chair"` |

### Skills

**Discovery** — RFC → Spikes → Plan → Tasks:

- `/cloverleaf-new-rfc` — scaffold an RFC work item from a brief file
- `/cloverleaf-draft-rfc` — Researcher populates the RFC body; emits a Spike per unknown
- `/cloverleaf-spike` — run one Spike to findings + recommendation
- `/cloverleaf-breakdown` — Plan agent decomposes the RFC into a Plan with a `task_dag`
- `/cloverleaf-gate` — human decision on an RFC or Plan sitting at its gate
- `/cloverleaf-discover` — end-to-end Discovery orchestrator over all of the above

**Delivery** — one Task from `pending` to `merged`:

- `/cloverleaf-new-task` — scaffold a Task (auto-sets `risk_class`)
- `/cloverleaf-implement` — Implementer; produces the feature branch
- `/cloverleaf-document` — Documenter; doc-only commits
- `/cloverleaf-run` — orchestrator; drives the whole walk, selecting the council profile by `risk_class`
- `/cloverleaf-run-plan` — DAG walker; drives every Task in an approved Plan, several at a time

**Council members, run standalone** — each produces a verdict and drives no state transition, so you can get one member's opinion without running a council:

- `/cloverleaf-review` — Reviewer
- `/cloverleaf-security-review` — Security Reviewer
- `/cloverleaf-ui-review` — UI Reviewer
- `/cloverleaf-qa` — QA

**Human gates:**

- `/cloverleaf-approve-baselines` — approve new or resized visual baselines and clear `baselines_pending`. Clear-only: it drives no transition. Re-run `/cloverleaf-run` afterwards so the held council pass can land.
- `/cloverleaf-merge` — the `final-gate` approval; performs the real `git merge --no-ff` into main

### Configuration

The package ships defaults for eight config files in `config/`. Your repo overrides any of them by placing a file of the same name at `<repoRoot>/.cloverleaf/config/<name>.json`. Consumer override is a **full replacement** — your file becomes the complete source of truth for that config.

| Config file | Purpose |
|---|---|
| `council.json` | Council profiles and their per-gate bindings: which reviewers run, in which rounds, under which aggregation rule |
| `qa-rules.json` | Per-package test commands for the QA member |
| `ui-paths.json` | Glob patterns marking a diff as UI-touching (default: `site/**`). Feeds the `ui_changes` predicate that admits the UI member to a council round |
| `affected-routes.json` | Rules for mapping a diff to the site routes the UI member visits; includes `contentRoutes` for content-collection mapping |
| `ui-review.json` | UI Reviewer runtime settings — browser engines, viewports, visual-diff thresholds, axe scope, `maxCombinations` |
| `security-paths.json` | Sensitive paths and keywords that infer `security_class: high` |
| `secret-patterns.json` | Secret regexes and placeholder excludes for the deterministic scan |
| `discovery.json` | Discovery-track settings, including `worktree_setup_command` for non-TypeScript consumers |

One further override has no shipped default, because it only makes sense per-repo:

| Override file | Purpose |
|---|---|
| `.cloverleaf/config/astro-base.json` | Explicit Astro `base` path — the UI Reviewer reads it instead of best-effort parsing `astro.config.*` |

All overrides are read fresh on every skill invocation; no caching. Edit and the next `/cloverleaf-run` picks it up.

#### Council profiles

`council.json` decides who reviews your code. A profile is a list of rounds; each round is a list of members dispatched concurrently. A `when` clause gates a member on a predicate, so a round can adapt to the Task in front of it:

```json
{
  "profiles": {
    "delivery-full": {
      "rounds": [
        [ { "member": "reviewer" } ],
        [
          { "member": "security", "when": "security_class:high" },
          { "member": "ui", "when": "ui_changes" },
          { "member": "qa" }
        ]
      ],
      "aggregation": "any-veto",
      "on_round_bounce": "stop"
    }
  },
  "gates": {
    "task.review": { "by": "risk_class", "map": { "low": "delivery-fast", "high": "delivery-full" } }
  }
}
```

A member can also be a custom role: give it a `prompt` naming a file under `<repoRoot>/.cloverleaf/prompts/`, and the council dispatches your reviewer alongside the built-ins. The path is exist-checked when the plan resolves, so a typo fails loudly rather than silently skipping a reviewer.

Example `affected-routes.json` override for a Next.js project:

```json
{
  "pageRoots": ["apps/web/app/"],
  "globalPatterns": ["apps/web/components/**", "apps/web/styles/**"],
  "routeScope": ["apps/web/**"],
  "contentRoutes": {}
}
```

Example `astro-base.json`:

```json
{ "base": "/my-docs" }
```

### Known limitations

- Concurrent `/cloverleaf-run` on the same repo may race on preview ports.
- QA does not produce HTML reports (no `report_uri`).

### Prerequisites for UI Reviewer

The installer (`install.sh`) automatically runs the Playwright browser install step. If you need to install manually, run:

    npx playwright install chromium webkit firefox

On **Linux**, webkit additionally requires system-level dependencies. By default `install.sh` installs webkit deps only:

    npx playwright install-deps webkit

To also install firefox system deps (enabling the full chromium + webkit + firefox browser matrix for the UI Reviewer), pass `--with-cross-browser` to the installer:

    ./install.sh --with-cross-browser

This runs `npx playwright install-deps webkit firefox` instead. When the flag is omitted, `install.sh` prints a note reminding you how to enable cross-browser support later.

**Disk footprint:** approximately 600–650 MB total across all three browsers in the default `PLAYWRIGHT_BROWSERS_PATH` location (`~/.cache/ms-playwright/`).

| Browser   | Approx. size |
|-----------|-------------|
| chromium  | ~300 MB     |
| webkit    | ~150–170 MB |
| firefox   | ~150–180 MB |

To store browsers in a non-default location, set `PLAYWRIGHT_BROWSERS_PATH` before installing and before running the UI Reviewer skill:

    export PLAYWRIGHT_BROWSERS_PATH=/mnt/data/playwright
    npx playwright install chromium webkit firefox

Subsequent `/cloverleaf-ui-review` invocations reuse the cache — no re-download per run as long as `PLAYWRIGHT_BROWSERS_PATH` is set consistently.

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

See [CHANGELOG](../CHANGELOG.md) for the full release history and roadmap.

## Branch topology

State commits (`.cloverleaf/**`) always land on `main`. Code commits land on a per-task feature branch named `cloverleaf/<task-id>`.

- `main`: canonical audit trail. Every status-transition event, gate decision, and feedback envelope is committed here, in order.
- `cloverleaf/<task-id>`: code for one task. Branched from main; the Implementer agent lives here.

The skills handle the branch switching for you. After `/cloverleaf-implement <TASK-ID>` runs, you are back on main with the state updates committed; the `cloverleaf/<task-id>` branch holds the code ready for review. After `/cloverleaf-merge`, the audit trail reflects the merged state, and you push the code branch manually.

The Reviewer never switches branches. It reads files via `git show` and runs tests in a `git worktree add` sidecar to avoid clobbering main's `.cloverleaf/`.

## Package layout

- `lib/` — TypeScript library used by the CLI. State, events, feedback, IDs, paths. Includes `buildBaselinePath(repoRoot, browser, slug, viewport)` (`lib/visual-diff.ts`) for constructing canonical baseline paths under `.cloverleaf/baselines/{browser}/`. `lib/ui-browser.ts` exports `buildBrowserEscalationFinding` and `applyMaxCombinationsCap` (used by the UI Reviewer prompt for per-engine escalation and combination-count capping). `lib/ui-review-state.ts` exports `readUiReviewState`, `writeUiReviewState`, and `uiReviewStatePath` — the baseline-approval sidecar API for `.cloverleaf/runs/{taskId}/ui-review/state.json`. The CLI exposes `write-baseline <repoRoot> <taskId> <browser> <slug> <viewport> <sourceFile>` as the safe write path for baselines; it enforces the `baselines_pending` guard and uses `buildBaselinePath` internally. `lib/walker-config.ts` exports `loadWalkerConfig()` — reads `~/.config/cloverleaf/walker.json` (XDG-aware) for the user-level `max_concurrent` override; exposed via `cloverleaf-cli walker-default-concurrency [--explain]`. `lib/release-preflight.ts` exports `runPreflightChecks(repoRoot)` — runs six blocking checks and two warnings, returning `{ checks, version, tag, notes }`; exposed via `cloverleaf-cli release-preflight <repoRoot> [--json]`. `lib/dag-overlap.ts` exports `computeOverlapEdges(tasks)` and `getFirstSharedFile(taskA, taskB)` — infers serialization edges from `scope.files_touched` and is used internally by `savePlan` to augment `task_dag.edges` before writing. `lib/scope-check.ts` exports `classifyFiles(taskDoc, modifiedFiles, siblingScopes)` — classifies branch-modified files into `own`, `contested`, and `extension` buckets; exposed via `cloverleaf-cli check-scope <repoRoot> <taskId> --branch <branchName>` (prints JSON, exits 1 on missing branch/task doc) and `cloverleaf-cli extend-scope <repoRoot> <taskId> --add <file>... --reason <text>` (idempotently set-unions files into `scope.files_touched` and appends an audit entry to `.cloverleaf/runs/plan/<PLAN-ID>/audit.jsonl`).
- `skills/` — Claude Code skill markdown files.
- `prompts/` — Implementer/Reviewer subagent system prompts.
- `examples/toy-repo/` — standalone demo repo.
- `tests/` — Vitest suite.

## Development

```bash
npm test        # run the Vitest suite
npm run test:watch
```

## Plans vs RFC-direct tasks

Cloverleaf has two ways to get from an approved RFC to executed Tasks. Both are first-class; the right one depends on the size and shape of the work.

**Plan-task (Discovery flow):** Operator invokes `/cloverleaf-discover`. The Plan agent decomposes the RFC into a Plan with a `task_dag`; the operator approves the decomposition at `task_batch_gate`; tasks are materialised under the Plan; the walker drives them through Delivery. Use this when the work spans ≥3 related tasks AND there's value in reviewing the decomposition before any task materializes (the gate is a checkpoint, not ceremony).

**RFC-direct task (skip the Plan layer):** Operator invokes `/cloverleaf-new-task --rfc=<RFC-ID> "<brief>"`. A single task is created with `context.rfc` set and `parent` absent — no Plan, no `task_batch_gate`. Use this for:

- **Hotfixes after a Plan has delivered** — a small bug or polish item surfaces after the Plan's tasks are all merged. Creating a new Plan for one task is pure overhead; an RFC-direct task is faster and equally trackable.
- **Incremental RFC progress without batch decomposition** — operator hasn't yet decided how to decompose the next chunk of work, but a single concrete task is clear. Create it now; defer the Plan formation until later (or skip Plans entirely if the work continues to arrive one task at a time).

### Auto-advance: how the walker treats them

When the walker (`/cloverleaf-run-plan`) finishes a Plan's final task, it asks `cloverleaf-cli rfc-tasks <repo_root> <RFC-ID>` whether the parent RFC can also advance from `approved` to `completed`. The check considers BOTH sibling Plans AND RFC-direct tasks under the same RFC:

- An **in-flight** Plan (`drafting`/`gate-pending`/`approved`) OR standalone task (any non-terminal state) blocks the RFC advance — there's still work pending under this RFC.
- A **delivered** Plan (`completed`) OR standalone task (`merged`) counts toward the at-least-one-delivered requirement — the RFC must have produced at least one successful piece of work to advance.
- If all delivered work was rejected/escalated, the operator decides: abandon the RFC, re-decompose, or accept the RFC as not-shippable. The walker won't auto-advance.

### Operator visibility

```bash
cloverleaf-cli rfc-tasks <repo_root> <RFC-ID>            # compact JSON
cloverleaf-cli rfc-tasks <repo_root> <RFC-ID> --pretty   # indented for humans
```

Returns the RFC's status, all sibling Plans (with their child tasks), all standalone tasks, and a summary block with in-flight/delivered counts plus `can_auto_advance_rfc`. Pure read; no side effects.

### The tradeoff to name

Skipping the Plan = skipping `task_batch_gate`. That's the right tradeoff for hotfixes (one task; no decomposition to review) and for one-task-at-a-time incremental work. It's the wrong tradeoff for a large multi-task scope where the human's review of the decomposition is the load-bearing checkpoint. Plans are a checkpoint, not ceremony.

## Security review

The **Security Reviewer** runs as a blocking council member whenever a Task's effective `security_class` is `high`. Both shipped profiles include it, so it covers fast-profile backend work, not only full-profile UI work.

**What triggers it.** `security_class` (`low`/`high`, independent of the UI-keyed `risk_class`) is inferred at task creation from sensitive markers (keywords + paths) and re-checked against the actual diff at council entry — defense in depth, so a task whose brief never says "credential" but whose diff touches `engine/exchange.py` is still caught. Override at creation with `--security=high|low`.

**Two passes.** (A) a deterministic secret scan (`cloverleaf-cli secret-scan`) over the diff's added lines — cloud keys, tokens, PEM headers, credentialed connection strings; (B) an LLM judgment pass reasoning about injection, broken authz, unsafe deserialization, SSRF, missing input validation, weak crypto.

**Routing.** Findings merge into one feedback envelope and the maximum severity sets the member's verdict. Any `blocker` — a leaked credential, say — produces `escalate`, which is un-lowerable, so the Task lands in `escalated` for a human. An `error` or `warning` produces `bounce`, and under `any-veto` the council sends the Task back to `implementing` with the round's feedback batched. Clean produces `pass` and the council carries on.

**Customizing.** Both pattern sets are consumer-overridable: `.cloverleaf/config/security-paths.json` (sensitive paths + keywords) and `.cloverleaf/config/secret-patterns.json` (secret regexes + placeholder excludes).

**Mechanical enforcement (v0.8.1+).** A high-security Task cannot reach `merged` without a passing security review. Standard 0.8.0 retired the `security_gate` state-machine annotation that used to carry this, so the guarantee now rests on two mechanisms. First, the `security` member is **blocking** under `any-veto` — its bounce or escalate stops the council outright. Second, `apply-council-verdict` records `security_review_verdict='pass'` on the `council → final-gate` transition for high-security Tasks, and writes a `security` block into the council audit artifact naming the member's verdict, the gating verdict it set, and the basis for both — including the case where no security member ran at all. The audit record is what makes the guarantee inspectable after the fact, rather than only enforced in the moment.

## License

MIT — see [../LICENSE](../LICENSE).
