---
name: cloverleaf-new-task
description: Scaffold a new Cloverleaf Task from a prose brief. Allocates next task ID, writes .cloverleaf/tasks/<PROJECT>-<NNN>.json. Usage — /cloverleaf-new-task "<brief>".
---

# Cloverleaf — new task

The user has invoked this skill with a brief. Your job: turn the brief into a structured Cloverleaf Task and write it to `.cloverleaf/tasks/`.

## Steps

1. Determine the active project. Run:
   ```
   ~/.claude/plugins/cloverleaf/bin/cloverleaf-cli infer-project <repo_root>
   ```
   where `<repo_root>` is the current working directory. On failure (no projects, or multiple projects), report the error and ask the user to specify `--project=<id>` or to create a project config first.

2. Allocate the next task ID:
   ```
   ~/.claude/plugins/cloverleaf/bin/cloverleaf-cli next-task-id <repo_root> --project=<project>
   ```
   Capture the output (e.g., `DEMO-002`).

3. Read the user's brief (the text passed as the skill argument).

4. Construct a Task JSON document with this shape (matches task.schema.json):
   ```json
   {
     "id": "<allocated-id>",
     "type": "task",
     "status": "pending",
     "owner": { "kind": "agent", "id": "implementer" },
     "project": "<project>",
     "title": "<concise title derived from brief>",
     "context": {},
     "acceptance_criteria": ["<criterion 1>", "<criterion 2>", "..."],
     "definition_of_done": ["<terminal statement of completion>"],
     "risk_class": "low"
   }
   ```

   Derive 2-5 acceptance criteria from the brief. Each must be verifiable. Derive one or more Definition of Done strings as an array.

5. Write the file to `<repo_root>/.cloverleaf/tasks/<allocated-id>.json`.

6. Commit: `git add .cloverleaf/tasks/<allocated-id>.json && git commit -m "cloverleaf: task <allocated-id>"`.

7. Report:
   - "Created `<allocated-id>` at `.cloverleaf/tasks/<allocated-id>.json`."
   - Show the generated acceptance criteria.
   - Suggest: "Review and edit the task if needed, then run `/cloverleaf-run <allocated-id>`."

## Rules

- Do not guess at acceptance criteria. If the brief is too vague (e.g., "make it faster" with no target), ask the user a clarifying question before writing the file.
- If the user's brief hints at complex/risky work (UI changes, breaking API, cross-project), set `risk_class: "high"` and mention it. Default is `"low"` for simple tasks.
