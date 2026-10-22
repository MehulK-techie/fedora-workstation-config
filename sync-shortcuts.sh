#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: Universal Keybindings, Ergonomics & Performance Sync
# ==============================================================================
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

echo "[+] Syncing ergonomic workstation keybindings for $REAL_USER..."

# ------------------------------------------------------------------------------
# 1. Zen Browser Protection: Release Ctrl+Alt+Arrow from GNOME
# ------------------------------------------------------------------------------
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Page_Up', '<Super><Alt>Left']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Page_Down', '<Super><Alt>Right']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-up "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-down "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Super><Shift>Page_Up', '<Super><Shift><Alt>Left']"
as_user gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Super><Shift>Page_Down', '<Super><Shift><Alt>Right']"
as_user gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-up "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-down "[]"

# ------------------------------------------------------------------------------
# 2. Window Switching & Screenshot Mechanics
# ------------------------------------------------------------------------------
# Universal Alt+Tab (All workspaces, individual windows)
as_user gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
as_user gsettings set org.gnome.shell.app-switcher current-workspace-only false

# Screenshot Controls: Instant full capture on Print, selection on Shift+Print
as_user gsettings set org.gnome.shell.keybindings screenshot "['Print']"
as_user gsettings set org.gnome.shell.keybindings screenshot-window "['<Alt>Print']"
as_user gsettings set org.gnome.shell.keybindings show-screenshot-ui "['<Shift>Print', '<Super><Shift>s']"

# Ergonomic Window Close
as_user gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# ------------------------------------------------------------------------------
# 3. Custom Utilities Registration (OCR Snip, HUD, Clipboard)
# ------------------------------------------------------------------------------
MEDIA_KEYS="org.gnome.settings-daemon.plugins.media-keys"
CUSTOM_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

as_user gsettings set $MEDIA_KEYS custom-keybindings "['$CUSTOM_PATH/custom0/', '$CUSTOM_PATH/custom1/', '$CUSTOM_PATH/custom2/']"

# Custom 0: Interactive PowerToys-Style OCR Extractor
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" name "Windows OCR Text Extractor"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" command "$HOME/.local/bin/ocr-snip"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" binding "<Super><Shift>t"

# Custom 1: Emoji Board
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" name "Emoji Board"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" command "gnome-characters"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" binding "<Super>period"

# Custom 2: Workstation Shortcuts HUD
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" name "Workstation Shortcuts HUD"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" command "$HOME/.local/bin/show-shortcuts"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" binding "<Super>slash"

# ------------------------------------------------------------------------------
# 4. Multitasking Performance Tuning (Eliminate Overview Stutter)
# ------------------------------------------------------------------------------
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.overview blur false 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.appfolder blur false 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.dash-to-dock blur true 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.panel blur true 2>/dev/null || true
as_user gsettings set org.gnome.mutter experimental-features "['scale-monitor-framebuffer']" 2>/dev/null || true

echo "✔ All shortcuts and performance optimizations synchronized successfully!"
