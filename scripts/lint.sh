#!/usr/bin/env bash
# Syntax-check and lint every script in the repo (used by `just check` and CI).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Every script in bin/ and assets/libexec/, sorted by its shebang, so a new
# one is checked without being listed here.
SHELL_FILES=(*.sh scripts/*.sh docs/overview/*.sh)
PYTHON_FILES=(lib/mkworkstation/*.py docs/overview/*.py)
for f in bin/* assets/libexec/*; do
    [[ -f "$f" ]] || continue
    case "$(head -n 1 "$f")" in
        *python3*) PYTHON_FILES+=("$f") ;;
        *bash*) SHELL_FILES+=("$f") ;;
    esac
done

for f in "${SHELL_FILES[@]}"; do
    bash -n "$f"
done
shellcheck "${SHELL_FILES[@]}"

for f in "${PYTHON_FILES[@]}"; do
    python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$f"
done

echo "✔ All ${#SHELL_FILES[@]} shell and ${#PYTHON_FILES[@]} Python scripts passed."
