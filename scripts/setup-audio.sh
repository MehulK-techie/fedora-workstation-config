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
#   3. installs 52-prefer-hardware-speaker.conf: the built-in speaker outranks HDMI
#      and virtual outputs at every boot
#   4. Easy Effects no longer starts at login (it took over the output on cold
#      boots): MK's speaker-tuning entry (~/.config/autostart/mk-sound.desktop) and
#      Easy Effects' own (com.github.wwmm.easyeffects.desktop) are switched off
#      (each backed up once to .bak), and its background service is stopped.
#      `mk sound on` brings the tuning back whenever you want it.
#   5. shows the result (wpctl status)
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
install -Dm644 "$SCRIPT_DIR/config/wireplumber/52-prefer-hardware-speaker.conf" \
    "$HOME/.config/wireplumber/wireplumber.conf.d/52-prefer-hardware-speaker.conf"

# Easy Effects off at login (idempotent: a switched-off entry is left alone)
for entry in "$HOME/.config/autostart/mk-sound.desktop" "$HOME/.config/autostart/com.github.wwmm.easyeffects.desktop"; do
    [[ -f "$entry" ]] || continue
    if ! grep -q '^Hidden=true' "$entry"; then
        [[ -e "$entry.bak" ]] || cp -a "$entry" "$entry.bak"
        sed -i -E 's/^X-GNOME-Autostart-enabled=.*/X-GNOME-Autostart-enabled=false/' "$entry"
        grep -q '^X-GNOME-Autostart-enabled=' "$entry" || echo 'X-GNOME-Autostart-enabled=false' >> "$entry"
        echo 'Hidden=true' >> "$entry"
        echo "Easy Effects won't start at login: $(basename "$entry") switched off ('mk sound on' turns the tuning back on)"
    fi
done
if pgrep -f 'easyeffects.*(--service-mode|--gapplication-service)' > /dev/null; then
    easyeffects -q 2> /dev/null || pkill -f 'easyeffects.*(--service-mode|--gapplication-service)' || true
    sleep 1
    echo "Easy Effects' background service stopped"
fi
install -Dm755 "$SCRIPT_DIR/bin/mk-audio-init" "$HOME/.local/bin/mk-audio-init"
"$HOME/.local/bin/mk-audio-init" --clean
echo
wpctl status 2> /dev/null | sed -n '/^Audio/,/^Video/p' | sed '$d'
pinned=$(grep -c '"target"' "${XDG_STATE_HOME:-$HOME/.local/state}/wireplumber/stream-properties" 2> /dev/null) || true
echo "Apps still pinned to an output: ${pinned:-0}"
