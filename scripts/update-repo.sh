#!/usr/bin/env bash
# Export this machine's GNOME settings and extensions into the repo (`mk export`).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$REPO_DIR/config"
EXT_SETTINGS_DIR="$CONFIG_DIR/extension-settings"

# Personal home paths become __USER_HOME__ so dumps work for any account.
# Left out of the repo: usage history (Run dialog commands, recent emojis),
# machine-specific disk IDs (Astra Monitor's storage-main), and runtime state
# that must not be restored elsewhere (Tiling Assistant's backup of GNOME's own
# keys and version marker, Caffeine's current on/off state, Space Bar's workspace names).
dump() {
    dconf dump "$1" \
        | sed -E -e "s|$HOME|__USER_HOME__|g" \
            -e '/^(command-history|recently-used|storage-main|overridden-settings|last-version-installed|user-enabled|workspace-names-map)=/d'
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

# The curated extensions (the seven MK uses) that are enabled and work here, plus each one's
# settings. Anything else you have on stays on this machine and out of the repo.
MK_OWN=" mk-shell-engine@mehulk mk-indicator@mehulk wack-sonoma-lockscreen@rinzler69-wastaken.github.com "
CURATED="$MK_OWN blur-my-shell@aunetx caffeine@patapon.info text-extractor@imshaaz21.github.com touchpad-gesture-customization@coooolapps.com "
EXT_LIST="$CONFIG_DIR/enabled-extensions.txt"
{
    echo "# The third-party extensions MK uses (sync.sh installs them on a fresh install, from"
    echo "# extensions.gnome.org for your GNOME version). MK's own three come from this repo."
    echo "# Written by 'mk export' (only these curated ones are ever listed)."
} > "$EXT_LIST"
rm -f "$EXT_SETTINGS_DIR"/*.dconf
while IFS= read -r uuid; do
    state=$(gnome-extensions info "$uuid" 2>/dev/null | awk '/State:/ { print $2 }')
    [[ "$CURATED" == *" $uuid "* ]] || continue
    case "$state" in
        ACTIVE|ENABLED|INACTIVE) ;;
        *) echo "    [*] Skipped $uuid (state: ${state:-unknown}, broken on this GNOME version?)"; continue ;;
    esac
    [[ "$MK_OWN" == *" $uuid "* ]] || echo "$uuid" >> "$EXT_LIST"
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
