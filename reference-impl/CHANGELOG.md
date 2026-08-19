# Changelog

All notable changes to the Cloverleaf Reference Implementation are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.13.2 — 2026-08-19

**Patch: `--help` is answered, and the UI reviewer's teardown reaches the server it started.**

### Fixed
- `cloverleaf-cli --help` exited 2 with `Unknown command: --help` and printed the command list to stderr, so the most reflexive thing a user types at an unfamiliar CLI both failed and left stdout empty. `--help` and `-h` now write the list to stdout and exit 0. Every error path is unchanged: an unknown command and a missing command still print to stderr and exit 2, and the list stays off stdout there, because in that context it is a diagnostic rather than the answer. The text moved into one constant so a command added for one exit cannot go missing from the other.
- `prompts/ui-reviewer.md` — teardown released npm and nothing else. `SERVER_PID=$!` records npm's PID and `npm run dev` runs the dev server as a child, so `kill $SERVER_PID` left the server reparented to init and still holding the port, and the teardown reported success having freed nothing. Measured rather than inferred: under the old form the recorded PID was gone while its child answered HTTP 200 on the site's base URL for another minute and a half. Step 3 now starts the server under `setsid`, putting the whole tree in a process group whose id equals the recorded PID, and step 13 kills the group. The two are pinned together in one shell block, because without `setsid` a backgrounded job stays in the calling shell's group, the recorded PID is not a group id at all, and the group kill silently matches nothing behind its own `|| true` — failing straight back to the orphan. `astro preview` is deliberately not adopted despite being the form that surfaced this; D6 priced and rejected it. Step 3 also detaches stdin and captures the server's output so step 4's escalate path can say why a start failed.

### Added
- `tests/site-accuracy.test.ts` gains a guard over `Nav.astro`'s link entries. `external: true` renders the href verbatim; `external: false` sends it through `url()`, which prefixes the site base. A wrong flag breaks the link silently in whichever direction it is wrong, and the absolute-URL-marked-internal case renders as `/cloverleaf/https://…` — plausible in source, resolvable nowhere. The existing link guard cannot see either case, since it reads rendered `href="…"` attributes and these hrefs live in a frontmatter array. Not part of the published package.

### Changed
- `tests/site-accuracy.test.ts` — both parity loops now sweep every occurrence rather than the first. Each read its site with a non-global `.match()`, which returns one hit and leaves everything after it unchecked, so a second stale version or agent count added later would sit in a shipped page behind a green guard. The looseness was reported as affecting the four version sites; it affected twelve, because the roster loop carries eight more on the same construct and its patterns are the weaker ones. All twelve match exactly once today, which is why nothing was failing and the guard read as adequate. Not part of the published package.
- `tests/site-accuracy.test.ts` — the header now states that the suite sweeps bare `#chapter-N` literals outside markdown link syntax, that the breadth is deliberate, and what the guard structurally cannot catch: a wrong-but-valid anchor, since `#chapter-7` changed to `#chapter-9` still resolves. Comment-only. Not part of the published package.

## 0.13.1 — 2026-08-18

**Patch: the CLI named a file nobody can run.** The only change to the published package is the usage text `lib/cli.ts` prints.

### Fixed
- `cloverleaf-cli` printed `Usage: cli.ts <command> [args...]`. `cli.ts` is not something a consumer can invoke: `bin` maps `cloverleaf-cli` to `./dist/cli.mjs`, and all 160 `cloverleaf-cli` call sites across the shipped `skills/` and `scripts/` already use that name. The usage text now names the binary that exists. Corrected at both sites — the module docblock and the live string `usage()` writes to stderr — since the two had drifted as a pair.
- `site/src/components/DecisionGate.astro` — chapter 9's council diagram omitted the Security Reviewer from **both** delivery profiles and stated the UI Reviewer with no condition. `config/council.json` seats `security` in `delivery-fast` *and* `delivery-full` under `security_class:high`, and gates `ui` on `ui_changes`. The two cards now carry the wording the guide already used, and the output cards stack so the accurate text fits the diagram. Not part of the published package.

### Added
- `tests/site-accuracy.test.ts` gains a fourth guard, over the council diagram. It anchors to `config/council.json` rather than to the site, so it fires when the engine's configuration changes and the diagram does not — the failure an internally-anchored check cannot see. The member-id and `when`-condition vocabularies are themselves asserted against the config, so a profile that seats a member this guard does not spell fails rather than passing silently. Not part of the published package.

## 0.13.0 — 2026-08-18

**Breaking: delivery runs through one generic council phase.** The reviewer / security / UI / QA gates are unified into a single configurable review council driven by the collapsed `council` task state (requires `@cloverleaf/standard@0.8.0`). The shipped default reproduces the previous fast/full pipeline exactly.

### Changed
- The council engine generalizes over gate `kind`: `applyCouncilVerdict` exits `council → final-gate`/`implementing`/`escalated` (no lane admin-walk); `resolveCouncilPlan` + `postAdvisoryVerdict` operate on task / plan / rfc work items. `task.review` rebinds to the `council` state; `task.plan_review` becomes decisive-capable.
- The shipped `config/council.json` ships two lane profiles (`delivery-fast`, `delivery-full`) selected by `risk_class`; the default reproduces today's pipeline (the regression guard, now through the FSM change).
- `cloverleaf-run` drives a single universal council delivery path; `cloverleaf-merge` / `cloverleaf-run-plan` merge every task at `final-gate` under `final_approval_gate`. Security classification moves to council entry; the v0.8.1 guarantee is now carried by a blocking security council member + a recorded verdict backstop.
- `advance-status` drops its trailing `[path]` positional (`fast_lane` / `full_pipeline`), the reference-impl half of the lane split this release retires. No shipped skill or prompt ever passed it, but it was live in two places a user could read: the CLI's own usage text, and — via `formatReason` — the `reason` field of every event emitted with it. It also silently overrode the task's declared `risk_class` in the fixture handed to the validators, so a caller could contradict the task document from the command line; that override is gone and `risk_class` is now read only from the task. The security gate is unaffected either way, since it keys off `security_class`. Removed alongside it: the `path` field on `AdvanceWorkItemParams` and `StatusTransitionParams`, and `formatReason`'s `path` component — a reason is now either absent or a lone `gate=…`. Requires `@cloverleaf/standard@0.8.0`, which drops the corresponding transition tag; illegal-transition messages consequently no longer carry a `(path=…)` clause. New `tests/lane-vocabulary-retired.test.ts` sweeps `lib/` for the retired vocabulary, asserting a non-empty swept set so a sweep that matched nothing cannot read as a pass.
- `README.md` — rewritten for the collapsed council pipeline. The Fast Lane / Full Pipeline walks, the `automated-gates` hub, and the `ui-review → qa` baseline hand-off are replaced by the single `council` phase and its `risk_class`-selected profiles. The agent table now lists Chair and Security Reviewer and marks Plan and Researcher real; the skills list gains the six Discovery skills and the plan walker, and drops `/cloverleaf-release`, removed back in CLV-76; the config section covers all eight shipped files including `council.json`; and the v0.8.1 security guarantee is described as what it now is — a blocking council member plus the `apply-council-verdict` backstop — not the retired `security_gate` annotation.

### Added
- Council members carry an optional `kind` (`code` | `rfc` | `plan`); `validate-council` CLI enforces kind-homogeneity.
- Advisory discovery-gate councils: `cloverleaf-discover` runs an opt-in council at `rfc.strategy_gate` / `plan.task_batch` before the human gate.
- A decisive `plan_review` council (agent bounce `tactical-plan → pending`) — **available at the CLI/library level only; do not bind it.** `apply-council-verdict`'s `task.plan_review` gate hard-requires `status === 'tactical-plan'`, and **no shipped skill stops at `tactical-plan`**: `/cloverleaf-implement` completes `pending → tactical-plan → implementing` in a single dispatch, so a consumer that bound a profile to this gate would find the apply call throws. The shipped default binds nothing to it; a real stop-at-`tactical-plan` checkpoint is a follow-up (see the `skills/cloverleaf-run` entry under **Fixed**).

### Fixed
- `package.json` — `@cloverleaf/standard` dependency and peerDependency ranges corrected to `^0.8.0`. The previous `^0.7.x` ranges excluded the 0.8.0 collapsed-FSM Standard that 0.13.0 requires, so a fresh install would have resolved 0.7.1 and failed at `documenting → council`. A new `tests/package-contract.test.ts` pins the range against `standard/VERSION`.
- `prompts/qa.md` — removed the top-level `results` key from the documented feedback envelope. `feedback.schema.json` is `additionalProperties: false`, so a QA envelope carrying `results` was rejected by `write-feedback` and the delivery council could not complete for a high-risk task. Aggregate counts now go at the end of `summary`. The standalone `skills/cloverleaf-qa/SKILL.md` documented the same stale `results` shape and told the orchestrating agent to expect it, plus a human-report template that read `<passed>/<total>`/`<failed>/<total>` off it — both corrected to match the prompt's real, schema-valid output (counts read from `summary`) so an orchestrator following either document constructs the same envelope.
- `skills/cloverleaf-new-task` — `--rfc=<RFC-ID>` is now required. The skill previously documented `context: {}` for its no-RFC usage, but `task.schema.json` requires `context.rfc`, so any task scaffolded that way was born schema-invalid and failed at its first `advance-status`. A concrete schema-valid example was added.
- `lib/council.ts` — `council-plan` now resolves a per-member `substitutions` map alongside `promptPath`. The council runner substituted a fixed five tokens (`{{task}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{diff}}`), a set complete only for `security-reviewer.md`; `reviewer.md`'s `{{test_rules}}`, `qa.md`'s `{{qa_rules}}` and `ui-reviewer.md`'s `{{affected_routes}}` / `{{ui_review_config}}` / `{{taskId}}` arrived unresolved on the council path — the only automatic one — silently disabling the 0.10.0 test-runner agnosticism and leaving members to improvise a test command while still returning a confident `pass`. `test_rules`/`qa_rules` carry the qa-rules **document** (`{ rules: [...] }`, consumer override then packaged default), the shape those prompts document, not `loadQaRulesConfig()`'s bare array. Resolution is side-effect free: `{{preview_port}}` has no configured default and no non-allocating resolver, so it is omitted rather than fabricated and stays the dispatcher's job. New `loadQaRulesDocument()` in `lib/qa-rules.ts`; `loadQaRulesConfig()` is unchanged for callers that execute rules rather than prompt with them. `{{taskId}}` — the run-artifact directory `ui-reviewer.md` writes its `state.json` sidecar into — is resolved from the work-item id: left literal, the sidecar landed under a `{{taskId}}` directory, `read-ui-review-state` found nothing, `baselines_pending` read `false`, and the **human baseline-approval gate silently passed with unapproved visual baselines**. `skills/cloverleaf-ui-review` substitutes it on the standalone path too. The map is now typed (`MemberToken` + an exhaustiveness `default:`, so a token with no resolver is a typecheck failure), and `tests/council.test.ts` pins every built-in prompt's declared `{{…}}` tokens against `BASE_TOKENS ∪ MEMBER_TOKENS` and against a real plan's resolved `substitutions` — closing the class rather than the one instance, which matters because `skills/cloverleaf-run` §7.2 now tells the runner to **stop** rather than dispatch a member carrying an unresolved token.
- `lib/council.ts` — the council result artifact's `security.basis` now reports only what the run can prove. `basis` was derived from `council.members` — the members that actually *ran* — so a profile with no security member, one excluded by its `when` predicate, and a blocking security member the council stopped before reaching all rendered as `no security member configured; advanced under council authority`. The artifact is the durable record a human reads when asking whether security was consulted, and for two of those three cases that record was false. `applyCouncilVerdict` now classifies the absence against the gate's resolved plan (`resolveCouncilPlan`, consulted only when there is no security verdict to explain, and before any transition mutates the task the gate binding selects a profile from). A cause is named only when a stop rule fired **in a round that could actually have preceded security's own**: an `escalate` stops the council immediately, so an escalator in security's round or earlier explains the absence while a later one cannot; a **blocking** bounce stops it "before the next round" under `on_round_bounce: stop`, so it explains the absence only from a strictly earlier round — a same-round bounce cannot un-dispatch a member already running concurrently. Anything else (a non-blocking bounce, a stop rule that fired too late, a lost member envelope) is reported as unexplained rather than given an invented cause that would point an auditor away from the real anomaly, and a `council.json` that will not resolve says so on stderr and in the artifact instead of failing the apply. When no security member is in the resolved plan the basis now says exactly that — `no security member in this task's resolved council plan` — rather than the false `no security member configured`, since a `when`-excluded member *is* configured and merely inactive for this task; the trailing clause is verdict-aware, so a bounce no longer claims the task "advanced". **Gating behavior is unchanged**: the `security_review_verdict` backstop and `gating_verdict_set` (the v0.8.1 guarantee) are byte-for-byte untouched; only the audit string changed.
- `skills/cloverleaf-run` — three prose defects reconciled against what the FSM and `council-plan` actually do. §7.2 now substitutes each council member's resolved `substitutions` map from the plan (e.g. `test_rules` for `reviewer`, `qa_rules` for `qa`, `affected_routes`/`ui_review_config` for `ui`) instead of a fixed five-token list, and calls out that `{{preview_port}}` is deliberately absent from `substitutions` (planning must stay side-effect free and cannot allocate a port without one) — the runner itself allocates and substitutes `{{preview_port}}` when dispatching the `ui` member, the same way `skills/cloverleaf-ui-review` does. §3a no longer claims a `tactical-plan` checkpoint that `/cloverleaf-implement` cannot provide (that skill always completes both advances — `pending → tactical-plan → implementing` — in one dispatch and stops at `implementing`, never pausing at `tactical-plan`) — it now states plainly that a decisive `task.plan_review` is **not currently wired** and must not be bound by a consumer: `apply-council-verdict`'s `task.plan_review` gate (`applyDecisivePlanReview`) hard-requires `status === 'tactical-plan'`, which the task has already left by the time `/cloverleaf-implement` returns, so the call would throw. §3b is marked reserved (not deleted), recording the intended reload logic for when a real stop-at-`tactical-plan` mode exists; the shipped default binds no profile to `task.plan_review`, so this does not affect the packaged pipeline, and building the checkpoint itself is tracked as a follow-up. `skills/cloverleaf-implement`'s own step-8 comment carried the same false checkpoint claim and is corrected to match, so the two skills no longer assert opposite things. §2 gained a preflight: `load-task` does not schema-validate, so the runner now confirms `context.rfc` is present and `risk_class`/`security_class` are `low` or `high` before dispatching any agent, rather than discovering a schema-invalid task at its first real transition after a full Implementer run — plus a note on deleting an orphan event file after a failed `advance-status` save so a retry does not misnumber the next event.
- `prompts/implementer.md` — rework-aware branch handling (a council bounce no longer destroys the Documenter's commits), an explicit one-JSON-object output contract, and a long-run verification protocol replacing the previous silent early return.
- `prompts/reviewer.md` — excludes `.cloverleaf/` from its own diff so branch/base divergence is not mistaken for implementer drift; gained the same output-exclusivity clause.
- `prompts/ui-reviewer.md` — the UI member resolves its browser packages from the plugin root, and the driver-placement rule is retired. The prompt told the member to place its Playwright driver inside `$WT/site/` "so that Node can resolve `playwright` from `$WT/site/node_modules/`", and to `import axe from 'axe-core'` from that same driver. Neither package is a dependency of the reviewed repo's UI directory, and `prep-worktree` copies `node_modules` only into `standard/` and `reference-impl/` — so ESM resolution walking up from `$WT/site/` reached neither package and the import failed *from the mandated location too*, which would have stopped the UI member on any UI-touching task. `playwright`, `axe-core`, `pixelmatch` and `pngjs` are runtime `dependencies` of this package, so every consumer already has all four under the plugin root: the driver now anchors `createRequire` there and imports Cloverleaf's own helpers from `dist/<module>.mjs` by absolute path. Fixing this in the reviewed repo's `package.json` instead would have repaired only a repo that vendors its own UI, and pushed the burden onto every adopter. Because resolution no longer depends on where the driver sits, the placement rule is removed rather than corrected; what that rule was incidentally providing — cleanup of a driver written outside `$WT`, which `git worktree remove` does not sweep up — is now an explicit teardown step. The axe snippet is corrected alongside it: axe-core runs inside the page, so the driver injects `axe.source` and evaluates there instead of calling `axe.run(document)` in the Node process, where there is no `document`.
- `prompts/ui-reviewer.md` — the UI member now establishes `PLAYWRIGHT_BROWSERS_PATH` itself instead of asserting that a caller already did. The prompt stated the variable "is set to `~/.cache/ms-playwright` before you are invoked" and then acted on it — step 7 verifies each engine binary underneath it, and a missing binary is an `escalate` — but that precondition held only on the standalone path, where `skills/cloverleaf-ui-review` exports it before dispatch. `skills/cloverleaf-run`, the council path that now actually dispatches the `ui` member, never mentioned the variable, so the stated precondition was false exactly where the member runs; a literal reading of an empty variable could return a spurious `escalate` and stop a UI task. It stayed benign only because `~/.cache/ms-playwright` is also Playwright's own default on Linux, so the engines launched regardless. The prompt now runs `export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"`, which self-heals on the council path while deferring to a dispatcher or operator who already set it — the same shape as the `CLOVERLEAF_PLUGIN_ROOT` export the prompt gained alongside it, and the idiom `install.sh` already used. Adding the export to `cloverleaf-run` instead would have created a second caller that must remember, which is the drift that produced the defect. `skills/cloverleaf-ui-review` is corrected to the same `:-` form: it hard-coded `~/.cache/ms-playwright`, so following it discarded the non-default browser cache directory that `README.md` documents as a supported override. `tests/prompts.test.ts` now pins the export, forbids the precondition sentence, and sweeps every shipped prompt and skill for three things — naming this variable without setting it, setting it without deferring to an existing value (so a future dispatcher that adds the step cannot reintroduce the clobber), and the `="~/…"` assignment whose tilde a shell never expands inside double quotes.
- `prompts/{implementer,reviewer,qa,ui-reviewer}.md` — the safe suite-capture idiom (`<command> > /tmp/suite.log 2>&1; echo "EXIT=$?"`) is now documented wherever a long command's exit status is load-bearing; piping a run through `tail` reports *tail's* exit status, so a failing run reads as success. `ui-reviewer.md` had been left out and showed a bare `npm ci`, so the UI member improvised the piped form on every council pass while the members whose prompts modelled the safe one used it correctly — the difference was the prompt, not the agent. `tests/prompts.test.ts` now pins the idiom across all four prompts and sweeps every shipped prompt and skill for the `2>&1 | tail` signature, so the next document that grows a long command cannot quietly omit it.
- `skills/cloverleaf-ui-review` + `prompts/ui-reviewer.md` — an order to tear down a process now names the handle it kills by. The skill's rule "always teardown preview server + worktree on error" was addressed to the orchestrating agent, which creates neither: the subagent adds the worktree (`ui-reviewer.md` step 2) and backgrounds the dev server (step 3), so `$WT` and `$SERVER_PID` live in a different agent's shell. Ordered to kill something it had no handle on, the agent improvised from the one anchor it did hold — the port it had allocated — and wrote `pkill -f "port=<port>"`. That pattern also matches the command line of the shell running it, so the shell kills itself: exit 144, and every command after it in the same compound statement silently never runs. The 2026-08-06 dogfood watched this five times; three of them skipped the `rm -rf` / `git worktree remove` that followed and left worktrees registered until a later retry caught it. The rule now assigns server and worktree teardown to the subagent that holds the handles, bounds the orchestrator's own cleanup to what it can reach from the repo root (`git worktree prune`, which needs no `$WT`), forbids the pattern kill with the exit-144 reason attached, and has it report a still-listening port rather than kill blind. `ui-reviewer.md` already modelled the correct form (`SERVER_PID=$!` … `kill $SERVER_PID`), but its step 4 said only "kill it" at the one moment an agent doubts its PID is good; it now names `$SERVER_PID` and points at teardown, and step 13 carries the reason the form matters — the `rm -f` and `git worktree remove` that follow the kill are exactly what a self-match discards. No shipped document ever contained `pkill`, so the defect was an absence rather than a bad example to delete: `tests/prompts.test.ts` sweeps every shipped prompt and skill for a `pkill` modelled **inside a fenced shell block**, scoped that way because prose that names the command in order to forbid it is the fix, not the defect. The sweep asserts a non-empty document set *and* a non-empty shell-block set, because a fence matcher that silently matched nothing would read exactly like a pass.
- `prompts/ui-reviewer.md` — the UI member disables Astro's dev toolbar before it starts the preview server, so a captured baseline contains only what ships. Step 3 backgrounded `npm run dev`, so the dev server injected its toolbar over the bottom-centre of every page the member screenshotted and every tracked baseline carried it: dev-only UI absent from production, occluding the exact region a bottom-of-page regression appears in, coupling each baseline to the Astro version that drew it, and — because the toolbar is in the DOM rather than merely painted — putting the toolbar's own accessibility violations in front of the axe pass as though they were the site's. Two other routes were priced and rejected. Capturing against `npm run preview` needs a prior build, so a UI directory whose `build` runs a type-check (as this repo's does) would fail a purely visual review on an unrelated type error; it also assumes the directory has a `preview` script, which `ui-paths.json` cannot guarantee because it scopes that directory to anything. Setting `devToolbar: { enabled: false }` in the reviewed repo's astro config repairs only a repo that vendors its own UI and pushes the burden onto every adopter — the shape the browser-resolution fix above was rejected for. Astro's `devToolbar` preference is **project-scoped by default**, so `npx astro preferences disable devToolbar` run inside the throwaway worktree turns the toolbar off for that capture alone: it writes into `$WT/<ui-dir>/.astro/`, which step 13 deletes along with the worktree, needs no build, touches no tracked file, and works for any Astro site. `--global` is forbidden with the reason attached, since that writes to the operator's home directory and would silently change every other Astro project on the machine. A non-zero exit means the directory is not an Astro project, so the member is told to disable that toolchain's own overlay instead and, failing that, to emit an `info` finding rather than silently capture a contaminated baseline. `tests/prompts.test.ts` sweeps every shipped prompt and skill for a fenced block that starts a dev server and requires the disable to appear **earlier in that same block**: presence alone is satisfied by prose while the modelled sequence still starts the server undisabled, and Astro decides whether to inject the toolbar when the server boots. The sweep is fenced for the same reason the `pkill` sweep is — step 3's prose forbids `--global` by naming it, and a whole-file sweep failed on this fix's own text.
- `skills/cloverleaf-run-plan` — the "Walker policy" section described rules the policy it points at does not have. It listed `prep-worktree` and `mkdir -p` auto-approvals that were never in the file, folded `node` into a blanket `npm/npx/node` approval that has since been split so `node -e`/`-p` are excluded, and placed `sudo` on the auto-reject list when it now defers to a human instead. It also described the file as "the same one used during the CLV-16..CLV-20 dogfood runs", which stopped being true when the policy was realigned on claw-drive's starter. Rewritten around the four outcomes the policy actually resolves to (auto-approve / auto-defer / auto-reject / escalate), and it now points at `.cloverleaf/policy-check.mjs` as the way to verify an edit rather than leaving the reader to trust the prose.
- `prompts/documenter.md` — path table corrected: `standard/src/**` does not exist; `validators/`, `state-machines/` and `agent-contracts/` were unrouted.
- `scripts/acceptance-walker.sh` — the `council-optin` scenario's `source=consumer` check parsed `council-plan`'s output by interpolating the raw JSON text into a Python single-quoted string literal. Once `council-plan` started emitting a per-member `substitutions` map (JSON-encoded strings, carrying escaped quotes) alongside `promptPath`, that interpolation corrupted the literal and `json.loads` threw; the error was swallowed (`2>/dev/null`) and fell through to a Node fallback reading `process.env.COUNCIL_PLAN_OUT`, which was never exported — so the fallback silently produced `''` instead of failing, and the scenario reported a confusing `expected source=consumer, got ''` instead of a parse error. That extraction now parses via stdin, never interpolating command output into a quoted literal, and fails loudly on a malformed payload instead of degrading to an empty string. The scenario's other extraction (the post-apply `status` read) was never vulnerable and is unchanged — it interpolates a repo path into a `require()`, not a JSON payload.

## 0.12.0 — 2026-07-18

### Added
- **Council parallel rounds, advisory mode, and two more delivery gates (Slice 3).** `apply-council-verdict` is now gate-aware: beyond `task.review` it drives `task.plan_review` (at `tactical-plan`) and `task.final_gate` (at `final-gate`) as **advisory** gates — the council records its verdict + posts a feedback envelope and a human drives the transition. Members *within* a review round are now dispatched concurrently (rounds still run in sequence; bounces stay batched). `cloverleaf-run` auto-runs an opt-in advisory council at `final-gate` before the human merge; `task.plan_review` is available at the CLI/library level for consumers with a tactical-plan checkpoint. Additive and back-compatible — a repo with no `council.json` is unaffected.

## 0.11.1 — 2026-07-15

### Changed
- Test-hygiene and coverage polish for the council chair + custom-role engine (no functional change): cover `finalizeChairVerdict`'s malformed-input and non-string-rationale branches and `buildChairContext`'s member tagging; assert `chair.md` enumerates its `pass`/`bounce`/`escalate` verdicts; document why built-in member prompts are not exist-checked; consolidate a duplicate import and a stray blank line in `lib/council.ts`; clean up temp-dir leaks in the council/chair resolution tests; and add `local` scoping plus an explicit exit check to the council-chair acceptance scenario.

## 0.11.0 — 2026-07-10

### Added
- **Council chair engine + custom reviewer roles (Slice 2).** A council profile may set `aggregation: "chair"` — a deliberative agent (the built-in `prompts/chair.md`, or a custom `chair.prompt` under `.cloverleaf/prompts/`) reads all member verdicts + feedback, renders the council verdict + rationale, and curates which member feedback is forwarded to the Implementer on a bounce. A council member may be a **custom role** whose prompt lives at `.cloverleaf/prompts/<file>.md`, alongside the four built-ins. `council-plan` now emits a resolved `promptPath` per member; new `lib/chair.ts` with CLI subcommands `chair-context` and `chair-verdict`. Additive and back-compatible — a repo with no `council.json` (and the shipped default profile) is unaffected.

## 0.10.1 — 2026-07-07

### Fixed
- QA prompt now describes the injected test-rules payload accurately as a JSON object `{ rules: [...] }` (matching the implementer and reviewer prompts) rather than a bare array, so the QA agent reads the rules correctly.

### Changed
- Ordered the `qa-report` module functions top-down by dependency and added a CLI usage-error test for the `qa-report` subcommand.

## 0.10.0 — 2026-06-29

### Added
- Test-runner & worktree-prep agnosticism for non-TypeScript consumers. The implementer and reviewer agents now honor the project's `qa-rules.json` test commands (previously only QA did), so a consumer defines its test commands once and all three test-running agents respect them.
- `prep-worktree` is now topology-aware: a non-monorepo consumer project (no `standard/`/`reference-impl/` subdirs) is prepared via a configurable `worktree_setup_command` (new `discovery.json` field) instead of the TypeScript dependency dance. Monorepo projects are unaffected.
- `cloverleaf-cli qa-report <runs.json> <out.html>` generates the QA HTML report, so QA no longer depends on a monorepo `dist/` path.

### Changed
- QA and reviewer prompts generalize their TypeScript-specific guidance (module inspection, output parsing, worktree prep) so non-TypeScript projects read cleanly.

## 0.9.0 — 2026-06-18

### Added
- **Configurable review councils (Slice 1).** A per-project `council.json` can bind a review *council* to the `task.review` gate: a profile of rounds (sequential waves) composed from the built-in reviewers (`reviewer`, `security`, `ui`, `qa`), with member activation predicates (`security_class:high`, `ui_changes`) and deterministic verdict aggregation (`any-veto` default, plus `unanimous` / `majority` / `quorum(k)` / `weighted`). New `lib/aggregation.ts`, `lib/council-config.ts`, `lib/council.ts`, shipped `config/council.json`, and read-only CLI subcommands `council-plan` and `aggregate-verdicts`. The shipped default reproduces the existing pipeline exactly, so projects with no `council.json` are unaffected.
- **Configurable review councils — wired into the pipeline.** When a project provides a `.cloverleaf/config/council.json`, `cloverleaf-run` drives the `task.review` gate via the configured council: each active member runs as a read-only review, verdicts combine through the configured deterministic rule, and the outcome drives the FSM with a full audit artifact at `.cloverleaf/runs/<task>/council/task.review.json`. Projects with no `council.json` are unaffected — the existing review path runs verbatim. New `lib/council-result.ts` and CLI subcommand `apply-council-verdict`; `council-plan` now reports its config `source`.

### Changed
- **Council path pre-release polish.** Cleaned up the opt-in council surface surfaced while exercising it on a real consumer project: `council-plan` and `apply-council-verdict` no longer emit a benign `git diff` usage block to stderr when the feature branch is absent (`lib/council.ts` and `lib/security-classify.ts` now discard git's stderr while still capturing stdout — behavior is otherwise unchanged, git errors still resolve to an empty changed-file list); the `cloverleaf-run` council member diff (§7.2) excludes `.cloverleaf/` orchestration churn so reviewers see only the code change; the §7.4 wrap-up commit is guarded against an empty index and documents that the FSM walk self-commits some transitions; the council result artifact records a `walk_note` when the `qa` state is traversed administratively (no `qa` member ran); and `apply-council-verdict` rejects gates other than `task.review` with a clear error (the FSM walk is hardcoded for the `task.review → merge` lane).

## 0.8.6 — 2026-05-28

### Changed
- `prompts/ui-reviewer.md` hardened against two agent-improvisation failures seen in the v0.8.1 walker (CLV-108): (1) an explicit prohibition on shelling out to ImageMagick (`convert`/`compare`/`magick`) — visual diffing is **only** `compareVisual` (pixelmatch, `lib/visual-diff.ts`); ImageMagick is not installed and not a dependency. (2) The CLV-36 Playwright-script-placement rule now explicitly covers retries and ad-hoc fallback scripts ("fix it in place in `$WT/site/`, never relocate to `/tmp`"), closing the retry loophole the agent fell through.

### Notes
- Pure prose change in one agent prompt. No CLI changes, no dependency changes, no Standard contract change (still 0.7.1).
- Regression guards added/extended in `tests/prompts.test.ts` (new ImageMagick-prohibition block; CLV-36 block extended for retry coverage).

## 0.8.5 — 2026-05-28

### Changed
- `prompts/reviewer.md` and `prompts/qa.md` now document a **module-load recipe**: to load or run a single module directly, use `npx tsx` (already in the worktree's `node_modules`) rather than improvising `node -e "import('./lib/x.js')"`. tsx resolves `.ts` sources and the project's `.js`-style import specifiers, so the natural import works; plain `node -e` failed with `ERR_MODULE_NOT_FOUND` because sources are `.ts` and the build emits `.mjs`. Eliminates the wasted-turn import failure the Reviewer hit on CLV-103/CLV-104 in the v0.8.1 walker run.

### Notes
- Pure prose change in two agent prompts. No CLI changes, no dependency changes, no Standard contract change (still 0.7.1).
- A parameterized regression test in `tests/prompts.test.ts` asserts both prompts carry the recipe.

## 0.8.4 — 2026-05-27

### Fixed
- `lib/qa-report.ts` `escape()` now tolerates non-string inputs. Eliminates `TypeError: Cannot read properties of undefined (reading 'replace')` that fired on every QA invocation in the v0.8.1 walker run (CLV-101..108). Function signature changed from `(s: string)` to `(s: unknown)`; null/undefined produce `""`, non-strings get `String()`-coerced before escaping. Happy-path output for string inputs is byte-identical.

### Added
- `DiscoveryConfig.prep_copy_dirs: string[]` (defaults to `[]`). `cloverleaf-cli prep-worktree` honors this field by copying each listed directory from `<mainRoot>` into the per-task worktree after the existing node_modules copies. Eliminates the manual per-task copy of the gitignored design-docs directory the v0.8.1 walker required 8 times. Cloverleaf-the-project's own `.cloverleaf/config/discovery.json` opts in with its design-docs directory; other consumers (claw-crypto, etc.) leave it empty and get current behavior.
- Missing source dirs are skipped silently with a stderr notice; existing `primeCopy` idempotency pattern applies (dest is wiped before copy).

### Notes
- Standard contract unchanged (still 0.7.1).
- Both fixes are strict supersets of pre-fix behavior — no migration needed.

## 0.8.3 — 2026-05-27

### Changed
- Nine cloverleaf delivery + discovery skills (`cloverleaf-implement`, `cloverleaf-document`, `cloverleaf-review`, `cloverleaf-ui-review`, `cloverleaf-qa`, `cloverleaf-security-review`, `cloverleaf-draft-rfc`, `cloverleaf-spike`, `cloverleaf-breakdown`) now carry an explicit **"Dispatch conventions"** block inline with their Task-tool dispatch step. The block instructs the LLM to invoke the Task tool in its default foreground mode and NOT to background-dispatch or poll. Eliminates the `Blocked: sleep` antipattern that fired on every agent dispatch during the v0.8.1 walker run.

### Notes
- Pure prose change in skill bodies. No CLI changes, no Standard contract change.
- A parameterized regression test in `tests/skills.test.ts` asserts every dispatching skill carries the canonical block.
- Walker UX improvement: fewer `tool_use_error` events on every per-task delivery + discovery dispatch.

## 0.8.2 — 2026-05-27

### Changed
- `cloverleaf-cli check-scope` honors `.gitattributes merge=union` annotations. Files marked `merge=union` (e.g., `reference-impl/CHANGELOG.md` and `standard/CHANGELOG.md`) are no longer reported as `contested` when a sibling task in the same Plan also touches them — they fall through to `extension[]` and auto-extend post-merge. This unblocks the multi-writer CHANGELOG pattern that `.gitattributes` already declared but `check-scope` was failing to honor.

### Notes
- Pre-fix behavior is a strict subset of post-fix: single-writer collisions on files without `merge=union` still escalate exactly as before.
- Standard is unchanged (still 0.7.1).
- The `.gitattributes` parity bump adds `standard/CHANGELOG.md merge=union` alongside the existing `reference-impl/CHANGELOG.md merge=union`.

## 0.8.1 — 2026-05-27

**Mechanical enforcement of the security-review state.** v0.8.0 delivered the Security Reviewer agent; the 2026-05-25 claw-crypto dogfood validated the feature's value but showed the LLM driving /cloverleaf-run skipped the bookkeeping. 0.8.1 makes the bookkeeping non-prose.

### Changed
- `cloverleaf-cli advance-status` enforces the Standard 0.7.1 `security_gate` annotation. On any transition with the flag, it performs a **classify-security writeback**: re-runs classify-security against the real diff and writes back `security_class: "high"` on under-classification, then validates. On refusal: **exit code 2** + canonical error message naming the required recovery action.
- `cloverleaf-cli advance-status review → automated-gates` resets `security_review_verdict` to null (rework invalidates prior security pass), atomic with the status change.
- `cloverleaf-security-review` skill writes `security_review_verdict` on each terminal branch via `set-task-field`, committed before `advance-status`.
- `cloverleaf-run` skill's "Security gate (both lanes)" section keeps belt-and-suspenders prose; new refusal-and-recover subsection documents the exit-code-2 recovery pattern.
- `prompts/security-reviewer.md` requires `verdict` on the agent response envelope.

### Added
- `cloverleaf-cli set-task-field <repoRoot> <taskId> <field> <value>` — focused write primitive used by the security-review skill. Allowlist scoped to `security_review_verdict`.
- `classifyTaskSecurity(repoRoot, taskId, opts?)` helper extracted from the classify-security CLI handler; used by both the CLI and `advanceStatus`.
- `__setMockChangedFiles` testing seam in `lib/security-classify.ts` for deterministic integration tests.
- Integration tests for Flows 1–4 + backward-compat (`reference-impl/tests/integration.security-gate.test.ts`), including the load-bearing Flow 2 dogfood reproduction.

### Dependencies
- `@cloverleaf/standard` peer dep bumped from `^0.7.0` to `^0.7.1` (adds `security_gate` + `resets_security_verdict` transition annotations).

## 0.8.0 — 2026-05-13

### Added
- **Security Reviewer (8th agent).** Hybrid two-pass Delivery step gated by the new `security_class` dimension, running off the `automated-gates` hub in both lanes. Pass A: deterministic `cloverleaf-cli secret-scan` (cloverleaf-authored minimal pattern set, consumer-overridable at `.cloverleaf/config/secret-patterns.json`). Pass B: LLM judgment subagent (`prompts/security-reviewer.md`) for injection/authz/deserialization/SSRF/validation/crypto. Findings merge into one envelope; max severity sets the verdict — `blocker` → escalated, `error`/`warning` → implementing, clean → automated-gates.
- New skill `/cloverleaf-security-review`.
- New CLI subcommands `secret-scan` and `classify-security`; new libs `lib/secret-scan.ts`, `lib/security-classify.ts`; new configs `config/secret-patterns.json`, `config/security-paths.json` (both consumer-overridable).
- `/cloverleaf-new-task` infers `security_class` (keyword/path markers; `--security=high|low` override).

### Changed
- `/cloverleaf-run` runs a security gate off the `automated-gates` hub in both lanes (`MAX_SECURITY_BOUNCES=3`), with a review-time diff re-check + write-back on under-classification, and fail-toward-review if classify-security errors. The Reviewer skill is unchanged.
- Bumped `@cloverleaf/standard` to `^0.7.0` (security_class + security-review state).

## 0.7.5 — 2026-05-12

### Added

- **RFC-direct task pattern formalised.** A task with `parent` absent/null AND `context.rfc` set is now a first-class workflow shape ("RFC-direct task" / "standalone task"). Surfaced by claw-crypto's `CC-43`, `CC-44`, and `CC-045..052` (10 tasks across two RFCs, parented to RFCs only, no Plan). See `README.md` § "Plans vs RFC-direct tasks" for the full pattern docs.
- **New CLI subcommand `cloverleaf-cli rfc-tasks <repoRoot> <RFC-ID>`** returns a categorized JSON view: the RFC's status, sibling Plans (with their child tasks), standalone tasks under this RFC, and a summary block with `inflight_plans` / `inflight_standalone` / `delivered_plans` / `delivered_standalone` / `can_auto_advance_rfc`. Compact by default; `--pretty` for human reading. Read-only; exit 2 with actionable stderr when the RFC file is absent.
- **New pure-lib module `lib/rfc-tasks.ts`** exporting `isStandaloneTask(task)` and `computeRfcTasksView(repoRoot, rfcId)`. Used by the CLI subcommand above and (transitively) by the walker.

### Changed

- **Walker RFC auto-advance now considers standalone tasks.** The `cloverleaf-run-plan` SKILL.md's RFC auto-advance block replaces its v0.7.4 inline `jq` sibling-Plan scan with a single `cloverleaf-cli rfc-tasks` call and reads `summary.can_auto_advance_rfc`. Standalone tasks under the same `parent_rfc` block the advance when in-flight and count toward the at-least-one-delivered requirement when merged. Closes the latent v0.7.4 bug where an RFC could be advanced while standalone tasks were still pending under it.
- `/cloverleaf-new-task` SKILL.md `--rfc=<ID>` Rules entry now cross-links to the README § "Plans vs RFC-direct tasks" and names the workflow shape it produces.

### Docs

- New section in `reference-impl/README.md` titled "Plans vs RFC-direct tasks": when to use each, auto-advance semantics, the `task_batch_gate` tradeoff.
- New section in methodology site `guide/04-discovery.mdx` titled "RFC-direct tasks".
- Clarifying sentence in `guide/06-work-items.mdx` Task entry covering the `parent: null + context.rfc` shape.
- New FAQ entry: "When should I use a Plan vs go RFC → Task directly?"

### Tests

- +18 unit tests in `tests/rfc-tasks.test.ts` (`isStandaloneTask` + `computeRfcTasksView` happy path, in-flight blocks, all-rejected, all-rejected-mixed, standalone-only, RFC-not-approved, missing RFC, cross-project, orphan exclusion, missing-dirs guard, empty workspace).
- +4 CLI integration tests in `tests/cli.test.ts` (compact / `--pretty` / missing-RFC exit 2 / usage error).
- Walker v0.7.4 RFC-advance regression block (7 tests) replaced with v0.7.5 block (6 tests) reflecting the new CLI-driven shape.
- +11 content-guard tests in `tests/skills.test.ts` (README section, chapter 4 section, chapter 6 clarification, FAQ entry, package.json version).

## 0.7.4 — 2026-05-11

### Added

- `/cloverleaf-new-task` accepts a `--rfc=<RFC-ID>` flag and, when present, populates `context.rfc` from `<repo_root>/.cloverleaf/rfcs/<RFC-ID>.json` with the workItemRef shape `{ "project": "<rfc-project>", "id": "<RFC-ID>" }`. The `project` is read from the on-disk RFC (a task in project FOO may legitimately reference an RFC in project BAR). Aborts with a verify-the-RFC-ID message when the target file is absent. When `--rfc` is omitted, `context` remains `{}` — pre-v0.7.4 behavior preserved. Use to scaffold the standalone-task-from-RFC pattern (no Plan parent, no task_batch_gate) — practiced by claw-crypto's CC-43/44 and CC-045..052, previously required a post-hoc `context.rfc` retrofit commit.
- **Walker auto-advances Plan `approved` → `completed`** after the final child task's merge commit (depends on Standard 0.6.0's new `completed` terminal state on the Plan state machine). The advance is guarded on `status === "approved"` so re-runs of `/cloverleaf-run-plan` against a fully-merged plan are idempotent. Closes the previous state-sync gap where Plans with all-merged children stayed at `status: "approved"` indefinitely (surfaced by claw-crypto Plans CC-10/CC-27/CC-37). Plan-advance commits as `cloverleaf: plan <PLAN-ID> completed (all tasks merged)`.
- **Walker auto-advances parent RFC `approved` → `completed`** immediately after the Plan-advance commit, when (a) no sibling Plan of the same `parent_rfc` is still in-flight (`drafting`, `gate-pending`, or `approved`) AND (b) at least one sibling Plan reached `completed`. The "at-least-one-completed" guard avoids advancing an RFC whose Plans were all `rejected` — those leave the RFC at `approved` for the operator to abandon or re-decompose. RFC-advance commits as `cloverleaf: rfc <RFC-ID> completed (<N> sibling plans completed, 0 in-flight)`. Operators may still advance manually for backfill (e.g. `cloverleaf-cli advance-rfc <repo> <RFC-ID> completed agent` against claw-crypto's CC-1/CC-21/CC-35).

### Changed

- Bumped `@cloverleaf/standard` dependency to `^0.6.0` (was `^0.5.0`) — required for the new `completed` state on Plan and RFC state machines.
- `npm test` now runs `scripts/check-standard-prepped.mjs` as a `pretest` hook. Fails fast with an actionable error when `standard/node_modules/` or `standard/dist/` is absent, instead of bombing partway through `tests/conformance.test.ts` with a cryptic `ERR_MODULE_NOT_FOUND: @apidevtools/swagger-parser`. Same script was already used by `prepublishOnly`.

### Tests

- +4 regression tests in `tests/skills.test.ts` covering the `--rfc=<ID>` flag documentation, the rfcs/ file read, the workItemRef JSON shape, and the abort-on-missing-RFC behavior.
- +3 regression tests in `tests/skills.test.ts` covering the walker's Plan-advance block (advance-plan command shape, idempotency guard, descriptive commit message).
- +7 regression tests in `tests/skills.test.ts` covering the walker's RFC-auto-advance block (advance-rfc command shape, parent_rfc field reads, status guard, in-flight sibling check across `drafting`/`gate-pending`/`approved`, at-least-one-completed requirement, commit message, plain-language skip-condition documentation).
- `tests/conformance.test.ts` now passes again on a fully-prepped checkout (was failing because `standard/node_modules/` was missing in fresh clones / post-rebase states).

## 0.7.3 — 2026-04-30

### Changed

- Walker reads `notification_contract.idle_after_seconds` from the walker config (falls back to 600 when absent) and passes the resolved value as `--idle-after` to `claw-drive watch`, replacing the previously hardcoded 600 s constant. Walker validates the notification-contract vocab on session spawn and warns on drift (unknown keys are logged but do not block execution); dispatch remains hardcoded on `[DONE]` / `[NEEDS-INPUT]` terminal tokens. [CLV-98]

## 0.7.2 — 2026-04-29

### Changed

- `cloverleaf-cli check-scope` now skips sibling tasks whose `status` is `"merged"` when gathering sibling scopes. Merged siblings no longer contest scope, so files they touched are no longer returned in the `contested` bucket. Non-merged siblings (e.g. `status: "review"`) continue to contest as before. [CLV-92]
- `prompts/plan.md` — added a **Partial-scope warning** block directing the Plan agent to count tasks where `scope.files_touched` is absent or an empty array and, when that count is greater than zero, append a `⚠ Tasks without scope.files_touched: <CLV-XX, CLV-YY>` warning line at the bottom of the gate-pending summary with an advisory that the walker will silent-skip scope enforcement on those tasks; the warning is omitted entirely when every task has a non-empty `scope.files_touched`. Regression-guarded by two new test cases in `tests/skills.test.ts` (`describe('Plan prompt (CLV-93 — partial-scope warning in gate-pending summary)')`). [CLV-93]

## 0.7.1 — 2026-04-29

### Added

- `lib/scope-check.ts` — new module exporting `classifyFiles(taskDoc, modifiedFiles, siblingScopes)` returning `{ contested, own, extension }` buckets. Uses exact-path comparison after normalization (trim, backslash→slash, strip leading `./`, strip trailing `/`); excludes `.cloverleaf/`-prefixed paths; lex-smallest sibling taskId wins as owner for contested files; output buckets sorted lexicographically. [CLV-86]
- `skills/cloverleaf-run-plan/SKILL.md` — step 5e now calls `cloverleaf-cli check-scope` before the y/N merge prompt; on `contested` files the merge is skipped and the task is escalated with a clear message; on tooling failure the walker warns and falls through to the existing flow. Adds a post-merge auto-extend block invoking `cloverleaf-cli extend-scope` when `extension[]` is non-empty. New Rules entry: "Scope-contested merges are escalated, never auto-resolved". [CLV-88]
- `prompts/implementer.md` — added a one-paragraph **Scope nudge** after step 1 covering own-scope, discovery-during-implementation auto-extension, and the contested-file refuse-merge consequence. [CLV-88]
- `cloverleaf-cli check-scope <repoRoot> <taskId> --branch <branchName>` — reads the task doc from the feature branch via `git show`, gathers sibling task scopes from main, computes modified files via `git diff main..<branch>`, calls `classifyFiles`, and prints `{ own, contested, extension }` JSON to stdout. Exits 0 on success, 1 on missing branch or task doc, 2 on missing `--branch` flag. [CLV-87]
- `cloverleaf-cli extend-scope <repoRoot> <taskId> --add <file>... --reason <text>` — set-unions the supplied files into `scope.files_touched` (sorted, deduped), saves via `saveTask`, and appends a `{ ts, kind, task_id, files, reason }` JSON line to `.cloverleaf/runs/plan/<PLAN-ID>/audit.jsonl`. Idempotent: re-running with the same files produces no change to the task doc. Exits 2 on missing `--reason` or no `--add` files. [CLV-87]

## 0.7.0 — 2026-04-29

### Added

- `lib/dag-overlap.ts` — new module exporting `computeOverlapEdges(tasks)` and `getFirstSharedFile(taskA, taskB)`. Infers serialization edges from `scope.files_touched`: pairwise intersection over normalized paths (strips leading `./`, trailing `/`, canonicalizes separators), emits one lower-id-first edge per unique `(from.id, to.id)` pair, deduplicates, and sorts output deterministically. [CLV-81]

### Changed

- `savePlan` in `lib/plan.ts` now: (1) validates against the Plan schema, (2) calls `computeOverlapEdges` on all inline tasks and set-union-merges inferred edges into `task_dag.edges`, (3) runs cycle detection on the augmented DAG and throws `"file overlap creates cycle: <task-id> ↔ <task-id> via <file>"` if a cycle is found, then (4) writes to disk. [CLV-81]
- Plan prompt (`prompts/plan.md`): added a `scope.files_touched` per-task population instruction alongside the `task_dag` guidance, an explicit directive that file-overlap edges must NOT be added manually (the system computes them automatically on Plan save), and a new "Gate-pending summary template" section that groups edges under `Logical:` and `Inferred from file overlap:` headings. Regression-guarded in `tests/prompts.test.ts` (`describe('plan prompt (CLV-82 — scope.files_touched and gate-pending summary)')`). [CLV-82]

### Standard

- Coordinated with Standard 0.5.0 release. Standard 0.5.0 adds `task.scope.files_touched` to the Task schema, enabling DAG-overlap detection across concurrent task scopes. `@cloverleaf/standard` dependency bumped from `^0.4.0` to `^0.5.0`.

## 0.6.7 — 2026-04-29

### Fixed

- Walker (`cloverleaf-run-plan` SKILL.md step 5): attach a persistent Monitor stream (`persistent: true`, `timeout_ms: 3600000`) immediately after each `mcp__claw-drive__start_session` call so child events arrive without requiring Session A nudges. Dispatch table expanded to cover `idle` (with `claw-drive status` + `last_token` branching for `[DONE]` / `[NEEDS-INPUT]` / transient-5xx retry / continue-waiting), `tool_decision_required`, `turn_completed [DONE]`, `turn_completed [NEEDS-INPUT]`, and `session_stopped`. Transient-5xx pattern (`5\d\d\b|API Error: 5\d\d|temporarily unavailable`) triggers `mcp__claw-drive__send_turn` with `"API recovered. Retry the last operation."` for automatic self-healing without operator intervention. `tests/skills.test.ts` gains 14 regression tests: a `plugin.json no skills property` guard (prevents re-introduction of the auto-discovery suppression from CLV-69) and 12 assertions covering Monitor attachment ordering, all five dispatch-table event types, and the three 5xx pattern forms. [CLV-74]

### Added

- `--pretty` flag on `load-rfc`, `load-spike`, `load-plan`, and `load-task` CLI subcommands — pass `--pretty` to receive multi-line `JSON.stringify(doc, null, 2)` output instead of the compact default. [CLV-75]

### Changed

- `load-rfc`, `load-spike`, `load-plan`, and `load-task` now emit compact single-line JSON followed by a `\n` by default (jq-safe; previously `load-rfc`, `load-spike`, and `load-plan` emitted pretty-printed JSON without a trailing newline, and `load-task` emitted pretty-printed JSON). [CLV-75]
- Release-prep custodian skill added to walker plan; walker now auto-bumps `package.json` version and promotes `## [Unreleased]` to a dated release heading as part of the plan run. [CLV-73/CLV-77]

### Removed

- Breaking — /cloverleaf-release skill removed. Release publishing returns to the manual five-command sequence printed by the walker's 'Next steps' block. [CLV-76]

## 0.6.6 — 2026-04-29

### Fixed

- `runPreflightChecks()` in `lib/release-preflight.ts` now extracts release notes via a section-split approach (`changelog.split(/\n(?=## )/)`, `versionRegex.test(s)` per section, strip header line, trim) instead of a one-shot regex. The previous regex captured content from the wrong CHANGELOG section when the target version was not the last entry. Four new/augmented test cases (cases 1, 11, 12, 13 in `release-preflight.test.ts`) cover multi-section isolation and last-section extraction; case 13 specifically exercises the bracketed `## [version]` header form. Total test count advances from 10 to 13. [CLV-69]
- (hot-fix, commit `069c3ae`) Removed the `skills[]` array from `reference-impl/.claude-plugin/plugin.json` that was inadvertently introduced in v0.6.5. The explicit array suppressed Claude Code's auto-discovery mechanism, causing all 17 `cloverleaf:*` skills to go missing at runtime; removing the field restores full auto-discovery.

### Changed

- Walker SKILL (`cloverleaf-run-plan`): all state-mutating `git` invocations in walker bash blocks now use `git -C <repo_root>` so they resolve paths against the repo root regardless of shell cwd; added regression guard test in `tests/skills.test.ts`. ([CLV-70])

## 0.6.5 — 2026-04-28

### Changed

- `cloverleaf-run-plan` skill: step 5b now calls `cloverleaf-cli prep-worktree <repo_root> "$WT"` immediately after `git worktree add` and before `mcp__claw-drive__start_session`, ensuring every child worktree is fully primed before the session starts. All `claw-drive watch` invocations in step 5c now append `--idle-after 600` so child sessions emit synthetic idle events after 10 minutes of silence. Step 5d gains a new idle event handler: when a `silent_for_ms >= 600000` event arrives for a child session in qa-or-higher task state, the walker calls `claw-drive status <child_session_id>` to read `last_token`; if `last_token` is `[DONE]` or the on-disk task status is `final-gate`/`automated-gates`, the child is treated as terminal and drain proceeds. Retired claw-drive 0.5.7 token vocabulary replaced throughout. [CLV-64]
- QA prompt (`prompts/qa.md`) clarifies that the compiled QA-report artifact lives at `<repoRoot>/reference-impl/dist/qa-report.mjs` and should be invoked via `node --input-type=module` or imported from there. Reduces ambiguity that caused QA agents in earlier dogfood runs to look for `dist/lib/qa-report.js`. Regression-guarded in `tests/prompts.test.ts`. [CLV-65]
### Added

- `lib/release-preflight.ts` — new module exporting `runPreflightChecks(repoRoot): PreflightResult`. Runs six blocking checks (`on-main`, `clean-tree`, `in-sync-with-origin`, `valid-version`, `changelog-section`, `tag-absent`) and two warnings (`npm-authenticated`, `gh-authenticated`). Returns `{ checks, version, tag, notes }`. Never throws — all errors are captured into per-check `message` fields. [CLV-63]
- `cloverleaf-cli release-preflight <repoRoot> [--json]` — new CLI subcommand. In `--json` mode emits the full `PreflightResult` as JSON on stdout; in plain mode prints one `✓`/`⚠`/`✗`-prefixed line per check and exits non-zero if any blocking check fails. [CLV-63]
- `/cloverleaf-release` skill (`skills/cloverleaf-release/SKILL.md`) — publishes a new `@cloverleaf/reference-impl` release. Flow: parse `[--dry-run] [--yes]` flags → call `cloverleaf-cli release-preflight --json` → display check list → bail on blocking failure → display 5-command release plan + version + notes preview → prompt `y/N` (skipped with `--yes`) → execute `git tag -a` / `git push origin main` / `git push origin <tag>` / `npm publish --access public` / `gh release create` sequentially with bail-fast. [CLV-63]
- Plugin manifest (`reference-impl/.claude-plugin/plugin.json`) updated to version `0.6.5`; `cloverleaf-release` added to the `skills[]` array. Marketplace manifest (`.claude-plugin/marketplace.json`) updated to version `0.6.5` with `", release"` appended to the plugin description. [CLV-63]

## 0.6.4 — 2026-04-28

### Added

- `lib/walker-config.ts` — new `loadWalkerConfig()` loader that reads `~/.config/cloverleaf/walker.json` (XDG-aware), validates `max_concurrent`, and returns `{ maxConcurrent, source, path }` with `source: 'default'` (value 3) when the file is absent or the field is omitted. `cloverleaf-cli walker-default-concurrency [--explain]` subcommand exposes the resolved value to the walker skill; `--explain` emits `max_concurrent=N (from <path>|default)` instead of the bare integer. [CLV-58]

### Changed

- `cloverleaf-run-plan` skill: step 1 resolves `max_concurrent` via `cloverleaf-cli walker-default-concurrency` (plain form, captured into `$MAX`) and `cloverleaf-cli walker-default-concurrency --explain` (startup info line) instead of hard-coding 3. When `--max-concurrent=N` was passed (`$MAX_FLAG` is set), `$MAX` is assigned from the flag and an info line is printed directly. On non-zero exit from `walker-default-concurrency`, the walker stops with `Fix or remove ~/.config/cloverleaf/walker.json and retry.` (CLV-59)

## 0.6.3 — 2026-04-28

### Fixed

- `prepWorktree()` now copies the primary repo's `reference-impl/dist/` into the spawned worktree immediately after the `reference-impl/node_modules` copy step, so agents importing from `<worktree>/reference-impl/dist/` (e.g. `dist/lib/qa-report.js`) no longer encounter `Cannot find module` errors. No new build step is invoked inside the worktree — the already-built dist from the primary is reused directly. [CLV-52]
- `cloverleaf-run-plan/SKILL.md` step-6 Report section gains a `## Next steps (release publishing)` block listing the five post-merge release commands (tag, push origin main, push tag, npm publish, gh release create) so operators have an authoritative checklist immediately after a plan completes. [CLV-53]
- `cloverleaf-run-plan/SKILL.md` scenario_brief template gains an explicit `DO NOT run git checkout main from this worktree` paragraph explaining the two-worktree branch-hold constraint and providing safe alternatives (`git diff main..HEAD`, `git show main:<path>`). Regression-guarded in `tests/skills.test.ts`. [CLV-53]

### Added

- `reference-impl/scripts/check-standard-prepped.mjs` — new sanity-check script run as the first step of `prepublishOnly`. Walks up from `process.cwd()` to locate the repo root by detecting `standard/package.json`, then verifies both `standard/dist/` and `standard/node_modules/` exist. If either is absent, writes an actionable error to stderr (`ERROR: standard/ is not prepped in this environment.`) with two remediation options (`cloverleaf-cli prep-worktree` or `(cd ../standard && npm ci && npm run build)`) and exits with code 1. Exits 0 with no output when both are present. [CLV-54]
- `reference-impl/package.json` `prepublishOnly` script updated to `node scripts/check-standard-prepped.mjs && npm test && npm run build`, placing the sanity check before the vitest/tsc run so that an unprepped worktree fails fast with an actionable error before any test or build work begins. [CLV-54]

## 0.6.2 — 2026-04-27

### Added

- `cloverleaf-cli write-baseline <repoRoot> <taskId> <browser> <slug> <viewport> <sourceFile>` — new subcommand that copies a screenshot file to the canonical baseline path (`.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`), creating intermediate directories as needed. Includes the CLV-38 guard: exits non-zero with a descriptive error when the task's `ui-review/state.json` has `baselines_pending: true`, preventing the UI Reviewer from bypassing the human baseline-approval gate. Prints the destination path on stdout on success.
- Repo-root `.gitattributes` sets `reference-impl/CHANGELOG.md merge=union` so Git automatically unions concurrent `## [Unreleased]` entries from parallel task branches rather than raising a merge conflict. Regression test (`tests/changelog-merge-union.test.ts`) verifies both bullets survive and no conflict markers appear. [CLV-47]

### Changed

- `install.sh` gains a `--with-cross-browser` flag. On Linux, passing the flag runs `npx playwright install-deps webkit firefox` (both engines) instead of the previous webkit-only `npx playwright install-deps webkit`. When the flag is absent, webkit-only behavior is preserved and an informational note is printed explaining how to re-run with `--with-cross-browser` to add firefox system deps for the full UI-Reviewer browser matrix. [CLV-46]
- All five agent prompts (`implementer.md`, `documenter.md`, `reviewer.md`, `ui-reviewer.md`, `qa.md`) now open with a **Pre-flight** step: `cd "$(git rev-parse --show-toplevel)"`. Session B sessions spawned by the walker harness may inherit an arbitrary `cwd`; this anchors every agent at the repo root before any task steps run. [CLV-48]
- `SKILL.md` (Session B scenario brief) now references `$WORKTREE_ROOT` by name in the brief text and includes an explicit `cd "$WORKTREE_ROOT"` pre-flight instruction so the spawned session resets its working directory to the worktree root before proceeding. [CLV-48]

## 0.6.1 — 2026-04-27

Focused patch release addressing seven bugs surfaced by the v0.6.0 dogfood run
on Plan CLV-26 (2026-04-26). All seven require manual intervention during that
run; v0.6.1 eliminates every one.

### Fixed

- **Bug #1 — Walker worktree path under /tmp/ rejected by claw-drive.**
  `SKILL.md` step 5b previously set `WT="/tmp/walker-<PLAN-ID>-<TASK-ID>"`.
  claw-drive rejects sessions whose `cwd` is outside `$HOME` with
  `INVALID_CWD`. The path template is now
  `WT="${XDG_CACHE_HOME:-$HOME/.cache}/cloverleaf/walker/<PLAN-ID>-<TASK-ID>"`
  and a `mkdir -p "$(dirname "$WT")"` call is added before `git worktree add`
  so the directory hierarchy is created on first use. No `/tmp/walker-*` path
  remains anywhere in `SKILL.md`.

- **Bug #2 — Reviewer and QA prompts use `git worktree add ... main`, which
  fails inside walker worktrees.** Inside a walker worktree the `main` branch
  is already checked out in the primary repo, so `git worktree add ... main`
  produces `fatal: branch 'main' is already checked out`. The Reviewer and QA
  prompts now use `git worktree add --detach <path> <sha>` exclusively,
  avoiding branch-held-by-primary-repo collisions.

- **Bug #3 — UI Reviewer writes Playwright script to /tmp/; Node cannot
  resolve playwright.** Node resolves modules relative to the script file's
  location, so a script placed under `/tmp/` cannot find `node_modules/playwright`.
  The UI Reviewer prompt now places the script file inside the worktree root
  (or `reference-impl/`) where `node_modules/playwright` is resolvable.

- **Bug #4 — `cloverleaf-cli prep-worktree` errors with "main missing
  standard/node_modules" inside a walker worktree.** `prep-worktree` validated
  its `mainRoot` argument for the presence of `standard/node_modules` and
  `reference-impl/node_modules`, but walker peer worktrees are fresh checkouts
  without installed deps. `prep-worktree` now walks up the directory tree from
  the provided `mainRoot` to find the actual primary repo root (identified by
  the presence of both `node_modules` trees), or accepts an explicit
  `--primary-root` flag.

- **Bug #5 — UI Reviewer bypasses the baselines_pending gate at the CLI
  layer.** During CLV-27, the UI Reviewer copied new baselines directly under
  `.cloverleaf/baselines/` before the `baselines_pending` human gate fired,
  bypassing the approval gate entirely. `cloverleaf-cli` now refuses (non-zero
  exit with a descriptive error) to write files under `.cloverleaf/baselines/`
  when the task's `ui-review/state.json` has `baselines_pending: true`. The
  guard is enforced in TypeScript at the CLI layer, independent of prompt text.

- **Bug #6 — Conflict markers survive rebase and reach `git merge --no-ff`.**
  During CLV-29's rebase an Edit call silently failed to remove conflict
  markers from `guide.astro`; git accepted the rebase as complete, the merge
  went through, and the site build broke post-merge. The walker's drain merge
  sequence in `SKILL.md` section 5e now runs a `grep` step that scans every
  file changed on the task branch for unresolved conflict markers
  (`<<<<<<<`, `=======`, `>>>>>>>`) and aborts before `git merge --no-ff` if
  any are found, marking the task `state: "escalated"` and surfacing the
  affected files to the user.

- **Bug #7 — walk-state.json reports tasks as `state: "running"` after drain
  and merge.** The drain step in `SKILL.md` referenced the `walk-state-write`
  call in prose but did not emit it. Tasks stayed at `state: "running"` in
  `walk-state.json` even after a successful merge, which could exhaust all
  concurrency slots on resume. A `cloverleaf-cli walk-state-write` call is now
  emitted immediately after a successful `git merge --no-ff` in the drain step,
  recording `state: "merged"` and the `merge_commit` SHA in walk-state.

- `cloverleaf-cli prep-worktree` no longer fails when `mainRoot` is a walker worktree path (a peer worktree with no installed deps). A new `findPrimaryRoot(startDir)` helper walks up parent directories until it finds one containing both `standard/node_modules` and `reference-impl/node_modules`, and `prepWorktree` now resolves the actual primary repo root via this helper before copying node_modules. If the walk exhausts without a both-match, the helper re-walks for each subdirectory individually and throws a precise error naming the specific missing directory (e.g. "main missing reference-impl/node_modules at <path>"), preserving the prior diagnostic granularity. 5 regression tests added in `tests/prep-worktree.test.ts` (walker-mode happy path, two AC guards, and three diagnostic-branch tests). [CLV-37]

### Migration note (upgrading from v0.6.0)

Consumers upgrading from v0.6.0 who have a stale `walk-state.json` with tasks
stuck at `state: "running"` from a completed run should run:

```bash
cloverleaf-run-plan <PLAN-ID> --reset
```

before the first v0.6.1 invocation on any plan with a stale walk-state. The
`--reset` flag wipes `walk-state.json` and starts fresh. A dedicated
`cloverleaf-cli walk-state-reconcile` subcommand is **not** shipped in v0.6.1
— `--reset` is the documented migration path, since stale `running` entries
exhaust all concurrency slots and cause the walker to exit immediately before
reconciliation can run, making `--reset` the only reliable fix.

### Tests

Tests updated to cover the three SKILL.md changes landing in this task
(CLV-34): no `/tmp/walker` path in `cloverleaf-run-plan` skill, conflict-marker
grep before merge, and `walk-state-write` call after merge. Sibling tasks
CLV-35 through CLV-38 each add their own regression tests.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- `@cloverleaf/standard` package.json is not modified.
- The walker skill's external API (invocation arguments, `--reset` flag,
  exit behaviour) is unchanged. Only internal skill-body prose and CLI
  implementation change.

## 0.6.0 — 2026-04-24

First feature release after the CLV-15 / cross-browser-UI-review line of
patches. Introduces an autonomous DAG walker that drives a Plan's task_dag
through Delivery concurrently.

### Added

- **`/cloverleaf-run-plan <PLAN-ID>`** skill — autonomous DAG walker.
  Reads an approved Plan, computes ready tasks, spawns one claw-drive
  Session B per ready task (default `max_concurrent: 3`, configurable via
  `--max-concurrent=N`), monitors them, surfaces only escalations and
  per-task final-gate approvals to the human. Resumable across
  invocations. `--reset` flag to wipe walk-state and start over. Each
  task runs in a dedicated git worktree (`/tmp/walker-<PLAN-ID>-<TASK-ID>`)
  so parallel Sessions don't race on HEAD; the walker itself performs
  the final `git merge --no-ff` on main in the primary repo after human
  approval. Session B does NOT invoke `/cloverleaf-merge` in walker mode.
- `lib/dag-walker.ts` — `computeReadyTasks(plan, walkState, maxConcurrent)`
  pure function for DAG scheduling; `detectCycle(plan)` Tarjan-style cycle
  guard.
- `lib/walk-state.ts` — atomic read/write of
  `.cloverleaf/runs/plan/<PLAN-ID>/walk-state.json`.
- Four new `cloverleaf-cli` subcommands: `dag-ready-tasks`,
  `dag-detect-cycle`, `walk-state-read`, `walk-state-write`. The walker
  skill body invokes these to bridge bash to the TypeScript library.
- `scripts/acceptance-walker.sh` (run via `npm run acceptance:walker`) —
  release-gate harness for the walker's data plane. Synthesises a tmp
  Cloverleaf consumer repo with a 3-peer Plan and exercises the seven
  CLI/walk-state behaviours that compose the walker's tick loop: cycle
  detection on clean Plan, dag-ready-tasks at full and capped concurrency,
  walk-state write+read round-trip, slot-accounting against a running
  task, all-merged exit set, and cycle detection on a 2-cycle Plan. No
  Claude tokens consumed; complements the manual dogfood for full
  Session-orchestration validation.

### Changed

- `/cloverleaf-merge` skill gains a Q&A affordance at the final-gate
  prompt. Users can ask clarifying questions (which get answered from
  pipeline context and re-prompted) before giving the `y/N` verdict.
  Only `y/Y/yes/YES` proceeds to merge; `n/N/no/NO` declines. Any other
  response is treated as a question. The walker depends on this
  behaviour, but manual merges get the same affordance as a side-effect.
- Event filenames scoped per work item (`<workItemId>-<NNN>-<type>.json`
  instead of the old global per-project `<PROJECT>-<NNN>-<type>.json`).
  The global counter collided across parallel Delivery worktrees at
  merge time. Per-work-item scoping makes sibling-task events unique by
  construction so they merge cleanly. `lib/ids.ts::nextEventId(repoRoot,
  workItemId)` is the new signature; the previous `(repoRoot, project)`
  form is replaced.

### Tests

547 tests passing, up from 506 in v0.5.5. New suites:

- `tests/dag-walker.test.ts` — 13 tests (9 for `computeReadyTasks`, 4 for
  `detectCycle`).
- `tests/walk-state.test.ts` — 7 tests (path construction, round-trip,
  atomic write, tmp-file cleanup, malformed JSON).
- `tests/cli.test.ts` — +4 tests for the new walker subcommands.
- `tests/skills.test.ts` — +13 tests asserting `/cloverleaf-run-plan`
  skill-body shape + 3 tests for the `/cloverleaf-merge` Q&A loop.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- Existing `/cloverleaf-run <TASK-ID>` unchanged. The walker invokes it
  per-task inside each Session B.
- The `/cloverleaf-merge` change is additive — existing `y/Y/yes/YES`
  and `n/N/no/NO` responses continue to work exactly as before. Only
  arbitrary text was previously treated as decline; now it's a question.

## 0.5.5 — 2026-04-24

Bundles the merged CLV-20 end-to-end integration test (the Plan CLV-15 join
node) with a `prep-worktree` idempotence fix surfaced by CLV-20's own
Reviewer. Plan CLV-15 (cross-browser UI review, RFC CLV-9) is now fully
delivered on `main`.

### Fixed

- `cloverleaf-cli prep-worktree` no longer fails with `EEXIST` when invoked
  on a worktree that already has a partially-populated `node_modules` tree.
  CLV-20's Reviewer hit `Error: EEXIST, File exists '.../vite/node_modules/.bin'`
  on the second `prep-worktree` invocation. Root cause: Node's `cpSync`
  with `verbatimSymlinks: true` does not reliably overwrite an existing
  symlink at the destination, even with `force: true` (the default). The
  v0.5.2 synthetic unit-test fixtures didn't exercise nested `.bin`
  symlinks (as created by npm under `vite/node_modules/.bin → ../../.bin`),
  so the regression slipped through. Fix introduces an internal
  `primeCopy(src, dst)` helper that wipes `dst` before `cpSync`, making
  `prep-worktree` idempotent.

### Added

- End-to-end integration test
  (`reference-impl/tests/e2e.ui-review-cross-browser.test.ts`) — 638 lines,
  17 tests. Exercises the cross-browser UI review pipeline using synthetic
  PNG buffers (no real Playwright launch), wiring together `visual-diff`,
  `ui-browser`, `axe-dedupe`, `ui-review-state`, `ui-review-config`, and
  the task state machine. Covers: 3-browser matrix (chromium/webkit/firefox)
  × per-browser baseline paths (`.cloverleaf/baselines/{browser}/...`),
  per-engine escalation, axe-chromium-only rule, `maxCombinations` cap,
  `baselines_pending` gate blocking `ui-review → qa`, and
  `/cloverleaf-approve-baselines` clearing the flag. Completes CLV-20 (join
  node of Plan CLV-15).

### Tests

506 tests passing (+19 from v0.5.4: 17 new from CLV-20 + 2 prep-worktree
idempotence regression tests).

### Compatibility

- Standard stays at 0.4.1. No schema, contract, state-machine, or library-API
  changes.
- `prepWorktree()` internal helper `primeCopy` is not exported; callers of
  the library API or CLI observe only that repeat invocations now succeed.

## 0.5.4 — 2026-04-24

Bundles the merged CLV-19 baseline-approval sidecar with a follow-up typo
fix surfaced by CLV-19's own Reviewer.

### Fixed

- `cloverleaf-ui-review/SKILL.md` now uses the fully-qualified
  `/cloverleaf-approve-baselines <TASK-ID>` in its human-facing message when
  `baselines_pending` is true. The previous text said `/approve-baselines`,
  which would have produced a "skill not found" error if a human copied the
  message verbatim (the registered plugin-scoped skill name is
  `/cloverleaf-approve-baselines`, matching every other skill in the
  `cloverleaf-*` family). Regression guarded in `tests/skills.test.ts`.

### Added

- `lib/ui-review-state.ts` — new module with `UiReviewState` interface and three exports: `uiReviewStatePath(repoRoot, taskId)`, `readUiReviewState(repoRoot, taskId)`, `writeUiReviewState(repoRoot, taskId, state)`. Reads/writes the baseline-approval sidecar at `.cloverleaf/runs/{taskId}/ui-review/state.json`. Absent file is treated as `{ baselines_pending: false }`.
- `lib/paths.ts` gains two new exported helpers: `runsDir(repoRoot)` and `uiReviewRunDir(repoRoot, taskId)` — canonical path constructors for the runs directory and per-task ui-review run directory.
- `cloverleaf-cli read-ui-review-state <repoRoot> <taskId>` — reads and prints the ui-review state sidecar JSON to stdout.
- `cloverleaf-cli write-ui-review-state <repoRoot> <taskId> <baselines_pending>` — writes `{ baselines_pending: true|false }` to the ui-review state sidecar, creating intermediate directories as needed.
- `/cloverleaf-approve-baselines` skill (`skills/cloverleaf-approve-baselines/SKILL.md`) — human baseline-approval gate. Triggered when `cloverleaf-ui-review` reports `baselines_pending: true`. Presents new baseline images to the human for review, writes `baselines_pending: false` via `cloverleaf-cli write-ui-review-state`, then advances the task from `ui-review` → `qa`.

### Changed

- UI Reviewer prompt (`prompts/ui-reviewer.md`) now writes the `state.json` sidecar (step 12, before teardown). Sets `baselines_pending: true` if any `compareVisual` call returned `new-baseline` or `dimension-mismatch`; otherwise writes `baselines_pending: false`. Teardown is renumbered from step 12 to step 13.
- `/cloverleaf-ui-review` skill reads the `state.json` sidecar after the subagent completes. If `baselines_pending` is `true`, the task stays in `ui-review` status and the skill reports that `/cloverleaf-approve-baselines` must be run before the task can advance to `qa`. If `baselines_pending` is `false` (or state.json is absent), the task advances to `qa` normally.

## 0.5.3 — 2026-04-24

Bundles the merged CLV-18 cross-browser UI Reviewer work with a Documenter
pipeline bug fix that was reproduced three consecutive Delivery runs.

### Added

- `lib/ui-browser.ts` — two new exported helpers:
  - `buildBrowserEscalationFinding(engine, platform?)` — builds an `error`-severity Finding with `rule: "browser-missing"` naming the missing Playwright engine and its install command. On Linux, the message appends the `install-deps` hint.
  - `applyMaxCombinationsCap(routes, viewportCount, browserCount, maxCombinations)` — enforces the `maxCombinations` cap: sorts affected routes by diff size (most-changed first), keeps the first `floor(maxCombinations / (viewports × browsers))` routes, and returns one `warning`-severity Finding with `rule: "ui-review-cap"` per skipped route.

### Changed

- UI Reviewer prompt (`prompts/ui-reviewer.md`) refactored for v0.5 multi-browser behavior:
  - **Browser outer loop**: browser is now the outermost loop, wrapping the viewport × route loops. Engines are drawn from `config.browsers`.
  - **Per-engine escalation**: before launching any browser session, all required engine binaries are verified. If any are absent, `verdict: "escalate"` is returned immediately with `buildBrowserEscalationFinding` findings for every missing engine.
  - **axe-core chromium-only**: the axe pass runs exclusively on the engine named by `config.axe.browser` (default `"chromium"`). webkit and firefox passes produce no axe output and no axe findings, avoiding engine-specific false positives from Blink/WebKit/Gecko divergence (CLV-12).
  - **maxCombinations cap**: before starting browser sessions, the reviewer computes `routes × viewports × browsers`. If the product exceeds `config.maxCombinations` (default 90), it applies `applyMaxCombinationsCap` and emits `ui-review-cap` warnings for each skipped route. `ui-review-cap` warnings are never gating.
  - Baseline paths use the `{browser}` subdirectory (`.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`), consistent with CLV-17.
  - Visual-diff finding messages and metadata now include the `browser` dimension.
  - Output schema extended: `rule` may now be `"ui-review-cap"` or `"browser-missing"` in addition to the existing `"a11y.<rule-id>"` and `"visual-diff"` values.
  - `cloverleaf-cli prep-worktree` is now called immediately after `git worktree add` in the runtime procedure.
- Documenter prompt (`prompts/documenter.md`) "Commit discipline" section rewritten. The prompt now instructs the Documenter subagent to run `git status --porcelain` in the worktree before committing, stage every modified doc file explicitly (or `git add -A` when only docs are modified), and self-check that `git status` is empty before returning. The previous phrasing ("One commit per file touched") allowed the subagent to commit only CHANGELOG.md while silently leaving README.md edits uncommitted.

### Fixed

- Documenter subagent no longer silently drops README edits when both
  CHANGELOG.md and README.md are modified in the same worktree. This bug
  was reproduced on three consecutive Delivery runs (CLV-16, CLV-17,
  CLV-18) — each time the driver had to reject the commit and instruct the
  subagent to include README.md explicitly. The v0.5.3 prompt rewrite
  (above) forces an explicit `git status` read and an empty-status
  self-check.

### Tests

443 tests passing (+2 from v0.5.2's 410; net includes CLV-18's additions and
the 2 new documenter prompt regression assertions).

### Compatibility

- Standard stays at 0.4.1. No schema, contract, state-machine, or library-API
  changes.
- The Documenter prompt body gained two new assertions in
  `tests/prompts.test.ts` (one positive, one negative around the
  CHANGELOG-only failure mode) — downstream forks that rewrote the
  Documenter prompt may need to reintroduce the `git status --porcelain`
  phrasing and the CHANGELOG-only warning.

## 0.5.2 — 2026-04-24

Bundles the CLV-16 + CLV-17 cross-browser groundwork with two dogfood-surfaced
pipeline bug fixes (both reproduced on CLV-16 2026-04-22 and CLV-17 2026-04-24
Delivery runs via claw-drive).

### Added

- `UiReviewConfig` gains three new backward-compatible fields: `browsers` (array
  of `BrowserEngine` strings, default `["chromium"]`), `axe.browser` (string,
  default `"chromium"`), and `maxCombinations` (integer, default `90`). Configs
  that omit these keys continue to work unchanged — `applyDefaults()` fills
  them in at load time.
- `BrowserEngine` type alias (`'chromium' | 'webkit' | 'firefox'`) exported
  from `lib/ui-review-config.ts`.
- `install.sh` now runs `npx playwright install chromium webkit firefox` (all
  three browsers) after the existing chromium step, and on Linux also runs
  `npx playwright install-deps webkit` for webkit system dependencies.
- `buildBaselinePath(repoRoot, browser, slug, viewport)` exported from
  `lib/visual-diff.ts` — constructs the canonical baseline path
  `.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`. Callers should use
  this helper instead of constructing paths manually.
- `cloverleaf-cli prep-worktree <mainRoot> <worktreePath>` (new subcommand) —
  primes a freshly-created git worktree for the reference-impl test suites by
  copying main's `standard/node_modules` and `reference-impl/node_modules`
  into the worktree (preserving the `@cloverleaf/standard → ../../../standard`
  relative symlink so it resolves to the worktree's own `standard/`), then
  running `npm run build` inside the worktree's `standard/` so `dist/` comes
  from the branch's own sources. Exposed via a new `prepWorktree()` export
  from `lib/prep-worktree.ts`.

### Changed

- Baseline storage layout migrated from flat
  (`.cloverleaf/baselines/{slug}-{viewport}.png`) to browser-subdirectory
  layout (`.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`) via `git
  mv` (CLV-17). The flat layout is **deprecated**; all new baselines must be
  placed under `baselines/{browser}/`. Existing chromium baselines have been
  moved to `baselines/chromium/`.
- UI Reviewer prompt and `compareVisual` call-sites updated to construct
  `baselinePath` with the `{browser}` segment. Attachment label paths in
  reviewer output reference the new subdir form.
- QA prompt (`prompts/qa.md`) now invokes `cloverleaf-cli prep-worktree`
  immediately after `git worktree add`.
- Reviewer prompt (`prompts/reviewer.md`) now invokes `cloverleaf-cli
  prep-worktree` in its worktree recipe and runs `npm test` from
  `reference-impl/` (rather than `npm install && npm test` at the worktree
  root, which never resolved `@cloverleaf/standard`'s deps).
- Vitest `testTimeout` bumped from the 5 s default to 15 s. CLI-level tests
  chain three or more `npx tsx cli.ts` spawns (~1.8 s each); the default was
  reliably exceeded by `advance-rfc`, `advance-spike`, and `advance-plan`
  flows on a loaded machine.

### Fixed

- `/cloverleaf-merge` skill no longer calls `advance-status ... merged agent`
  for the `final-gate → merged` transition. That transition is
  `allowed_actors: [human]` per the task state machine, so the CLI correctly
  rejected it with `Illegal transition final-gate → merged ... by agent`. The
  skill now passes `human final_approval_gate full_pipeline` as positional
  args. Driven sessions on CLV-16 and CLV-17 had to self-recover by reading
  the CLI signature and retrying.
- Reviewer and QA subagents running tests in a fresh git worktree no longer
  fail with `Cannot find module '@cloverleaf/standard/validators/index.js'`.
  Git worktrees don't inherit `node_modules`, and `npm install` in the
  worktree's `reference-impl/` followed the `file:../standard` dep into a
  `standard/` that had no built `dist/` and no runtime deps (`ajv-formats`
  etc.). The new `prep-worktree` helper wires up both. QA subagents in the
  CLV-16 and CLV-17 Delivery runs had to hand-apply two `cp -r` workarounds.

### Tests

410 tests passing (+30 from v0.5.1):

- 6 unit tests for `prepWorktree` (node_modules copy, standard/dist build,
  relative-symlink preservation, error paths).
- 2 CLI tests for `prep-worktree` (usage + error wiring).
- 2 skill-body regression tests for the merge-skill actor bug.
- 2 prompt regression tests asserting QA/Reviewer prompts invoke
  `prep-worktree`.
- Plus CLV-17 regression tests (browser subdirectory baselines) carried over
  from the v0.5 cross-browser work.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- `prepWorktree()` is a new library export; no existing APIs changed.
- Skill body tests now forbid `advance-status ... merged agent` in
  `cloverleaf-merge`. Downstream forks that patched the skill to retry with
  `agent` will need to drop that patch.

## 0.5.1 — 2026-04-22

Bug-fix release closing issues surfaced by the v0.5 Discovery-track dogfood
(cross-browser UI review, `/cloverleaf-discover docs/briefs/cross-browser-ui-review.md`).

### Fixed

- `saveRfc`, `saveSpike`, `savePlan`, `saveTask` now auto-create their parent
  directories (`.cloverleaf/rfcs/`, `spikes/`, `plans/`, `tasks/`) on first
  write. Prior to this fix a fresh consumer repo hit `ENOENT` on the first
  `/cloverleaf-discover` run, which cascaded into an inconsistent
  `spike-in-flight` RFC with zero spikes on disk. Mirrors the v0.1.1 fix for
  `events/` and `feedback/`.
- `/cloverleaf-new-rfc` title scaffold no longer carries a trailing newline.
  `echo "$FIRST_LINE" | jq -Rs .` captured `\n` into the JSON string; switched
  to `printf '%s' "$FIRST_LINE" | jq -Rs .`, same fix for the `problem` field.
- `/cloverleaf-discover` prose rewritten from "inline `/cloverleaf-X` steps" to
  "invoke `/cloverleaf-X`" across all 10 sub-skill references. Matches the
  observed runtime behaviour (driven Claude spawns sub-skills via the Skill
  tool) and removes the mental-model mismatch for humans reading the skill.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- No library API changes — `saveX` signatures unchanged; existing callers
  benefit from auto-dir-creation transparently.

### Tests

380 tests passing (+6 regression tests: 4 auto-create tests across
rfc/spike/plan/task, 1 for the printf guard in new-rfc, 1 for the
invoke-not-inline guard in discover).

## 0.5.0 — 2026-04-22

### Added — Discovery track is now real

- **Researcher agent** (`prompts/researcher.md`) — operations `draftRfc` (reads brief + docs, emits RFC with `unknowns[]` for candidate spikes) and `runSpike` (executes a spike, emits `findings` + `recommendation`). Dual-operation prompt file.
- **Plan agent** (`prompts/plan.md`) — operation `breakdown` (approved RFC + completed spikes → Plan with edge-based `task_dag` + inline `tasks[]` + optional `path_reviewer_map`).
- **Discovery skills** (6 new):
  - `/cloverleaf-new-rfc <brief-file>` — scaffolds a new RFC in `.cloverleaf/rfcs/`.
  - `/cloverleaf-draft-rfc <RFC-ID>` — invokes Researcher draftRfc; emits one Spike per unknown; transitions RFC to spike-in-flight or planning.
  - `/cloverleaf-spike <SPIKE-ID>` — invokes Researcher runSpike; transitions pending → running → completed with findings + recommendation.
  - `/cloverleaf-breakdown <RFC-ID>` — invokes Plan breakdown on an approved RFC; emits a Plan at `task_batch_gate` gate-pending.
  - `/cloverleaf-gate <item-id> <approve|reject|revise> [reason]` — human gate action on RFC (`rfc_strategy_gate`, all 3 actions) or Plan (`task_batch_gate`, approve/reject only).
  - `/cloverleaf-discover <brief-file>` — full Discovery orchestrator mirroring `/cloverleaf-run`. Drives RFC → (Spikes) → Plan → gates → task materialisation, then prompts to kick off Delivery on the first DAG root via `/cloverleaf-run`.
- **Per-type library modules** — `lib/rfc.ts`, `lib/spike.ts`, `lib/plan.ts`. Each exports `loadX`, `saveX` (with AJV `validateOrThrow`), `advanceXStatus` (delegates to `advanceWorkItemStatus`). `lib/plan.ts` also exports `materialiseTasksFromPlan` — atomic batch task-file creation with DFS cycle detection + pre-validation of every task before any file write.
- **Generic work-item helper** — `lib/work-item.ts::advanceWorkItemStatus<T>` + `loadStateMachine(type)`. The per-type modules delegate emit-then-save atomicity through this helper, so each type inherits the "orphan event" guard established in v0.1.1.
- **Discovery config** — `config/discovery.json` package default (`{ "docContextUri": "", "projectId": "", "idStart": 1 }`; all generic values). Consumer override at `<repoRoot>/.cloverleaf/config/discovery.json` with full-replacement + per-field fallback normalisation. Loader: `loadDiscoveryConfig(repoRoot)`. CLI: `cloverleaf-cli discovery-config --repo-root <path>`.
- **Shared work-item ID helper** — `nextWorkItemId(repoRoot, project)` scans `.cloverleaf/{rfcs,spikes,plans,tasks}/` for the next sequential ID, matching the oauth-rollout scenario convention where IDs share a per-project namespace across types (directory determines type, not ID).
- **CLI subcommands** (12 new) — `load-rfc`, `save-rfc`, `advance-rfc [gate]`, `load-spike`, `save-spike`, `advance-spike`, `load-plan`, `save-plan`, `advance-plan [gate]`, `materialise-tasks <plan-id>`, `next-work-item-id <project>`, `discovery-config --repo-root <path>`. All `advance-*` commands enforce the v0.1.1 actor guardrail (`agent` or `human` only; `system` rejected).

### Changed

- `lib/state.ts` renamed to `lib/task.ts` (no behavioural change). Prepares the lib for parallel per-type modules.
- `lib/task.ts::advanceStatus` now delegates to `lib/work-item.ts::advanceWorkItemStatus`. Public signature unchanged; the orphan-event error format preserves byte-for-byte compatibility with v0.4.1 regex matches.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes. RFC/Spike/Plan schemas + contracts have shipped in Standard since 0.2.0.
- Existing Delivery-track skills (`/cloverleaf-implement`, `-document`, `-review`, `-ui-review`, `-qa`, `-merge`, `-run`) are unchanged.
- Existing `nextTaskId` export still works (back-compat).

### Tests

~375 tests passing (up from 273 at v0.4.1).

## [0.4.1] — 2026-04-21

### Added
- `cloverleaf-cli plugin-root` subcommand — prints the CLI's plugin root, used by skills to locate prompts/config regardless of install mode.
- `axe.ignored` field in `config/ui-review.json` — array of `{ruleId, target}` tuples to drop matching findings before verdict computation. Unblocks tasks on surfaces with pre-existing a11y debt.

### Fixed
- `cloverleaf-merge` skill now performs a real `git merge --no-ff` (was only committing state transitions, leaving feature-branch code/baselines stranded).
- `latestFeedback` now finds the most recent feedback across `r`/`u`/`q` prefixes (was `r`-only).
- Reviewer skills (`-review`, `-ui-review`, `-qa`) reliably persist feedback under `.cloverleaf/feedback/` with an explicit `git add` + `git commit` after `write-feedback`.
- UI Reviewer's `compareVisual` paths explicitly rooted at `{{repo_root}}` (not the worktree) — prevents stray baselines in main repo during pipeline runs.
- Reviewer skills clean up `/tmp/cloverleaf-fb-*.json` at step 0 — prevents stale feedback from prior tasks bleeding into new runs.
- Skills no longer hardcode `~/.claude/plugins/cloverleaf/` paths. They use `$(cloverleaf-cli plugin-root)/...` — works under any install mode (npm install, `claude plugin install`, `--plugin-dir`, legacy symlinks).

### Changed
- Cloverleaf's own `.cloverleaf/config/ui-review.json` adds `axe.ignored` entries for pre-existing /guide/ `.step-meta` color-contrast violations (unblocks CLV-008-class tasks on /guide/).

## [0.4.0] — 2026-04-21

### Added
- Visual regression diffs via pixelmatch; baselines at `.cloverleaf/baselines/{route-slug}-{viewport}.png`, committed to git and updated on merge.
- Multi-viewport screenshot pass (mobile/tablet/desktop defaults, consumer-overridable).
- `config/ui-review.json` — new consumer-overridable config shipped as package default.
- `loadUiReviewConfig(repoRoot)` loader + `cloverleaf-cli ui-review-config` subcommand for prompt substitution.
- Configurable axe viewport coverage with `(ruleId, target)` dedupe; findings aggregate viewports into `metadata.viewports`.
- QA HTML report at `.cloverleaf/runs/{taskId}/qa/report.html`; report path surfaced via `finding.attachments`.
- `Finding.attachments` and `Finding.metadata` typed fields (requires `@cloverleaf/standard@^0.4.0`).

### Changed
- Package config defaults in `reference-impl/config/*.json` are now framework-generic. Cloverleaf's own site continues to work via `.cloverleaf/config/` consumer overrides (populated in v0.3.1).
- `@cloverleaf/standard` peer dep bumped from `^0.3.0` to `^0.4.0`.

### Breaking
- Removed deprecated loaders (already superseded in v0.3.1 by `loadXConfig(repoRoot)` equivalents):
  - `loadDefaultPatterns` → use `loadUiPathsConfig(repoRoot).patterns`
  - `loadDefaultRules` → use `loadQaRulesConfig(repoRoot)`
  - `loadDefaultConfig` → use `loadAffectedRoutesConfig(repoRoot)`

## [0.3.1] — 2026-04-20

### Added

- Consumer-override mechanism for all shipped configs. Place `<repoRoot>/.cloverleaf/config/<name>.json` to replace the package default (full replacement, no merge).
- New APIs with `repoRoot` parameter: `loadUiPathsConfig(repoRoot)`, `loadQaRulesConfig(repoRoot)`, `loadAffectedRoutesConfig(repoRoot)`.
- `contentRoutes` field in `affected-routes.json` — maps content-file globs to specific routes (e.g., `{"site/src/content/guide/**": "/guide/"}`). Evaluated after `pageRoots` and before the `routeScope` conservative fallback.
- UI Reviewer prompt checks `<repoRoot>/.cloverleaf/config/astro-base.json` before parsing `astro.config.*`.
- `/cloverleaf-qa` skill reads consumer `qa-rules.json` override if present.
- README: new "Customizing for your repo" section documenting the override mechanism.

### Changed

- CLI commands `detect-ui-paths` and `affected-routes` now pass `repoRoot` through to the new loaders — overrides take effect at the skill level.
- Package default `affected-routes.json` gains `contentRoutes: {}` field (empty; cloverleaf's own override populates it).

### Deprecated

- `loadDefaultPatterns()`, `loadDefaultRules()`, `loadDefaultConfig()` remain exported for one release as thin wrappers around the package defaults (bypass consumer overrides). Prefer the new `loadXConfig(repoRoot)` APIs. Deprecated wrappers will be removed in v0.4.

### Fixed

- **Architectural drift:** cloverleaf-specific defaults no longer dictate behavior for external consumers. The package remains usable as a reference implementation for other codebases.
- **Astro base path hardcoding:** no cloverleaf-specific base path ships in any package artifact. Consumers supply their own via `astro-base.json` or via parseable `astro.config.*`.

### Dependencies

- Unchanged: `@cloverleaf/standard@^0.3.0` (accepts Standard 0.3.1 automatically).

## [0.3.0] — 2026-04-20

### Added

- `affected-routes` CLI command — computes which site routes a task's diff affects. Outputs a JSON array, the string `"all"` (global change detected), or `[]` (no renderable routes).
- `lib/affected-routes.ts` — pure `computeAffectedRoutes` helper + `loadDefaultConfig`.
- `config/affected-routes.json` — default rules: page-root / global-pattern / route-scope. Consumer-overridable.
- UI Reviewer prompt placeholder `{{affected_routes}}`.
- Install script warns when Playwright chromium is not cached.
- CLI-level integration test for ui-review skip path.

### Changed

- UI Reviewer runs axe ONLY on pages in the task's affected-routes set. If the set is `[]`, the skill skips axe entirely and advances `ui-review → qa`. If `"all"`, the v0.2 crawl behavior applies (up to 20 pages reachable from `/`).
- `/cloverleaf-ui-review` skill sets `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` before subagent dispatch. Playwright resolves chromium from the shared user-level cache; ~300 MB download is one-time, not per run.
- Known-limitations section updated: diff-scoping + Playwright caching issues from v0.2 are closed; visual diff / multi-viewport deferred to v0.4.

### Fixed

- Pre-existing a11y violations on unrelated pages no longer bounce PRs that don't touch them (v0.2 known limitation; surfaced by CLV-003 dogfood).
- Playwright's ~300 MB chromium install is no longer repeated per `/cloverleaf-ui-review` invocation (v0.2 known limitation).

### Dependencies

- Unchanged: `@cloverleaf/standard@^0.3.0`, `playwright@^1.47.0`, `axe-core@^4.10.0`.

## [0.2.0] — 2026-04-20

### Added

- Documenter agent (`/cloverleaf-document`) — doc-only commits per file-path rules
- UI Reviewer agent (`/cloverleaf-ui-review`) — Playwright + axe-core accessibility review, single viewport
- QA agent (`/cloverleaf-qa`) — per-package test runner via `git worktree`
- `config/ui-paths.json` — configurable UI path glob patterns (default: `site/**`)
- `config/qa-rules.json` — configurable per-package test commands
- `lib/ui-paths.ts`, `lib/qa-rules.ts`, `lib/ports.ts` — supporting helpers
- `detect-ui-paths` CLI command
- `--prefix=<r|u|q>` flag on `write-feedback` CLI to disambiguate reviewer feedback files
- CLI-level integration test for full pipeline (`tests/e2e.full-pipeline.test.ts`)

### Changed

- `/cloverleaf-run` orchestrator is path-aware: reads `task.risk_class` to dispatch fast lane (`low`) or full pipeline (`high`)
- `/cloverleaf-implement` stops at `implementing` state for `risk_class: "high"` (Documenter runs next)
- `/cloverleaf-merge` branches on state: `automated-gates` → fast-lane `human_merge`; `final-gate` → `final_approval_gate` with richer summary
- `/cloverleaf-new-task` formalizes `risk_class` inference with explicit keyword list and `--risk=high|low` override
- Per-agent bounce budgets (3 each: Reviewer, UI Reviewer, QA) instead of single global counter
- CLI bin compiled to `.mjs` (was `.ts` via `tsx` shim)
- `npm test` now runs `tsc --noEmit` before vitest to enforce `@ts-expect-error` directives

### Fixed

- `ProjectDoc.name` is now required in TypeScript type (matches schema)
- Toy-repo `DEMO-RFC-001` is now a real file (was a phantom reference)

### Dependencies

- Added: `playwright@^1.47.0`, `axe-core@^4.10.0`
- Unchanged: `@cloverleaf/standard@^0.3.0`

### Known limitations (surfaced by dogfood run)

- UI Reviewer runs axe-core against the full rendered site, not the PR diff. Pre-existing accessibility violations on unrelated pages will bounce PRs that don't touch them. Workaround: the orchestrator operator can override the bounce when the findings are outside the diff (the feedback is still written to `.cloverleaf/feedback/<TASK-ID>-u<N>.json` for traceability). A diff-scoped UI Reviewer is planned for v0.3.
- Playwright's ~300MB browser install runs once per machine but is not cached across `git worktree`s — each UI Reviewer invocation runs `npm ci` inside the worktree which picks up the globally-installed browsers from `~/.cache/ms-playwright/`. Cache-aware install deferred to v0.3.

## [0.1.1] — 2026-04-20

Bug-fix release addressing issues surfaced by the v0.1.0 end-to-end demo and final code review.

### Fixed

- Auto-create `.cloverleaf/events/` and `.cloverleaf/feedback/` on first write (previously crashed with ENOENT in fresh consumer repos).
- `advanceStatus` is now atomic: the status event is emitted before the task file is saved, so a failed emit leaves the task unchanged. A failed save after a successful emit produces a clear "orphan event" error.
- Every write path now validates against the corresponding `@cloverleaf/standard` schema via the new `lib/validate.ts` (AJV). `saveTask`, `writeFeedback`, `emitStatusTransition`, and `emitGateDecision` throw on invalid input.
- Shared `formatReason` helper eliminates drift between the validator-input `reason` and the persisted `reason` on status-transition events.
- CLI `advance-status` now rejects `actor=system` with exit code 2 (previously silently cast to `agent`). `system` is not a valid actor for task transitions in the Standard's state machine.
- `tests/cli.test.ts` fixtures aligned with the real task + project schemas so they double as teaching examples.

### Changed

- **Branch topology:** state commits now land on `main`; feature branches (`cloverleaf/<task-id>`) carry only code. Skills handle the `git checkout main` transitions. The Reviewer never `git checkout`s — uses `git show` and `git worktree add` instead. See README "Branch topology".

### Added

- `reference-impl/lib/validate.ts` — shared AJV `validateOrThrow` helper loading all `@cloverleaf/standard` schemas once.
- `reference-impl/README.md` gains a "Branch topology" section.

## [0.1.0] — 2026-04-20

First release of the Cloverleaf reference implementation package.

### Added

- `@cloverleaf/reference-impl@0.1.0` — Tight-Loop reference implementation (Implementer + Reviewer) as Claude Code skills.
- Five skills: `/cloverleaf-new-task`, `/cloverleaf-implement`, `/cloverleaf-review`, `/cloverleaf-merge`, `/cloverleaf-run`.
- `lib/` TypeScript library for state + events + feedback + ID allocation.
- `install.sh` with user-level and project-local modes.
- `examples/toy-repo/` end-to-end demo.
- Targets L2 Exchange conformance of `@cloverleaf/standard@0.3.0`.

### Known gaps

- Documenter, UI Reviewer, QA, Researcher, Plan agents are stubbed (state transitions emitted, no work performed).
- No HTTP endpoints; L3 conformance deferred.
