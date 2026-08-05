---
name: cloverleaf-run
description: End-to-end orchestrator. Drives every task through one universal delivery council — implement (+ optional decisive plan-review) → documenting → council → final-gate/implementing/escalated. The lane is a risk_class profile selector (delivery-fast / delivery-full); security, UI, and QA are council members. Usage — /cloverleaf-run <TASK-ID>.
---

# Cloverleaf — run (orchestrator)

## Branch discipline

`<repo_root>` is `$(git rev-parse --show-toplevel)` of your current working directory. In walker context (Session B inside `$WORKTREE_ROOT`), this is the worktree path, NOT the primary repo. Pass `<repo_root>` explicitly to every `cloverleaf-cli` invocation, and run `git add .cloverleaf/ && git commit` from `<repo_root>` so state-advance commits land on the worktree's current branch (`cloverleaf/<TASK-ID>` in walker mode).

Do NOT `git checkout main` from a walker worktree — main is held by the primary repo. To compare against main, use `git diff main..HEAD` or `git show main:<path>`. Sub-skills run from the worktree's current branch and stay on it; the walker (in the primary repo) does the final merge to main itself after all tasks reach final-gate.

## Bounce budget

The delivery council owns the loop. `council_bounces` (max 3) counts council bounces back to the Implementer; `plan_review_bounces` (max 3) counts decisive plan-review bounces. On either cap, escalate (section 6). Security, UI, and QA are **council members**, not separate gates — there is no per-agent counter.

These counters live in-session (not persisted). Rerunning `/cloverleaf-run` resets.

## Steps

1. Capture TASK-ID. Initialize `council_bounces = 0`, `plan_review_bounces = 0`.

2. Load task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Verify `status === "pending"`. If not, report and stop. **Preflight:** `load-task` does not schema-validate. Before dispatching any agent, confirm the task document is schema-valid: `context.rfc` is present, and `risk_class` / `security_class` are `low` or `high`. An invalid task otherwise clears every precondition and fails at its first real transition — after the Implementer has already produced a branch and commits.

   If any `advance-status` later fails with `orphan event written to … but task save failed`, the event file it names records a transition that did not happen: delete that file before retrying, or the retry will number the next event around it.

3. **Tactical plan (+ optional decisive plan-review).**
   a. `cloverleaf-cli council-plan <repo_root> <TASK-ID> task.plan_review`. **A decisive `task.plan_review` is not currently wired — do not bind one.** `/cloverleaf-implement <TASK-ID>` always completes both advances (`pending → tactical-plan → implementing`) in a single dispatch and stops at `implementing`; there is no point at which a plan-review verdict can be applied. If a consumer's `.cloverleaf/config/council.json` bound `plan.mode === "decisive"` for this gate anyway, §3b's `cloverleaf-cli apply-council-verdict <repo_root> <TASK-ID> task.plan_review '<verdict>'` would fail — it requires the task to still be at `tactical-plan`, and by the time `/cloverleaf-implement` returns it is already at `implementing`. The shipped default binds no profile to `task.plan_review` (`plan.profile` is always `null` here), so this limitation does not affect the packaged pipeline; it is tracked as a follow-up, not built in this fix. Otherwise (no decisive plan-review bound — the shipped default) simply inline `/cloverleaf-implement <TASK-ID>`, which walks `pending → tactical-plan → implementing` and stops at `implementing`.
   b. **Reserved — not reachable today.** Applying a decisive `task.plan_review` verdict requires the task to still be at `tactical-plan`, and 3a never leaves it there under the current `/cloverleaf-implement`, so skip 3b unconditionally and continue to 3c. The bullets below record the intended reload logic for when a real stop-at-`tactical-plan` mode exists:
      - `implementing` (pass) → continue to 3c.
      - `pending` (bounce) → `plan_review_bounces += 1`; if `>= 3` escalate (section 6); else return to 3a.
      - `escalated` → stop and surface.
   c. Finish the Implementer (task at `implementing`), then reach `documenting` for **every** `risk_class`:
      - `risk_class: "high"` → run `/cloverleaf-document <TASK-ID>` (the Documenter adds doc commits and advances `implementing → documenting`).
      - `risk_class: "low"` (no docs) → the **runner** advances the state itself: `cloverleaf-cli advance-status <repo_root> <TASK-ID> documenting agent`, then commit (`git add .cloverleaf/ && (git diff --cached --quiet || git commit -m "cloverleaf: <TASK-ID> → documenting")`).

      Either way the task reaches `documenting` before §4a advances `documenting → council`.

4. **Delivery council.**
   a. Enter the phase: `cloverleaf-cli advance-status <repo_root> <TASK-ID> council agent`. Commit. (Council entry classifies security — a sensitive diff upgrades `security_class` to `high` so the blocking security member runs.)
   b. `cloverleaf-cli council-plan <repo_root> <TASK-ID> task.review`. The plan always carries a profile: the shipped default binds `task.review` to `delivery-fast` (`risk_class: low`) / `delivery-full` (`risk_class: high`); a consumer `.cloverleaf/config/council.json` overrides.
   c. Run the council members (section 7.2), reach the verdict (7.3 chair / 7.4 deterministic), and — **before** applying it — run the **baselines-hold check (section 4.1)**. Then, once cleared, `cloverleaf-cli apply-council-verdict <repo_root> <TASK-ID> task.review '<verdict>'`. Commit the remainder: `git add .cloverleaf/ && (git diff --cached --quiet || git commit -m "cloverleaf: <TASK-ID> council review (<verdict>)")`.

### 4.1 Baselines hold (before applying a council pass)

The collapse removed the old `ui-review → qa` hold that `baselines_pending` guarded; the hold moves to **council pass**. After the members run (the `ui` member captures baselines and, on new/resized baselines, sets `baselines_pending=true` via `write-ui-review-state` — that mechanism is unchanged), and **before** applying a council `pass` that would advance `council → final-gate`, read the ui-review state:

```bash
cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID>
```

- If the council verdict is `pass` **and** `baselines_pending` is `true`: do **NOT** apply the verdict. Surface to the human: "⏸ `<TASK-ID>` — new visual baselines need approval. Inspect the captured baseline images, then run `/cloverleaf-approve-baselines <TASK-ID>` (which clears `baselines_pending`) and re-run `/cloverleaf-run <TASK-ID>` — the `ui` member now passes and the council pass applies." Stop here (leave the task at `council`); the re-run re-dispatches the council with `baselines_pending=false`.
- Otherwise (`baselines_pending` is `false`, or the verdict is `bounce` / `escalate`): proceed to apply the verdict (step 4c). This is a runner **convention** — no FSM change, exactly as the old `ui-review → qa` hold was a convention. `/cloverleaf-approve-baselines` and the `write-baseline` guard are unchanged.

5. **Branch on the task's new status** (reload with `load-task`):
   - `final-gate` (pass) → run the advisory `final_gate` council (section 7.6) if bound, then inline `/cloverleaf-merge <TASK-ID>`.
   - `implementing` (bounce) → `council_bounces += 1`. If `>= 3`, escalate (section 6). Else return to 3c (re-implement; the batched council feedback is in `.cloverleaf/feedback/`).
   - `escalated` → stop and surface (`.cloverleaf/feedback/` + `.cloverleaf/runs/<TASK-ID>/council/task.review.json`).

### 6. Escalation

- `cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent`
- Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> escalated (bounce budget exhausted)"`.
- Report: "✗ Escalated `<TASK-ID>`. Review `.cloverleaf/feedback/` and either refine the task or take over manually. Counters: council_bounces=<N>, plan_review_bounces=<N>."

## 7. Delivery council mechanics

The council member-dispatch, verdict, and apply steps referenced by steps 3b / 4c / 5.

7.2 **Run the council members (verdict-only).** Re-run `cloverleaf-cli council-plan <repo_root> <TASK-ID> task.review` to get `plan.rounds`, `plan.aggregation`, `plan.on_round_bounce`, and (for a chair profile) `plan.chair`. For each round **in order**: dispatch **all active members in the round concurrently** — issue their Task-tool calls **in a single message** so the harness runs them in parallel — and capture each member's `{verdict, summary, findings}` envelope. Do **not** advance state (the task stays at `council` until you apply the verdict at step 4c). Rounds still run in sequence; only members *within* a round are concurrent. (Built-in members resolve to the shipped `reviewer`/`security-reviewer`/`ui-reviewer`/`qa` prompts by their `promptPath`; a custom role resolves to `.cloverleaf/prompts/<file>.md`.)

   **Dispatch conventions:** invoke the Task tool in foreground (default — never `run_in_background`); do not poll with foreground `sleep`. Substitute the five base tokens, plus every entry in that member's `substitutions` map from the plan:
   - `{{task}}`, `{{branch}}` (`cloverleaf/<TASK-ID>`), `{{base_branch}}` (`main`), `{{repo_root}}`, `{{diff}}` (`git diff main..cloverleaf/<TASK-ID> -- ':(exclude).cloverleaf/'`) — the five base tokens, always present.
   - `{{<key>}}` for every key in `substitutions`: `council-plan` resolves each member's extra tokens beyond the five base ones (e.g. `test_rules` for `reviewer`, `qa_rules` for `qa`, `affected_routes` and `ui_review_config` for `ui`; `security`'s map is empty — its prompt needs no extra tokens).
   - **`{{preview_port}}` — the one exception.** `ui-reviewer.md` declares it, but it is deliberately NOT in the plan's `substitutions`: planning must stay side-effect free and cannot allocate a port without one. When dispatching the `ui` member, the runner must allocate a free port itself and substitute `{{preview_port}}` before dispatch — the same way the standalone `cloverleaf-ui-review` skill does: `PREVIEW_PORT=$(node -e "const net=require('net');const s=net.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")`.

   Never dispatch a member with an unresolved `{{…}}` token: if a token the prompt declares is missing from `substitutions` (and it is not `{{preview_port}}` for `ui`, which the runner fills in itself), stop and report rather than letting the member improvise.

   Persist each member's envelope: `echo '<envelope>' > /tmp/clv-council-<member>.json && cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/clv-council-<member>.json --prefix=<prefix>`, where `<prefix>` is `r`/`s`/`u`/`q` for the built-ins and the **member id** for a custom role. Collect a members array `[{ "member": "<id>", "verdict": "<pass|bounce|escalate>", "blocking": <plan member blocking>, "weight": <plan member weight> }]`.

   **Short-circuit:** if any member returns `escalate`, stop immediately. Otherwise, after each round, if `plan.on_round_bounce === "stop"` and any **blocking** member in that round returned `bounce`, stop before the next round. Always finish the members already running in the current round (batched).

7.3 **Reach the council verdict.**
   - **If `plan.aggregation === "chair"`:**
     - If **any member returned `escalate`**, the council verdict is `{"verdict":"escalate","rule":"chair","rationale":"escalated by <escalating member ids>","members":[<members array>]}` — do **not** dispatch the chair (a member escalate is final; the chair may raise a bounce to escalate but can never lower one).
     - Else if **no blocking member bounced and none escalated** (all blocking members passed), the council verdict is `{"verdict":"pass","rule":"chair","rationale":"all blocking members passed; chair not convened","members":[<members array>],"forward":[]}` — do **not** dispatch the chair.
     - Otherwise (a blocking member bounced; no member escalated) **dispatch the chair.** Build enriched inputs `[{ "member", "verdict", "blocking", "weight", "envelope": <the member's /tmp/clv-council-<member>.json object> }]`; run `context=$(cloverleaf-cli chair-context '<enriched-inputs-json>')`. Dispatch the chair prompt at `plan.chair.promptPath` as a **read-only** foreground subagent, substituting `{{task}}`, `{{repo_root}}`, and `{{member_verdicts}}` = `$context`; capture its `{verdict, rationale, forward}` output. Then run `cloverleaf-cli chair-verdict '<chair-raw-json>' '<members-json>'` and capture the council verdict JSON.
   - **Else (deterministic):** map `plan.aggregation` to the CLI rule (a string passes through; `{ "quorum": k }` → `quorum:k`) and run `cloverleaf-cli aggregate-verdicts '<members-json>' <rule>`; capture the council verdict JSON.

7.4 **Apply.** After the baselines-hold check (section 4.1) clears, run `cloverleaf-cli apply-council-verdict <repo_root> <TASK-ID> task.review '<council-verdict-json>'`. The FSM walk may self-commit some transitions (e.g. `security_class → high`, the rework verdict-reset), so the wrap-up commit can find nothing staged — that is expected. Commit the remainder: `git add .cloverleaf/ && (git diff --cached --quiet || git commit -m "cloverleaf: <TASK-ID> council review (<verdict>)")`. The verdict drives the FSM: `pass` → `council → final-gate`; `bounce` → `council → implementing`; `escalate` → `council → escalated` (branch per step 5).

On a chair **bounce**, the result artifact's `forward` array names the members whose feedback the Implementer should prioritize; the chair `rationale` frames them. The council result artifact at `.cloverleaf/runs/<TASK-ID>/council/task.review.json` records per-member verdicts, the aggregate (or chair) verdict, `forward` (for a chair bounce), and the security basis (incl. an omitted or out-voted `security` member). On any member-dispatch failure or unparseable envelope, stop and report — never treat a failed member as a pass.

### 7.6 Advisory `final_gate` council (opt-in)

`final-gate` is the human merge pause. Before inlining `/cloverleaf-merge <TASK-ID>` at the final gate (step 5), check for an advisory council:

1. `cloverleaf-cli council-plan <repo_root> <TASK-ID> task.final_gate`.
2. If `plan.source !== "consumer"` or `plan.profile === null`, skip — proceed to the plain human merge (today's behavior).
3. Otherwise dispatch `plan.rounds` per §7.2 (parallel within a round), reviewing `{{diff}}` = `git diff main..cloverleaf/<TASK-ID> -- ':(exclude).cloverleaf/'`, and reach a verdict per §7.3 (chair) or §7.4-style `aggregate-verdicts` (deterministic). Then `cloverleaf-cli apply-council-verdict <repo_root> <TASK-ID> task.final_gate '<council-verdict-json>'`. This **posts** the advisory result to `.cloverleaf/runs/<TASK-ID>/council/task.final_gate.json` + a feedback envelope and **drives no transition** (the task stays at `final-gate`). Commit: `git add .cloverleaf/ && (git diff --cached --quiet || git commit -m "cloverleaf: <TASK-ID> advisory final_gate council (<verdict>)")`.
4. Surface the council verdict + rationale to the human at the merge confirmation. The human still drives `/cloverleaf-merge` (merge) or reject; the advisory council never merges.

`task.plan_review` (decisive, at `tactical-plan`) is **not currently wired** (see §3a/§3b); `task.final_gate` is advisory-only and post-only.

## Rules

- The delivery council owns the bounce loop: `council_bounces` (max 3) and `plan_review_bounces` (max 3). There is no per-agent counter — security, UI, and QA are members.
- On any sub-skill error or escalation, the orchestrator stops with a clear message.
- Human merge gate is NOT skipped; confirmation is still required at merge time.
- The baselines-hold is a convention: a council `pass` is held at `baselines_pending` until `/cloverleaf-approve-baselines <TASK-ID>` clears it and the council is re-run.
