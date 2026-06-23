#!/usr/bin/env bash
#
# v0.6 walker acceptance harness.
#
# Exercises the walker's data plane (lib/dag-walker.ts, lib/walk-state.ts, and
# the four `cloverleaf-cli` subcommands shipped in v0.6.0) against a synthetic
# 3-peer Plan. The walker SKILL.md itself is a markdown body that runs inside
# Session A's Claude when /cloverleaf-run-plan is invoked — that orchestration
# loop is exercised separately by the manual dogfood (see the spec at
# docs/superpowers/specs/2026-04-24-autonomous-dag-walk-design.md).
#
# Default scenario validates:
#
#   1. Cycle detection on a clean Plan exits 0 silently.
#   2. dag-ready-tasks returns all peers when nothing has run yet.
#   3. dag-ready-tasks respects the maxConcurrent cap.
#   4. Walk-state write + read round-trips faithfully.
#   5. dag-ready-tasks subtracts running sessions from the slot count.
#   6. dag-ready-tasks returns nothing when every task is merged.
#   7. Cycle detection catches a hand-crafted 2-cycle.
#
# Named scenarios (pass as first argument):
#
#   flow2-dogfood-repro  — Reproduces the Flow 2 (Under-classification at the door)
#                          sequence from the CLV-107 integration test. Exercises the
#                          advance-status security-gate refusal (exit code 2), writeback,
#                          and recovery sequence against a real git repo + CLI. Matches
#                          the load-bearing dogfood trail captured in
#                          tests/integration.security-gate.test.ts (Flow 2 describe block).
#
#   council-optin        — Exercises the opt-in council end-to-end against a real temp
#                          repo with a consumer .cloverleaf/config/council.json. Asserts
#                          council-plan reports source=consumer, apply-council-verdict
#                          drives a high-risk task to final-gate, and the council result
#                          artifact is written.
#
# Run via `npm run acceptance:walker` from the reference-impl/ directory or
# directly: `bash scripts/acceptance-walker.sh [scenario]`.
set -euo pipefail

# ---------------------------------------------------------------------------
# scenario: flow2-dogfood-repro
#
# Description
# -----------
# Reproduces the "Under-classification at the door" scenario that surfaced
# during the 2026-05-25 claw-crypto dogfood and is captured as the load-bearing
# Flow 2 integration test in reference-impl/tests/integration.security-gate.test.ts.
#
# What it demonstrates
# --------------------
# A task that was created with security_class="low" has a diff that touches a
# sensitive path (scripts/deploy.sh). The orchestrator attempts to advance the
# task directly to `merged` (fast-lane), bypassing the security-review state.
# The `advance-status` CLI:
#   1. Re-runs classify-security against the real git diff.
#   2. Detects the sensitive path → writes back security_class="high" (writeback).
#   3. Validates: security_class=high but security_review_verdict=null → refuses.
#   4. Exits with code 2 and a canonical error message naming the recovery action.
#
# Recovery sequence:
#   1. Orchestrator reads exit-2 → advances to security-review.
#   2. Security Reviewer runs, sets verdict=pass via set-task-field.
#   3. Advance security-review → automated-gates.
#   4. Retry: advance automated-gates → merged. Verdict=pass → guard allows.
#   5. Task reaches status=merged.
#
# Mirrors CLV-107 Flow 2 integration test
# ----------------------------------------
# This scenario exercises the exact same sequence as the "dogfood: low-declared
# task with sensitive diff is refused, upgraded, then recovers to merged" test
# case in tests/integration.security-gate.test.ts. The key difference: the
# integration test uses __setMockChangedFiles (an in-process testing seam),
# while this scenario uses a real git repo and a real committed sensitive file.
#
# Assertions (all must pass for exit 0)
# --------------------------------------
#   A1. advance-status automated-gates→merged exits non-zero (refusal).
#   A2. Exit code of the refused advance is 2.
#   A3. Refusal stderr contains "SECURITY_GATE" or "security_review_verdict".
#   A4. Task security_class was written back to "high" after refusal.
#   A5. Recovery set-task-field exits 0.
#   A6. Final advance-status automated-gates→merged exits 0 (pass).
#   A7. Task status is "merged" at end.
#   A8. Task security_review_verdict is "pass" at end.
# ---------------------------------------------------------------------------
run_council_optin() {
  echo "=== Scenario: council-optin ==="
  REPO="$(mktemp -d -t cloverleaf-council-optin.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT
  mkdir -p "$REPO/.cloverleaf/tasks" "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/config"

  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'JSON'
{ "id": "DEMO-001", "type": "task", "status": "review", "project": "DEMO", "title": "t",
  "owner": { "kind": "agent", "id": "unassigned" }, "context": { "rfc": { "project": "DEMO", "id": "DEMO-RFC-001" } },
  "acceptance_criteria": ["a"], "definition_of_done": ["d"], "risk_class": "high" }
JSON

  cat > "$REPO/.cloverleaf/config/council.json" <<'JSON'
{ "profiles": { "lean": { "rounds": [[{ "member": "reviewer" }, { "member": "qa" }]], "aggregation": "any-veto" } },
  "gates": { "task.review": "lean" } }
JSON

  COUNCIL_PLAN_OUT="$(cloverleaf-cli council-plan "$REPO" DEMO-001 task.review --changed-files=)"
  SRC="$(python3 -c "import json,sys; d=json.loads('$COUNCIL_PLAN_OUT'.strip()); print(d.get('source',''))" 2>/dev/null || \
    node -e "const d=JSON.parse(process.env.COUNCIL_PLAN_OUT||'{}'); process.stdout.write(d.source||'')" <<< "" )"
  [ "$SRC" = "consumer" ] || { echo "FAIL: expected source=consumer, got '$SRC'"; exit 1; }
  echo "✓ council-plan reports source=consumer"

  VERDICT='{"verdict":"pass","rule":"any-veto","rationale":"ok","members":[{"member":"reviewer","verdict":"pass"},{"member":"qa","verdict":"pass"}]}'
  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.review "$VERDICT" > /dev/null

  STATUS="$(python3 -c "import json,sys; d=json.load(open('$REPO/.cloverleaf/tasks/DEMO-001.json')); print(d.get('status',''))" 2>/dev/null || \
    node -e "const d=require('$REPO/.cloverleaf/tasks/DEMO-001.json'); process.stdout.write(d.status||'')")"
  [ "$STATUS" = "final-gate" ] || { echo "FAIL: expected final-gate, got '$STATUS'"; exit 1; }
  echo "✓ apply-council-verdict advanced task to final-gate"

  [ -f "$REPO/.cloverleaf/runs/DEMO-001/council/task.review.json" ] || { echo "FAIL: council result artifact missing"; exit 1; }
  echo "✓ council result artifact exists"

  echo "=== council-optin: all assertions passed ==="
}

run_flow2_dogfood_repro() {
  echo "=== Scenario: flow2-dogfood-repro ==="
  echo "Reproducing Flow 2 (Under-classification at the door) end-to-end."
  echo "Mirrors: tests/integration.security-gate.test.ts 'Flow 2' describe block."
  echo

  # ---- Setup: create a minimal git repo ----
  local REPO
  REPO="$(mktemp -d -t cloverleaf-flow2-repro.XXXXXX)"
  # Expand REPO now so the trap string carries the literal path, not the
  # variable name (local variables are not in scope when EXIT fires).
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT

  # Initialise git so advance-status can run git diff against a real branch.
  # Use -b main explicitly so the default branch is 'main' regardless of the
  # system's init.defaultBranch config (some systems default to 'master').
  git -C "$REPO" init -q -b main 2>/dev/null || {
    # Older git versions (<2.28) don't support -b; rename after init.
    git -C "$REPO" init -q
    git -C "$REPO" symbolic-ref HEAD refs/heads/main
  }
  git -C "$REPO" config user.email "acceptance@cloverleaf.test"
  git -C "$REPO" config user.name "Acceptance Test"

  # Create the .cloverleaf structure.
  mkdir -p "$REPO/.cloverleaf/projects" "$REPO/.cloverleaf/tasks"
  mkdir -p "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/feedback"
  printf '{"key":"DEMO","name":"Demo Project"}' > "$REPO/.cloverleaf/projects/DEMO.json"

  # Seed task: low-classified at automated-gates (simulating the dogfood state).
  # security_class="low" declared, security_review_verdict absent (null equivalent).
  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'TASKEOF'
{
  "id": "DEMO-001",
  "type": "task",
  "status": "automated-gates",
  "owner": {"kind": "agent", "id": "unassigned"},
  "project": "DEMO",
  "title": "Dogfood reproduction task",
  "context": {"rfc": {"project": "DEMO", "id": "DEMO-RFC-001"}},
  "acceptance_criteria": ["Flow 2 recovery succeeds"],
  "definition_of_done": ["Task reaches merged"],
  "risk_class": "low",
  "security_class": "low",
  "security_review_verdict": null
}
TASKEOF

  # Commit the initial state on main.
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "chore: initial repo state"

  # Create the feature branch with a sensitive file in its diff.
  # scripts/deploy.sh matches "**/deploy*.sh" in config/security-paths.json.
  git -C "$REPO" checkout -q -b cloverleaf/DEMO-001
  mkdir -p "$REPO/scripts"
  printf '#!/bin/bash\necho "Deploying..."\n' > "$REPO/scripts/deploy.sh"
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "feat: add deploy script"

  # Return to main so advance-status can run 'git diff main..cloverleaf/DEMO-001'.
  git -C "$REPO" checkout -q main

  echo "Temp repo: $REPO"
  echo "Feature branch 'cloverleaf/DEMO-001' contains: scripts/deploy.sh"
  echo "Task starts at status=automated-gates, security_class=low, verdict=null"
  echo

  # ---- Step 1: Attempt advance automated-gates → merged (fast-lane) ----
  # Expected: exit 2 (SECURITY_GATE refusal). The advance-status CLI re-runs
  # classify-security, detects scripts/deploy.sh → upgrades to high → refuses.
  echo "Step 1: attempting advance-status automated-gates → merged (fast-lane)..."
  REFUSAL_STDERR=""
  REFUSAL_EXIT=0
  REFUSAL_STDERR_FILE="$(mktemp)"
  cloverleaf-cli advance-status "$REPO" DEMO-001 merged human human_merge fast_lane \
    2>"$REFUSAL_STDERR_FILE" || REFUSAL_EXIT=$?
  REFUSAL_STDERR="$(cat "$REFUSAL_STDERR_FILE")"
  rm -f "$REFUSAL_STDERR_FILE"

  # A1: must exit non-zero.
  if [[ "$REFUSAL_EXIT" -eq 0 ]]; then
    echo "FAIL [A1]: advance-status should have been refused but exited 0"
    exit 1
  fi
  echo "✓ A1. advance-status refused (non-zero exit)"

  # A2: must exit with code 2.
  if [[ "$REFUSAL_EXIT" -ne 2 ]]; then
    echo "FAIL [A2]: expected exit code 2 (SECURITY_GATE), got $REFUSAL_EXIT"
    exit 1
  fi
  echo "✓ A2. exit code is 2 (SECURITY_GATE)"
  echo "  [refusal evidence] stderr: $REFUSAL_STDERR"

  # A3: stderr must mention security_gate or security_review_verdict.
  if ! echo "$REFUSAL_STDERR" | grep -qiE 'security_review_verdict|security.?gate|security-gate'; then
    echo "FAIL [A3]: refusal stderr does not mention security_review_verdict or security-gate"
    echo "  got: $REFUSAL_STDERR"
    exit 1
  fi
  echo "✓ A3. refusal stderr contains security-gate evidence"

  # A4: security_class must have been written back to "high".
  SECURITY_CLASS="$(python3 -c "import json,sys; d=json.load(open('$REPO/.cloverleaf/tasks/DEMO-001.json')); print(d.get('security_class',''))" 2>/dev/null || \
    node -e "const d=require('$REPO/.cloverleaf/tasks/DEMO-001.json'); process.stdout.write(d.security_class||'')")"
  if [[ "$SECURITY_CLASS" != "high" ]]; then
    echo "FAIL [A4]: expected security_class=high after writeback, got: $SECURITY_CLASS"
    exit 1
  fi
  echo "✓ A4. security_class written back to 'high' (classify-security diff-detected scripts/deploy.sh)"

  # ---- Recovery sequence ----
  echo
  echo "Recovery sequence:"

  # Recovery step 1: advance to security-review (unconditional edge — no security_gate).
  echo "  Recovery 1: advance automated-gates → security-review..."
  cloverleaf-cli advance-status "$REPO" DEMO-001 security-review agent
  echo "  ✓ advanced to security-review"

  # Recovery step 2: Security Reviewer writes verdict=pass.
  echo "  Recovery 2: set-task-field security_review_verdict=pass..."
  SET_EXIT=0
  cloverleaf-cli set-task-field "$REPO" DEMO-001 security_review_verdict pass || SET_EXIT=$?

  # A5: set-task-field must exit 0.
  if [[ "$SET_EXIT" -ne 0 ]]; then
    echo "FAIL [A5]: set-task-field exited $SET_EXIT, expected 0"
    exit 1
  fi
  echo "  ✓ A5. set-task-field exited 0"

  # Recovery step 3: advance security-review → automated-gates.
  echo "  Recovery 3: advance security-review → automated-gates..."
  cloverleaf-cli advance-status "$REPO" DEMO-001 automated-gates agent
  echo "  ✓ advanced to automated-gates"

  # Recovery step 4: retry advance automated-gates → merged (fast-lane).
  # Verdict=pass, security_class=high → guard allows.
  echo "  Recovery 4: retry advance automated-gates → merged (fast-lane)..."
  RETRY_EXIT=0
  cloverleaf-cli advance-status "$REPO" DEMO-001 merged human human_merge fast_lane || RETRY_EXIT=$?

  # A6: retry must exit 0.
  if [[ "$RETRY_EXIT" -ne 0 ]]; then
    echo "FAIL [A6]: retry advance-status exited $RETRY_EXIT, expected 0"
    exit 1
  fi
  echo "✓ A6. retry advance-status exited 0 (guard passed: verdict=pass)"

  # ---- Final assertions ----
  FINAL_STATUS="$(python3 -c "import json,sys; d=json.load(open('$REPO/.cloverleaf/tasks/DEMO-001.json')); print(d.get('status',''))" 2>/dev/null || \
    node -e "const d=require('$REPO/.cloverleaf/tasks/DEMO-001.json'); process.stdout.write(d.status||'')")"
  FINAL_VERDICT="$(python3 -c "import json,sys; d=json.load(open('$REPO/.cloverleaf/tasks/DEMO-001.json')); print(d.get('security_review_verdict',''))" 2>/dev/null || \
    node -e "const d=require('$REPO/.cloverleaf/tasks/DEMO-001.json'); process.stdout.write(String(d.security_review_verdict)||'')")"

  # A7: status must be merged.
  if [[ "$FINAL_STATUS" != "merged" ]]; then
    echo "FAIL [A7]: expected status=merged, got: $FINAL_STATUS"
    exit 1
  fi
  echo "✓ A7. task status is 'merged'"

  # A8: verdict must be pass.
  if [[ "$FINAL_VERDICT" != "pass" ]]; then
    echo "FAIL [A8]: expected security_review_verdict=pass, got: $FINAL_VERDICT"
    exit 1
  fi
  echo "✓ A8. security_review_verdict is 'pass'"

  echo
  echo "=== flow2-dogfood-repro: all 8 assertions passed ==="
  echo "  [refusal observed]  exit code 2 + security-gate stderr (A1–A3)"
  echo "  [writeback observed] security_class upgraded to 'high' (A4)"
  echo "  [recovery succeeded] task reached status='merged' with verdict='pass' (A5–A8)"
}

# ---------------------------------------------------------------------------
# Scenario dispatch
# ---------------------------------------------------------------------------
case "${1:-default}" in
  flow2-dogfood-repro)
    run_flow2_dogfood_repro
    exit 0
    ;;
  council-optin)
    run_council_optin
    exit 0
    ;;
  default|"")
    : # fall through to default scenario below
    ;;
  *)
    echo "Unknown scenario: $1"
    echo "Available scenarios: flow2-dogfood-repro, council-optin"
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# Default scenario (no argument given)
# ---------------------------------------------------------------------------

REPO="$(mktemp -d -t cloverleaf-walker-acceptance.XXXXXX)"
trap 'rm -rf "$REPO"' EXIT

mkdir -p "$REPO/.cloverleaf/projects" "$REPO/.cloverleaf/plans" "$REPO/.cloverleaf/tasks"

cat > "$REPO/.cloverleaf/projects/ACC.json" <<'EOF'
{"key": "ACC", "name": "Acceptance Test"}
EOF

# Three disjoint peer tasks, no edges. Mirrors the v0.6 default scenario:
# walker spawns 3 parallel sessions when max_concurrent >= 3.
cat > "$REPO/.cloverleaf/plans/ACC-1.json" <<'EOF'
{
  "type": "plan",
  "project": "ACC",
  "id": "ACC-1",
  "status": "gate-approved",
  "owner": {"kind": "agent", "id": "plan"},
  "parent_rfc": {"project": "ACC", "id": "ACC-0"},
  "task_dag": {
    "nodes": [
      {"project": "ACC", "id": "ACC-2"},
      {"project": "ACC", "id": "ACC-3"},
      {"project": "ACC", "id": "ACC-4"}
    ],
    "edges": []
  },
  "tasks": []
}
EOF

for ID in ACC-2 ACC-3 ACC-4; do
  cat > "$REPO/.cloverleaf/tasks/$ID.json" <<EOF
{
  "id": "$ID",
  "type": "task",
  "status": "pending",
  "owner": {"kind": "agent", "id": "unassigned"},
  "project": "ACC",
  "title": "Acceptance task $ID",
  "context": {"rfc": {"project": "ACC", "id": "ACC-0"}},
  "acceptance_criteria": ["Pass acceptance"],
  "definition_of_done": ["Done"],
  "risk_class": "low"
}
EOF
done

echo "Acceptance scratch repo: $REPO"
echo

# --- 1. cycle detection on clean plan ---
if ! cloverleaf-cli dag-detect-cycle "$REPO" ACC-1; then
  echo "FAIL: dag-detect-cycle should exit 0 on clean Plan"
  exit 1
fi
echo "✓ 1. dag-detect-cycle on clean Plan: exit 0"

# --- 2. ready tasks returns all 3 roots with max=3 ---
READY=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 3 | sort)
EXPECTED=$(printf "ACC-2\nACC-3\nACC-4")
if [[ "$READY" != "$EXPECTED" ]]; then
  echo "FAIL: ready (max=3) returned:"
  echo "$READY"
  echo "expected:"
  echo "$EXPECTED"
  exit 1
fi
echo "✓ 2. dag-ready-tasks (max=3): all 3 peers returned"

# --- 3. concurrency cap with max=2 ---
COUNT=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 2 | wc -l)
if [[ "$COUNT" -ne 2 ]]; then
  echo "FAIL: ready (max=2) returned $COUNT tasks, expected 2"
  exit 1
fi
echo "✓ 3. dag-ready-tasks (max=2): 2 tasks returned (cap honoured)"

# --- 4. walk-state write + read round-trip ---
cat > "$REPO/walk-state-input.json" <<'EOF'
{
  "plan_id": "ACC-1",
  "started": "2026-04-24T00:00:00Z",
  "max_concurrent": 3,
  "tasks": {
    "ACC-2": {
      "state": "running",
      "session_id": "sess_test",
      "started_at": "2026-04-24T00:00:01Z",
      "last_seq": 0
    }
  }
}
EOF
cloverleaf-cli walk-state-write "$REPO" "$REPO/walk-state-input.json"
ROUND=$(cloverleaf-cli walk-state-read "$REPO" ACC-1 | jq -r '.tasks["ACC-2"].state')
if [[ "$ROUND" != "running" ]]; then
  echo "FAIL: walk-state round-trip read=$ROUND, expected=running"
  exit 1
fi
echo "✓ 4. walk-state-write + walk-state-read: round-trip clean"

# --- 5. running session is subtracted from slot count ---
READY=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 3 | sort)
EXPECTED=$(printf "ACC-3\nACC-4")
if [[ "$READY" != "$EXPECTED" ]]; then
  echo "FAIL: with ACC-2 running, ready (max=3)=$READY, expected=$EXPECTED"
  exit 1
fi
echo "✓ 5. slot accounting: ACC-2 running → only ACC-3 ACC-4 returned"

# --- 6. all merged → empty ready set ---
cat > "$REPO/walk-state-input.json" <<'EOF'
{
  "plan_id": "ACC-1",
  "started": "2026-04-24T00:00:00Z",
  "max_concurrent": 3,
  "tasks": {
    "ACC-2": {"state": "merged", "session_id": "s1", "merged_at": "2026-04-24T00:01:00Z", "merge_commit": "abc"},
    "ACC-3": {"state": "merged", "session_id": "s2", "merged_at": "2026-04-24T00:01:01Z", "merge_commit": "def"},
    "ACC-4": {"state": "merged", "session_id": "s3", "merged_at": "2026-04-24T00:01:02Z", "merge_commit": "ghi"}
  }
}
EOF
cloverleaf-cli walk-state-write "$REPO" "$REPO/walk-state-input.json"
READY=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 3 || true)
if [[ -n "$READY" ]]; then
  echo "FAIL: all tasks merged but dag-ready-tasks emitted: $READY"
  exit 1
fi
echo "✓ 6. all-merged: dag-ready-tasks emits empty set"

# --- 7. cycle detection catches a 2-cycle ---
cat > "$REPO/.cloverleaf/plans/BAD-1.json" <<'EOF'
{
  "type": "plan",
  "project": "ACC",
  "id": "BAD-1",
  "status": "gate-approved",
  "owner": {"kind": "agent", "id": "plan"},
  "parent_rfc": {"project": "ACC", "id": "ACC-0"},
  "task_dag": {
    "nodes": [
      {"project": "ACC", "id": "ACC-2"},
      {"project": "ACC", "id": "ACC-3"}
    ],
    "edges": [
      {"from": {"project": "ACC", "id": "ACC-2"}, "to": {"project": "ACC", "id": "ACC-3"}},
      {"from": {"project": "ACC", "id": "ACC-3"}, "to": {"project": "ACC", "id": "ACC-2"}}
    ]
  },
  "tasks": []
}
EOF
if cloverleaf-cli dag-detect-cycle "$REPO" BAD-1 >/dev/null 2>&1; then
  echo "FAIL: cycle in BAD-1 not detected"
  exit 1
fi
echo "✓ 7. dag-detect-cycle on 2-cycle: exits non-zero"

echo
echo "All 7 walker acceptance checks passed."

# ---------------------------------------------------------------------------
# Bug-fix regression checks (CLV-39)
# These are static grep checks that guard against regressions in the fixes
# merged for bugs #1, #2, and #4 discovered during the v0.6 Walker Dogfood
# (RFC CLV-30).  They run at the end of the acceptance harness so that the
# data-plane checks above always complete first.
# ---------------------------------------------------------------------------

# Locate the reference-impl root relative to this script (works when invoked
# from any cwd: via `npm run acceptance:walker` or directly).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFIMPL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo
echo "--- Bug-fix regression checks (CLV-39) ---"
echo

# --- 8. Bug #1: walker WT path uses XDG_CACHE_HOME pattern, not /tmp/ ---
#
# The SKILL.md for cloverleaf-run-plan previously used `/tmp/cl-review-<id>`
# paths (the same pattern used by reviewer/QA for their ephemeral worktrees).
# That caused INVALID_CWD failures because the walker's own worktrees are
# long-lived and must not live under /tmp (gets cleaned by the OS mid-run).
# Fix: the SKILL.md now uses `${XDG_CACHE_HOME:-$HOME/.cache}/cloverleaf/...`.
#
# Static check: assert the XDG_CACHE_HOME pattern is present in SKILL.md AND
# that no bare `/tmp/` worktree add pattern exists for the walker's WT
# variable (reviewer/QA use /tmp legitimately for their short-lived worktrees,
# so we check only the WT assignment line).

SKILL_MD="$REFIMPL_DIR/skills/cloverleaf-run-plan/SKILL.md"

if ! grep -qE '\$\{XDG_CACHE_HOME:-\$HOME/.cache\}/cloverleaf/walker' "$SKILL_MD"; then
  echo "FAIL [bug #1]: SKILL.md does not contain the XDG_CACHE_HOME walker WT pattern"
  echo "  expected: \${XDG_CACHE_HOME:-\$HOME/.cache}/cloverleaf/walker/<...>"
  echo "  file: $SKILL_MD"
  exit 1
fi
echo "✓ 8. [bug #1] SKILL.md uses XDG_CACHE_HOME for walker WT path (not /tmp/)"

# Secondary check: the WT= assignment must NOT use /tmp as the base.
# (A line like `WT="/tmp/..."` would be the regression.)
if grep -E '^\s*WT="?/tmp/' "$SKILL_MD" >/dev/null 2>&1; then
  echo "FAIL [bug #1]: SKILL.md still has a WT=/tmp/... assignment — regression detected"
  echo "  file: $SKILL_MD"
  exit 1
fi
echo "✓ 8b.[bug #1] SKILL.md has no WT=/tmp/... assignment"

# --- 9. Bug #2: reviewer.md and qa.md must not use 'git worktree add … main' ---
#
# The original reviewer/QA prompts told agents to run:
#   git worktree add /tmp/cl-review-<id> main          # named branch
# This fails when 'main' (or the feature branch) is already checked out in
# another worktree (the walker worktree).  The fix switched to:
#   git worktree add --detach "$TMPDIR" "$SHA"          # detached at a SHA
# Static check: no 'git worktree add' line should end with 'main' as the
# branch argument (allowing for optional flags between 'add' and 'main').

REVIEWER_MD="$REFIMPL_DIR/prompts/reviewer.md"
QA_MD="$REFIMPL_DIR/prompts/qa.md"

# Pattern: 'git worktree add' followed by anything then whitespace+'main' at
# end of token (but NOT 'main's or 'mainRoot' — we only care about the git
# ref argument).  We use a strict regex to avoid false positives.
WORKTREE_ADD_MAIN_PATTERN='git worktree add[^`\n]*[[:space:]]main([[:space:]]|`|$)'

if grep -P "$WORKTREE_ADD_MAIN_PATTERN" "$REVIEWER_MD" >/dev/null 2>&1; then
  echo "FAIL [bug #2]: reviewer.md still contains 'git worktree add … main' (named-branch form)"
  grep -nP "$WORKTREE_ADD_MAIN_PATTERN" "$REVIEWER_MD"
  exit 1
fi
echo "✓ 9. [bug #2] reviewer.md: no 'git worktree add … main' pattern found"

if grep -P "$WORKTREE_ADD_MAIN_PATTERN" "$QA_MD" >/dev/null 2>&1; then
  echo "FAIL [bug #2]: qa.md still contains 'git worktree add … main' (named-branch form)"
  grep -nP "$WORKTREE_ADD_MAIN_PATTERN" "$QA_MD"
  exit 1
fi
echo "✓ 9b.[bug #2] qa.md: no 'git worktree add … main' pattern found"

# Complementary check: both files must contain '--detach' (the corrected form).
if ! grep -q '\-\-detach' "$REVIEWER_MD"; then
  echo "FAIL [bug #2]: reviewer.md does not contain '--detach' — fix may be missing"
  exit 1
fi
if ! grep -q '\-\-detach' "$QA_MD"; then
  echo "FAIL [bug #2]: qa.md does not contain '--detach' — fix may be missing"
  exit 1
fi
echo "✓ 9c.[bug #2] reviewer.md and qa.md both use '--detach' (corrected worktree form)"

# --- 10. Bug #4: prep-worktree walker-mode (node_modules resolution) ---
#
# Bug: cloverleaf-cli prep-worktree threw "main missing standard/node_modules"
# when passed a walker worktree as mainRoot, because a walker worktree has no
# node_modules of its own — the actual node_modules live in the primary repo
# that contains the walker worktree as a child path.
# Fix (CLV-37): prep-worktree now walks up the directory tree from mainRoot
# until it finds an ancestor with both standard/node_modules and
# reference-impl/node_modules, then uses that as the effective primary root.
#
# Static check: verify the fix is present in the source file.

PREP_WORKTREE_SRC="$REFIMPL_DIR/lib/prep-worktree.ts"

if ! grep -q 'findPrimaryRoot' "$PREP_WORKTREE_SRC"; then
  echo "FAIL [bug #4]: prep-worktree.ts does not contain 'findPrimaryRoot' — walker-mode fix absent"
  echo "  file: $PREP_WORKTREE_SRC"
  exit 1
fi
echo "✓ 10. [bug #4] prep-worktree.ts contains findPrimaryRoot (walker-mode walk-up fix)"

# Live invocation check: build a synthetic walker-worktree filesystem layout
# and call `cloverleaf-cli prep-worktree` with the walker worktree path as
# mainRoot. This mirrors the exact scenario that caused the bug in production:
# the orchestrator passes the walker's own worktree (no node_modules) as
# mainRoot; the fix must walk up to the primary repo to find them.

PRIMARY_ROOT="$(mktemp -d -t cl-prepwt-primary.XXXXXX)"
WALKER_WT="$PRIMARY_ROOT/walkers/acc-walker-wt"
TARGET_WT="$(mktemp -d -t cl-prepwt-target.XXXXXX)"

cleanup_prepwt() {
  rm -rf "$PRIMARY_ROOT" "$TARGET_WT"
}
# Stack cleanup on top of the existing EXIT trap without losing the REPO cleanup.
OLD_TRAP="$(trap -p EXIT | sed "s/trap -- '//;s/' EXIT//")"
trap 'cleanup_prepwt; '"$OLD_TRAP" EXIT

# Primary repo: has node_modules.
mkdir -p "$PRIMARY_ROOT/standard/node_modules/some-dep"
printf '{"name":"some-dep"}' > "$PRIMARY_ROOT/standard/node_modules/some-dep/package.json"
printf '{"name":"@cloverleaf/standard","version":"0.0.0-acctest","scripts":{"build":"mkdir -p dist && echo acctest > dist/marker.txt"}}' \
  > "$PRIMARY_ROOT/standard/package.json"

mkdir -p "$PRIMARY_ROOT/reference-impl/node_modules/@cloverleaf"
ln -s '../../../standard' "$PRIMARY_ROOT/reference-impl/node_modules/@cloverleaf/standard"
mkdir -p "$PRIMARY_ROOT/reference-impl/node_modules/vitest"
printf '{"name":"vitest"}' > "$PRIMARY_ROOT/reference-impl/node_modules/vitest/package.json"
printf '{"name":"@cloverleaf/reference-impl","version":"0.0.0-acctest"}' \
  > "$PRIMARY_ROOT/reference-impl/package.json"

# Walker worktree: source files but NO node_modules (the bug scenario).
mkdir -p "$WALKER_WT/standard"
printf '{"name":"@cloverleaf/standard","version":"0.0.0-acctest","scripts":{"build":"mkdir -p dist && echo acctest > dist/marker.txt"}}' \
  > "$WALKER_WT/standard/package.json"
mkdir -p "$WALKER_WT/reference-impl"
printf '{"name":"@cloverleaf/reference-impl","version":"0.0.0-acctest"}' \
  > "$WALKER_WT/reference-impl/package.json"

# Target worktree to be prepped.
mkdir -p "$TARGET_WT/standard"
printf '{"name":"@cloverleaf/standard","version":"0.0.0-acctest","scripts":{"build":"mkdir -p dist && echo acctest > dist/marker.txt"}}' \
  > "$TARGET_WT/standard/package.json"
mkdir -p "$TARGET_WT/reference-impl"
printf '{"name":"@cloverleaf/reference-impl","version":"0.0.0-acctest"}' \
  > "$TARGET_WT/reference-impl/package.json"

# Invoke prep-worktree with the walker worktree (no node_modules) as mainRoot.
if ! cloverleaf-cli prep-worktree "$WALKER_WT" "$TARGET_WT" 2>&1; then
  echo "FAIL [bug #4]: cloverleaf-cli prep-worktree failed when mainRoot is a walker worktree"
  echo "  mainRoot (walker wt, no node_modules): $WALKER_WT"
  echo "  targetWt: $TARGET_WT"
  echo "  primary repo (has node_modules):       $PRIMARY_ROOT"
  exit 1
fi

# Assert the target worktree was populated correctly.
if [[ ! -f "$TARGET_WT/standard/node_modules/some-dep/package.json" ]]; then
  echo "FAIL [bug #4]: standard/node_modules not copied to target worktree"
  exit 1
fi
if [[ ! -f "$TARGET_WT/standard/dist/marker.txt" ]]; then
  echo "FAIL [bug #4]: standard/dist not built in target worktree"
  exit 1
fi
if [[ ! -f "$TARGET_WT/reference-impl/node_modules/vitest/package.json" ]]; then
  echo "FAIL [bug #4]: reference-impl/node_modules not copied to target worktree"
  exit 1
fi
echo "✓ 10b.[bug #4] prep-worktree succeeds with walker-worktree mainRoot; target correctly populated"

echo
echo "All 10 walker acceptance checks passed (7 data-plane + 3 bug-fix regressions)."
echo
echo "Note: this script validates the walker's data plane (CLI subcommands +"
echo "walk-state semantics) against a synthetic Plan, and guards the v0.6"
echo "walker dogfood bug fixes (CLV-39: bugs #1, #2, #4) via static grep +"
echo "a live prep-worktree invocation. The walker's full Session-orchestration"
echo "loop (claw-drive integration, final-gate Q&A, escalation surfacing) is"
echo "exercised by the manual dogfood — see"
echo "docs/superpowers/specs/2026-04-24-autonomous-dag-walk-design.md."
