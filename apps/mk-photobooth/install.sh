#!/bin/bash
# MK Photo Booth: webcam looks, frames, stickers.
# Standalone install of camera-controls (no root): see ../install-app.sh.
# shellcheck disable=SC2034  # the settings below are read by install-app.sh
APP_BIN=camera-controls
APP_ID=io.github.mehulk.MkCamera
APP_GI="Gtk:4.0 Adw:1 Gst:1.0 Pango:1.0 PangoCairo:1.0"
APP_PY="cairo PIL"
APP_CMDS="v4l2-ctl"
APP_OPTIONAL=""
APP_DIRS=""
APP_PKGS="python3-gobject python3-cairo python3-pillow gtk4 libadwaita gstreamer1-plugins-good v4l-utils"
# shellcheck source=../install-app.sh
source "$(dirname "${BASH_SOURCE[0]}")/../install-app.sh"
