#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: Master Shortcuts, Performance & UI Synchronizer
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

echo "[+] Synchronizing full workstation suite for $REAL_USER..."

# 1. Zen Browser Protection: Reclaim Ctrl+Alt+Arrow
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Page_Up', '<Super><Alt>Left']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Page_Down', '<Super><Alt>Right']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-up "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-down "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Super><Shift>Page_Up', '<Super><Shift><Alt>Left']"
as_user gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Super><Shift>Page_Down', '<Super><Shift><Alt>Right']"

# 2. Universal Alt+Tab Across All Workspaces
as_user gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
as_user gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
as_user gsettings set org.gnome.shell.app-switcher current-workspace-only false

# 3. Screenshot Suite (Instant Fullscreen, Window, Interactive Selection)
as_user gsettings set org.gnome.shell.keybindings screenshot "['Print']"
as_user gsettings set org.gnome.shell.keybindings screenshot-window "['<Alt>Print']"
as_user gsettings set org.gnome.shell.keybindings show-screenshot-ui "['<Shift>Print', '<Super><Shift>s']"
as_user gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# 4. Instant 1-Click Window Snapping & Tiling (Zero Popups)
as_user gsettings set org.gnome.shell.extensions.tiling-assistant enable-tiling-popup false 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.tiling-assistant window-gap 4 2>/dev/null || true
as_user gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Super>Left']"
as_user gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Super>Right']"
as_user gsettings set org.gnome.desktop.wm.keybindings maximize "['<Super>Up']"
as_user gsettings set org.gnome.desktop.wm.keybindings unmaximize "['<Super>Down']"

# 5. Clean Calendar Dropdown
as_user gsettings set org.gnome.desktop.calendar show-weekdate false
as_user gsettings set org.gnome.shell.world-clocks locations "[]"
as_user gsettings set org.gnome.shell.weather locations "[]"

# 6. Smooth Animation & Blur-My-Shell Startup Fixes
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.panel blur true 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.panel static-blur true 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.overview blur false 2>/dev/null || true
as_user gsettings set org.gnome.shell.extensions.blur-my-shell.lockscreen blur false 2>/dev/null || true
as_user gsettings set org.gnome.mutter experimental-features "['scale-monitor-framebuffer']" 2>/dev/null || true

# 7. Register Custom Shortcut Slots (OCR, Emoji, HUD)
MEDIA_KEYS="org.gnome.settings-daemon.plugins.media-keys"
CUSTOM_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

as_user gsettings set $MEDIA_KEYS custom-keybindings "['$CUSTOM_PATH/custom0/', '$CUSTOM_PATH/custom1/', '$CUSTOM_PATH/custom2/']"

# OCR Tool: Super + Shift + T
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" name "Windows OCR Text Extractor"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" command "$HOME/.local/bin/ocr-snip"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" binding "<Super><Shift>t"

# Emoji Picker: Super + .
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" name "Emoji Board"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" command "gnome-characters"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" binding "<Super>period"

# Shortcuts HUD: Super + /
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" name "Workstation Shortcuts HUD"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" command "$HOME/.local/bin/show-shortcuts"
as_user gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" binding "<Super>slash"

echo "✔ All shortcuts, UI polish, and performance settings synchronized successfully!"
