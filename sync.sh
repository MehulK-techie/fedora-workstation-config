#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: Desktop Environment & Shortcut Sync (User Scope)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -eq 0 ]]; then
    echo "[-] Error: sync.sh manages user desktop settings. Do NOT run with sudo." >&2
    exit 1
fi

echo "[+] Syncing MK Workstation User Configurations..."

# 1. Deploy local CLI tools
mkdir -p "$HOME/.local/bin"
cp -f "$SCRIPT_DIR/bin/"* "$HOME/.local/bin/"
chmod +x "$HOME/.local/bin/"*

# 2. Window Management & Multitasking (All Workspaces, Zero Lag)
echo "==> Applying window management keybindings..."
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false

# Window snap & sizing (Zero popup delays)
gsettings set org.gnome.shell.extensions.tiling-assistant enable-tiling-popup false 2>/dev/null || true
gsettings set org.gnome.shell.extensions.tiling-assistant window-gap 4 2>/dev/null || true
gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Super>Left']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Super>Right']"
gsettings set org.gnome.desktop.wm.keybindings maximize "['<Super>Up']"
gsettings set org.gnome.desktop.wm.keybindings unmaximize "['<Super>Down']"
gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# 3. Protect Zen Browser Workspaces (Release Ctrl+Alt+Arrows)
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Page_Up', '<Super><Alt>Left']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Page_Down', '<Super><Alt>Right']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-up "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-down "[]"

# 4. Instant Screenshot Keybindings
gsettings set org.gnome.shell.keybindings screenshot "['Print']"
gsettings set org.gnome.shell.keybindings screenshot-window "['<Alt>Print']"
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['<Shift>Print', '<Super><Shift>s']"

# 5. Clean Calendar & Panel Defaults
gsettings set org.gnome.desktop.calendar show-weekdate false
gsettings set org.gnome.shell.world-clocks locations "[]"
gsettings set org.gnome.shell.weather locations "[]"

# 6. Smooth Animation Performance Tweaks
gsettings set org.gnome.shell.extensions.blur-my-shell.overview blur false 2>/dev/null || true
gsettings set org.gnome.shell.extensions.blur-my-shell.lockscreen blur false 2>/dev/null || true
gsettings set org.gnome.shell.extensions.blur-my-shell.panel blur true 2>/dev/null || true
gsettings set org.gnome.mutter experimental-features "['scale-monitor-framebuffer']" 2>/dev/null || true

# 7. Register Custom Hotkeys
MEDIA_KEYS="org.gnome.settings-daemon.plugins.media-keys"
CUSTOM_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

gsettings set $MEDIA_KEYS custom-keybindings "['$CUSTOM_PATH/custom0/', '$CUSTOM_PATH/custom1/', '$CUSTOM_PATH/custom2/', '$CUSTOM_PATH/custom3/', '$CUSTOM_PATH/custom4/']"

# OCR Tool: Super + Shift + T
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" name "Windows OCR Extractor"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" command "$HOME/.local/bin/ocr-snip"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom0/" binding "<Super><Shift>t"

# Emoji Board: Super + .
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" name "Emoji Board"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" command "gnome-characters"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom1/" binding "<Super>period"

# Shortcuts HUD: Super + /
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" name "Workstation Shortcuts HUD"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" command "$HOME/.local/bin/show-shortcuts"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom2/" binding "<Super>slash"

# Scratchpad / Notes: Super + N
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom3/" name "Quick Notes & Timer"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom3/" command "$HOME/.local/bin/mk-scratchpad"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom3/" binding "<Super>n"

# Camera Controls: Super + C
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom4/" name "Camera Studio Controls"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom4/" command "$HOME/.local/bin/camera-controls"
gsettings set "$MEDIA_KEYS.custom-keybinding:$CUSTOM_PATH/custom4/" binding "<Super>c"

echo "✔ Workstation configurations synchronized."
