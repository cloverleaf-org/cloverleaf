#!/usr/bin/env bash
set -euo pipefail

# Cloverleaf Reference Impl installer.
# Default: installs skills + CLI shim into ~/.claude/plugins/cloverleaf/.
# --project: installs locally into ./.claude/plugins/cloverleaf/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="user"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) MODE="project"; shift ;;
    --help|-h)
      echo "Usage: ./install.sh [--project]"
      echo "  --project: install locally in .claude/plugins/cloverleaf/"
      echo "  (default): install at ~/.claude/plugins/cloverleaf/"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 2 ;;
  esac
done

if [[ "$MODE" == "user" ]]; then
  INSTALL_ROOT="${HOME}/.claude/plugins/cloverleaf"
else
  INSTALL_ROOT="$(pwd)/.claude/plugins/cloverleaf"
fi

mkdir -p "${INSTALL_ROOT}/skills" "${INSTALL_ROOT}/prompts" "${INSTALL_ROOT}/bin"

# Symlink config directory
ln -sf "${SCRIPT_DIR}/config" "${INSTALL_ROOT}/config"

# Symlink skills
for f in "${SCRIPT_DIR}/skills/"*.md; do
  name="$(basename "$f")"
  ln -sf "$f" "${INSTALL_ROOT}/skills/${name}"
done

# Symlink prompts
for f in "${SCRIPT_DIR}/prompts/"*.md; do
  name="$(basename "$f")"
  ln -sf "$f" "${INSTALL_ROOT}/prompts/${name}"
done

# Write the CLI shim
cat > "${INSTALL_ROOT}/bin/cloverleaf-cli" <<EOF
#!/usr/bin/env bash
exec npx --yes tsx "${SCRIPT_DIR}/lib/cli.ts" "\$@"
EOF
chmod +x "${INSTALL_ROOT}/bin/cloverleaf-cli"

echo "Cloverleaf reference impl installed at: ${INSTALL_ROOT}"
echo "Skills available: $(ls "${INSTALL_ROOT}/skills" | wc -l | tr -d ' ')"
echo ""
echo "Add ${INSTALL_ROOT}/bin to your PATH if you want to invoke cloverleaf-cli directly,"
echo "or reference it by absolute path from your skill calls."

# Post-install: warn about Playwright chromium if not cached
if [ ! -d "${HOME}/.cache/ms-playwright" ] || [ -z "$(ls -A "${HOME}/.cache/ms-playwright" 2>/dev/null)" ]; then
  echo ""
  echo "Note: UI Reviewer uses Playwright chromium. If you plan to run /cloverleaf-ui-review, install once with:"
  echo "  npx playwright install chromium"
fi
