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

gnome_version() {
    gnome-shell --version | grep -oE '[0-9]+' | head -n 1
}

# Download the build of an extension that matches this GNOME version.
ego_install() {
    local uuid=$1 url zip rc=0
    command -v curl &>/dev/null || return 1
    url=$(curl -fs --max-time 20 \
        "https://extensions.gnome.org/extension-info/?uuid=${uuid}&shell_version=$(gnome_version)" \
        | python3 -c 'import json, sys; print(json.load(sys.stdin)["download_url"])' 2>/dev/null) || return 1
    zip=$(mktemp --suffix=.zip)
    curl -fsSL --max-time 120 -o "$zip" "https://extensions.gnome.org${url}" \
        && gnome-extensions install --force "$zip" || rc=1
    rm -f "$zip"
    return "$rc"
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

# Snapshot every desktop setting first, so `mk restore` can undo this run.
BACKUP_DIR="$HOME/.config/mk-workstation/backups"
mkdir -p "$BACKUP_DIR"
dconf dump / > "$BACKUP_DIR/dconf-$(date +%Y%m%d-%H%M%S).ini"
# Keep the 5 newest snapshots
find "$BACKUP_DIR" -name 'dconf-*.ini' -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f --
echo "    [+] Settings snapshot saved (undo with: mk restore)"

# 1. Deploy local CLI tools and remember where the repo lives (used by `mk`)
mkdir -p "$HOME/.local/bin" "$HOME/.config/mk-workstation"
cp -f "$SCRIPT_DIR/bin/"* "$HOME/.local/bin/"
chmod +x "$HOME/.local/bin/"*
printf '%s\n' "$SCRIPT_DIR" > "$HOME/.config/mk-workstation/repo-path"

# Daily, low-priority check for repo updates (shows a notification via `mk check`)
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/mk-update-check.service" << 'UNIT'
[Unit]
Description=Check for MK Workstation updates

[Service]
Type=oneshot
Nice=19
IOSchedulingClass=idle
ExecStart=%h/.local/bin/mk check
UNIT
cat > "$UNIT_DIR/mk-update-check.timer" << 'UNIT'
[Unit]
Description=Daily check for MK Workstation updates

[Timer]
OnBootSec=15min
OnUnitActiveSec=1d
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload 2>/dev/null \
    && systemctl --user enable --now mk-update-check.timer &>/dev/null \
    || echo "    [*] Couldn't enable the daily update check (no systemd user session)"

# Login helper: re-initializes Blur my Shell after GNOME Shell has settled (bin/mk-session).
AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/mk-session.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=MK Workstation session start
Comment=Makes sure Blur my Shell is applied after login
Exec=$HOME/.local/bin/mk-session
X-GNOME-Autostart-enabled=true
NoDisplay=true
DESKTOP
# Older login hacks toggled every extension (crashing others) or re-applied keys
# that now persist. Move them aside rather than delete them.
RETIRED_DIR="$HOME/.config/mk-workstation/retired-autostart"
for hack in fix-extensions.desktop bms-panel-fix.desktop gnome-alt-tab-fix.desktop; do
    if [[ -f "$AUTOSTART_DIR/$hack" ]]; then
        mkdir -p "$RETIRED_DIR"
        mv -f "$AUTOSTART_DIR/$hack" "$RETIRED_DIR/"
        echo "    [+] Retired old login hack $hack (kept in $RETIRED_DIR)"
    fi
done

# Remember which packages existed before MK, so `mk save` can spot new ones.
"$HOME/.local/bin/mk-apps" baseline

# 2. GNOME Extensions (list in config/enabled-extensions.txt, written by `mk export`)
echo "==> Installing and enabling GNOME extensions..."
mapfile -t ACTIVE_EXTENSIONS < <(grep -vE '^\s*(#|$)' "$SCRIPT_DIR/config/enabled-extensions.txt" || true)
mkdir -p "$USER_EXT_DIR"
NEW_EXTENSIONS=0
for uuid in "${ACTIVE_EXTENSIONS[@]}"; do
    # Never replace a version that is already installed.
    if [[ -d "$USER_EXT_DIR/$uuid" || -d "/usr/share/gnome-shell/extensions/$uuid" ]]; then
        continue
    fi
    if ego_install "$uuid"; then
        echo "    [+] Installed $uuid from extensions.gnome.org"
    elif [[ -d "$SCRIPT_DIR/extensions/$uuid" ]]; then
        cp -r "$SCRIPT_DIR/extensions/$uuid" "$USER_EXT_DIR/"
        echo "    [+] Installed $uuid from the repo's offline copy"
    else
        echo "    [*] Couldn't install $uuid (offline, or no version for GNOME $(gnome_version))"
        continue
    fi
    NEW_EXTENSIONS=1
    # Extensions that ship only schema sources need them compiled for gsettings.
    schemas="$USER_EXT_DIR/$uuid/schemas"
    if [[ -d "$schemas" && ! -f "$schemas/gschemas.compiled" ]]; then
        glib-compile-schemas "$schemas" || true
    fi
done
# WACK Shell 1.0.0 calls super.vfunc_event(), which GNOME 50 no longer provides:
# every pointer event over its panel buttons logs a JS error (hundreds per
# session). Pass the event on instead. No-op once upstream fixes it.
WACK_JS="$USER_EXT_DIR/wack-shell@rinzler69-wastaken.github.com/panelComponents.js"
if [[ -f "$WACK_JS" ]] && grep -q 'return super.vfunc_event(event);' "$WACK_JS"; then
    sed -i 's|return super.vfunc_event(event);|return Clutter.EVENT_PROPAGATE; // MK: no StWidget.vfunc_event on GNOME 50|' "$WACK_JS"
    echo "    [+] Patched WACK Shell for GNOME 50 (takes effect after logging in again)"
fi

# This project's own top-bar watermark: always refresh it so repo updates land.
MK_INDICATOR="mk-indicator@mehulk"
[[ -d "$USER_EXT_DIR/$MK_INDICATOR" ]] || NEW_EXTENSIONS=1
rm -rf "${USER_EXT_DIR:?}/$MK_INDICATOR"
cp -r "$SCRIPT_DIR/extensions/$MK_INDICATOR" "$USER_EXT_DIR/"

gsettings set org.gnome.shell disable-user-extensions false
# Write the list directly: `gnome-extensions enable` fails on Wayland for
# extensions the running shell hasn't loaded yet.
gsettings_append org.gnome.shell enabled-extensions "${ACTIVE_EXTENSIONS[@]}" "$MK_INDICATOR"

# 3. Window Management & Multitasking (All Workspaces, Zero Lag)
echo "==> Applying window management keybindings..."
gsettings set org.gnome.desktop.wm.keybindings switch-applications "['<Super>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "['<Shift><Super>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false
gsettings set org.gnome.shell.window-switcher current-workspace-only false

# Windows-style split screen (Tiling Assistant): Super+arrows snap halves, and
# Super+Left then Super+Up makes a quarter, as on Windows. After snapping, Snap
# Assist offers your other windows for the free space; snapped windows raise
# together. Super+Z picks a layout (config/tiling-layouts.json).
TA="tiling-assistant@leleat-on-github"
TA_SCHEMA="org.gnome.shell.extensions.tiling-assistant"
ext_set "$TA" "$TA_SCHEMA" dynamic-keybinding-behavior 3
ext_set "$TA" "$TA_SCHEMA" enable-tiling-popup true
ext_set "$TA" "$TA_SCHEMA" enable-raise-tile-group true
ext_set "$TA" "$TA_SCHEMA" enable-tile-animations false
ext_set "$TA" "$TA_SCHEMA" enable-layout-picker true
ext_set "$TA" "$TA_SCHEMA" search-popup-layout "['<Super>z']"
ext_set "$TA" "$TA_SCHEMA" center-window "['<Super><Control>c']"
# Install the MK layouts unless you already made your own (TA's examples don't count).
TA_LAYOUTS="$HOME/.config/tiling-assistant/layouts.json"
TA_EXAMPLE=$(find "$USER_EXT_DIR/$TA" "/usr/share/gnome-shell/extensions/$TA" -name layouts_example.json 2>/dev/null | head -n 1 || true)
same_json() { python3 -c 'import json, sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))' "$1" "$2" 2>/dev/null; }
if [[ ! -s "$TA_LAYOUTS" ]] || { [[ -n "$TA_EXAMPLE" ]] && same_json "$TA_LAYOUTS" "$TA_EXAMPLE"; }; then
    mkdir -p "$(dirname "$TA_LAYOUTS")"
    cp -f "$SCRIPT_DIR/config/tiling-layouts.json" "$TA_LAYOUTS"
elif ! same_json "$TA_LAYOUTS" "$SCRIPT_DIR/config/tiling-layouts.json"; then
    echo "    [*] Kept your own Tiling Assistant layouts ($TA_LAYOUTS)"
fi
# While Tiling Assistant runs it owns Super+arrows (it blanks GNOME's own snap
# keys and restores them when disabled), so only set GNOME's when it isn't running.
if [[ "$(gnome-extensions info "$TA" 2>/dev/null | awk '/State:/ { print $2 }')" != "ACTIVE" ]]; then
    gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Super>Left']"
    gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Super>Right']"
    gsettings set org.gnome.desktop.wm.keybindings maximize "['<Super>Up']"
    gsettings set org.gnome.desktop.wm.keybindings unmaximize "['<Super>Down']"
fi
gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"
# Busy apps (games, compiles) get 20s before GNOME shows "not responding" (default 5s).
gsettings set org.gnome.mutter check-alive-timeout 20000

# 4. Protect Zen Browser Workspaces (Release Ctrl+Alt+Arrows)
# Super+Ctrl+arrows also switch workspaces, like Windows virtual desktops.
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Page_Up', '<Super><Alt>Left', '<Super><Control>Left']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Page_Down', '<Super><Alt>Right', '<Super><Control>Right']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-up "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-down "[]"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Super><Shift>Page_Up', '<Super><Shift><Alt>Left']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Super><Shift>Page_Down', '<Super><Shift><Alt>Right']"
# Super+1-9 opens dock apps (Windows taskbar style); workspaces use Super+Alt+N,
# matching Super+Alt+arrows, so the two never fight over the same keys.
for n in 1 2 3 4; do
    gsettings set org.gnome.desktop.wm.keybindings "switch-to-workspace-$n" "['<Super><Alt>$n']"
    gsettings set org.gnome.desktop.wm.keybindings "move-to-workspace-$n" "['<Super><Shift><Alt>$n']"
done

# 5. Instant Screenshot & Power Keybindings
# Print (Fn+PrtSc on laptops) = instant full screen; area selection on Shift+Print,
# Super+Shift+S (Windows) and Super+Shift+4 (macOS); Super+Shift+3 = macOS full screen.
# Every capture is saved to ~/Pictures/Screenshots and copied to the clipboard.
gsettings set org.gnome.shell.keybindings screenshot "['Print', '<Super><Shift>3']"
gsettings set org.gnome.shell.keybindings screenshot-window "['<Alt>Print']"
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['<Shift>Print', '<Super><Shift>s', '<Super><Shift>4']"
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

# 6b. Windows & macOS conveniences (GNOME stays GNOME: Super still opens the overview)
echo "==> Applying Windows & macOS conveniences..."
MK_WM="org.gnome.desktop.wm.keybindings"
MK_SHELL="org.gnome.shell.keybindings"
gsettings set "$MEDIA_KEYS" home "['<Super>e']"                   # Files (Win+E)
gsettings set "$MEDIA_KEYS" control-center "['<Super>i']"         # Settings (Win+I)
gsettings set "$MK_WM" show-desktop "['<Super>d']"                # Show desktop (Win+D)
gsettings set "$MK_WM" panel-run-dialog "['<Alt>F2', '<Super>r']" # Run a command (Win+R)
gsettings set "$MK_SHELL" toggle-overview "['<Super>s']"          # Search (Win+S)
gsettings set "$MK_SHELL" toggle-quick-settings "['<Super><Shift>a']" # Quick settings
gsettings set "$MK_SHELL" toggle-application-view "['<Super>a']"  # App grid (GNOME/Launchpad)
gsettings set "$MK_SHELL" toggle-message-tray "['<Super>m']"      # Notifications; Super+V is clipboard
gsettings set "$MK_SHELL" focus-active-notification "[]"          # frees Super+N for notes
gsettings set "$MK_WM" toggle-above "['<Super><Control>t']"         # Always on top (PowerToys)
# Window buttons on the right, new windows centred (macOS), hot corner on
gsettings set org.gnome.desktop.wm.preferences button-layout "appmenu:minimize,maximize,close"
gsettings set org.gnome.mutter center-new-windows true
gsettings set org.gnome.desktop.interface enable-hot-corners true
# Laptop comfort: tap to click, natural scrolling, battery %, weekday, Night Light
gsettings set org.gnome.desktop.peripherals.touchpad tap-to-click true
gsettings set org.gnome.desktop.peripherals.touchpad natural-scroll true
gsettings set org.gnome.desktop.interface show-battery-percentage true
gsettings set org.gnome.desktop.interface clock-show-weekday true
gsettings set org.gnome.settings-daemon.plugins.color night-light-enabled true

# 7. Smooth Animation Performance Tweaks
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.overview blur false
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.lockscreen blur false
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel blur true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel static-blur true
gsettings_append org.gnome.mutter experimental-features scale-monitor-framebuffer

# Saved extension preferences (config/extension-settings/, written by `mk export`).
# Loaded after the defaults above, so your own tuned values win.
echo "==> Restoring saved extension settings..."
for settings in "$SCRIPT_DIR"/config/extension-settings/*.dconf; do
    [[ -e "$settings" ]] || continue
    path=$(sed -n '1s/^# dconf path: //p' "$settings")
    if [[ "$path" != /org/gnome/shell/extensions/*/ ]]; then
        echo "    [*] Skipped $(basename "$settings") (missing '# dconf path:' header)"
        continue
    fi
    sed "s|__USER_HOME__|$HOME|g" "$settings" | dconf load "$path"
done

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
add_shortcut notes   "Quick Notes & Timer"       "$HOME/.local/bin/mk-scratchpad"   "<Super><Shift>n"
add_shortcut camera  "Camera Studio Controls"    "$HOME/.local/bin/camera-controls" "<Super>c"
add_shortcut taskmgr "System Monitor"            "gnome-system-monitor"             "<Control><Shift>Escape"
# Ctrl+Alt+T opens a terminal: Fedora's Ptyxis, or whichever is installed
for term in ptyxis kgx gnome-terminal; do
    if command -v "$term" &>/dev/null; then
        add_shortcut terminal "Terminal" "$term" "<Control><Alt>t"
        break
    fi
done
# Super+N opens Obsidian for notes; Super+B opens your default web browser.
add_shortcut obsidian "Notes (Obsidian)" "flatpak run md.obsidian.Obsidian" "<Super>n"
browser=$(xdg-settings get default-web-browser 2>/dev/null || true)
if [[ -n "$browser" ]]; then
    add_shortcut browser "Web Browser" "gtk-launch ${browser%.desktop}" "<Super>b"
fi

# Drop your own custom shortcuts that run exactly what an mk-* shortcut now
# runs (such as an older "Launch Obsidian" on Super+N), so no key is bound twice.
dedupe_custom_shortcuts() {
    local path cmd mk_cmds=() kept=()
    mapfile -t paths < <(gsettings get "$MEDIA_KEYS" custom-keybindings | grep -oE "'[^']+'" | tr -d "'")
    for path in "${paths[@]}"; do
        [[ "$path" == */mk-*/ ]] && mk_cmds+=("$(gsettings get "$MEDIA_KEYS.custom-keybinding:$path" command)")
    done
    for path in "${paths[@]}"; do
        if [[ "$path" != */mk-*/ ]]; then
            cmd=$(gsettings get "$MEDIA_KEYS.custom-keybinding:$path" command)
            if printf '%s\n' "${mk_cmds[@]}" | grep -qxF -- "$cmd"; then
                echo "    [+] Replaced duplicate shortcut $(basename "$path") with its mk-* version"
                continue
            fi
        fi
        kept+=("'$path'")
    done
    local IFS=,
    gsettings set "$MEDIA_KEYS" custom-keybindings "[${kept[*]}]"
}
dedupe_custom_shortcuts

echo "✔ Workstation configurations synchronized."
if (( NEW_EXTENSIONS )); then
    echo "  New extensions were installed: log out and back in to load them."
fi
