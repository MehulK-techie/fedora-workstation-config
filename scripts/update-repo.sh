#!/usr/bin/env bash
# Export this machine's GNOME settings and extensions into the repo (`mk export`).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$REPO_DIR/config"
USER_EXT_DIR="$HOME/.local/share/gnome-shell/extensions"

# Personal home paths become __USER_HOME__ so dumps work for any account, and
# usage history (Run dialog commands, recent emojis) is left out of the repo.
dump() {
    dconf dump "$1" \
        | sed -E -e "s|$HOME|__USER_HOME__|g" -e '/^(command-history|recently-used)=/d' \
        > "$CONFIG_DIR/$2"
}

echo "=== Syncing Local Settings to Repo ==="
mkdir -p "$CONFIG_DIR"
dump /org/gnome/shell/ gnome-shell-full.dconf
dump /org/gnome/desktop/ gnome-desktop-full.dconf
dump /org/gnome/mutter/ gnome-mutter-full.dconf
dump /org/gnome/settings-daemon/plugins/media-keys/ keybindings.dconf
gnome-extensions list --enabled > "$CONFIG_DIR/enabled-extensions.txt"

# Refresh bundled copies one extension at a time. Never wipe extensions/:
# it also holds this project's own mk-indicator, which may not be installed here.
if [[ -d "$USER_EXT_DIR" ]]; then
    for ext in "$USER_EXT_DIR"/*/; do
        uuid=$(basename "$ext")
        rm -rf "${REPO_DIR:?}/extensions/$uuid"
        cp -r "$ext" "$REPO_DIR/extensions/$uuid"
    done
fi
echo "Sync Complete!"
