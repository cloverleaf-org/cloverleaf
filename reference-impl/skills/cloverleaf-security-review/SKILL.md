---
name: cloverleaf-security-review
description: Run the Security Reviewer council member on a task's feature branch as a standalone one-off. Hybrid two-pass (deterministic secret scan + LLM vulnerability judgment). Emit-only — it records the `security_review_verdict`, writes a feedback envelope, and reports the verdict (pass/bounce/escalate) for the delivery council or a human to apply. It does NOT advance the task FSM. Usage — /cloverleaf-security-review <TASK-ID>.
---

# Cloverleaf — security review (emit-only council member)

The delivery states `security-review`/`automated-gates` no longer exist — the `@cloverleaf/standard` task FSM
collapsed them into a single `council` phase (Council Slice 4). The Security Reviewer is now a **council member**
that the runner (`/cloverleaf-run`) dispatches; its blocking verdict gates the aggregated council result. A single
member cannot drive the multi-member council to merge, so this standalone skill is **emit-only**: it runs the two
passes against the task's branch, records the `security_review_verdict`, emits the feedback envelope, and reports
the verdict. **It does not advance the FSM** — the council or a human applies the aggregated verdict via
`apply-council-verdict` (which is what advances `council → final-gate`/`implementing`/`escalated` and records the
authoritative security backstop for high-security tasks).

## Steps

0. Pre-flight: stay on the current branch (do NOT checkout main in walker worktrees). Clean stale temp:
   ```bash
   rm -f /tmp/cloverleaf-fb-s.json
   ```

1. Capture the TASK-ID argument.

2. Load the task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Light guard only: confirm the task exists and is not terminal (`merged`/`rejected`/`escalated`). Do NOT hard-require any particular state — this skill reviews the branch, not a specific FSM state. If the task is terminal, report the current status and stop.

3. Confirm the branch `cloverleaf/<TASK-ID>` exists: `git rev-parse --verify cloverleaf/<TASK-ID>`. If missing, report the discrepancy and stop. Compute the diff for the subagent (do NOT check out): `git diff main..cloverleaf/<TASK-ID>`.

4. **Pass A — deterministic secret scan:**
   ```bash
   cloverleaf-cli secret-scan <repo_root> --branch cloverleaf/<TASK-ID>
   ```
   Capture the `findings[]` array (each has `severity` of `error`/`blocker`, plus `rule`, `message`, `location`).

5. **Pass B — LLM judgment:** dispatch a subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/security-reviewer.md` with substitutions for `{{task}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{diff}}`.

   **Dispatch conventions:** invoke the Task tool in foreground mode (its default — do NOT pass `run_in_background: true`). The Task tool returns the subagent's final message as a string in the result. Do NOT use Bash `sleep` to poll an output file — the harness blocks foreground `sleep`, and background dispatch is unnecessary here because the foreground Task tool already blocks until the subagent finishes.

   Parse the subagent's feedback envelope (`verdict` + `findings[]`).

6. **Merge + derive verdict.** Concatenate Pass A findings + Pass B findings into one `findings[]`. Derive the final verdict from the max severity across ALL findings:
   - any `blocker` → `verdict: "escalate"`
   - else any `error` or `warning` → `verdict: "bounce"`
   - else (only `info`, or none) → `verdict: "pass"`

7. **Emit the verdict + envelope (no FSM advance).**

   Record the member's `security_review_verdict` on the task (a live field the council's `council → final-gate` backstop reads for high-security tasks), then emit the merged feedback envelope. **Never call `advance-status`** — the council/human applies the aggregated verdict.

   **Pass:**
   ```bash
   cloverleaf-cli set-task-field <repo_root> <TASK-ID> security_review_verdict pass
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security_review_verdict → pass"
   ```
   Report: "✓ Security Reviewer verdict: **pass**. Recorded `security_review_verdict=pass`. This is one council member's verdict — the delivery council (`/cloverleaf-run <TASK-ID>`) or a human applies the aggregated verdict (`apply-council-verdict`); this skill does not advance the FSM."

   **Bounce:**
   ```bash
   echo '<merged-envelope-json>' > /tmp/cloverleaf-fb-s.json
   cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-s.json --prefix=s
   git -C <repo_root> add .cloverleaf/feedback/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review feedback"
   cloverleaf-cli set-task-field <repo_root> <TASK-ID> security_review_verdict bounce
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security_review_verdict → bounce"
   ```
   Report: "✗ Security Reviewer verdict: **bounce**. Findings: <summarize by severity>. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-s<N>.json`. The delivery council or a human applies the verdict (a council bounce loops the task back to `implementing`); this skill does not advance the FSM."

   **Escalate (blocker found):**
   ```bash
   echo '<merged-envelope-json>' > /tmp/cloverleaf-fb-s.json
   cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-s.json --prefix=s
   git -C <repo_root> add .cloverleaf/feedback/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review feedback"
   cloverleaf-cli set-task-field <repo_root> <TASK-ID> security_review_verdict escalate
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security_review_verdict → escalate"
   ```
   Report: "⚠ Security Reviewer verdict: **escalate** — a BLOCKER was found. Recorded `security_review_verdict=escalate` and emitted feedback to `.cloverleaf/feedback/<TASK-ID>-s<N>.json`. A human MUST review `.cloverleaf/feedback/` before this can proceed. The council or a human applies the verdict (a council escalate is un-lowerable → `escalated`); this skill does not advance the FSM."

## Rules

- Never push. Read-only on source — the security reviewer does not modify code.
- A `blocker` (e.g. a leaked credential) ALWAYS yields an `escalate` verdict; never let a bounce loop silently "fix" it. The council/human enforces the terminal escalation.
- Emit-only: never call `advance-status`. This is one council member's verdict; the council/human applies it.
