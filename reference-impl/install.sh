#!/usr/bin/env bash
set -euo pipefail

# Cloverleaf Reference Impl installer.
#
# As of v0.4.0, cloverleaf installs as a proper Claude Code plugin via the
# `claude plugin` CLI. Point Claude Code at the cloverleaf repo root (where
# .claude-plugin/marketplace.json lives), then install the plugin from the
# resulting marketplace.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 'claude' CLI not found on PATH."
  echo "Install Claude Code first: https://docs.claude.com/claude-code"
  exit 1
fi

if [ ! -f "${REPO_ROOT}/.claude-plugin/marketplace.json" ]; then
  echo "error: ${REPO_ROOT}/.claude-plugin/marketplace.json not found."
  echo "This script expects to be run from inside a cloverleaf checkout."
  exit 1
fi

echo "Registering cloverleaf marketplace from ${REPO_ROOT}..."
claude plugin marketplace add "${REPO_ROOT}"

echo "Installing cloverleaf plugin..."
claude plugin install cloverleaf@cloverleaf-local

echo ""
echo "Cloverleaf installed. Slash commands:"
echo "  /cloverleaf-new-task   — scaffold a Task from a brief"
echo "  /cloverleaf-run        — full pipeline orchestrator"
echo "  /cloverleaf-implement  — run Implementer"
echo "  /cloverleaf-document   — run Documenter"
echo "  /cloverleaf-review     — run Reviewer"
echo "  /cloverleaf-ui-review  — run UI Reviewer (visual diff + multi-viewport + axe)"
echo "  /cloverleaf-qa         — run QA"
echo "  /cloverleaf-merge      — merge gate"
echo ""
echo "Restart any open Claude Code sessions to pick up the new skills."

# Post-install: warn about Playwright chromium if not cached
if [ ! -d "${HOME}/.cache/ms-playwright" ] || [ -z "$(ls -A "${HOME}/.cache/ms-playwright" 2>/dev/null)" ]; then
  echo ""
  echo "Note: UI Reviewer uses Playwright chromium. If you plan to run /cloverleaf-ui-review, install once with:"
  echo "  npx playwright install chromium"
fi
