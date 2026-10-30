#!/bin/bash
# MK Notes: notebooks, ink, tables, PDF printouts.
# Standalone install of mk-notes (no root): see ../install-app.sh.
# shellcheck disable=SC2034  # the settings below are read by install-app.sh
APP_BIN=mk-notes
APP_ID=io.github.mehulk.MkNotes
APP_GI="Gtk:4.0 Adw:1 PangoCairo:1.0 GdkPixbuf:2.0"
APP_PY="cairo"
APP_CMDS=""
APP_OPTIONAL="pdftoppm:PDF_printouts bwrap:sandboxed_PDF_reading tesseract:text_from_pictures"
APP_DIRS="Notes"
APP_PKGS="python3-gobject python3-cairo gtk4 libadwaita poppler-utils bubblewrap"
# shellcheck source=../install-app.sh
source "$(dirname "${BASH_SOURCE[0]}")/../install-app.sh"
