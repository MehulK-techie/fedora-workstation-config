#!/usr/bin/env bash
# Sound for every app, once (no sudo): Spotify and browsers silent while system
# sounds work. WirePlumber had pinned those apps to an output it remembered
# (Easy Effects' virtual sink); when that passed nothing on, they went quiet.
#
#   ./scripts/setup-audio.sh
#
#   1. installs config/wireplumber/51-mk-follow-default.conf: apps always
#      follow the current default output
#   2. mk-audio-init --clean: forgets the pinned outputs, restarts PipeWire,
#      pipewire-pulse and WirePlumber together (sound stops for a second),
#      picks the built-in output, moves anything playing onto it
#   3. shows the result (wpctl status)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $EUID -eq 0 ]]; then
    echo "Run it as yourself, not with sudo: these are your session's services." >&2
    exit 1
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
install -Dm644 "$SCRIPT_DIR/config/wireplumber/51-mk-follow-default.conf" \
    "$HOME/.config/wireplumber/wireplumber.conf.d/51-mk-follow-default.conf"
install -Dm755 "$SCRIPT_DIR/bin/mk-audio-init" "$HOME/.local/bin/mk-audio-init"
"$HOME/.local/bin/mk-audio-init" --clean
echo
wpctl status 2> /dev/null | sed -n '/^Audio/,/^Video/p' | sed '$d'
echo "Apps still pinned to an output: $(grep -c '"target"' "${XDG_STATE_HOME:-$HOME/.local/state}/wireplumber/stream-properties" 2> /dev/null || echo 0)"
