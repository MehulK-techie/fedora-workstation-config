#!/usr/bin/env bash
set -e

echo "==> Syncing current GNOME & Workspace settings to repository..."
mkdir -p dconf
dconf dump /org/gnome/desktop/wm/keybindings/ > dconf/wm-keybindings.dconf
dconf dump /org/gnome/shell/extensions/ > dconf/extensions-config.dconf
echo "✔ Settings dumped successfully."
