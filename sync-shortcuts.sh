#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: Master Shortcuts, Performance & UI Synchronizer
# ==============================================================================
# Kept so older `mk update` installs keep working. All desktop settings now
# live in sync.sh; this just runs it (as the desktop user if started via sudo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -eq 0 && -n "${SUDO_USER:-}" ]]; then
    REAL_UID=$(id -u "$SUDO_USER")
    exec sudo -u "$SUDO_USER" env \
        HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)" \
        XDG_RUNTIME_DIR="/run/user/$REAL_UID" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$REAL_UID/bus" \
        "$SCRIPT_DIR/sync.sh" "$@"
fi
exec "$SCRIPT_DIR/sync.sh" "$@"
