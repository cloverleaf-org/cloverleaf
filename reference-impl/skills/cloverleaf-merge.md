---
name: cloverleaf-merge
description: Human gate for merging a Cloverleaf task. Advances automated-gates → merged via the human_merge gate, requires explicit user confirmation. Usage — /cloverleaf-merge <TASK-ID>.
---

# Cloverleaf — merge

## Steps

1. Capture the TASK-ID.

2. Load the task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Verify `status === "automated-gates"`. If not, report and stop.

3. Confirm with the user. Print:
   > "About to merge `<TASK-ID>`. Branch `cloverleaf/<TASK-ID>` has been reviewed and passed. Confirm merge? (y/N)"

   Wait for the user's reply. Only proceed on explicit `y`, `Y`, `yes`, or `YES`. Anything else: abort without state change.

4. On confirmation:
   - Emit the gate decision: `cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> human_merge approve human`. Note: decision is `approve` (not `approved` — per the gate-decision schema's enum).
   - Advance: `cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human human_merge fast_lane`.
   - Commit state: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> merged"`.

5. Report:
   - "✓ Merged `<TASK-ID>`. Branch `cloverleaf/<TASK-ID>` is ready for you to push and open a PR."
   - "Suggested: `git push origin cloverleaf/<TASK-ID>` then open a PR against `main`."

## Rules

- The skill does NOT push the branch or open a PR. That remains explicit to the user.
- The `merged` status in `.cloverleaf/` is the Cloverleaf-level record; the actual GitHub merge is the user's responsibility.
- If the user declines, no state change and no commit.
