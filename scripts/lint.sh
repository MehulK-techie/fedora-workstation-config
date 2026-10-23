#!/usr/bin/env bash
# Syntax-check and lint every script in the repo (used by `just check` and CI).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SHELL_FILES=(*.sh scripts/*.sh bin/mk bin/mk-apps bin/mk-doctor bin/ocr-snip bin/mk-scratchpad)
PYTHON_FILES=(bin/camera-controls bin/show-shortcuts bin/mk-companion bin/mk-timer bin/mk-reminders bin/mk-power lib/mkworkstation/*.py)

for f in "${SHELL_FILES[@]}"; do
    bash -n "$f"
done
shellcheck "${SHELL_FILES[@]}"

for f in "${PYTHON_FILES[@]}"; do
    python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$f"
done

echo "✔ All ${#SHELL_FILES[@]} shell and ${#PYTHON_FILES[@]} Python scripts passed."
