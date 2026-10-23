#!/usr/bin/env bash
# Export this machine's GNOME settings and extensions into the repo (`mk export`).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$REPO_DIR/config"
EXT_SETTINGS_DIR="$CONFIG_DIR/extension-settings"

# Personal home paths become __USER_HOME__ so dumps work for any account, and
# usage history (Run dialog commands, recent emojis) is left out of the repo.
dump() {
    dconf dump "$1" \
        | sed -E -e "s|$HOME|__USER_HOME__|g" -e '/^(command-history|recently-used)=/d'
}

# dconf folder holding an extension's settings: from the settings-schema in its
# metadata.json, or by convention the part of the UUID before the '@'.
ext_settings_path() {
    local uuid=$1 dir schema
    dir=$(gnome-extensions info "$uuid" 2>/dev/null | awk '/Path:/ { print $2 }')
    schema=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("settings-schema", ""))' \
        "$dir/metadata.json" 2>/dev/null || true)
    if [[ -n "$schema" ]]; then
        echo "/${schema//.//}/"
    else
        echo "/org/gnome/shell/extensions/${uuid%%@*}/"
    fi
}

echo "=== Syncing Local Settings to Repo ==="
mkdir -p "$CONFIG_DIR" "$EXT_SETTINGS_DIR"
dump /org/gnome/shell/ > "$CONFIG_DIR/gnome-shell-full.dconf"
dump /org/gnome/desktop/ > "$CONFIG_DIR/gnome-desktop-full.dconf"
dump /org/gnome/mutter/ > "$CONFIG_DIR/gnome-mutter-full.dconf"
dump /org/gnome/settings-daemon/plugins/media-keys/ > "$CONFIG_DIR/keybindings.dconf"

# Enabled extensions that actually work here, plus each one's settings.
# sync.sh installs and enables exactly this list, then loads these settings.
EXT_LIST="$CONFIG_DIR/enabled-extensions.txt"
{
    echo "# Extensions sync.sh installs and enables. Written by 'mk export'; edit freely."
    echo "# Missing ones are downloaded from extensions.gnome.org for your GNOME version."
} > "$EXT_LIST"
rm -f "$EXT_SETTINGS_DIR"/*.dconf
while IFS= read -r uuid; do
    state=$(gnome-extensions info "$uuid" 2>/dev/null | awk '/State:/ { print $2 }')
    case "$state" in
        ACTIVE|ENABLED|INACTIVE) ;;
        *) echo "    [*] Skipped $uuid (state: ${state:-unknown}, broken on this GNOME version?)"; continue ;;
    esac
    echo "$uuid" >> "$EXT_LIST"
    path=$(ext_settings_path "$uuid")
    settings=$(dump "$path")
    if [[ -n "$settings" ]]; then
        printf '# dconf path: %s\n%s\n' "$path" "$settings" > "$EXT_SETTINGS_DIR/$uuid.dconf"
        echo "    [+] $uuid ($(grep -c '=' <<< "$settings") settings)"
    else
        echo "    [+] $uuid (default settings)"
    fi
done < <(gnome-extensions list --enabled)

# Third-party extensions are no longer copied into the repo: sync.sh fetches
# them from extensions.gnome.org. Only this project's own extension lives here.
echo "Sync Complete! Review with: git -C \"$REPO_DIR\" diff --stat"
