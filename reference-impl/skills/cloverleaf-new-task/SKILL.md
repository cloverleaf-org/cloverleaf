---
name: cloverleaf-new-task
description: Scaffold a new Cloverleaf Task from a prose brief. Allocates next task ID, writes .cloverleaf/tasks/<PROJECT>-<NNN>.json. Usage — /cloverleaf-new-task "<brief>".
---

# Cloverleaf — new task

The user has invoked this skill with a brief. Your job: turn the brief into a structured Cloverleaf Task and write it to `.cloverleaf/tasks/`.

## Steps

1. Determine the active project. Run:
   ```
   cloverleaf-cli infer-project <repo_root>
   ```
   where `<repo_root>` is the current working directory. On failure (no projects, or multiple projects), report the error and ask the user to specify `--project=<id>` or to create a project config first.

2. Allocate the next task ID:
   ```
   cloverleaf-cli next-task-id <repo_root> --project=<project>
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

7. **v0.4 scaffolding:** Ensure baseline and run directories are set up:
   ```bash
   # v0.4 scaffolding additions — baselines tracked, runs ephemeral
   mkdir -p <repo_root>/.cloverleaf/baselines
   mkdir -p <repo_root>/.cloverleaf/runs
   
   # Ensure .gitignore excludes runs/ (baselines ARE tracked, only runs is ephemeral)
   if ! grep -qE '^\.cloverleaf/runs/?$' <repo_root>/.gitignore 2>/dev/null; then
     echo '.cloverleaf/runs/' >> <repo_root>/.gitignore
   fi
   ```

8. Report:
   - "Created `<allocated-id>` at `.cloverleaf/tasks/<allocated-id>.json`."
   - Show the generated acceptance criteria.
   - Suggest: "Review and edit the task if needed, then run `/cloverleaf-run <allocated-id>`."

## Rules

- Do not guess at acceptance criteria. If the brief is too vague (e.g., "make it faster" with no target), ask the user a clarifying question before writing the file.
- **risk_class inference:** `risk_class` determines the Delivery pipeline (`"low"` → fast lane; `"high"` → full pipeline). Rules:
  1. If the user passed `--risk=high` or `--risk=low` as a flag on the skill invocation, honor it.
  2. Otherwise, set `risk_class: "high"` when the brief OR any acceptance criterion matches (case-insensitive) any of these keywords:
     `site/`, `UI`, `page`, `component`, `style`, `visual`, `layout`, `render`, `display`, `accessibility`, `a11y`, `responsive`, `.astro`, `.css`, `.html`
  3. Also set `risk_class: "high"` for breaking APIs or cross-project work (v0.1.1 behavior, retained).
  4. Default: `risk_class: "low"`.
- After writing the task, report the chosen risk_class and how it was determined, e.g.:
  > "Risk class: `high` → full pipeline (matched keyword `component` in acceptance criterion). Override with `--risk=low` if desired."
- Users can manually edit `risk_class` in the task JSON before running `/cloverleaf-run`.

## v0.4 artifacts

- `.cloverleaf/baselines/` is **tracked** in git; baseline PNGs travel with code.
- `.cloverleaf/runs/` is **gitignored**; each task's run artifacts (diffs, candidate screenshots, QA reports) are ephemeral.
