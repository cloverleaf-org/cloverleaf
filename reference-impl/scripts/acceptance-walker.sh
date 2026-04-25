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
# This script validates:
#
#   1. Cycle detection on a clean Plan exits 0 silently.
#   2. dag-ready-tasks returns all peers when nothing has run yet.
#   3. dag-ready-tasks respects the maxConcurrent cap.
#   4. Walk-state write + read round-trips faithfully.
#   5. dag-ready-tasks subtracts running sessions from the slot count.
#   6. dag-ready-tasks returns nothing when every task is merged.
#   7. Cycle detection catches a hand-crafted 2-cycle.
#
# Run via `npm run acceptance:walker` from the reference-impl/ directory or
# directly: `bash scripts/acceptance-walker.sh`.
set -euo pipefail

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
echo
echo "Note: this script validates the walker's data plane (CLI subcommands +"
echo "walk-state semantics) against a synthetic Plan. The walker's full"
echo "Session-orchestration loop (claw-drive integration, final-gate Q&A,"
echo "escalation surfacing) is exercised by the manual dogfood — see"
echo "docs/superpowers/specs/2026-04-24-autonomous-dag-walk-design.md."
