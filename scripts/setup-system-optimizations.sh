#!/usr/bin/env bash
# The login screen at your refresh rate and resolution: copies your display
# settings (~/.config/monitors.xml: resolution, refresh rate, scale) to GDM's,
# so the login screen (and the switch to your session) runs at the same rate,
# with no mode change, as your desktop. Run it yourself (it writes GDM's home):
#
#   sudo scripts/setup-system-optimizations.sh [--user NAME] [--dry-run]
#
# The lock screen extension's "Sync refresh to GDM" button runs it through
# pkexec (it asks for your password). Safe to run again: it copies only when
# the files differ, and backs GDM's old file up once (monitors.xml.bak, never
# overwritten).
set -euo pipefail

DRY=0
USER_NAME="${SUDO_USER:-}"
if [[ -z "$USER_NAME" && -n "${PKEXEC_UID:-}" ]]; then
    USER_NAME=$(getent passwd "$PKEXEC_UID" | cut -d: -f1)
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --user) USER_NAME="${2:?--user needs a name}"; shift 2 ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 && $DRY -eq 0 ]]; then
    echo "Run it as root: sudo $0" >&2
    exit 1
fi
USER_NAME=${USER_NAME:-$(id -un)}

home=$(getent passwd "$USER_NAME" | cut -d: -f6)
gdm_home=$(getent passwd gdm | cut -d: -f6)
src="$home/.config/monitors.xml"
dst="${gdm_home:-/var/lib/gdm}/.config/monitors.xml"

if [[ ! -f "$src" ]]; then
    echo "No display settings at $src yet: change a display setting in Settings once (or apply the current one), then run this again." >&2
    exit 1
fi
if [[ -z "$gdm_home" ]]; then
    echo "No gdm user here: is GDM the login screen?" >&2
    exit 1
fi

if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "GDM already uses your display settings."
    exit 0
fi

if [[ $DRY -eq 1 ]]; then
    echo "would copy $src -> $dst (owner gdm:gdm, mode 644)"
    exit 0
fi

if [[ -f "$dst" && ! -e "$dst.bak" ]]; then
    cp -a "$dst" "$dst.bak"
fi
install -D -o gdm -g gdm -m 644 "$src" "$dst"
command -v restorecon > /dev/null && restorecon "$dst" || true
echo "GDM now uses your display settings ($dst). They apply from the next login screen."
