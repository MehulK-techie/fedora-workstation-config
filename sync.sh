#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: Desktop Environment & Shortcut Sync (User Scope)
# ==============================================================================
# Single source of truth for GNOME settings. setup.sh runs this as the desktop
# user; it is also safe to run on its own, as often as you like.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -eq 0 ]]; then
    echo "[-] Error: sync.sh manages user desktop settings. Do NOT run with sudo." >&2
    exit 1
fi

# Reach the session bus even when started from a TTY, over SSH, or by setup.sh.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

if ! gsettings get org.gnome.shell enabled-extensions &>/dev/null; then
    echo "[-] Error: Can't reach a GNOME session. Log into GNOME and run this from its terminal." >&2
    exit 1
fi

USER_EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
MEDIA_KEYS="org.gnome.settings-daemon.plugins.media-keys"
CUSTOM_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

# Add items to a string-array key, keeping whatever the user already has there.
gsettings_append() {
    local schema=$1 key=$2 current item
    shift 2
    current=$(gsettings get "$schema" "$key")
    for item in "$@"; do
        [[ "$current" == *"'$item'"* ]] && continue
        if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
            current="['$item']"
        else
            current="${current%]}, '$item']"
        fi
    done
    gsettings set "$schema" "$key" "$current"
}

# Set a key owned by an extension. User-installed extensions keep their schema
# in their own folder, which gsettings doesn't search without --schemadir.
ext_set() {
    local uuid=$1 schema=$2 key=$3 value=$4
    local dir="$USER_EXT_DIR/$uuid/schemas"
    local args=()
    [[ -f "$dir/gschemas.compiled" ]] && args=(--schemadir "$dir")
    if gsettings "${args[@]}" list-schemas 2>/dev/null | grep -qx "$schema"; then
        gsettings "${args[@]}" set "$schema" "$key" "$value" \
            || echo "    [*] Could not set $schema $key"
    else
        echo "    [*] Skipped $schema $key ($uuid not installed or too old)"
    fi
}

# Custom shortcuts live in named mk-* slots and are appended to the list, so
# the user's own custom shortcuts (custom0, custom1, ...) are never touched.
add_shortcut() {
    local slot="$CUSTOM_PATH/mk-$1/"
    local schema="$MEDIA_KEYS.custom-keybinding:$slot"
    gsettings set "$schema" name "$2"
    gsettings set "$schema" command "$3"
    gsettings set "$schema" binding "$4"
    gsettings_append "$MEDIA_KEYS" custom-keybindings "$slot"
}

# Older versions of this script used numbered customN slots. Drop only the
# ones that run MK tools so they don't duplicate the new mk-* slots.
remove_legacy_shortcuts() {
    local list path cmd binding kept=()
    list=$(gsettings get "$MEDIA_KEYS" custom-keybindings)
    while IFS= read -r path; do
        [[ -z "$path" ]] && continue
        if [[ "$path" =~ /custom[0-9]+/$ ]]; then
            cmd=$(gsettings get "$MEDIA_KEYS.custom-keybinding:$path" command)
            binding=$(gsettings get "$MEDIA_KEYS.custom-keybinding:$path" binding)
            if [[ "$cmd" =~ /\.local/bin/(ocr-snip|show-shortcuts|mk-scratchpad|camera-controls|close-workspace-apps)\'$ ]] \
                || [[ "$cmd" == "'gnome-characters'" && "$binding" == "'<Super>period'" ]]; then
                continue
            fi
        fi
        kept+=("'$path'")
    done < <(grep -oE "'[^']+'" <<< "$list" | tr -d "'")

    if (( ${#kept[@]} )); then
        local IFS=,
        gsettings set "$MEDIA_KEYS" custom-keybindings "[${kept[*]}]"
    else
        gsettings set "$MEDIA_KEYS" custom-keybindings "@as []"
    fi
}

echo "[+] Syncing MK Workstation User Configurations..."

# 1. Deploy local CLI tools and remember where the repo lives (used by `mk`)
mkdir -p "$HOME/.local/bin" "$HOME/.config/mk-workstation"
cp -f "$SCRIPT_DIR/bin/"* "$HOME/.local/bin/"
chmod +x "$HOME/.local/bin/"*
printf '%s\n' "$SCRIPT_DIR" > "$HOME/.config/mk-workstation/repo-path"

# 2. GNOME Extensions (Active 8)
echo "==> Installing and enabling GNOME extensions..."
ACTIVE_EXTENSIONS=(
    touchpad-gesture-customization@coooolapps.com
    blur-my-shell@aunetx
    monitor@astraext.github.io
    transparent-top-bar@ftpix.com
    wack-shell@rinzler69-wastaken.github.com
    text-extractor@imshaaz21.github.com
    places-menu@gnome-shell-extensions.gcampax.github.com
    dash-to-dock@micxgx.gmail.com
)
mkdir -p "$USER_EXT_DIR"
NEW_EXTENSIONS=0
for uuid in "${ACTIVE_EXTENSIONS[@]}"; do
    # Bundled copies fill gaps only; never replace a version that is already installed.
    if [[ ! -d "$USER_EXT_DIR/$uuid" && ! -d "/usr/share/gnome-shell/extensions/$uuid" \
        && -d "$SCRIPT_DIR/extensions/$uuid" ]]; then
        cp -r "$SCRIPT_DIR/extensions/$uuid" "$USER_EXT_DIR/"
        echo "    [+] Installed $uuid from repo"
        NEW_EXTENSIONS=1
    fi
done
gsettings set org.gnome.shell disable-user-extensions false
# Write the list directly: `gnome-extensions enable` fails on Wayland for
# extensions the running shell hasn't loaded yet.
gsettings_append org.gnome.shell enabled-extensions "${ACTIVE_EXTENSIONS[@]}"

# 3. Window Management & Multitasking (All Workspaces, Zero Lag)
echo "==> Applying window management keybindings..."
gsettings set org.gnome.desktop.wm.keybindings switch-applications "['<Super>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "['<Shift><Super>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false
gsettings set org.gnome.shell.window-switcher current-workspace-only false

# Window snap & sizing (Zero popup delays)
ext_set tiling-assistant@leleat-on-github org.gnome.shell.extensions.tiling-assistant enable-tiling-popup false
ext_set tiling-assistant@leleat-on-github org.gnome.shell.extensions.tiling-assistant window-gap 4
gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Super>Left']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Super>Right']"
gsettings set org.gnome.desktop.wm.keybindings maximize "['<Super>Up']"
gsettings set org.gnome.desktop.wm.keybindings unmaximize "['<Super>Down']"
gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# 4. Protect Zen Browser Workspaces (Release Ctrl+Alt+Arrows)
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Page_Up', '<Super><Alt>Left']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Page_Down', '<Super><Alt>Right']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-up "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-down "[]"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Super><Shift>Page_Up', '<Super><Shift><Alt>Left']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Super><Shift>Page_Down', '<Super><Shift><Alt>Right']"

# 5. Instant Screenshot & Power Keybindings
gsettings set org.gnome.shell.keybindings screenshot "['Print']"
gsettings set org.gnome.shell.keybindings screenshot-window "['<Alt>Print']"
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['<Shift>Print', '<Super><Shift>s']"
# GNOME 50 renamed power-off to shutdown; Ctrl+Alt+Delete stays on GNOME's logout.
if gsettings list-keys "$MEDIA_KEYS" | grep -qx shutdown; then
    gsettings set "$MEDIA_KEYS" shutdown "['<Super>BackSpace', '<Super><Shift>x']"
else
    gsettings set "$MEDIA_KEYS" power-off "['<Super>BackSpace', '<Super><Shift>x', 'XF86PowerOff']"
fi

# 6. Clean Calendar & Panel Defaults
gsettings set org.gnome.desktop.calendar show-weekdate false
gsettings set org.gnome.shell.world-clocks locations "[]"
gsettings set org.gnome.shell.weather locations "[]"

# 7. Smooth Animation Performance Tweaks
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.overview blur false
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.lockscreen blur false
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel blur true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel static-blur true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.modal-dialogs blur true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.modal-dialogs brightness 0.65
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.modal-dialogs sigma 30
gsettings_append org.gnome.mutter experimental-features scale-monitor-framebuffer

# 8. Modern Modal Dialog Styling (written once; re-runs don't append again)
SHELL_CSS="$HOME/.config/gnome-shell/gnome-shell.css"
CSS_MARKER="/* MK Workstation: modal dialog styling */"
mkdir -p "$(dirname "$SHELL_CSS")"
if ! grep -qF "$CSS_MARKER" "$SHELL_CSS" 2>/dev/null; then
    cat >> "$SHELL_CSS" << CSSEOF

$CSS_MARKER
.modal-dialog {
  border-radius: 24px !important;
  background-color: rgba(20, 20, 28, 0.82) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6) !important;
  padding: 18px !important;
}

.end-session-dialog {
  border-radius: 24px !important;
}

.modal-dialog-linked-button {
  border-radius: 12px !important;
  font-weight: bold !important;
  padding: 10px 20px !important;
  margin: 4px !important;
  transition: all 200ms ease-in-out !important;
}

.modal-dialog-linked-button:hover {
  background-color: rgba(255, 255, 255, 0.18) !important;
}

.modal-dialog-linked-button:last-child {
  background-color: #e64553 !important;
  color: #ffffff !important;
}

.modal-dialog-linked-button:last-child:hover {
  background-color: #f38ba8 !important;
}
CSSEOF
fi

# 9. Register Custom Hotkeys
echo "==> Registering MK custom shortcuts..."
remove_legacy_shortcuts
add_shortcut ocr     "OCR Text Extractor"        "$HOME/.local/bin/ocr-snip"        "<Super><Shift>t"
add_shortcut emoji   "Emoji Board"               "gnome-characters"                 "<Super>period"
add_shortcut hud     "Workstation Shortcuts HUD" "$HOME/.local/bin/show-shortcuts"  "<Super>slash"
add_shortcut notes   "Quick Notes & Timer"       "$HOME/.local/bin/mk-scratchpad"   "<Super>n"
add_shortcut camera  "Camera Studio Controls"    "$HOME/.local/bin/camera-controls" "<Super>c"

echo "✔ Workstation configurations synchronized."
if (( NEW_EXTENSIONS )); then
    echo "  New extensions were installed: log out and back in to load them."
fi
