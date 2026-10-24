"""Build docs/MK-Workstation-Overview.pdf from the screenshots in docs/assets/screens.

    python3 docs/overview/build.py            (or: just overview)

Pure cairo + Pango (no extra Python packages). The PDF is interactive: the
contents page and every footer link to the pages, the PDF has bookmarks, and
web addresses are clickable. App icons on the apps page come from the icon
theme of the computer that builds it (drawn as names if one is missing).
Screenshots come from docs/overview/capture.py (your desktop) or a headless
GNOME Shell, always on Fedora's own wallpaper.
"""
import io
import sys
from pathlib import Path

import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
gi.require_version("GdkPixbuf", "2.0")
gi.require_foreign("cairo")
import cairo  # noqa: E402
from gi.repository import GdkPixbuf, Pango, PangoCairo  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "docs/assets/screens"
OUT = str(sys.argv[2]) if len(sys.argv) > 2 else str(REPO / "docs/MK-Workstation-Overview.pdf")
GITHUB = "https://github.com/MehulK-techie/fedora-workstation-config"
SOURCE_WIDTH = 1920  # crops below are in 1920x1080 screen pixels
W, H = 960, 540
M = 56  # page margin

INK = (0.059, 0.090, 0.165)
MUTED = (0.36, 0.42, 0.51)
BLUE = (0.145, 0.388, 0.922)
BLUE_SOFT = (0.90, 0.93, 0.99)
NIGHT = (0.035, 0.055, 0.13)
LINE = (0.89, 0.91, 0.94)
FONT = "Adwaita Sans"

# ---------------------------------------------------------------- drawing helpers


def rgb(cr, c, a=1.0):
    cr.set_source_rgba(*c, a)


def text(cr, markup, x, y, width, size, color=INK, weight="Regular", align="left", spacing=1.0):
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription.from_string(f"{FONT} {weight} {size}"))
    layout.set_width(int(width * Pango.SCALE))
    layout.set_wrap(Pango.WrapMode.WORD)
    layout.set_line_spacing(spacing)
    layout.set_alignment({"left": Pango.Alignment.LEFT, "center": Pango.Alignment.CENTER,
                          "right": Pango.Alignment.RIGHT}[align])
    layout.set_markup(markup, -1)
    rgb(cr, color)
    cr.move_to(x, y)
    PangoCairo.show_layout(cr, layout)
    return layout.get_pixel_size()[1]


def rounded(cr, x, y, w, h, r):
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -1.5708, 0)
    cr.arc(x + w - r, y + h - r, r, 0, 1.5708)
    cr.arc(x + r, y + h - r, r, 1.5708, 3.1416)
    cr.arc(x + r, y + r, r, 3.1416, 4.7124)
    cr.close_path()


def load(name):
    pixbuf = GdkPixbuf.Pixbuf.new_from_file(str(SHOTS / f"{name}.jpg"))
    ok, png = pixbuf.save_to_bufferv("png", [], [])
    return cairo.ImageSurface.create_from_png(io.BytesIO(png))


def paint_scaled(cr, src, cx, cy, cw, ch, x, y, w, h):
    """Paint a crop of src into (x, y, w, h), filling it; sharp at 2x."""
    scale = max(w / cw, h / ch)
    k = min(1.0, 2.5 * scale)
    small = cairo.ImageSurface(cairo.FORMAT_RGB24, max(1, int(cw * k)), max(1, int(ch * k)))
    sc = cairo.Context(small)
    sc.scale(k, k)
    sc.set_source_surface(src, -cx, -cy)
    sc.get_source().set_filter(cairo.FILTER_BEST)
    sc.paint()
    cr.save()
    cr.rectangle(x, y, w, h)
    cr.clip()
    cr.translate(x, y)
    cr.scale(scale / k, scale / k)
    cr.set_source_surface(small, 0, 0)
    cr.get_source().set_filter(cairo.FILTER_BEST)
    cr.paint()
    cr.restore()


def image(cr, name, x, y, w, h=None, crop=None, radius=10, border=True):
    """A screenshot scaled to width w (height from the aspect unless h)."""
    src = load(name)
    k = src.get_width() / SOURCE_WIDTH if crop else 1
    cx, cy, cw, ch = [v * k for v in crop] if crop else (0, 0, src.get_width(), src.get_height())
    if h is None:
        h = ch * w / cw
    for i, a in ((10, 0.025), (5, 0.04), (2, 0.06)):
        rounded(cr, x - i / 2, y + i / 2, w + i, h + i / 2, radius + i)
        cr.set_source_rgba(0, 0, 0, a)
        cr.fill()
    cr.save()
    rounded(cr, x, y, w, h, radius)
    cr.clip()
    paint_scaled(cr, src, cx, cy, cw, ch, x, y, w, h)
    cr.restore()
    if border:
        rounded(cr, x, y, w, h, radius)
        cr.set_line_width(0.75)
        rgb(cr, LINE)
        cr.stroke()
    return h


def link(cr, target, x, y, w, h):
    """Make a rectangle clickable: a page name or a web address."""
    attrs = f"uri='{target}'" if "://" in target else f"dest='{target}'"
    cr.tag_begin(cairo.TAG_LINK, f"{attrs} rect=[{x} {y} {w} {h}]")
    cr.tag_end(cairo.TAG_LINK)


def kicker_title(cr, kicker, title, y=M - 8, color=INK, kicker_color=BLUE):
    rgb(cr, kicker_color)
    cr.rectangle(M, y + 3, 22, 3)
    cr.fill()
    text(cr, kicker.upper(), M + 30, y - 4, 520, 8.5, kicker_color, "Bold")
    return y + 18 + text(cr, title, M, y + 14, W - 2 * M, 26, color, "Bold", spacing=0.95)


def lede(cr, s, x, y, w, size=12.5, color=MUTED):
    return text(cr, s, x, y, w, size, color, spacing=1.12)


def points(cr, items, x, y, width, size=11, gap=10, color=INK):
    for title, body in items:
        rgb(cr, BLUE)
        cr.new_sub_path()
        cr.arc(x + 3, y + 8, 2.6, 0, 6.2832)
        cr.fill()
        used = text(cr, f"<b>{title}</b>" + (f"  <span foreground='#5b677c'>{body}</span>" if body else ""),
                    x + 14, y, width - 14, size, color, spacing=1.08)
        y += used + gap
    return y


def caption(cr, s, x, y, w, color=MUTED, align="center"):
    text(cr, s, x, y, w, 8.5, color, align=align)


def stat(cr, big, small, x, y, w):
    text(cr, big, x, y, w, 26, BLUE, "Bold")
    text(cr, small, x, y + 36, w, 9.5, MUTED, spacing=1.05)


# ---------------------------------------------------------------- pages

surface = cairo.PDFSurface(OUT, W, H)
surface.set_metadata(cairo.PDFMetadata.TITLE, "MK Workstation: Fedora, finished")
surface.set_metadata(cairo.PDFMetadata.AUTHOR, "MK Workstation")
surface.set_metadata(cairo.PDFMetadata.SUBJECT, "What MK Workstation adds to Fedora Workstation, and how to get it")
surface.set_metadata(cairo.PDFMetadata.KEYWORDS, "Fedora, GNOME, Linux desktop, setup, notes, productivity")
cr = cairo.Context(surface)
page = 0
CONTENTS = []  # (dest, title, page)


def new_page(dest=None, title=None, dark=False):
    global page
    if page:
        cr.show_page()
    page += 1
    rgb(cr, NIGHT if dark else (1, 1, 1))
    cr.paint()
    if dest:
        cr.tag_begin(cairo.TAG_DEST, f"name='{dest}'")
        cr.tag_end(cairo.TAG_DEST)
        surface.add_outline(cairo.PDF_OUTLINE_ROOT, title, f"dest='{dest}'", 0)
        CONTENTS.append((dest, title, page))


def footer(dark=False):
    color = (0.62, 0.68, 0.78) if dark else MUTED
    rgb(cr, (1, 1, 1) if dark else LINE, 0.15 if dark else 1)
    cr.rectangle(M, H - 34, W - 2 * M, 0.75)
    cr.fill()
    text(cr, "MK Workstation", M, H - 27, 200, 8, color, "Bold")
    text(cr, "Contents", M + 92, H - 27, 80, 8, color)
    link(cr, "contents", M + 88, H - 30, 52, 16)
    text(cr, str(page), W - M - 40, H - 27, 40, 8, color, align="right")


# 1 ── Cover
new_page("cover", "MK Workstation", dark=True)
src = load("welcome")
paint_scaled(cr, src, 0, 0, src.get_width(), src.get_height(), 0, 0, W, H)
shade = cairo.LinearGradient(0, 0, W * 0.75, 0)
shade.add_color_stop_rgba(0, *NIGHT, 0.94)
shade.add_color_stop_rgba(0.55, *NIGHT, 0.70)
shade.add_color_stop_rgba(1, *NIGHT, 0.0)
cr.set_source(shade)
cr.paint()
text(cr, "MK WORKSTATION", M, 150, 400, 10, (0.55, 0.75, 1), "Bold")
th = text(cr, "Fedora,\nfinished.", M, 172, 520, 54, (1, 1, 1), "Bold", spacing=0.9)
lh = lede(cr, "One command turns a fresh Fedora Workstation into a fast, good-looking desktop "
              "that already works the way you do. Free and open source.", M, 172 + th + 16, 380, 13, (0.82, 0.87, 0.95))
text(cr, "Fedora 44 · GNOME 50 · about 15 minutes", M, 172 + th + 16 + lh + 14, 400, 9.5, (0.6, 0.68, 0.8))
text(cr, f"<u>{GITHUB.replace('https://', '')}</u>", M, H - 60, 500, 9.5, (0.55, 0.75, 1))
link(cr, GITHUB, M, H - 64, 330, 18)

# 2 ── Contents: one section per page, so the numbers are known up front;
# links point forward and cairo resolves them when the file is finished.
SECTIONS = [("why", "Why it exists", "Great foundation, bare walls"),
            ("switching", "Moving between apps", "Swipes and a switcher that keeps up"),
            ("windows", "Windows that behave", "Snap layouts and tiling"),
            ("dock", "The dock", "Magnifies, glows, gets out of the way"),
            ("welcome", "A desktop that says hello", "Greeting, tasks, your colours"),
            ("notes", "MK Notes", "Write, link, draw, find"),
            ("notes-more", "MK Notes: the rest", "Sync, PDF, website, history, tasks"),
            ("focus", "Step away", "Screensavers worth stepping away for"),
            ("topbar", "The top bar", "Speed test, system monitor, your music"),
            ("apps", "Apps, ready to go", "Joplin, ONLYOFFICE, Zen and more"),
            ("hardware", "Made for your computer", "Fingerprint, battery, speakers"),
            ("shortcuts", "Shortcuts you already know", "Windows and Mac habits"),
            ("safe", "Try it without worry", "Snapshots, restore, uninstall"),
            ("start", "Get started", "Three commands")]
new_page("contents", "Contents")
y = kicker_title(cr, "Inside", "What you'll find")
col_w = (W - 2 * M - 30) / 2
for i, (dest, title, sub) in enumerate(SECTIONS):
    x = M + (i // 7) * (col_w + 30)
    yy = y + 8 + (i % 7) * 50
    text(cr, f"{i + 3:02d}", x, yy, 30, 15, BLUE, "Bold")
    text(cr, f"<b>{title}</b>", x + 40, yy, col_w - 40, 12, INK)
    text(cr, sub, x + 40, yy + 19, col_w - 40, 9.5, MUTED)
    rgb(cr, LINE)
    cr.rectangle(x, yy + 41, col_w, 0.6)
    cr.fill()
    link(cr, dest, x, yy - 4, col_w, 44)
footer()

# 3 ── Why
new_page("why", "Why it exists")
y = kicker_title(cr, "Why it exists", "Great foundation. Bare walls.")
lh = lede(cr, "Fedora is one of the best Linux systems you can install. But out of the box it's a blank "
              "canvas: no codecs for most videos, a handful of apps, a desktop that works differently from "
              "the one you came from. Getting it right usually takes a weekend of forum posts.", M, y + 4, 420)
points(cr, [
    ("Before", "find extensions one by one, install codecs, hunt for shortcut settings, look for a notes app, "
               "fix what breaks after an update"),
    ("After", "run one command, make a coffee, log in to a desktop that's done"),
    ("Not locked in", "everything it changes is a normal GNOME setting or a normal app; undo it any time"),
], M, y + 4 + lh + 22, 420, size=11)
for i, (big, small) in enumerate((("1", "command to set up\nthe whole desktop"),
                                  ("≈15 min", "from fresh install\nto finished desktop"),
                                  ("0", "settings you have\nto look up"),
                                  ("100%", "open source, scripts\nyou can read"))):
    x, yy = 540 + (i % 2) * 190, y + 12 + (i // 2) * 120
    rounded(cr, x, yy, 175, 100, 12)
    rgb(cr, BLUE_SOFT)
    cr.fill()
    stat(cr, big, small, x + 16, yy + 14, 150)
footer()

# 4 ── Switching
new_page("switching", "Moving between apps")
y = kicker_title(cr, "Moving between apps", "Every window, live, one swipe away")
h = image(cr, "alttab", M, y + 10, 560, crop=(0, 0, 1920, 1080))
caption(cr, "Alt+Tab or three fingers: a frosted grid of live windows, the ring glides to the one you want", M, y + 16 + h, 560)
points(cr, [
    ("A grid, not a strip", "live previews, app icons, titles, and which desktop each is on"),
    ("Three fingers", "swipe through them; each window takes the same finger travel"),
    ("Move as you go", "press 1–9 to send the selected window to that desktop"),
    ("Mouse too", "point at a window to pick it, click to open it"),
    ("Four fingers", "switch desktops; pinch to show the desktop"),
], 640, y + 14, W - M - 640, size=10.5, gap=11)
footer()

# 5 ── Windows
new_page("windows", "Windows that behave")
y = kicker_title(cr, "Windows that behave", "Snap, tile, focus. No dragging.")
h = image(cr, "tiled", M, y + 10, 470)
caption(cr, "Notes on the left, files, a document and the calculator in the quarters", M, y + 16 + h, 470)
points(cr, [
    ("Snap layouts", "Super+Z shows six layouts; pick one and the other windows fill in"),
    ("Halves and quarters", "Super and the arrow keys, the way Windows does it"),
    ("Snap Assist", "after you snap one window, it offers the rest for the free space"),
    ("Always on top", "Super+Ctrl+T keeps a video or a calculator above everything"),
    ("New desktop", "Super+Ctrl+D; Shift takes the current window along"),
    ("Quick Look", "press Space on a file in Files to preview it"),
], M + 495, y + 14, W - M - (M + 495), size=10.5, gap=11)
footer()

# 6 ── Dock
new_page("dock", "The dock")
y = kicker_title(cr, "The dock", "Out of the way until you want it")
dh = image(cr, "dock-magnify", (W - 700) / 2, y + 14, 700)
points(cr, [
    ("Magnifies", "the icon under your pointer grows and its neighbours follow in a wave"),
    ("Glows in each app's colour", "worked out from the app's own icon"),
    ("Hides", "when a window touches it, and steps aside in the overview so titles stay readable"),
    ("Works like a taskbar", "click to focus or minimise; several windows show as thumbnails"),
], M, y + 40 + dh, W - 2 * M, size=11, gap=10)
footer()

# 7 ── Welcome
new_page("welcome", "A desktop that says hello")
y = kicker_title(cr, "After you log in", "A desktop that says hello, and remembers")
h = image(cr, "welcome", M, y + 10, 520)
points(cr, [
    ("Light that lands on time", "two comets run up the screen edges and meet at the top, once the desktop "
                                 "is ready, so it never stutters"),
    ("What's waiting", "your pinned tasks and the next reminder today, right under the greeting"),
    ("Never the same twice", "good morning, Friday, long time no see, your birthday… or your own lines"),
    ("Say it your way", "your name, sir or ma'am; spoken aloud if you like"),
    ("Your colours", "the whole desktop picks up the most vivid colour of your wallpaper"),
], M + 545, y + 14, W - M - (M + 545), size=10.5, gap=11)
footer()

# 8 ── MK Notes
new_page("notes", "MK Notes")
y = kicker_title(cr, "Super + N", "MK Notes: write, link, draw, find")
nh = image(cr, "notes-split", M, y + 10, 480)
ph = nh
image(cr, "phone-note", M + 496, y + 10, ph * 404 / 816, h=ph)
caption(cr, "Edit with a live preview: links, callouts, checklists, a sketch", M, y + 16 + nh, 480)
caption(cr, "Same notes on your phone", M + 480, y + 16 + nh, ph * 404 / 816 + 32)
px = M + 496 + ph * 404 / 816 + 18
points(cr, [
    ("Your files", "plain Markdown in a folder you own; other apps open it too"),
    ("Linked", "[[links]], backlinks and a graph of how ideas connect"),
    ("Drawn", "sketch or handwrite with a pen, pressure and all"),
    ("Pasted", "screenshots go straight into the note"),
], px, y + 14, W - M - px, size=9.5, gap=9)
footer()

# 9 ── MK Notes, more
new_page("notes-more", "MK Notes: the rest")
y = kicker_title(cr, "MK Notes", "The features you'd normally pay for")
th = image(cr, "notes-tasks", M, y + 10, 430, crop=(0, 0, 1920, 1080))
caption(cr, "Every checkbox from every note, in one list", M, y + 16 + th, 430)
cols = [
    ("Phone sync", "browser or Android app, works offline, encrypted over your Wi-Fi"),
    ("PDF export", "one click, with pictures and checkboxes"),
    ("Your website", "publish your notes as pages you can host anywhere"),
    ("Version history", "go back to how a note looked this morning"),
    ("Daily notes", "a calendar marks the days you wrote"),
    ("Quick capture", "Super+Ctrl+N from anywhere, straight into your Inbox"),
    ("Your look", "theme, font, size, line length, spacing"),
    ("Tasks view", "tick things off without opening the note"),
]
cx0, cy0, cw = M + 455, y + 12, (W - M - (M + 455) - 14) / 2
for i, (t, b) in enumerate(cols):
    x = cx0 + (i % 2) * (cw + 14)
    yy = cy0 + (i // 2) * 76
    rounded(cr, x, yy, cw, 66, 10)
    rgb(cr, BLUE_SOFT)
    cr.fill()
    text(cr, f"<b>{t}</b>", x + 12, yy + 9, cw - 24, 10.5, INK)
    text(cr, b, x + 12, yy + 27, cw - 24, 8.5, MUTED, spacing=1.0)
footer()

# 10 ── Focus
new_page("focus", "Focus timer")
y = kicker_title(cr, "Step away", "Screensavers worth stepping away for")
bw = (W - 2 * M - 2 * 12) / 3
bh = image(cr, "scene-web", M, y + 10, bw)
image(cr, "scene-knight", M + bw + 12, y + 10, bw)
image(cr, "scene-matrix", M + 2 * (bw + 12), y + 10, bw)
caption(cr, "Web Hang: a masked hero swings over the city", M, y + 16 + bh, bw)
caption(cr, "Night Watch: a caped figure in the rain", M + bw + 12, y + 16 + bh, bw)
caption(cr, "Neon Cascade: code rain decodes the time", M + 2 * (bw + 12), y + 16 + bh, bw)
points(cr, [
    ("When you step away", "after three idle minutes, or in a focus session; any touch and you're back"),
    ("Never over a film", "a video, a call or Keep awake keeps it away"),
    ("Focus timer", "counts down in the top bar, silences notifications, ends with a little party"),
    ("Light on the machine", "30 frames a second, the still parts drawn once"),
], M, y + 36 + bh, W - 2 * M, size=10.5, gap=7)
footer()

# 11 ── Top bar
new_page("topbar", "The top bar")
y = kicker_title(cr, "The top bar", "Everything you check, one click away")
mh = image(cr, "speedtest", M, y + 10, 200)
caption(cr, "System monitor with a speed test", M, y + 16 + mh, 200)
qh = image(cr, "media", M + 220, y + 10, mh * 470 / 620, h=mh)
caption(cr, "Your music, from Spotify or any player", M + 220, y + 16 + qh, mh * 470 / 620)
px = M + 220 + mh * 470 / 620 + 22
points(cr, [
    ("System monitor", "a tiny CPU graph and temperature; click for memory, disk, battery draw"),
    ("Speed test", "ping, download and upload on a gauge, whenever you ask"),
    ("Your music", "spinning album art, the song scrolling by, seek, skip, pick speakers"),
    ("Clipboard history", "Super+V brings back anything you copied"),
], px, y + 14, W - M - px, size=10, gap=10)
footer()

# 12 ── Apps
new_page("apps", "Apps, ready to go")
y = kicker_title(cr, "Apps", "Installed and ready on first login")
APPS = [("app.zen_browser.zen", "Zen Browser"), ("net.cozic.joplin_desktop", "Joplin"),
        ("org.onlyoffice.desktopeditors", "ONLYOFFICE"), ("vscode", "VS Code"),
        ("com.spotify.Client", "Spotify"), ("net.lutris.Lutris", "Lutris"),
        ("com.mattjakeman.ExtensionManager", "Extension Manager"), ("net.sonobus.SonoBus", "SonoBus"),
        ("com.github.tenderowl.frog", "Frog"), ("one.alynx.FlipClock", "FlipClock"),
        ("io.github.mehulk.MkNotes", "MK Notes"), ("io.github.mehulk.MkCompanion", "Companion"),
        ("io.github.mehulk.MkTimer", "Focus Timer"), ("io.github.mehulk.MkShortcuts", "Shortcuts")]
ICON_DIRS = [REPO / "assets/icons", Path("/var/lib/flatpak/exports/share/icons/hicolor/scalable/apps"),
             Path("/var/lib/flatpak/exports/share/icons/hicolor/256x256/apps"),
             Path("/var/lib/flatpak/exports/share/icons/hicolor/128x128/apps"), Path("/usr/share/pixmaps"),
             Path.home() / ".local/share/flatpak/exports/share/icons/hicolor/scalable/apps"]


def icon(name, size):
    for folder in ICON_DIRS:
        for ext in (".svg", ".png"):
            path = folder / f"{name}{ext}"
            if path.exists():
                try:
                    pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(path), size * 2, size * 2, True)
                    ok, png = pb.save_to_bufferv("png", [], [])
                    return cairo.ImageSurface.create_from_png(io.BytesIO(png))
                except Exception:  # noqa: BLE001 - an unreadable icon falls back to its name
                    pass
    return None


per_row, cell = 7, (W - 2 * M) / 7
for i, (name, label) in enumerate(APPS):
    x = M + (i % per_row) * cell
    yy = y + 16 + (i // per_row) * 118
    surf = icon(name, 56)
    if surf:
        cr.save()
        cr.translate(x + (cell - 56) / 2, yy)
        cr.scale(0.5, 0.5)
        cr.set_source_surface(surf, 0, 0)
        cr.paint()
        cr.restore()
    else:
        rounded(cr, x + (cell - 56) / 2, yy, 56, 56, 14)
        rgb(cr, BLUE_SOFT)
        cr.fill()
    text(cr, label, x, yy + 64, cell, 9.5, INK, "Bold" if name.startswith("io.github.mehulk") else "Regular",
         align="center")
lede(cr, "Plus full video and audio codecs, hardware video decoding for your graphics card, "
         "a modern terminal toolkit, gaming helpers and developer tools. Every app list is a plain text file: "
         "add or remove a line and it's yours. Bold ones are made for MK Workstation.", M, y + 270, W - 2 * M, 11)
footer()

# 13 ── Hardware
new_page("hardware", "Made for your computer")
y = kicker_title(cr, "Your computer", "It looks at your hardware, then tunes for it")
cards = [
    ("Fingerprint and face unlock", "if your computer has a reader or an IR camera, logging in is a touch or a glance"),
    ("Battery that lasts", "full speed when plugged in, balanced on battery, power-saver when it runs low"),
    ("Speakers with body", "laptop speakers get warmth, bass they can actually play, and clearer voices"),
    ("Touchscreens and 2-in-1s", "rotation and tablet mode just work; MK Notes takes a pen"),
    ("The right graphics driver", "hardware video decoding for Intel, AMD or NVIDIA"),
    ("Older machines too", "mk effects lite turns off heavy effects; mk device shows what was found"),
]
cw = (W - 2 * M - 28) / 3
for i, (t, b) in enumerate(cards):
    x, yy = M + (i % 3) * (cw + 14), y + 16 + (i // 3) * 150
    rounded(cr, x, yy, cw, 136, 14)
    rgb(cr, BLUE_SOFT)
    cr.fill()
    rgb(cr, BLUE)
    cr.rectangle(x + 18, yy + 20, 26, 3)
    cr.fill()
    text(cr, f"<b>{t}</b>", x + 18, yy + 34, cw - 36, 13, INK)
    text(cr, b, x + 18, yy + 60, cw - 36, 10, MUTED, spacing=1.1)
footer()

# 14 ── Shortcuts
new_page("shortcuts", "Shortcuts you already know")
y = kicker_title(cr, "Keyboard", "Coming from Windows or a Mac? Your hands already know these.")
rows = [("Super+E", "Files", "Super+N", "MK Notes"), ("Super+B", "Web browser", "Super+V", "Clipboard history"),
        ("Super+Shift+S", "Screenshot an area", "Super+Shift+T", "Copy text from the screen"),
        ("Super+Z", "Snap layouts", "Super+L", "Lock"), ("Ctrl+Shift+Esc", "System Monitor", "Super+.", "Emoji"),
        ("Super+Q", "Close window", "Ctrl+Alt+T", "Terminal"),
        ("Ctrl+Alt+End", "Shut down (asks first)", "Ctrl+Alt+Home", "Restart (asks first)")]
sh = image(cr, "shortcuts-window", W - M - 230, y + 10, 230, crop=(486, 76, 950, 956))
caption(cr, "Super+/ shows them all, live, and lets you change any key", W - M - 230, y + 16 + sh, 230)
yy = y + 14
for a, b, c, d in rows:
    for kx, key, lx, label in ((M, a, M + 108, b), (M + 290, c, M + 398, d)):
        layout_w = 8 + 7.2 * len(key)
        rounded(cr, kx, yy - 2, layout_w, 22, 6)
        rgb(cr, BLUE_SOFT)
        cr.fill()
        text(cr, key, kx + 6, yy + 1, layout_w, 9.5, BLUE, "Bold")
        text(cr, label, lx, yy + 1, 170, 10, INK)
    yy += 38
footer()

# 15 ── Safe
new_page("safe", "Try it without worry")
y = kicker_title(cr, "No risk", "Try it. Change your mind. Nothing breaks.")
points(cr, [
    ("A snapshot every time", "your settings are saved before every change; mk restore puts them back"),
    ("One-line uninstall", "mk uninstall removes MK's tools and shortcuts from your account"),
    ("Health check", "mk doctor finds broken extensions, clashing keys, missing codecs, and tells you the fix"),
    ("Readable", "plain shell and Python you can read in an afternoon; every change is in the git history"),
    ("Yours to change", "rename it, swap any app, key or colour without touching the scripts"),
    ("Updates in one go", "mk update: system, apps, extensions and settings together"),
], M, y + 14, 520, size=11.5, gap=13)
ch = image(cr, "companion", M + 560, y + 10, 230, crop=(675, 170, 570, 775))
caption(cr, "The Companion (Super+Shift+N): quick notes, tasks and reminders", M + 560, y + 16 + ch, 230)
footer()

# 16 ── Get started
new_page("start", "Get started", dark=True)
y = kicker_title(cr, "Get started", "Three commands on a fresh Fedora Workstation", y=96,
                 color=(1, 1, 1), kicker_color=(0.55, 0.75, 1))
cmds = ["git clone " + GITHUB + ".git", "cd fedora-workstation-config", "sudo ./setup.sh"]
yy = y + 20
for i, cmd in enumerate(cmds):
    rounded(cr, M, yy, W - 2 * M, 40, 10)
    rgb(cr, (1, 1, 1), 0.07)
    cr.fill()
    text(cr, f"{i + 1}", M + 16, yy + 11, 20, 12, (0.55, 0.75, 1), "Bold")
    text(cr, f"<tt>{cmd}</tt>", M + 44, yy + 11, W - 2 * M - 60, 12, (1, 1, 1))
    yy += 50
lede(cr, "Then log out and back in. That's it. Everything after that is optional: "
         "<b>mk doctor</b> to check, <b>mk</b> to see every command.", M, yy + 8, W - 2 * M, 12.5, (0.82, 0.87, 0.95))
for i, (label, url) in enumerate((("Source code and issues", GITHUB),
                                  ("Getting started guide", GITHUB + "/blob/main/docs/GUIDE.md"),
                                  ("Every feature", GITHUB + "/blob/main/docs/FEATURES.md"))):
    x = M + i * 290
    text(cr, f"<u>{label}</u> ↗", x, yy + 70, 270, 11, (0.55, 0.75, 1), "Bold")
    link(cr, url, x, yy + 66, 230, 20)
footer(dark=True)

cr.show_page()
surface.finish()
print(f"{page} pages -> {OUT}")
