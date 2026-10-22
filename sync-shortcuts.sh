#!/usr/bin/env bash
set -euo pipefail

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
REAL_UID=$(id -u "$REAL_USER")
USER_BUS="/run/user/$REAL_UID/bus"

as_user() {
    if [[ $EUID -eq 0 ]]; then
        sudo -u "$REAL_USER" env DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_BUS" XDG_RUNTIME_DIR="/run/user/$REAL_UID" "$@"
    else
        "$@"
    fi
}

echo "[+] Syncing universal shortcuts for $REAL_USER..."

# Alt+Tab across all workspaces
as_user gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
as_user gsettings set org.gnome.shell.app-switcher current-workspace-only false

# Screenshot & Window Close
as_user gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"
as_user gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# Custom Bindings (PowerToys OCR: Super+Shift+T, Emoji: Super+.)
MEDIA_KEYS="org.gnome.settings-daemon.plugins.media-keys"
CUSTOM_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

as_user gsettings set $MEDIA_KEYS custom-keybindings "['$CUSTOM_PATH/custom0/', '$CUSTOM_PATH/custom1/']"

as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" name "Windows OCR Text Extractor"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" command "$HOME/.local/bin/ocr-snip"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" binding "<Super><Shift>t"

as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" name "Emoji Board"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" command "gnome-characters"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" binding "<Super>period"

echo "✔ Shortcuts synced successfully!"
