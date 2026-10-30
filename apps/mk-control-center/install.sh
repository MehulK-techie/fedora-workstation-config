#!/bin/bash
# MK Control Center: quick settings, actions, MK Lock, security.
# Standalone install of mk-center (no root): see ../install-app.sh.
# shellcheck disable=SC2034  # the settings below are read by install-app.sh
APP_BIN=mk-center
APP_ID=io.github.mehulk.MkCenter
APP_GI="Gtk:4.0 Adw:1"
APP_PY="cairo"
APP_CMDS="nmcli pactl systemd-inhibit"
APP_OPTIONAL="howdy:Face_ID fprintd-list:fingerprints mk-lock:app_locks"
APP_DIRS=""
APP_PKGS="python3-gobject gtk4 libadwaita NetworkManager pulseaudio-utils"
# shellcheck source=../install-app.sh
source "$(dirname "${BASH_SOURCE[0]}")/../install-app.sh"
