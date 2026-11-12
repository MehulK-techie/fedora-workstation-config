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

# What MK's tools need from Fedora (apps/dnf-packages.txt, which `sudo ./setup.sh` installs):
# sync runs as you and never installs system packages itself, it names what's missing.
# `./sync.sh --check-deps` does only this; a normal sync ends with it.
check_deps() {
    local manifest="$SCRIPT_DIR/apps/dnf-packages.txt" missing=()
    [[ -f "$manifest" ]] || return 0
    mapfile -t wanted < <(grep -vE '^\s*(#|$)' "$manifest")
    # one rpm call for the lot; a package can also be provided under another name (whatprovides)
    while read -r line; do
        [[ "$line" =~ ^package\ (.+)\ is\ not\ installed$ ]] || continue
        pkg="${BASH_REMATCH[1]}"
        rpm -q --whatprovides "$pkg" &>/dev/null || missing+=("$pkg")
    done < <(rpm -q "${wanted[@]}" 2>/dev/null || true)
    if (( ${#missing[@]} )); then
        echo "    [*] Packages MK uses that aren't installed (${#missing[@]}): ${missing[*]}"
        echo "        Install them with: sudo ./setup.sh   (or: sudo dnf install ${missing[*]})"
        return 1
    fi
    echo "    [+] Every package MK uses is installed (${#wanted[@]} checked)"
}
# ./sync.sh --reset-defaults: put every MK default back (extensions, settings, shortcuts), as
# on a fresh install; without it, a re-sync only updates MK's own code and leaves your choices be.
RESET_DEFAULTS=0
for arg in "$@"; do
    [[ "$arg" == --reset-defaults ]] && RESET_DEFAULTS=1
done
if [[ "${1:-}" == "--check-deps" ]]; then
    echo "==> Checking packages..."
    check_deps
    exit $?
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

# Fresh install or update? ~/.config/mk-workstation/.initialized is written by the first sync.
#   fresh (no marker, or --reset-defaults): MK's defaults: exactly the curated extensions on,
#     every other one off; the desktop settings, theme, extension settings and shortcuts below.
#   update (the marker is there): MK's code is refreshed (bin/, lib/, its three extensions, their
#     schemas), new MK shortcuts are added, and nothing you set is touched: extension switches,
#     settings, wallpaper, keys.
# An install from before the marker existed (it has the extensions-applied ledger) counts as an
# update: it's yours already.
MARKER="$HOME/.config/mk-workstation/.initialized"
if (( RESET_DEFAULTS )); then
    FRESH=1
    echo "==> --reset-defaults: MK's defaults go back on (this run's snapshot undoes it: mk restore)"
elif [[ -f "$MARKER" ]]; then
    FRESH=0
elif [[ -f "$HOME/.config/mk-workstation/extensions-applied" ]]; then
    FRESH=0
    mkdir -p "$(dirname "$MARKER")"
    date -Iseconds > "$MARKER"
    echo "    [*] Existing MK install: your settings are kept (./sync.sh --reset-defaults for MK's)"
else
    FRESH=1
fi
if (( ! FRESH )); then
    echo "    [*] Update: MK's code is refreshed; your extensions, settings and keys stay as they are"
fi
# The extensions MK uses, and only these (fresh install / --reset-defaults turns exactly these on)
CURATED_EXTENSIONS=(mk-shell-engine@mehulk mk-indicator@mehulk wack-sonoma-lockscreen@rinzler69-wastaken.github.com
    blur-my-shell@aunetx caffeine@patapon.info text-extractor@imshaaz21.github.com
    touchpad-gesture-customization@coooolapps.com)

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
                       [tour]=MkTour [vault]=MkVault [speedtest]=MkSpeedtest
                       [center]=MkCenter)
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
# Retired launchers (MK Commands Hub is the Actions page of MK Control Center now).
rm -f "$APP_DIR/io.github.mehulk.MkCommands.desktop" "$ICON_DIR/scalable/apps/io.github.mehulk.MkCommands.svg"
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
if (( FRESH )) && [[ -d "$HOME/.local/share/icons/$cursor" || -d "/usr/share/icons/$cursor" ]]; then
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
Description=Check Companion reminders every 30 seconds

[Timer]
OnCalendar=*:*:00,30
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
UNIT
# Watchdog: leftover VS Code helpers and runaway Node/Python (bin/mk-watchdog).
cat > "$UNIT_DIR/mk-watchdog.service" << 'UNIT'
[Unit]
Description=Catch leftover and runaway developer processes

[Service]
Type=oneshot
Nice=15
IOSchedulingClass=idle
ExecStart=%h/.local/bin/mk-watchdog
UNIT
cat > "$UNIT_DIR/mk-watchdog.timer" << 'UNIT'
[Unit]
Description=Check for leftover and runaway developer processes every 2 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=2min
AccuracySec=30s

[Install]
WantedBy=timers.target
UNIT
cat > "$UNIT_DIR/mk-storage-sense.service" << 'UNIT'
[Unit]
Description=Storage Sense: old cache files, orphan thumbnails, your journal, unused Flatpak runtimes

[Service]
Type=oneshot
Nice=19
IOSchedulingClass=idle
ExecStart=%h/.local/bin/mk-storage-sense
UNIT
cat > "$UNIT_DIR/mk-storage-sense.timer" << 'UNIT'
[Unit]
Description=Run Storage Sense once a week

[Timer]
OnCalendar=weekly
Persistent=true
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload 2>/dev/null \
    && systemctl --user enable --now mk-update-check.timer mk-reminders.timer mk-watchdog.timer \
        mk-storage-sense.timer &>/dev/null \
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
# Files: right-click a folder for Lock / Unlock with MK Lock, and a lock badge
# on locked folders (a nautilus-python extension; setup.sh installs
# nautilus-python). The older Scripts entry it replaces is removed.
NAUTILUS_EXT="$HOME/.local/share/nautilus-python/extensions"
mkdir -p "$NAUTILUS_EXT"
cp -f "$SCRIPT_DIR/config/nautilus/mk-lock.py" "$NAUTILUS_EXT/mk-lock.py"
# ...and "Open in VS Code" on folders and the folder background (when VS Code is installed).
cp -f "$SCRIPT_DIR/config/nautilus/open-in-code.py" "$NAUTILUS_EXT/open-in-code.py"

# VS Code: the menu bar folded into the title bar's hamburger. VS Code's settings file
# allows comments and trailing commas, so it's edited as text (your comments stay):
# an existing key gets the new value, a missing one goes in right after the opening
# "{"; the result is checked before it's written, with a one-time settings.json.bak.
VSCODE_SETTINGS="$HOME/.config/Code/User/settings.json"
if command -v code > /dev/null 2>&1; then
    mkdir -p "$(dirname "$VSCODE_SETTINGS")"
    [[ -f "$VSCODE_SETTINGS" ]] || echo "{}" > "$VSCODE_SETTINGS"
    python3 - "$VSCODE_SETTINGS" << 'PY'
import json, re, shutil, sys
from pathlib import Path

path = Path(sys.argv[1])
want = {"window.titleBarStyle": "custom", "window.menuBarVisibility": "compact"}
text = original = path.read_text()


def loads_jsonc(t):
    """Parse VS Code's JSON with comments: drop comments and trailing commas outside strings."""
    out, i, n = [], 0, len(t)
    while i < n:
        c = t[i]
        if c == '"':
            j = i + 1
            while j < n and t[j] != '"':
                j += 2 if t[j] == "\\" else 1
            out.append(t[i:j + 1])
            i = j + 1
        elif t.startswith("//", i):
            i = t.find("\n", i) if "\n" in t[i:] else n
        elif t.startswith("/*", i):
            i = t.find("*/", i) + 2 if "*/" in t[i:] else n
        else:
            out.append(c)
            i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


try:
    current = loads_jsonc(text)
except ValueError:
    print(f"    [*] {path} couldn't be read; add these by hand: {json.dumps(want)}")
    sys.exit(0)
for key, value in want.items():
    if current.get(key) == value:
        continue
    pattern = re.compile(r'("' + re.escape(key) + r'"\s*:\s*)("(?:[^"\\]|\\.)*"|true|false|null|-?\d[\d.eE+-]*)')
    if key in current and pattern.search(text):
        text = pattern.sub(lambda m: m.group(1) + json.dumps(value), text, count=1)
    else:
        text = re.sub(r"^\s*\{", lambda m: m.group(0) + f"\n    {json.dumps(key)}: {json.dumps(value)},", text, count=1)
if text != original:
    try:
        assert all(loads_jsonc(text).get(k) == v for k, v in want.items())
    except (ValueError, AssertionError):
        print(f"    [*] Left {path} as it was (the edit didn't check out); add by hand: {json.dumps(want)}")
        sys.exit(0)
    backup = path.with_name(path.name + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(text)
    print("    [+] VS Code: menu bar in the title bar (compact)")
PY
fi
rm -f "$HOME/.local/share/nautilus/scripts/Lock or unlock folder"
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
# (third-party ones installed on a fresh install only: an update never adds extensions)
(( FRESH )) || ACTIVE_EXTENSIONS=()
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
# Smoother unlock: GNOME switches off every extension that isn't marked for the
# lock screen when you lock, and rebuilds them all as you unlock, which is the
# hitch you see as the lock screen slides away (and gestures don't answer for a
# moment). Keep the ones with nothing to show or type on the lock screen loaded:
# gestures (they only act on the normal desktop). Not the text grabber: it
# would work on the lock screen.
for uuid in touchpad-gesture-customization@coooolapps.com; do
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

# This project's own top-bar watermark: always refresh it so repo updates land.
MK_INDICATOR="mk-indicator@mehulk"
[[ -d "$USER_EXT_DIR/$MK_INDICATOR" ]] || NEW_EXTENSIONS=1
rm -rf "${USER_EXT_DIR:?}/$MK_INDICATOR"
cp -r "$SCRIPT_DIR/extensions/$MK_INDICATOR" "$USER_EXT_DIR/"
glib-compile-schemas "$USER_EXT_DIR/$MK_INDICATOR/schemas" || true
# MK Shell Engine: MK's own shell pieces (snap layouts now; its dock and blur
# start only while Dash to Dock / Blur my Shell are off). Refreshed the same way.
MK_ENGINE="mk-shell-engine@mehulk"
[[ -d "$USER_EXT_DIR/$MK_ENGINE" ]] || NEW_EXTENSIONS=1
rm -rf "${USER_EXT_DIR:?}/$MK_ENGINE"
cp -r "$SCRIPT_DIR/extensions/$MK_ENGINE" "$USER_EXT_DIR/"
glib-compile-schemas "$USER_EXT_DIR/$MK_ENGINE/schemas" || true

# WACK Sonoma Live Lockscreen: MK's merge of WACK Sonoma Lockscreen and Live Lock
# Screen (the Sonoma clock and prompt, a video / GIF / picture behind it, unlock
# animations, Now Playing, the power button), plus MK's top bar pieces (Finder,
# Places, the app indicator), Hibernate and the desktop's live wallpaper; settings
# behind its gear in Extension Manager. Refreshed from the repo like the engine;
# switched on or off by you in Extension Manager.
MK_LOCK="wack-sonoma-lockscreen@rinzler69-wastaken.github.com"
[[ -d "$USER_EXT_DIR/$MK_LOCK" ]] || NEW_EXTENSIONS=1
rm -rf "${USER_EXT_DIR:?}/$MK_LOCK"
cp -r "$SCRIPT_DIR/extensions/$MK_LOCK" "$USER_EXT_DIR/"
glib-compile-schemas "$USER_EXT_DIR/$MK_LOCK/schemas" || true
# It now plays the desktop's live wallpaper too (MK Shell Engine's stands aside while
# it's on): the desktop file chosen before (~/.config/mk/wallpaper.json) carries over
# to its desktop-wallpaper-path, once, while that is still empty.
LOCK_SCHEMA="org.gnome.shell.extensions.wack-sonoma-lockscreen"
old_desktop=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("desktop",""))' \
    "$HOME/.config/mk/wallpaper.json" 2>/dev/null || true)
if [[ -n "$old_desktop" ]] &&
    [[ "$(gsettings --schemadir "$USER_EXT_DIR/$MK_LOCK/schemas" get "$LOCK_SCHEMA" desktop-wallpaper-path 2>/dev/null)" == "''" ]]; then
    ext_set "$MK_LOCK" "$LOCK_SCHEMA" desktop-wallpaper-path "$old_desktop"
    echo "    [+] Desktop live wallpaper: now played by WACK Sonoma Live Lockscreen"
fi
# v23: the desktop video is decoded on the graphics card (VA-API), once: a CPU-decoded HD
# video made GNOME Shell drop frames under the dock and the top bar. Choosing "Processor"
# again afterwards (Suite settings › Video Decoding) sticks.
APPLIED_V23="$HOME/.config/mk-workstation/extensions-applied"
if (( FRESH )) && ! grep -qxF "set:desktop-hwaccel-vaapi" "$APPLIED_V23" 2>/dev/null; then
    ext_set "$MK_LOCK" "$LOCK_SCHEMA" desktop-hwaccel vaapi
    mkdir -p "$(dirname "$APPLIED_V23")"
    echo "set:desktop-hwaccel-vaapi" >> "$APPLIED_V23"
    echo "    [+] Desktop live wallpaper: decoded on the graphics card (VA-API)"
fi
# (Its "Sync Refresh Rate to GDM" button runs /usr/local/libexec/mk-gdm-monitors,
# root-owned, which setup.sh installs; an earlier copy in ~/.local/libexec goes.)
rm -f "$HOME/.local/libexec/mk/setup-system-optimizations.sh"

(( FRESH )) && gsettings set org.gnome.shell disable-user-extensions false
# Every installed extension's settings schemas, compiled (one copied from another machine, or
# installed by hand, may come without gschemas.compiled: its settings would fail to load).
for schemas in "$USER_EXT_DIR"/*/schemas; do
    [[ -d "$schemas" ]] || continue
    compgen -G "$schemas/*.gschema.xml" > /dev/null || continue
    glib-compile-schemas "$schemas" 2> /dev/null || true
done

# Stray players from elsewhere: autostart entries for other live-wallpaper, mpv or lock-screen
# tools would put a second player (a visible window) or an overlay on the desktop at login. They
# are moved aside, not deleted (~/.config/mk-workstation/backups/autostart/); MK's own are kept.
AUTOSTART_DIR="$HOME/.config/autostart"
# CopyQ too: MK's clipboard history (Super+V, in the shell) does its job without a resident app.
for entry in "$AUTOSTART_DIR"/*wallpaper*.desktop "$AUTOSTART_DIR"/*mpv*.desktop "$AUTOSTART_DIR"/*lockscreen*.desktop \
    "$AUTOSTART_DIR"/com.github.hluk.copyq.desktop "$AUTOSTART_DIR"/copyq.desktop; do
    [[ -f "$entry" ]] || continue
    case "$(basename "$entry")" in mk-*|spidey-*) continue ;; esac
    mkdir -p "$HOME/.config/mk-workstation/backups/autostart"
    mv -f "$entry" "$HOME/.config/mk-workstation/backups/autostart/"
    echo "    [*] Moved aside autostart entry $(basename "$entry") (a second player, or CopyQ: Super+V is MK's)"
done
# One-time steps sync has done on this computer, one line each, in
# ~/.config/mk-workstation/extensions-applied (delete a line to have it done again).
APPLIED="$HOME/.config/mk-workstation/extensions-applied"
mkdir -p "$(dirname "$APPLIED")"
if [[ ! -f "$APPLIED" ]]; then
    touch "$APPLIED"
    # An install from before this list existed: take today's switches as yours (nothing changes now).
    if gsettings get org.gnome.shell enabled-extensions | grep -q "$MK_INDICATOR"; then
        for uuid in "${CURATED_EXTENSIONS[@]}"; do echo "enable:$uuid"; done >> "$APPLIED"
    fi
fi
first_time() { ! grep -qxF -- "$1" "$APPLIED"; }

# The lock screen's unlock: a slight zoom that fades into the desktop (1.03x to 1.0, 320 ms), set
# once; a different choice in the Command Centre stays yours.
if (( FRESH )) && first_time "lock-unlock-zoom"; then
    ext_set "$MK_LOCK" "$LOCK_SCHEMA" unlock-animation zoom
    ext_set "$MK_LOCK" "$LOCK_SCHEMA" animation-duration 320
    echo "lock-unlock-zoom" >> "$APPLIED"
fi

# Fresh install: exactly the curated extensions on, every other one off (GNOME's own included);
# an update leaves your switches exactly as they are.
if (( FRESH )); then
    list=$(printf "'%s', " "${CURATED_EXTENSIONS[@]}")
    gsettings set org.gnome.shell enabled-extensions "[${list%, }]"
    gsettings_remove org.gnome.shell disabled-extensions "${CURATED_EXTENSIONS[@]}"
    for uuid in "${CURATED_EXTENSIONS[@]}"; do
        grep -qxF "enable:$uuid" "$APPLIED" || echo "enable:$uuid" >> "$APPLIED"
    done
    echo "    [+] Extensions on: ${CURATED_EXTENSIONS[*]%%@*} (every other one off)"
    # Extension managers are tools you open now and then, not dock apps.
    gsettings_remove org.gnome.shell favorite-apps com.mattjakeman.ExtensionManager.desktop org.gnome.Extensions.desktop
fi
if [[ -d "$HOME/.local/share/gnome-shell/extensions/macos-dock@vinnytherobot.github.io" ]]; then
    gnome-extensions uninstall macos-dock@vinnytherobot.github.io 2>/dev/null \
        || rm -rf "$HOME/.local/share/gnome-shell/extensions/macos-dock@vinnytherobot.github.io"
fi

# Steps 3 to 7 are MK's default desktop settings: applied on a fresh install (or with
# --reset-defaults) only, so an update never puts back a setting you changed.
if (( FRESH )); then
# 3. Window Management & Multitasking (All Workspaces, Zero Lag)
# Every keyboard shortcut lives in config/shortcuts.conf (applied in step 9).
echo "==> Applying window management settings..."
gsettings set org.gnome.shell.app-switcher current-workspace-only false
gsettings set org.gnome.shell.window-switcher current-workspace-only false
# Touchpad Gesture Customization rewrites the line above every time it starts
# (login, unlock) from its own option, which defaults to current workspace only.
ext_set touchpad-gesture-customization@coooolapps.com \
    org.gnome.shell.extensions.touchpad-gesture-customization alttab-all-workspaces true

# Super+arrows: GNOME's own halves, maximize and restore.
gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Super>Left']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Super>Right']"
gsettings set org.gnome.desktop.wm.keybindings maximize "['<Super>Up']"
gsettings set org.gnome.desktop.wm.keybindings unmaximize "['<Super>Down']"
# Busy apps (games, compiles) get 20s before GNOME shows "not responding" (default 5s).
gsettings set org.gnome.mutter check-alive-timeout 20000

# 4. Workspaces, Spaces style: they come and go as you use them, and the last
# one is always empty, so "go to the last workspace" (Super+Ctrl+D) opens a
# fresh desktop. Ctrl+Alt+arrows stay free for Zen Browser.
gsettings set org.gnome.mutter dynamic-workspaces true
gsettings set org.gnome.mutter workspaces-only-on-primary true

# A fresh install that still has Fedora's own wallpaper gets MK's first (Super+W cycles them and
# yours in Pictures/Wallpapers); a wallpaper you chose is never replaced.
case "$(gsettings get org.gnome.desktop.background picture-uri-dark)" in
    *"/usr/share/backgrounds/"*|"''")
        if [[ -f "$MK_SHARE/assets/wallpapers/obsidian-aurora.jpg" ]]; then
            for key in picture-uri picture-uri-dark; do
                gsettings set org.gnome.desktop.background "$key" "file://$MK_SHARE/assets/wallpapers/obsidian-aurora.jpg"
            done
        fi
        ;;
esac

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
# The lock screen shows nothing of the session: no notifications there
# (mk-indicator also hides the media player GNOME shows regardless), and
# window animations stay on.
gsettings set org.gnome.desktop.notifications show-in-lock-screen false
gsettings set org.gnome.desktop.interface enable-animations true
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
# behind any wallpaper: solid black (never a colour seam at an edge of a live wallpaper)
gsettings set org.gnome.desktop.background primary-color '#000000'
gsettings set org.gnome.desktop.background color-shading-type 'solid'
gsettings set org.gnome.desktop.interface clock-show-weekday true
gsettings set org.gnome.settings-daemon.plugins.color night-light-enabled true

# 7. Smooth Animation Performance Tweaks
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.overview blur false
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.lockscreen blur false
# The panel when Blur my Shell is on: dynamic blur (it follows what's behind), the
# background overridden only while a window touches the bar, the default style
# (style-panel 0), so it sits with MK's own glass islands instead of fighting them.
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel blur true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel static-blur false
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel override-background true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel override-background-dynamically true
ext_set blur-my-shell@aunetx org.gnome.shell.extensions.blur-my-shell.panel style-panel 0
# Fractional scaling (e.g. 125%) without blur: native framebuffer scaling, and
# X11 apps (Steam, many games) rendered at native size instead of upscaled.
# (GNOME 51 has both built in and no longer has the experimental-features key.)
if gsettings list-keys org.gnome.mutter | grep -qx experimental-features; then
    gsettings_append org.gnome.mutter experimental-features scale-monitor-framebuffer xwayland-native-scaling
fi

# A saved setting that names a file this machine doesn't have (a wallpaper photo or video from
# the machine it was exported on) is left out, so the extension keeps its own default instead of
# pointing at nothing (a blank lock screen, a wallpaper player started for a missing file).
drop_missing_files() {
    local line value
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[a-z0-9-]+=\'(file://)?(/[^\']*)\'$ ]]; then
            value="${BASH_REMATCH[2]}"
            [[ -n "${BASH_REMATCH[1]}" ]] && printf -v value '%b' "${value//%/\\x}"   # (file:// URIs: %20 and co.)
            if [[ ! -e "$value" ]]; then
                echo "    [*] Left out ${line%%=*} (no $value on this machine)" >&2
                continue
            fi
        fi
        printf '%s\n' "$line"
    done
}

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
    # (__USER_HOME__ from `mk export`; a literal /home/<someone>/ from an older dump is this home too)
    sed -E -e "s|__USER_HOME__|$HOME|g" -e "s#/home/[^/']+/#$HOME/#g" "$settings" | drop_missing_files | dconf load "$path"
done
# Blur my Shell's top bar: dynamic blur, its background overridden only while a window
# touches the bar, the default style (straight to dconf: in place even before the
# extension's schema is installed)
dconf write /org/gnome/shell/extensions/blur-my-shell/panel/blur true
dconf write /org/gnome/shell/extensions/blur-my-shell/panel/static-blur false
dconf write /org/gnome/shell/extensions/blur-my-shell/panel/override-background true
dconf write /org/gnome/shell/extensions/blur-my-shell/panel/override-background-dynamically true
dconf write /org/gnome/shell/extensions/blur-my-shell/panel/style-panel 0
# and no Dash to Dock blur: MK's dock isn't Dash to Dock, and that pass only ever left a
# rectangle of blurred still wallpaper where a dock would be
dconf write /org/gnome/shell/extensions/blur-my-shell/dash-to-dock/blur false
fi  # (FRESH: default settings)

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

# 8a. Audio routing: apps follow the default output (WirePlumber stops pinning them
# to a remembered one, e.g. Easy Effects' sink, which left Spotify and browsers
# silent), and mk-audio-init checks the stack and the output at every login.
# The drop-in takes effect when WirePlumber next starts (login, or
# ./scripts/setup-audio.sh now); a sync never restarts audio for it.
install -Dm644 "$SCRIPT_DIR/config/wireplumber/51-mk-follow-default.conf" \
    "$HOME/.config/wireplumber/wireplumber.conf.d/51-mk-follow-default.conf"
# the built-in speaker outranks HDMI and virtual outputs at every boot (read at the next login)
install -Dm644 "$SCRIPT_DIR/config/wireplumber/52-prefer-hardware-speaker.conf" \
    "$HOME/.config/wireplumber/wireplumber.conf.d/52-prefer-hardware-speaker.conf"
# B&O-style tuning for the built-in speakers (a PipeWire smart filter; bin/mk-bo-tuning).
# Installed here, applied at the next login: a sync never restarts the sound.
"$HOME/.local/bin/mk-bo-tuning" install || echo "    [*] B&O tuning: not installed this time"
cat > "$HOME/.config/systemd/user/mk-audio-init.service" << 'UNIT'
[Unit]
Description=MK Workstation: sound for every app at login (bin/mk-audio-init)
After=pipewire.service pipewire-pulse.service wireplumber.service
Wants=pipewire-pulse.service wireplumber.service

[Service]
Type=oneshot
ExecStart=%h/.local/bin/mk-audio-init --watch
TimeoutStartSec=45
RemainAfterExit=yes

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload 2> /dev/null && systemctl --user enable mk-audio-init.service &> /dev/null || true

# 8b. Audio: only repaired when a service is down (a sync never cuts what's playing)
if ! "$SCRIPT_DIR/scripts/repair-audio.sh" --check >/dev/null 2>&1; then
    echo "==> Audio services were down: restarting them..."
    "$SCRIPT_DIR/scripts/repair-audio.sh" || echo "    [!] Audio repair failed: run scripts/repair-audio.sh --force"
fi

# 8c. Terminal helpers (alert-when-done): ~/.bashrc sources the installed copy, added once
install -Dm644 "$SCRIPT_DIR/config/bashrc_mk.sh" "$HOME/.config/mk-workstation/bashrc_mk.sh"
# shellcheck disable=SC2016  # (written into ~/.bashrc as it is: $HOME expands when bash reads it)
BASHRC_LINE='[ -f "$HOME/.config/mk-workstation/bashrc_mk.sh" ] && . "$HOME/.config/mk-workstation/bashrc_mk.sh"'
if ! grep -qF "mk-workstation/bashrc_mk.sh" "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# MK Workstation terminal helpers\n%s\n' "$BASHRC_LINE" >> "$HOME/.bashrc"
fi

# 9. Register Custom Hotkeys
echo "==> Registering MK custom shortcuts..."
remove_legacy_shortcuts
# Every shortcut: config/shortcuts.conf, then your changes from the Shortcuts
# window (Super+/) in ~/.config/mk-workstation/shortcuts.conf. Runs after the
# saved extension settings, so your choices win over extension defaults too.
# Fresh install: all of them (each noted in shortcuts-applied); update: only shortcuts MK added
# since, so a key you changed in GNOME Settings is never put back.
SHORTCUTS_LEDGER="$HOME/.config/mk-workstation/shortcuts-applied"
if (( FRESH )); then
    PYTHONPATH="$MK_SHARE/lib" python3 -m mkworkstation apply-shortcuts --record "$SHORTCUTS_LEDGER"
else
    PYTHONPATH="$MK_SHARE/lib" python3 -m mkworkstation apply-shortcuts --only-new "$SHORTCUTS_LEDGER"
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
(( FRESH )) && dedupe_custom_shortcuts

# The folders MK's tools save to and read from, on any account (made if missing)
mkdir -p "$(xdg-user-dir PICTURES 2>/dev/null || echo "$HOME/Pictures")/Screenshots" \
    "$(xdg-user-dir VIDEOS 2>/dev/null || echo "$HOME/Videos")/Wallpapers" \
    "$HOME/.config/mk" "$HOME/.local/bin" "$HOME/.config/pipewire/pipewire.conf.d"

echo "==> Checking packages..."
check_deps || true
# One camera app: GNOME's Camera (snapshot). Duplicates installed for your account alone go now;
# system-wide ones are named (sync runs as you: `sudo ./setup.sh` removes them).
if flatpak info --user hu.irl.cameractrls &> /dev/null; then
    flatpak uninstall --user -y --noninteractive hu.irl.cameractrls &> /dev/null &&
        echo "    [+] Removed Camera Controls (duplicate camera app)"
fi
dupes=()
for pkg in kamoso cheese guvcview droidcam cameractrls; do
    rpm -q "$pkg" &> /dev/null && dupes+=("$pkg")
done
flatpak info --system hu.irl.cameractrls &> /dev/null && dupes+=("hu.irl.cameractrls (Flatpak)")
if (( ${#dupes[@]} )); then
    echo "    [*] Duplicate camera apps installed: ${dupes[*]} (GNOME's Camera is the one MK keeps;"
    echo "        sudo ./setup.sh removes them)"
fi
if (( FRESH )); then
    mkdir -p "$(dirname "$MARKER")"
    date -Iseconds > "$MARKER"
fi
echo "✔ Workstation configurations synchronized."
if (( NEW_EXTENSIONS )); then
    echo "  New extensions were installed: log out and back in to load them."
fi
