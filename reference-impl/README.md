# @cloverleaf/reference-impl

Reference implementation of the Cloverleaf methodology as a set of Claude Code skills. Lets a user drive a Task from `pending` to `merged` with state, events, and feedback recorded in the repo under `.cloverleaf/`.

Implements [Cloverleaf Standard](../standard/) v0.3.0 at L2 (Exchange) conformance.

## Install

From this directory:

```bash
npm install            # pulls @cloverleaf/standard + deps
./install.sh           # symlinks skills into ~/.claude/plugins/cloverleaf/
# or:
./install.sh --project # local install into ./.claude/plugins/cloverleaf/
```

## Scope (v0.3)

v0.2 implements both paths of the Delivery track:

- **Fast Lane** (`risk_class: "low"`): Implementer → Reviewer → Human Merge
- **Full Pipeline** (`risk_class: "high"`): Implementer → Documenter → Reviewer → (UI Reviewer if `site/**` changed) → QA → Final Approval

### Agents

| Agent | Status | Mechanism |
|---|---|---|
| Implementer | Real | Subagent, code + tests on feature branch |
| Documenter | Real (v0.2) | Subagent, doc-only commits per file-path rules |
| Reviewer | Real | Subagent, read-only review of diff |
| UI Reviewer | Real (v0.5) | Playwright + axe-core + pixelmatch; multi-browser outer loop (chromium/webkit/firefox); axe-core runs on `axe.browser` engine only (default chromium); maxCombinations cap with per-route warnings |
| QA | Real (v0.2) | Per-package test runner via `git worktree` |
| Plan | Stub | Deferred to v0.3 |
| Researcher | Stub | Deferred to v0.3 |

### Skills

- `/cloverleaf-new-task` — scaffold a Task (auto-sets `risk_class`)
- `/cloverleaf-implement` — run Implementer
- `/cloverleaf-document` — run Documenter *(new in v0.2)*
- `/cloverleaf-review` — run Reviewer
- `/cloverleaf-ui-review` — run UI Reviewer *(new in v0.2)*
- `/cloverleaf-qa` — run QA *(new in v0.2)*
- `/cloverleaf-merge` — human gate (branches on state)
- `/cloverleaf-run` — orchestrator (dispatches by `risk_class`)

### Configuration

Two JSON config files in `config/` (overridable per consumer project):

- `config/ui-paths.json` — glob patterns that trigger UI Reviewer (default: `site/**`)
- `config/qa-rules.json` — per-package test commands

### Customizing for your repo

The package ships with cloverleaf-flavored defaults in `config/`. Your repo overrides any of them by placing a file of the same name at `<repoRoot>/.cloverleaf/config/<name>.json`. Consumer override is a **full replacement** — your file becomes the complete source of truth for that config.

Available overrides:

| Override file | Purpose |
|---|---|
| `.cloverleaf/config/ui-paths.json` | Controls `detect-ui-paths` — which diffs trigger the `ui-review` state |
| `.cloverleaf/config/qa-rules.json` | Per-package test commands for the QA agent |
| `.cloverleaf/config/affected-routes.json` | Rules for mapping diffs to site routes (UI Reviewer scope); includes `contentRoutes` for content-collection mapping |
| `.cloverleaf/config/astro-base.json` | Explicit Astro `base` path — avoids best-effort parsing of `astro.config.*` |

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

All overrides are read fresh on every skill invocation; no caching. Edit and the next `/cloverleaf-run` picks it up.

### Known limitations

- Concurrent `/cloverleaf-run` on the same repo may race on preview ports.
- QA does not produce HTML reports (no `report_uri`).

### Prerequisites for UI Reviewer

The installer (`install.sh`) automatically runs the Playwright browser install step. If you need to install manually, run:

    npx playwright install chromium webkit firefox

On **Linux**, webkit additionally requires system-level dependencies:

    npx playwright install-deps webkit

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

- `lib/` — TypeScript library used by the CLI. State, events, feedback, IDs, paths. Includes `buildBaselinePath(repoRoot, browser, slug, viewport)` (`lib/visual-diff.ts`) for constructing canonical baseline paths under `.cloverleaf/baselines/{browser}/`. `lib/ui-browser.ts` exports `buildBrowserEscalationFinding` and `applyMaxCombinationsCap` (used by the UI Reviewer prompt for per-engine escalation and combination-count capping).
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
