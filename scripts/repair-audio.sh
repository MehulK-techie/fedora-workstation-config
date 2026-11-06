#!/usr/bin/env bash
# Sound gone? Restart the audio stack (PipeWire, its PulseAudio bridge and
# WirePlumber) for your user and unmute the default output.
#
#   ./scripts/repair-audio.sh           check, and repair only what's down
#   ./scripts/repair-audio.sh --force   restart everything (cuts sound for a second)
#   ./scripts/repair-audio.sh --check   report only (exit 1 when something is down)
#
# User services only: no sudo, nothing in /etc. sync.sh runs it with --check
# and repairs only when a service is down, so a sync never interrupts what's
# playing, and never unmutes what you muted.
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
    echo "Run it as yourself, not with sudo: these are your session's services." >&2
    exit 1
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

UNITS=(pipewire.socket pipewire-pulse.socket pipewire.service pipewire-pulse.service wireplumber.service)
MODE=${1:-}

down=()
for unit in "${UNITS[@]}"; do
    systemctl --user is-active --quiet "$unit" || down+=("$unit")
done

if [[ "$MODE" == "--check" ]]; then
    if (( ${#down[@]} )); then
        echo "Audio: not running: ${down[*]}"
        exit 1
    fi
    echo "Audio: PipeWire, pipewire-pulse and WirePlumber are running."
    exit 0
fi

if (( ${#down[@]} == 0 )) && [[ "$MODE" != "--force" ]]; then
    echo "Audio: everything is running. (--force restarts it anyway.)"
else
    echo "Audio: restarting PipeWire, pipewire-pulse and WirePlumber..."
    systemctl --user daemon-reload
    systemctl --user enable --now pipewire.socket pipewire-pulse.socket wireplumber.service
    systemctl --user restart pipewire.service pipewire-pulse.service wireplumber.service
    sleep 1
fi

if command -v wpctl >/dev/null; then
    wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 || true
    echo "Audio: default output unmuted ($(wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null || echo 'no output found'))."
fi
