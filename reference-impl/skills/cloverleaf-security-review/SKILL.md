---
name: cloverleaf-security-review
description: Run the Security Reviewer agent on a task in the `security-review` state. Hybrid two-pass (deterministic secret scan + LLM vulnerability judgment); emits a feedback envelope; advances to automated-gates (pass), implementing (bounce), or escalated (blocker). Usage — /cloverleaf-security-review <TASK-ID>.
---

# Cloverleaf — security review

## Steps

0. Pre-flight: stay on the current branch (do NOT checkout main in walker worktrees). Clean stale temp:
   ```bash
   rm -f /tmp/cloverleaf-fb-s.json
   ```

1. Capture the TASK-ID argument.

2. Load the task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Verify `status === "security-review"`. If not, report the current status and stop.

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
   Parse the subagent's feedback envelope (`verdict` + `findings[]`).

6. **Merge + derive verdict.** Concatenate Pass A findings + Pass B findings into one `findings[]`. Derive the final verdict from the max severity across ALL findings:
   - any `blocker` → `verdict: "escalate"`
   - else any `error` or `warning` → `verdict: "bounce"`
   - else (only `info`, or none) → `verdict: "pass"`

7. **Branch on verdict:**

   **Pass:**
   ```bash
   cloverleaf-cli set-task-field <repo_root> <TASK-ID> security_review_verdict pass
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security_review_verdict → pass"
   cloverleaf-cli advance-status <repo_root> <TASK-ID> automated-gates agent
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review passed → automated-gates"
   ```
   Report: "✓ Security review passed. State → automated-gates."

   **Bounce:**
   ```bash
   echo '<merged-envelope-json>' > /tmp/cloverleaf-fb-s.json
   cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-s.json
   git -C <repo_root> add .cloverleaf/feedback/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review feedback"
   cloverleaf-cli set-task-field <repo_root> <TASK-ID> security_review_verdict bounce
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security_review_verdict → bounce"
   cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review bounced → implementing"
   ```
   Report: "✗ Security review bounced. Findings: <summarize by severity>. State → implementing."

   **Escalate (blocker found):**
   ```bash
   echo '<merged-envelope-json>' > /tmp/cloverleaf-fb-s.json
   cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-s.json
   git -C <repo_root> add .cloverleaf/feedback/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review feedback"
   cloverleaf-cli set-task-field <repo_root> <TASK-ID> security_review_verdict escalate
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security_review_verdict → escalate"
   cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent
   git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> security review escalated (blocker finding)"
   ```
   Report: "⚠ Security review found a BLOCKER. State → escalated. A human must review `.cloverleaf/feedback/` before this can proceed."

## Rules

- Never push. Read-only on source — the security reviewer does not modify code.
- A `blocker` (e.g. a leaked credential) ALWAYS escalates to a human; never let the bounce loop silently "fix" it.
- On illegal state transition, report and stop without partial commits.
