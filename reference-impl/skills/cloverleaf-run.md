---
name: cloverleaf-run
description: End-to-end orchestrator. Loops implement → review → (bounce ↻ implement) → pause at human merge gate. Max 3 bounces before escalation. Usage — /cloverleaf-run <TASK-ID>.
---

# Cloverleaf — run (orchestrator)

## Branch discipline

The orchestrator runs each sub-skill with the assumption that the working tree starts on `main`. Between steps, confirm the branch is main before proceeding. The Implementer step leaves the user on main after its internal `git checkout main`; the Reviewer and Merge steps start on main.

## Steps

1. Capture the TASK-ID.

2. Load the task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Verify `status === "pending"`. If not, report and stop — suggest the user run individual skills instead.

3. Loop, up to `MAX_BOUNCES = 3`:

   a. Invoke `/cloverleaf-implement <TASK-ID>` (inline the steps from that skill — do not actually call the slash command recursively).

   b. Invoke `/cloverleaf-review <TASK-ID>`.

   c. Re-load the task. If `status === "automated-gates"` — pass! Break out of the loop.

   d. Else if `status === "implementing"` — bounce. Increment bounce counter. If counter == MAX_BOUNCES, escalate (step 5) and stop.

   e. Else — unexpected state. Report and stop.

4. On pass: invoke `/cloverleaf-merge <TASK-ID>`, which prompts the user for confirmation.

5. On max bounces exceeded:
   - `cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent`.
   - Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> escalated after 3 bounces"`.
   - Report: "✗ Escalated `<TASK-ID>` after 3 bounces. Review the feedback files under `.cloverleaf/feedback/` and either refine the task or take over manually."

## Rules

- MAX_BOUNCES is hardcoded to 3 for v0.1.0.
- The orchestrator does not skip the human_merge gate; the user's confirmation is still required at merge time.
- If ANY individual skill reports an error or stops, the orchestrator also stops with a clear message.
