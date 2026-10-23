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

# Remove items from a string-array key, keeping everything else.
gsettings_remove() {
    local schema=$1 key=$2 item kept=()
    shift 2
    while IFS= read -r item; do
        printf '%s\n' "$@" | grep -qxF -- "$item" || kept+=("'$item'")
    done < <(gsettings get "$schema" "$key" | grep -oE "'[^']+'" | tr -d "'")
    if (( ${#kept[@]} )); then
        local IFS=,
        gsettings set "$schema" "$key" "[${kept[*]}]"
    else
        gsettings set "$schema" "$key" "@as []"
    fi
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
# The very first snapshot (your desktop before MK) is kept forever.
[[ -s "$BACKUP_DIR/original-dconf.ini" ]] || dconf dump / > "$BACKUP_DIR/original-dconf.ini"
# Keep the 5 newest snapshots
find "$BACKUP_DIR" -name 'dconf-*.ini' -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f --
echo "    [+] Settings snapshot saved (undo with: mk restore)"

# 1. Deploy local CLI tools and remember where the repo lives (used by `mk`)
mkdir -p "$HOME/.local/bin" "$HOME/.config/mk-workstation"
cp -f "$SCRIPT_DIR/bin/"* "$HOME/.local/bin/"
chmod +x "$HOME/.local/bin/"*
# The tools' shared Python library and the defaults it reads (shortcuts, brand)
MK_SHARE="$HOME/.local/share/mk-workstation"
mkdir -p "$MK_SHARE"
rm -rf "${MK_SHARE:?}/lib" "${MK_SHARE:?}/config"
cp -r "$SCRIPT_DIR/lib" "$SCRIPT_DIR/config" "$MK_SHARE/"
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
# Companion reminders: a tiny check once a minute, so they fire even when the
# Companion is closed, and catch up after sleep or a reboot (Persistent).
# KillMode=process keeps the notification (and its Open/Snooze buttons) alive
# after the check itself has finished.
cat > "$UNIT_DIR/mk-reminders.service" << 'UNIT'
[Unit]
Description=Fire due Companion reminders

[Service]
Type=oneshot
Nice=10
KillMode=process
ExecStart=%h/.local/bin/mk-reminders
UNIT
cat > "$UNIT_DIR/mk-reminders.timer" << 'UNIT'
[Unit]
Description=Check Companion reminders every minute

[Timer]
OnCalendar=*:*:00
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload 2>/dev/null \
    && systemctl --user enable --now mk-update-check.timer mk-reminders.timer &>/dev/null \
    || echo "    [*] Couldn't enable the update check and reminders (no systemd user session)"

# Blur my Shell's panel blur after login is now refreshed from inside the shell
# by mk-indicator, once startup has finished. Older login hacks toggled every
# extension (crashing others), toggled Blur my Shell too early (mk-session), or
# re-applied keys that now persist. Move them aside rather than delete them.
AUTOSTART_DIR="$HOME/.config/autostart"
RETIRED_DIR="$HOME/.config/mk-workstation/retired-autostart"
rm -f "$HOME/.local/bin/mk-session"
for hack in fix-extensions.desktop bms-panel-fix.desktop gnome-alt-tab-fix.desktop mk-session.desktop; do
    if [[ -f "$AUTOSTART_DIR/$hack" ]]; then
        mkdir -p "$RETIRED_DIR"
        mv -f "$AUTOSTART_DIR/$hack" "$RETIRED_DIR/"
        echo "    [+] Retired old login hack $hack (kept in $RETIRED_DIR)"
    fi
done
if [[ -f "$HOME/.config/systemd/user/mk-blur-fix.service" ]]; then
    systemctl --user disable mk-blur-fix.service &>/dev/null || true
    mkdir -p "$RETIRED_DIR"
    mv -f "$HOME/.config/systemd/user/mk-blur-fix.service" "$RETIRED_DIR/"
    systemctl --user daemon-reload &>/dev/null || true
    echo "    [+] Retired old login hack mk-blur-fix.service (kept in $RETIRED_DIR)"
fi

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
# WACK Shell also snapshots the dock with paint_to_content(), which GNOME 50's
# dock actor lacks: every dock move logged an error and a stack trace, a hitch
# right when windows minimize. Skip the snapshot instead.
WACK_EXT_JS="$USER_EXT_DIR/wack-shell@rinzler69-wastaken.github.com/extension.js"
if [[ -f "$WACK_EXT_JS" ]] && grep -q '^ *dock\.paint_to_content(null);' "$WACK_EXT_JS"; then
    sed -i 's|^\( *\)dock\.paint_to_content(null);|\1dock.paint_to_content?.(null); // MK: not on GNOME 50 dock actors|' "$WACK_EXT_JS"
    echo "    [+] Patched WACK Shell dock snapshot (takes effect after logging in again)"
fi
# Magic Lamp plays its genie even when GNOME was told to skip the effect, so
# gestures that animate windows themselves (4-finger pinch to show the desktop)
# ran two animations back to back and stuttered. Make it honour skipNextEffect().
LAMP_JS="$USER_EXT_DIR/compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js"
if [[ -f "$LAMP_JS" ]] && ! grep -q 'MK: skipNextEffect' "$LAMP_JS" &&
    grep -q 'stack.indexOf("_unminimizeWindow") !== -1)) {' "$LAMP_JS"; then
    sed -i \
        -e 's#^\( *\)\(if (stack && (stack.indexOf("_minimizeWindow") !== -1 || stack.indexOf("_unminimizeWindow") !== -1)) {\)$#\1\2\n\1    if (Main.wm._skippedActors?.delete(actor)) (Main.wm._mkSkipLamp ??= new Set()).add(actor); // MK: skipNextEffect#' \
        -e '/window_manager.connect("\(un\)\{0,1\}minimize"/,/if (Main.overview.visible) {/ s#^\( *\)if (Main.overview.visible) {$#\1if (Main.overview.visible || Main.wm._mkSkipLamp?.delete(actor)) {#' \
        "$LAMP_JS"
    echo "    [+] Patched Magic Lamp to respect gesture animations (takes effect after logging in again)"
fi
# Burn My Windows: a short, subtle "Glide" when windows open and close. The MK
# profile is high priority, so it wins over the default profile (Fire).
BMW_PROFILE="$HOME/.config/burn-my-windows/profiles/mk-glide.conf"
if [[ -d "$USER_EXT_DIR/burn-my-windows@schneegans.github.com" ]]; then
    mkdir -p "$(dirname "$BMW_PROFILE")"
    cp -f "$SCRIPT_DIR/config/burn-my-windows-profile.conf" "$BMW_PROFILE"
fi

# This project's own top-bar watermark: always refresh it so repo updates land.
MK_INDICATOR="mk-indicator@mehulk"
[[ -d "$USER_EXT_DIR/$MK_INDICATOR" ]] || NEW_EXTENSIONS=1
rm -rf "${USER_EXT_DIR:?}/$MK_INDICATOR"
cp -r "$SCRIPT_DIR/extensions/$MK_INDICATOR" "$USER_EXT_DIR/"

gsettings set org.gnome.shell disable-user-extensions false
# Effects profile (`mk effects full|lite|auto`, default auto): lite keeps the
# heaviest effects (config/effects.conf) installed but switched off, so older
# or low-power machines stay smooth. auto picks lite on weak hardware.
EFFECTS=$(cat "$HOME/.config/mk-workstation/effects" 2>/dev/null || echo auto)
read -ra HEAVY_EXTENSIONS <<< "$(sed -n 's/^HEAVY=//p' "$SCRIPT_DIR/config/effects.conf")"
if [[ "$EFFECTS" != full && "$EFFECTS" != lite ]]; then
    lite_below=$(sed -n 's/^AUTO_LITE_BELOW_GB=//p' "$SCRIPT_DIR/config/effects.conf")
    mem_gb=$(awk '/^MemTotal/ { print int($2 / 1048576) }' /proc/meminfo)
    if (( mem_gb < ${lite_below:-4} )) || (( $(nproc) <= 2 )) || ! compgen -G "/dev/dri/renderD*" > /dev/null; then
        EFFECTS=lite
    else
        EFFECTS=full
    fi
fi
if [[ "$EFFECTS" == lite ]]; then
    kept=()
    for uuid in "${ACTIVE_EXTENSIONS[@]}"; do
        [[ " ${HEAVY_EXTENSIONS[*]} " == *" $uuid "* ]] || kept+=("$uuid")
    done
    ACTIVE_EXTENSIONS=("${kept[@]}")
    gsettings_remove org.gnome.shell enabled-extensions "${HEAVY_EXTENSIONS[@]}"
    echo "    [*] Effects: lite (blur, window effects and genie off; 'mk effects full' turns them on)"
fi
# Write the list directly: `gnome-extensions enable` fails on Wayland for
# extensions the running shell hasn't loaded yet.
gsettings_append org.gnome.shell enabled-extensions "${ACTIVE_EXTENSIONS[@]}" "$MK_INDICATOR"
# GNOME's disabled-extensions list overrides enabled-extensions, so an extension
# switched off once in Extension Manager would otherwise never come back.
gsettings_remove org.gnome.shell disabled-extensions "${ACTIVE_EXTENSIONS[@]}" "$MK_INDICATOR"
# Extensions an earlier MK version enabled and later dropped: switch them off.
# Space Bar duplicated GNOME's own workspace dots in the top bar.
gsettings_remove org.gnome.shell enabled-extensions space-bar@luchrioh

# 3. Window Management & Multitasking (All Workspaces, Zero Lag)
# Every keyboard shortcut lives in config/shortcuts.conf (applied in step 9).
echo "==> Applying window management settings..."
gsettings set org.gnome.shell.app-switcher current-workspace-only false
gsettings set org.gnome.shell.window-switcher current-workspace-only false
# Touchpad Gesture Customization rewrites the line above every time it starts
# (login, unlock) from its own option, which defaults to current workspace only.
ext_set touchpad-gesture-customization@coooolapps.com \
    org.gnome.shell.extensions.touchpad-gesture-customization alttab-all-workspaces true

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
# Busy apps (games, compiles) get 20s before GNOME shows "not responding" (default 5s).
gsettings set org.gnome.mutter check-alive-timeout 20000

# 4. Workspaces, Spaces style: they come and go as you use them, and the last
# one is always empty, so "go to the last workspace" (Super+Ctrl+D) opens a
# fresh desktop. Ctrl+Alt+arrows stay free for Zen Browser.
gsettings set org.gnome.mutter dynamic-workspaces true
gsettings set org.gnome.mutter workspaces-only-on-primary true

# 6. Clean Calendar & Panel Defaults
gsettings set org.gnome.desktop.calendar show-weekdate false
gsettings set org.gnome.shell.world-clocks locations "[]"
gsettings set org.gnome.shell.weather locations "[]"

# 6b. Windows & macOS conveniences (GNOME stays GNOME: Super still opens the overview)
echo "==> Applying Windows & macOS conveniences..."
# Files, Finder-style: expandable folders in list view, folders first,
# item counts, and "Create Link" / "Delete Permanently" in the menus
gsettings set org.gnome.nautilus.list-view use-tree-view true
gsettings set org.gtk.gtk4.Settings.FileChooser sort-directories-first true
gsettings set org.gnome.nautilus.preferences show-directory-item-counts 'always'
gsettings set org.gnome.nautilus.preferences show-create-link true
gsettings set org.gnome.nautilus.preferences show-delete-permanently true
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
# Fractional scaling (e.g. 125%) without blur: native framebuffer scaling, and
# X11 apps (Steam, many games) rendered at native size instead of upscaled.
gsettings_append org.gnome.mutter experimental-features scale-monitor-framebuffer xwayland-native-scaling

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
# Every shortcut: config/shortcuts.conf, then your changes from the Shortcuts
# window (Super+/) in ~/.config/mk-workstation/shortcuts.conf. Runs after the
# saved extension settings, so your choices win over extension defaults too.
PYTHONPATH="$MK_SHARE/lib" python3 -m mkworkstation apply-shortcuts

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
