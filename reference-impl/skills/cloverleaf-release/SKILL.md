---
name: cloverleaf-release
description: Publish a new @cloverleaf/reference-impl release. Runs pre-flight checks, displays the 5-command release plan, and executes git tag -a / git push origin main / git push origin <tag> / npm publish / gh release create. Accepts [--dry-run] [--yes] flags.
---

# Cloverleaf — release

The user has invoked this skill, optionally with `--dry-run` and/or `--yes`.

## Args

- `--dry-run` — print the pre-flight check list and the 5-command release plan, then exit 0 without executing any release command.
- `--yes` — skip the interactive `y/N` prompt and execute the 5 commands unattended.

## Steps

1. **Parse flags.** Extract `--dry-run` and `--yes` from the invocation arguments if present.

2. **Capture the repo root.**

   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel)
   ```

3. **Run pre-flight checks.**

   ```bash
   PREFLIGHT=$(cloverleaf-cli release-preflight "$REPO_ROOT" --json)
   ```

   Parse the JSON. Extract `version`, `tag`, and `notes`.

4. **Display pre-flight check list.** For each check in `checks[]`:

   - Status `pass` → prefix `✓`
   - Status `fail` and level `warning` → prefix `⚠`
   - Status `fail` and level `blocking` → prefix `✗`

   Print one line per check: `<prefix> <id>: <message>`

5. **Bail on any blocking failure.**

   If any check has `level === "blocking"` and `status === "fail"`, print:

   ```
   ✗ Pre-flight failed — fix the issues above before releasing.
   ```

   And exit 1.

6. **Display release plan.**

   Print:

   ```
   Release plan for <tag>:
     1. git tag -a <tag> -m "Release <tag>"
     2. git push origin main
     3. git push origin <tag>
     4. cd reference-impl && npm publish --access public
     5. gh release create <tag> --notes-file /tmp/release-notes-$VERSION.md

   Version: <version>
   Notes preview:
   <notes (first 10 lines or "(no notes)" if empty)>
   ```

7. **If `--dry-run`:** Print `Dry run complete — no release commands executed.` and exit 0.

8. **If not `--yes`:** Prompt:

   ```
   Proceed with release of <tag>? (y/N)
   ```

   Read a single line from the user. If the response is not `y` or `Y`, print `Aborted.` and exit 0.

9. **Write the release notes file.**

   ```bash
   VERSION=<version>
   printf '%s' "$NOTES" > /tmp/release-notes-$VERSION.md
   ```

10. **Execute the 5 release commands sequentially, bail-fast on first non-zero exit.**

    ```bash
    git tag -a "reference-impl-v$VERSION" -m "Release reference-impl-v$VERSION"
    git push origin main
    git push origin "reference-impl-v$VERSION"
    cd reference-impl && npm publish --access public
    gh release create "reference-impl-v$VERSION" --notes-file "/tmp/release-notes-$VERSION.md"
    ```

    If any command fails, print `✗ Release failed at step N: <command>` and exit 1.

11. **Report success.**

    ```
    ✓ Released reference-impl-v<version>
    ```

## Rules

- Never skip pre-flight checks, even with `--yes`.
- Warning-level check failures (`⚠`) do not block execution — they are informational only.
- Do NOT modify `.cloverleaf/` — this skill only releases, it does not change task state.
- The skill's working directory is the consumer's repo root.
- Do not use hardcoded plugin paths — use `cloverleaf-cli` for all CLI invocations.
