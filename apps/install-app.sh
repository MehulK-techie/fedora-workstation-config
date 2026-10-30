#!/bin/bash
# Shared by apps/*/install.sh: install ONE MK app for this user, without the
# rest of the workstation. Never needs root.
#
#   APP_BIN       the program in bin/ (linked into ~/.local/bin)
#   APP_ID        its desktop id (assets/applications/APP_ID.desktop, icon
#                 assets/icons/APP_ID.svg)
#   APP_GI        "Namespace:version ..." typelibs it imports
#   APP_PY        Python modules it imports (besides gi)
#   APP_CMDS      programs it needs on PATH
#   APP_OPTIONAL  "program:what it's for ..." programs it can do without
#   APP_DIRS      folders under $HOME it keeps its files in
#   APP_PKGS      the Fedora packages that provide all of the above
#
# The program is copied to ~/.local/bin and MK's Python library to
# ~/.local/share/mk-workstation/lib (where the programs look for it), as
# sync.sh does, so the two never fight over the same files. Run it again
# after a git pull to update; safe to run any number of times.
set -euo pipefail
: "${APP_BIN:?}" "${APP_ID:=}" "${APP_GI:=}" "${APP_PY:=}" "${APP_CMDS:=}" "${APP_OPTIONAL:=}" "${APP_DIRS:=}" \
  "${APP_PKGS:=}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"

missing=()
for spec in $APP_GI; do
    ns=${spec%%:*} ver=${spec##*:}
    python3 -c "import gi; gi.require_version('$ns', '$ver'); from gi.repository import $ns" 2> /dev/null \
        || missing+=("typelib $ns $ver")
done
for mod in python3 $APP_PY; do
    [[ "$mod" == python3 ]] && { command -v python3 > /dev/null || missing+=("python3"); continue; }
    python3 -c "import $mod" 2> /dev/null || missing+=("python module $mod")
done
for cmd in $APP_CMDS; do
    command -v "$cmd" > /dev/null || missing+=("program $cmd")
done
if ((${#missing[@]})); then
    echo "[-] $APP_BIN needs: ${missing[*]}" >&2
    echo "    Install them with: sudo dnf install $APP_PKGS" >&2
    exit 1
fi
for opt in $APP_OPTIONAL; do
    command -v "${opt%%:*}" > /dev/null || echo "    [*] optional: ${opt%%:*} (${opt#*:})"
done

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
for d in $APP_DIRS; do mkdir -p "$HOME/$d"; done
LIB_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/mk-workstation/lib"
mkdir -p "$LIB_DIR"
[[ -L "$BIN_DIR/$APP_BIN" ]] && rm -f "$BIN_DIR/$APP_BIN"   # an older link-style install
cp -f "$REPO/bin/$APP_BIN" "$BIN_DIR/$APP_BIN"
chmod +x "$BIN_DIR/$APP_BIN"
rm -rf "$LIB_DIR/mkworkstation.new"
cp -r "$REPO/lib/mkworkstation" "$LIB_DIR/mkworkstation.new"
rm -rf "$LIB_DIR/mkworkstation"
mv "$LIB_DIR/mkworkstation.new" "$LIB_DIR/mkworkstation"
if [[ -f "$REPO/assets/applications/$APP_ID.desktop" ]]; then
    sed "s|@BIN@|$BIN_DIR|" "$REPO/assets/applications/$APP_ID.desktop" > "$APP_DIR/$APP_ID.desktop"
    cp -f "$REPO/assets/icons/$APP_ID.svg" "$ICON_DIR/" 2> /dev/null || true
    update-desktop-database "$APP_DIR" &> /dev/null || true
    gtk-update-icon-cache -q -t "${ICON_DIR%/scalable/apps}" &> /dev/null || true
fi
echo "✔ $APP_BIN installed: $BIN_DIR/$APP_BIN${APP_ID:+ (app grid: $APP_ID)}"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "    [*] add $BIN_DIR to your PATH to run it by name" ;; esac
