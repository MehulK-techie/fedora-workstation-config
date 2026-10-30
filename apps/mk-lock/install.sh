#!/bin/bash
# MK Lock: app locks, encrypted folders, the vault.
# Standalone install of mk-lock (no root): see ../install-app.sh.
# shellcheck disable=SC2034  # the settings below are read by install-app.sh
APP_BIN=mk-lock
APP_ID=io.github.mehulk.MkVault
APP_GI="Gtk:4.0 Adw:1"
APP_PY=""
APP_CMDS="pkcheck gocryptfs"
APP_OPTIONAL="fprintd-verify:fingerprint howdy:Face_ID"
APP_DIRS=""
APP_PKGS="python3-gobject gtk4 libadwaita polkit gocryptfs"
# shellcheck source=../install-app.sh
source "$(dirname "${BASH_SOURCE[0]}")/../install-app.sh"
