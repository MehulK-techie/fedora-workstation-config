#!/usr/bin/env bash
# Build docs/MK-Workstation-Overview.pptx (or: just deck).
# Needs Node.js; pptxgenjs is installed into ~/.cache/mk-workstation/deck on
# first run. Icons come from GNOME's Adwaita theme and the installed apps.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/mk-workstation/deck"
OUT="${1:-$REPO/docs/MK-Workstation-Overview.pptx}"
command -v node > /dev/null || { echo "[-] Node.js is needed: sudo dnf install nodejs" >&2; exit 1; }
mkdir -p "$CACHE"
if [[ ! -d "$CACHE/node_modules/pptxgenjs" ]]; then
    (cd "$CACHE" && npm install --silent --no-audit --no-fund pptxgenjs@3.12.0)
fi
ASSETS=$(mktemp -d)
trap 'rm -rf "$ASSETS"' EXIT

python3 - "$REPO" "$ASSETS" << 'PY'
import glob, re, sys
from pathlib import Path
import gi
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf
from PIL import Image

repo, assets = Path(sys.argv[1]), Path(sys.argv[2])
shots = repo / "docs/assets/screens"
for sub in ("img", "icons", "apps"):
    (assets / sub).mkdir()

def crop(name, box, out):
    im = Image.open(shots / f"{name}.jpg")
    k = im.width / 1920
    im.crop(tuple(int(v * k) for v in box)).save(assets / "img" / f"{out}.jpg", quality=92)

crop("companion", (675, 170, 1245, 945), "companion")
crop("quick-settings", (1415, 50, 1905, 610), "quick")
crop("shortcuts-window", (486, 76, 1436, 1032), "shortcuts")
for name in ("welcome", "alttab", "tiled", "notes-split", "notes-tasks", "scene-web", "scene-knight", "scene-matrix",
             "speedtest", "media", "phone-note", "dock-magnify"):
    Image.open(shots / f"{name}.jpg").save(assets / "img" / f"{name}.jpg", quality=92)

# GNOME's symbolic icons, white, for the coloured circles.
for name in ("input-touchpad view-dual window-new alarm view-pin x-office-calendar document-edit "
             "x-office-document network-workgroup document-open-recent view-reveal checkbox-checked "
             "auth-fingerprint battery-full audio-speakers input-tablet video-display edit-undo user-trash "
             "software-update-available weather-clear-night preferences-color applications-graphics edit-paste "
             "face-smile view-grid system-run emblem-system").split():
    found = glob.glob(f"/usr/share/icons/Adwaita/**/{name}-symbolic.svg", recursive=True)
    if not found:
        continue
    svg = open(found[0]).read()
    svg = re.sub(r'fill="#[0-9a-fA-F]{3,6}"', 'fill="#ffffff"', svg)
    svg = re.sub(r"(fill:\s*)#[0-9a-fA-F]{3,6}", r"\1#ffffff", svg).replace("<svg ", '<svg fill="#ffffff" ', 1)
    loader = GdkPixbuf.PixbufLoader.new_with_type("svg")
    loader.set_size(256, 256)
    loader.write(svg.encode())
    loader.close()
    loader.get_pixbuf().savev(str(assets / "icons" / f"{name}.png"), "png", [], [])

# App icons: MK's own, then installed Flatpaks and system apps.
dirs = [repo / "assets/icons", Path("/var/lib/flatpak/exports/share/icons/hicolor/scalable/apps"),
        Path("/var/lib/flatpak/exports/share/icons/hicolor/256x256/apps"),
        Path("/var/lib/flatpak/exports/share/icons/hicolor/128x128/apps"), Path("/usr/share/pixmaps")]
blank = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8, 256, 256)
blank.fill(0xdde6f5ff)
for app in ("app.zen_browser.zen net.cozic.joplin_desktop org.onlyoffice.desktopeditors vscode com.spotify.Client "
            "net.lutris.Lutris com.mattjakeman.ExtensionManager net.sonobus.SonoBus com.github.tenderowl.frog "
            "one.alynx.FlipClock io.github.mehulk.MkNotes io.github.mehulk.MkCompanion io.github.mehulk.MkTimer "
            "io.github.mehulk.MkShortcuts").split():
    paths = [d / f"{app}{ext}" for d in dirs for ext in (".svg", ".png")]
    path = next((p for p in paths if p.exists()), None)
    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(path), 256, 256, True) if path else blank
    pixbuf.savev(str(assets / "apps" / f"{app}.png"), "png", [], [])
PY

NODE_PATH="$CACHE/node_modules" node "$REPO/docs/overview/deck.js" "$ASSETS" "$OUT"

# Theme colours and name into ppt/theme/theme1.xml.
python3 - "$OUT" << 'PY'
import json, re, shutil, sys, zipfile
from xml.sax.saxutils import escape
out = sys.argv[1]
theme = json.load(open(out + ".theme.json"))
tmp = out + ".tmp"
with zipfile.ZipFile(out) as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as dst:
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename.startswith("ppt/theme/theme") and item.filename.endswith(".xml"):
            xml = data.decode()
            for slot, value in theme["colors"].items():
                xml = re.sub(rf"<a:{slot}>.*?</a:{slot}>", f'<a:{slot}><a:srgbClr val="{value}"/></a:{slot}>', xml, flags=re.S)
            xml = re.sub(r'(<a:clrScheme name=")[^"]*"', rf'\g<1>{escape(theme["name"])}"', xml)
            data = xml.encode()
        dst.writestr(item, data)
shutil.move(tmp, out)
PY
rm -f "$OUT.theme.json"
echo "✔ $OUT"
