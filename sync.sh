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
# Files only: a stray folder (e.g. Python's __pycache__) must not stop the sync.
find "$SCRIPT_DIR/bin" -maxdepth 1 -type f -exec cp -f {} "$HOME/.local/bin/" \;
find "$SCRIPT_DIR/bin" -maxdepth 1 -type f -printf '%f\n' | while read -r tool; do
    chmod +x "$HOME/.local/bin/$tool"
done
# The tools' shared Python library and the defaults it reads (shortcuts, brand)
MK_SHARE="$HOME/.local/share/mk-workstation"
mkdir -p "$MK_SHARE"
rm -rf "${MK_SHARE:?}/lib" "${MK_SHARE:?}/config" "${MK_SHARE:?}/assets"
cp -r "$SCRIPT_DIR/lib" "$SCRIPT_DIR/config" "$SCRIPT_DIR/assets" "$MK_SHARE/"

# MK's apps in the app grid, dock and Alt+Tab, with their icons. Your own image
# wins: ~/.config/mk-workstation/icons/<name>.svg or .png (see `mk icon`).
ICON_DIR="$HOME/.local/share/icons/hicolor"
APP_DIR="$HOME/.local/share/applications"
CUSTOM_ICONS="$HOME/.config/mk-workstation/icons"
mkdir -p "$ICON_DIR/scalable/apps" "$ICON_DIR/256x256/apps" "$APP_DIR"
declare -A ICON_NAMES=([companion]=MkCompanion [timer]=MkTimer [shortcuts]=MkShortcuts
                       [camera]=MkCamera [ocr]=MkOcr [notes]=MkNotes [screensaver]=MkScreensaver
                       [tour]=MkTour [vault]=MkVault)
for short in "${!ICON_NAMES[@]}"; do
    id="io.github.mehulk.${ICON_NAMES[$short]}"
    rm -f "$ICON_DIR/scalable/apps/$id.svg" "$ICON_DIR/256x256/apps/$id.png"
    if [[ -f "$CUSTOM_ICONS/$short.svg" ]]; then
        cp -f "$CUSTOM_ICONS/$short.svg" "$ICON_DIR/scalable/apps/$id.svg"
    elif [[ -f "$CUSTOM_ICONS/$short.png" ]]; then
        cp -f "$CUSTOM_ICONS/$short.png" "$ICON_DIR/256x256/apps/$id.png"
    else
        cp -f "$SCRIPT_DIR/assets/icons/$id.svg" "$ICON_DIR/scalable/apps/$id.svg"
    fi
    sed "s|@BIN@|$HOME/.local/bin|" "$SCRIPT_DIR/assets/applications/$id.desktop" > "$APP_DIR/$id.desktop"
done
touch "$ICON_DIR"
gtk-update-icon-cache -q -t "$ICON_DIR" 2>/dev/null || true
update-desktop-database -q "$APP_DIR" 2>/dev/null || true

# Files styling (config/gtk/files.css) kept in a marked block of your GTK 4
# stylesheet; anything else you have there is left alone.
GTK_CSS="$HOME/.config/gtk-4.0/gtk.css"
mkdir -p "$(dirname "$GTK_CSS")"
touch "$GTK_CSS"
python3 - "$GTK_CSS" "$SCRIPT_DIR/config/gtk/files.css" << 'PY'
import re, sys
path, source = sys.argv[1:]
text = open(path).read()
text = re.sub(r"/\* >>> MK Workstation.*?/\* <<< MK Workstation \*/\n?", "", text, flags=re.S).rstrip("\n")
block = ("/* >>> MK Workstation (managed by sync.sh; edit config/gtk/files.css) */\n"
         + open(source).read() + "/* <<< MK Workstation */\n")
open(path, "w").write((text + "\n\n" if text else "") + block)
PY
printf '%s\n' "$SCRIPT_DIR" > "$HOME/.config/mk-workstation/repo-path"

# Touchpad-friendly Firefox and Zen (config/browser/user.js): swipe back and
# forward, momentum scrolling, pinch zoom. A marked block in each profile's
# user.js; read when the browser next starts.
for profile in "$HOME"/.config/mozilla/firefox/*/ "$HOME"/.mozilla/firefox/*/ \
               "$HOME"/.var/app/app.zen_browser.zen/.zen/*/ "$HOME"/.zen/*/; do
    [[ -f "$profile/prefs.js" ]] || continue
    touch "$profile/user.js"
    python3 - "$profile/user.js" "$SCRIPT_DIR/config/browser/user.js" << 'PY'
import re, sys
path, source = sys.argv[1:]
text = open(path).read()
text = re.sub(r"// >>> MK Workstation.*?// <<< MK Workstation\n?", "", text, flags=re.S).rstrip("\n")
block = ("// >>> MK Workstation (managed by sync.sh; edit config/browser/user.js)\n"
         + open(source).read() + "// <<< MK Workstation\n")
open(path, "w").write((text + "\n\n" if text else "") + block)
PY
done

# Zen Browser: the desktop accent and compact tabs (config/browser/zen-userChrome.css).
ACCENT_RGB=$(grep -om1 'rgba([0-9]*,[0-9]*,[0-9]*' "$HOME/.cache/mk-workstation/accent.css" 2> /dev/null | sed 's/rgba(//' || true)
for profile in "$HOME"/.var/app/app.zen_browser.zen/.zen/*/ "$HOME"/.zen/*/; do
    [[ -f "$profile/prefs.js" ]] || continue
    mkdir -p "$profile/chrome"
    touch "$profile/chrome/userChrome.css"
    python3 - "$profile/chrome/userChrome.css" "$SCRIPT_DIR/config/browser/zen-userChrome.css" "${ACCENT_RGB:-47,128,255}" << 'PY'
import re, sys
path, source, accent = sys.argv[1:]
text = open(path).read()
text = re.sub(r"/\* >>> MK Workstation.*?/\* <<< MK Workstation \*/\n?", "", text, flags=re.S).rstrip("\n")
block = ("/* >>> MK Workstation (managed by sync.sh; edit config/browser/zen-userChrome.css) */\n"
         + open(source).read().replace("@ACCENT@", accent) + "/* <<< MK Workstation */\n")
open(path, "w").write((text + "\n\n" if text else "") + block)
PY
done

# Cursor: Bibata Modern Classic (GPL-3.0, github.com/ful1e5/Bibata_Cursor), a
# sleek black pointer with a white edge that suits the dark desktop. Pinned
# release and checksum; CURSOR= in config/theme.conf (or yours) picks another
# installed theme, CURSOR=Adwaita goes back to GNOME's.
CURSOR_NAME="Bibata-Modern-Classic"
CURSOR_URL="https://github.com/ful1e5/Bibata_Cursor/releases/download/v2.0.7/Bibata-Modern-Classic.tar.xz"
CURSOR_SHA="7d3495864e5bbef02f5e77de760b2905903b63c71495a78ef6306d19a3b556d8"
cursor=$(cat "$SCRIPT_DIR/config/theme.conf" "$HOME/.config/mk-workstation/theme.conf" 2> /dev/null |
    sed -n 's/^CURSOR=//p' | tail -1 || true)
cursor="${cursor:-$CURSOR_NAME}"
if [[ "$cursor" == "$CURSOR_NAME" && ! -d "$HOME/.local/share/icons/$CURSOR_NAME" ]] && command -v curl &> /dev/null; then
    tmp=$(mktemp -d)
    if curl -fsSL --max-time 60 -o "$tmp/cursor.tar.xz" "$CURSOR_URL" \
        && echo "$CURSOR_SHA  $tmp/cursor.tar.xz" | sha256sum -c --quiet - 2> /dev/null; then
        mkdir -p "$HOME/.local/share/icons"
        tar -xJf "$tmp/cursor.tar.xz" -C "$HOME/.local/share/icons"
    else
        echo "[!] Couldn't download the $CURSOR_NAME cursor; keeping the current one."
    fi
    rm -rf "$tmp"
fi
if [[ -d "$HOME/.local/share/icons/$cursor" || -d "/usr/share/icons/$cursor" ]]; then
    gsettings set org.gnome.desktop.interface cursor-theme "$cursor"
fi


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

# Laptops: smart power profiles (performance plugged in, balanced on battery,
# power-saver when low; config/power.conf). Event-driven, so it costs nothing
# while idle. `mk power off` turns it off and it stays off.
if compgen -G "/sys/class/power_supply/BAT*" > /dev/null && [[ ! -f "$HOME/.config/mk-workstation/power-off" ]]; then
    cat > "$UNIT_DIR/mk-power.service" << 'UNIT'
[Unit]
Description=Smart power profiles (MK Workstation)
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=%h/.local/bin/mk-power
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical-session.target
UNIT
    systemctl --user daemon-reload 2>/dev/null
    systemctl --user enable mk-power.service &>/dev/null || true
    systemctl --user restart mk-power.service &>/dev/null || true
fi

# Blur my Shell's panel blur after login is now refreshed from inside the shell
# by mk-indicator, once startup has finished. Older login hacks toggled every
# extension (crashing others), toggled Blur my Shell too early (mk-session), or
# re-applied keys that now persist. Move them aside rather than delete them.
AUTOSTART_DIR="$HOME/.config/autostart"
# Screensaver: watches for idle time from login (it does nothing while
# SCREENSAVER=off; a video, a call or Caffeine keep it away).
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/mk-screensaver.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=MK screensaver
Comment=Plays a scene when you step away (mk screensaver)
Exec=$HOME/.local/bin/mk-screensaver
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=15
NoDisplay=true
DESKTOP
pgrep -f "mk-screensaver$" > /dev/null || setsid -f "$HOME/.local/bin/mk-screensaver" > /dev/null 2>&1 || true
# The tour: once, at the first login after setup (it remembers, and the
# autostart entry then does nothing). Any time later: mk tour, Super+Shift+/.
cat > "$AUTOSTART_DIR/mk-tour.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=MK tour (first login)
Exec=$HOME/.local/bin/mk-tour --first-run
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=20
NoDisplay=true
DESKTOP
# Locked apps (mk lock app): launchers were just rewritten above; lock them again.
"$HOME/.local/bin/mk-lock" reapply > /dev/null 2>&1 || true
# Files: right-click a folder › Scripts › Lock or unlock folder (mk lock).
NAUTILUS_SCRIPTS="$HOME/.local/share/nautilus/scripts"
mkdir -p "$NAUTILUS_SCRIPTS"
cat > "$NAUTILUS_SCRIPTS/Lock or unlock folder" << 'SCRIPT'
#!/bin/bash
# MK: open or close a folder locked with `mk lock PATH` (asks for your fingerprint or password).
while IFS= read -r path; do
    [[ -n "$path" ]] && "$HOME/.local/bin/mk-lock" folder toggle "$path"
done <<< "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS"
SCRIPT
chmod +x "$NAUTILUS_SCRIPTS/Lock or unlock folder"
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
# Smoother unlock: GNOME switches off every extension that isn't marked for the
# lock screen when you lock, and rebuilds them all as you unlock, which is the
# hitch you see as the lock screen slides away (and gestures don't answer for a
# moment). Keep the ones with nothing to show or type on the lock screen loaded:
# animations and gestures (they only act on the normal desktop). Not the
# clipboard, text grabber or resource monitor (its menu lists your processes):
# they would work on the lock screen.
for uuid in impatience@gfxmonk.net burn-my-windows@schneegans.github.com \
            compiz-windows-effect@hermes83.github.com compiz-alike-magic-lamp-effect@hermes83.github.com \
            touchpad-gesture-customization@coooolapps.com transparent-top-bar@ftpix.com; do
    meta="$USER_EXT_DIR/$uuid/metadata.json"
    [[ -f "$meta" ]] || continue
    python3 - "$meta" << 'PY' && echo "    [+] $uuid stays loaded while locked (after logging in again)"
import json, sys
path = sys.argv[1]
data = json.load(open(path))
modes = data.get("session-modes", ["user"])
if "unlock-dialog" in modes:
    sys.exit(1)
data["session-modes"] = modes + ["unlock-dialog"]
json.dump(data, open(path, "w"), indent=2)
PY
done
# 3-finger Alt+Tab: the extension spreads one fixed swipe across all your
# windows, so the more windows are open, the less finger travel each one gets
# (with ten windows a small twitch skips two). Make it the same travel per
# window whatever is open: steady and predictable, like scrolling a list.
GESTURE_ALTTAB="$USER_EXT_DIR/touchpad-gesture-customization@coooolapps.com/src/altTab.js"
if [[ -f "$GESTURE_ALTTAB" ]] && ! grep -q 'MK: same travel per window' "$GESTURE_ALTTAB" &&
    grep -q 'this._progress = Math.clamp(this._progress + delta / distance, 0, 1);' "$GESTURE_ALTTAB"; then
    sed -i 's#this._progress = Math.clamp(this._progress + delta / distance, 0, 1);#this._progress = Math.clamp(this._progress + delta / distance * 6 / Math.max(3, (this._switcher?._items.length ?? 4) + 2 * dummyWinCount), 0, 1); // MK: same travel per window#' "$GESTURE_ALTTAB"
    echo "    [+] Patched 3-finger Alt+Tab for even finger travel per window (after logging in again)"
fi
# WACK Shell's top-left menu: shortcut hints beside every item it can match
# (Shut Down, Restart, Lock, Log Out...), read live from your keybindings, and
# one beside Sleep too (WACK has no Sleep hint of its own: patched in).
ext_set wack-shell@rinzler69-wastaken.github.com org.gnome.shell.extensions.wack-shell show-menu-shortcuts true
ext_set wack-shell@rinzler69-wastaken.github.com org.gnome.shell.extensions.wack-shell menu-shortcut-amount 1
WACK_MENU="$USER_EXT_DIR/wack-shell@rinzler69-wastaken.github.com/panelComponents.js"
if [[ -f "$WACK_MENU" ]] && ! grep -q 'MK: sleep hint' "$WACK_MENU" &&
    grep -q "} else if (action === 'settings') {" "$WACK_MENU" &&
    grep -q 'SystemActions.getDefault().activateSuspend();' "$WACK_MENU"; then
    # 0,/re/: first match only, the user-defined branch where name, cmd and binding exist.
    sed -i "0,/} else if (action === 'settings') {/s#} else if (action === 'settings') {#} else if (action === 'sleep') { // MK: sleep hint\n                    if (name === 'sleep' || name === 'suspend' || cmd.includes('suspend')) {\n                        return formatShortcut(binding, isMac);\n                    }\n                } else if (action === 'settings') {#" "$WACK_MENU"
    perl -0pi -e "s#(SystemActions\.getDefault\(\)\.activateSuspend\(\);\n\s*\})\)\);#\1, getShortcut('sleep'), isDark));#" "$WACK_MENU"
    echo "    [+] Top-left menu: Sleep shows its shortcut (after logging in again)"
fi
# Four-finger desktop swipes: one desktop per swipe, however fast the flick,
# and a settle of at least 300 ms, so switching feels deliberate and weighted
# instead of skipping two desktops on a quick swipe.
GESTURE_WS="$USER_EXT_DIR/touchpad-gesture-customization@coooolapps.com/src/workspaceSwitching.js"
if [[ -f "$GESTURE_WS" ]] && ! grep -q 'MK: one desktop per swipe' "$GESTURE_WS" &&
    grep -q '_gestureBegin(tracker, monitor) {' "$GESTURE_WS" &&
    grep -q 'this._workspaceAnimation._switchWorkspaceEnd(tracker, duration, progress);' "$GESTURE_WS"; then
    sed -i 's#_gestureBegin(tracker, monitor) {#_gestureBegin(tracker, monitor) {\n        this._mkStart = global.workspace_manager.get_active_workspace_index(); // MK: one desktop per swipe#' "$GESTURE_WS"
    sed -i 's#this._workspaceAnimation._switchWorkspaceEnd(tracker, duration, progress);#if (this._mkStart !== undefined) progress = Math.clamp(progress, this._mkStart - 1, this._mkStart + 1);\n        this._workspaceAnimation._switchWorkspaceEnd(tracker, Math.max(duration, 300), progress);#' "$GESTURE_WS"
    echo "    [+] Desktop swipes: one desktop at a time, weighted (after logging in again)"
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
glib-compile-schemas "$USER_EXT_DIR/$MK_INDICATOR/schemas" || true

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
# Astra Monitor: replaced by mk-indicator's own lighter system monitor.
gsettings_remove org.gnome.shell enabled-extensions monitor@astraext.github.io
# MacOS Dock: a second dock whose magnification fought Dash to Dock's
# (doubled icons). Dash to Dock + mk-indicator's magnification replace it.
gsettings_remove org.gnome.shell enabled-extensions macos-dock@vinnytherobot.github.io
if [[ -d "$HOME/.local/share/gnome-shell/extensions/macos-dock@vinnytherobot.github.io" ]]; then
    gnome-extensions uninstall macos-dock@vinnytherobot.github.io 2>/dev/null \
        || rm -rf "$HOME/.local/share/gnome-shell/extensions/macos-dock@vinnytherobot.github.io"
fi

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
# Housekeeping: Trash and temporary files older than 30 days are removed
# automatically (GNOME's own privacy setting), so the disk doesn't silt up.
gsettings set org.gnome.desktop.privacy remove-old-trash-files true
gsettings set org.gnome.desktop.privacy remove-old-temp-files true
gsettings set org.gnome.desktop.privacy old-files-age 30
# Faster overview search: skip search providers for apps that are rarely
# searched and often slow or failing to answer (VMs, contacts, passwords).
# Software too: answering overview searches kept GNOME Software (and its dnf
# daemon, together about 330 MB) running all day. Open Software to search apps.
gsettings_append org.gnome.desktop.search-providers disabled \
    org.gnome.Boxes.desktop org.gnome.Contacts.desktop org.gnome.seahorse.Application.desktop \
    org.gnome.Software.desktop
# Laptop comfort: tap to click, natural scrolling, battery %, weekday, Night Light
gsettings set org.gnome.desktop.peripherals.touchpad tap-to-click true
gsettings set org.gnome.desktop.peripherals.touchpad natural-scroll true
# Ignore the palm while typing, but only for a moment, so fast typing-then-
# swiping (Alt+Tab with three fingers) still responds right away.
gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing true
gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing-timeout 300
gsettings set org.gnome.desktop.peripherals.touchpad tap-and-drag true
# Two-finger scrolling (not the edge strip), right-click with two fingers
# anywhere on the pad instead of the bottom-right corner, the libinput
# pointer curve; speed is left as you set it.
gsettings set org.gnome.desktop.peripherals.touchpad two-finger-scrolling-enabled true
gsettings set org.gnome.desktop.peripherals.touchpad edge-scrolling-enabled false
gsettings set org.gnome.desktop.peripherals.touchpad click-method 'fingers'
gsettings set org.gnome.desktop.peripherals.touchpad tap-and-drag-lock false
gsettings set org.gnome.desktop.peripherals.touchpad accel-profile 'default'
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
