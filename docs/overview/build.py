"""Build docs/MK-Workstation-Overview.pdf from the screenshots in docs/assets/screens.

    python3 docs/overview/build.py            (or: just overview)

Pure cairo + Pango (no extra Python packages). Screenshots come from
docs/overview/capture.py, which drives a demo on a spare workspace.
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
SOURCE_WIDTH = 1920  # crops below are in 1920x1080 screen pixels
W, H = 960, 540
M = 56  # page margin

INK = (0.059, 0.090, 0.165)
MUTED = (0.33, 0.39, 0.48)
BLUE = (0.145, 0.388, 0.922)
BLUE_SOFT = (0.86, 0.91, 0.99)
LINE = (0.89, 0.91, 0.94)
FONT = "Adwaita Sans"


def rgb(cr, c, a=1.0):
    cr.set_source_rgba(*c, a)


def text(cr, markup, x, y, width, size, color=INK, weight="Regular", align="left",
         spacing=1.0):
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


def image(cr, name, x, y, w, h=None, crop=None, radius=10):
    """Draw a screenshot scaled to width w (height from aspect unless h)."""
    pixbuf = GdkPixbuf.Pixbuf.new_from_file(str(SHOTS / f"{name}.jpg"))
    ok, png = pixbuf.save_to_bufferv("png", [], [])
    src = cairo.ImageSurface.create_from_png(io.BytesIO(png))
    k = src.get_width() / SOURCE_WIDTH if crop else 1
    cx, cy, cw, ch = [v * k for v in crop] if crop else (0, 0, src.get_width(), src.get_height())
    scale = w / cw
    if h is None:
        h = ch * scale
    else:
        scale = max(w / cw, h / ch)
    # soft shadow
    for i, a in ((6, 0.03), (3, 0.05), (1, 0.06)):
        rounded(cr, x - i / 2, y + i / 2, w + i, h + i / 2, radius + i)
        cr.set_source_rgba(0, 0, 0, a)
        cr.fill()
    # Downsample to 2x the printed size: sharp on screen, small file.
    k = min(1.0, 2 * scale)
    small = cairo.ImageSurface(cairo.FORMAT_RGB24, max(1, int(cw * k)), max(1, int(ch * k)))
    sc = cairo.Context(small)
    sc.scale(k, k)
    sc.set_source_surface(src, -cx, -cy)
    sc.get_source().set_filter(cairo.FILTER_BEST)
    sc.paint()
    cr.save()
    rounded(cr, x, y, w, h, radius)
    cr.clip()
    cr.translate(x, y)
    cr.scale(scale / k, scale / k)
    cr.set_source_surface(small, 0, 0)
    cr.get_source().set_filter(cairo.FILTER_BEST)
    cr.paint()
    cr.restore()
    rounded(cr, x, y, w, h, radius)
    cr.set_line_width(0.75)
    rgb(cr, LINE)
    cr.stroke()
    return h


def header(cr, kicker, title, y=M - 6):
    rgb(cr, BLUE)
    cr.rectangle(M, y + 2, 22, 3)
    cr.fill()
    text(cr, kicker.upper(), M + 30, y - 5, 400, 8.5, BLUE, "Bold")
    return y + 16 + text(cr, title, M, y + 14, W - 2 * M, 25, INK, "Bold")


def footer(cr, n):
    rgb(cr, LINE)
    cr.rectangle(M, H - 34, W - 2 * M, 0.75)
    cr.fill()
    text(cr, "MK Workstation · Fedora, made for getting things done", M, H - 27, 500, 8, MUTED)
    text(cr, str(n), W - M - 40, H - 27, 40, 8, MUTED, align="right")


def bullets(cr, items, x, y, width, size=11.5, gap=9):
    for title, body in items:
        rgb(cr, BLUE)
        cr.new_sub_path()
        cr.arc(x + 3, y + 8, 2.6, 0, 6.2832)
        cr.fill()
        used = text(cr, f"<b>{title}</b>" + (f"  <span foreground='#55637a'>{body}</span>" if body else ""),
                    x + 14, y, width - 14, size, INK, spacing=1.05)
        y += used + gap
    return y


def chip(cr, label, x, y, size=9):
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription.from_string(f"{FONT} Bold {size}"))
    layout.set_text(label, -1)
    tw, th = layout.get_pixel_size()
    rounded(cr, x, y, tw + 16, th + 8, (th + 8) / 2)
    rgb(cr, BLUE_SOFT)
    cr.fill()
    rgb(cr, BLUE)
    cr.move_to(x + 8, y + 4)
    PangoCairo.show_layout(cr, layout)
    return tw + 16


def caption(cr, s, x, y, w):
    text(cr, s, x, y, w, 8.5, MUTED, align="center")


# Window crops on a 1920x1080 screenshot
COMPANION = (608, 74, 704, 962)
SHORTCUTS = (486, 76, 950, 956)
TIMER = (548, 182, 830, 752)
TERMINAL = (500, 218, 918, 684)
QUICK = (1415, 50, 490, 560)
SNAP = (608, 74, 704, 962)

surface = cairo.PDFSurface(OUT, W, H)
surface.set_metadata(cairo.PDFMetadata.TITLE, "MK Workstation: Fedora, made for getting things done")
surface.set_metadata(cairo.PDFMetadata.AUTHOR, "MK Workstation")
cr = cairo.Context(surface)
page = 0


def new_page():
    global page
    if page:
        cr.show_page()
    page += 1
    rgb(cr, (1, 1, 1))
    cr.paint()


# 1 ── Title
new_page()
grad = cairo.LinearGradient(0, 0, 0, H)
grad.add_color_stop_rgb(0, 0.97, 0.98, 1.0)
grad.add_color_stop_rgb(1, 1, 1, 1)
cr.set_source(grad)
cr.paint()
rgb(cr, BLUE)
cr.rectangle(M, 150, 36, 4)
cr.fill()
ty = 166 + text(cr, "MK Workstation", M, 166, 420, 38, INK, "Bold")
ty += 4 + text(cr, "Fedora, made for getting things done.", M, ty + 2, 410, 16, BLUE, "Medium")
ty += 16 + text(cr, "One command turns a fresh Fedora Workstation into a fast, familiar and "
         "productive desktop: Windows and macOS habits, notes and reminders, face unlock, "
         "and settings that adapt to your hardware.",
     M, ty + 12, 380, 11.5, MUTED, spacing=1.15)
x = M
for c in ("Fedora 44", "GNOME 50 · Wayland", "Open source"):
    x += chip(cr, c, x, ty + 14) + 8
image(cr, "overview", 480, 120, 424)
caption(cr, "The overview on an HP ENVY x360 13 running MK Workstation", 480, 370, 424)
footer(cr, page)

# 2 ── Stock Fedora
new_page()
y = header(cr, "The starting point", "Stock Fedora Workstation")
text(cr, "A clean, fast, secure Linux from the Fedora Project, backed by Red Hat. It ships "
         "the newest GNOME exactly as its designers intended, with very little added.",
     M, y + 6, 400, 11.5, MUTED, spacing=1.15)
bullets(cr, [
    ("Strong foundation", "SELinux, Wayland, Btrfs, automatic security updates, new release every 6 months."),
    ("Pure GNOME", "One focused way of working: Activities overview, keyboard first, few settings."),
    ("Free software only", "Patented codecs and hardware video decoding are left out by policy."),
], M, y + 82, 400)
text(cr, "<b>What people notice in the first hour</b>", 500, y + 6, 400, 11.5, INK)
bullets(cr, [
    ("No dock or tray icons", "apps live in the overview only"),
    ("No minimize button", "and no Windows-style snapping or layouts"),
    ("Alt+Tab per workspace", "windows elsewhere are hidden"),
    ("Videos use the CPU", "H.264 / HEVC decoding isn't hardware-accelerated"),
    ("Everything by hand", "apps, extensions, shortcuts, codecs, drivers, one by one"),
    ("No notes, tasks or reminders", "beyond separate apps"),
], 500, y + 34, 400, size=10.5, gap=7)
footer(cr, page)

# 3 ── What MK adds
new_page()
y = header(cr, "What it adds", "Six things, one command")
cards = [
    ("One command", "sudo ./setup.sh installs codecs, drivers, 60+ apps, extensions and settings. "
                    "Safe to run again; backs up what it touches."),
    ("Feels familiar", "Dock, snap layouts, Alt+Tab across workspaces, macOS gestures and shortcuts, "
                       "Windows keys like Super+E and Ctrl+Shift+Esc."),
    ("Productivity built in", "Notes, tasks and reminders, a focus timer, OCR, clipboard history "
                              "and a live shortcuts window."),
    ("Face and fingerprint", "Log in by looking at the camera or touching the reader; both set up for "
                             "the hardware you have."),
    ("Smart for your device", "Power profiles follow the charger, effects scale to the hardware, "
                              "GPU video decoding is set up for your graphics."),
    ("Yours to change", "Every shortcut, app and name lives in plain text files. Rename it, "
                        "rebind it, fork it."),
]
cw, ch = (W - 2 * M - 2 * 18) / 3, 150
for i, (title, body) in enumerate(cards):
    cx, cy = M + (i % 3) * (cw + 18), y + 14 + (i // 3) * (ch + 18)
    rounded(cr, cx, cy, cw, ch, 12)
    rgb(cr, (0.975, 0.98, 1.0))
    cr.fill_preserve()
    rgb(cr, LINE)
    cr.set_line_width(0.75)
    cr.stroke()
    rgb(cr, BLUE)
    cr.rectangle(cx + 18, cy + 20, 18, 3)
    cr.fill()
    text(cr, title, cx + 18, cy + 32, cw - 36, 13, INK, "Bold")
    text(cr, body, cx + 18, cy + 56, cw - 36, 10, MUTED, spacing=1.1)
footer(cr, page)

# 4 ── Before / after
new_page()
y = header(cr, "Side by side", "Stock Fedora vs MK Workstation")
rows = [
    ("Setup", "Install apps, codecs and extensions by hand", "One command, then mk update keeps it all current"),
    ("Video", "Software decoding for H.264 / HEVC", "Full codecs + GPU decoding for your graphics card"),
    ("Windows", "Maximize and half-screen tiling", "Snap layouts (Super+Z), quarters, always on top"),
    ("Switching", "Alt+Tab shows the current workspace", "Alt+Tab shows everything, 3- and 4-finger gestures"),
    ("Dock", "Only inside the overview", "Auto-hiding dock with app-coloured hover"),
    ("Notes &amp; tasks", "Separate apps", "Companion: pinned notes, tasks, reminders, morning brief"),
    ("Shortcuts", "Scattered across Settings", "One window: status of each, change or reset in a click"),
    ("Battery", "Profile stays where you left it", "Performance on AC, balanced on battery, saver when low"),
    ("Login", "Password", "Face unlock and fingerprint, detected and set up for you"),
    ("Health", "—", "mk doctor checks codecs, GPU, extensions, clashes, updates"),
    ("Sound", "Thin laptop speakers", "B&amp;O-style speaker tuning: EQ, bass, limiter (mk sound)"),
]
col = [M, M + 110, M + 110 + 330]
ty = y + 14
text(cr, "<b>STOCK FEDORA</b>", col[1], ty, 300, 8.5, MUTED)
text(cr, "<b>WITH MK WORKSTATION</b>", col[2], ty, 330, 8.5, BLUE)
ty += 20
for i, (k, a, b) in enumerate(rows):
    if i % 2 == 0:
        rgb(cr, (0.975, 0.98, 1.0))
        cr.rectangle(M - 8, ty - 5, W - 2 * M + 16, 30)
        cr.fill()
    text(cr, f"<b>{k}</b>", col[0], ty + 2, 100, 10, INK)
    text(cr, a, col[1], ty + 2, 320, 10, MUTED)
    text(cr, b, col[2], ty + 2, W - M - col[2], 10, INK)
    ty += 30
footer(cr, page)

# 5 ── Multitasking
new_page()
y = header(cr, "Desktop and multitasking", "Windows habits, macOS feel, GNOME underneath")
image(cr, "alt-tab", M, y + 12, 400)
caption(cr, "Alt+Tab: every window on every workspace, with live previews", M, y + 242, 400)
image(cr, "snap-layouts", 480, y + 12, 170, crop=SNAP)
caption(cr, "Super+Z: snap layouts", 480, y + 250, 170)
bullets(cr, [
    ("Gestures", "4 fingers ←/→ workspace, 3 fingers ←/→ window, 3 up overview"),
    ("Snap", "Super+arrows halves and quarters, Snap Assist"),
    ("Spaces", "Super+Ctrl+D new desktop, Super+Ctrl+←/→ move"),
    ("Polish", "genie minimize, soft open/close, 25% faster animations"),
], 668, y + 12, W - M - 668, size=10, gap=10)
footer(cr, page)

# 5b ── Dock
new_page()
y = header(cr, "The dock", "A dock that feels alive, and stays out of the way")
dh = image(cr, "dock-magnify", (W - 720) / 2, y + 14, 720)
bullets(cr, [
    ("Magnification", "the icon under the pointer grows and its neighbours follow in a soft wave, like macOS"),
    ("App-coloured glow", "a subtle circular tint in each app's own colour: Spotify green, Obsidian purple"),
    ("Out of the way", "hides when a window touches it and steps aside in the overview"),
    ("Taskbar clicks", "click to focus or minimize, thumbnails for apps with several windows, middle-click for a new one"),
    ("Tunable", "size, spread and speed in config/dock.conf; MAGNIFY=1 turns it off"),
], M, y + 34 + dh, W - 2 * M, size=11, gap=7)
footer(cr, page)

# 6 ── Shortcuts window
new_page()
y = header(cr, "Super + /", "Every shortcut, in one live window")
image(cr, "shortcuts-window", M, y + 12, 360, h=300, crop=SHORTCUTS)
bullets(cr, [
    ("Live", "reads GNOME directly; a change made anywhere shows up at once"),
    ("Honest status", "each shortcut marked working, clashing (and with what), unset or broken"),
    ("Change in a click", "press the new keys; add extra keys or remove them"),
    ("Your own commands", "+ adds a shortcut that runs anything, e.g. a Spotify toggle"),
    ("Undo", "reset one shortcut or all of them to the defaults"),
    ("Plain text underneath", "config/shortcuts.conf: one line per shortcut, easy to fork"),
], 450, y + 20, W - M - 450, size=11, gap=11)
footer(cr, page)

# 7 ── Companion
new_page()
y = header(cr, "Super + Shift + N", "Companion: notes, tasks and reminders")
image(cr, "companion-notes", M, y + 12, 196, crop=COMPANION)
image(cr, "companion-tasks", M + 214, y + 12, 196, crop=COMPANION)
bullets(cr, [
    ("Notes that stay out of the way", "pin the important ones open on top; the rest fold away"),
    ("Tasks with a progress bar", "tick, pin, undo; finished ones collect under Done"),
    ("Reminders", "in 10 min, at 18:00, every day or week; they fire even with the app closed, with Snooze"),
    ("Morning brief", "one notification with today's tasks and reminders"),
    ("From the terminal", "mk note, mk task \"pay rent\" 18:00, mk list"),
], 500, y + 20, W - M - 500, size=10.5, gap=10)
footer(cr, page)

# 8 ── Focus timer
new_page()
y = header(cr, "Focus timer", "Lives on your desktop, not in a window")
fh = image(cr, "focus-screen", M, y + 12, 520)
image(cr, "timer-celebration", M + 540, y + 12, W - 2 * M - 540, h=fh, crop=(440, 0, 1040, 1080))
caption(cr, "Step away and the focus screen takes over, like a screensaver", M, y + 18 + fh, 520)
caption(cr, "Time's up: robot, coins, fireworks", M + 540, y + 18 + fh, W - 2 * M - 540)
bullets(cr, [
    ("Out of the way", "the window hides; a small ring and countdown sit in the top bar"),
    ("Calm when you step away", "aurora light and the big ring; any key brings you back; never covers a video"),
    ("Focus mode", "can silence notifications; a celebration instead of an alarm"),
], M, y + 40 + fh, W - 2 * M, size=10.5, gap=6)
footer(cr, page)

# 8a ── Focus screensavers
new_page()
y = header(cr, "Step away", "Screensavers that play over your work")
bw = (W - 2 * M - 16) / 2
bh = image(cr, "saver-bubbles", M, y + 12, bw)
image(cr, "saver-mystify", M + bw + 16, y + 12, bw)
caption(cr, "Bubbles: soap bubbles that bounce off each other", M, y + 18 + bh, bw)
caption(cr, "Mystify: glowing shapes with echoes", M + bw + 16, y + 18 + bh, bw)
bullets(cr, [
    ("No new window", "drawn by the top-bar extension right over what you were doing; gone at the first touch"),
    ("Three classics, or a surprise", "Bubbles, Mystify, Starfield, or the full-screen Aurora; pick one in the timer"),
    ("Smooth on any machine", "a few small moving pieces, not a full-screen canvas: 60 fps even without a GPU"),
], M, y + 40 + bh, W - 2 * M, size=10.5, gap=6)
footer(cr, page)

# 8a2 ── MK Notes
new_page()
y = header(cr, "Super + N · Obsidian, Apple Notes and Samsung Notes in one", "MK Notes, on laptop and phone")
nh = image(cr, "notes-read", M, y + 12, 470)
image(cr, "phone-note", M + 486, y + 12, nh * 404 / 816, h=nh)
caption(cr, "On the laptop: links, callouts, checklists, a drawing", M, y + 18 + nh, 470)
caption(cr, "On the phone", M + 486, y + 18 + nh, nh * 404 / 816)
bullets(cr, [
    ("Your files", "a Markdown vault Obsidian opens too; folders, pins, colours, #tags"),
    ("Connected", "[[links]], backlinks, outline, graph view, quick switcher"),
    ("Like Apple Notes", "paste or capture screenshots, checklists that continue"),
    ("Like Samsung Notes", "draw and handwrite with pressure on lined or grid paper"),
    ("Pro features, free", "PDF export, publish as a website, version history"),
    ("On your phone", "browser or Android app, works offline, syncs over Wi-Fi"),
], M + 486 + nh * 404 / 816 + 18, y + 14, W - M - (M + 486 + nh * 404 / 816 + 18), size=9.5, gap=7)
footer(cr, page)

# 8b ── Welcome
new_page()
y = header(cr, "After you log in", "Welcome back home, sir.")
wh = image(cr, "welcome-light", M, y + 12, 500)
bullets(cr, [
    ("Neon edge light", "a line races around the screen edges, OnePlus-style, then the greeting fades in"),
    ("Waits for everything", "plays once every extension has loaded, so login stays smooth"),
    ("Sir, ma'am or your name", "or write your own line; change it in Quick Settings or the Companion"),
    ("A voice like an AI assistant", "calm British voice (natural Piper voice optional, no sudo)"),
    ("Your switch", "Quick Settings › Welcome light, or mk welcome off"),
], M + 520, y + 16, W - M - (M + 520), size=10.5, gap=9)
footer(cr, page)

# 8c ── Small touches
new_page()
y = header(cr, "The little things", "Polished where you look every day")
CAL, FILES, OSD, ICONS = (540, 0, 780, 660), (0, 40, 1200, 700), (640, 700, 640, 380), (500, 60, 920, 420)
cw = (W - 2 * M - 3 * 16) / 4
for i, (name, crop, cap) in enumerate((("calendar", CAL, "Calendar: glowing today, hover glow"),
                                       ("files", FILES, "Files: cyan hover and selection"),
                                       ("osd-stack", OSD, "Workspace dots step above volume"),
                                       ("app-icons", ICONS, "Own icons; swap in yours (mk icon)"))):
    x = M + i * (cw + 16)
    ih = image(cr, name, x, y + 14, cw, h=cw * 0.8, crop=crop)
    caption(cr, cap, x, y + 20 + ih, cw)
bullets(cr, [
    ("Speaker tuning", "laptop speakers sound thin on Linux without the vendor's Windows DSP; mk sound adds EQ, bass and a limiter"),
    ("Alt+Tab", "pops in smoothly; Alt+` switches windows of one app; wobbly windows while dragging"),
    ("Dock", "magnification and a soft glow in each app's colour"),
], M, y + 50 + cw * 0.8, W - 2 * M, size=10.5, gap=7)
footer(cr, page)

# 9 ── Hardware
new_page()
y = header(cr, "Made for your hardware", "Detects the machine, then tunes for it")
th = image(cr, "mk-device", M, y + 12, 390, crop=TERMINAL)
image(cr, "quick-settings", M + 404, y + 12, 140, crop=QUICK)
bullets(cr, [
    ("Fingerprint", "reader detected, login and sudo enabled; mk fingerprint to enroll"),
    ("Face unlock", "IR or regular webcam, trained for normal, dim and bright light"),
    ("Smart power", "performance plugged in, balanced on battery, saver below 25%"),
    ("Video", "Intel, AMD or NVIDIA detected; GPU decoding for H.264 and HEVC"),
    ("2-in-1s", "rotation sensor service; effects scale to RAM and GPU"),
    ("Smooth login", "the login screen uses your display layout: no flicker"),
], 620, y + 16, W - M - 620, size=10, gap=8)
caption(cr, "mk device on the author's HP ENVY x360 13 (Ryzen 5 4500U) · Quick Settings power mode",
        M, y + 22 + th, 544)
footer(cr, page)

# 10 ── Make it yours
new_page()
y = header(cr, "Open source", "Built to be changed")
items = [
    ("Rename it", "mk rename \"Riya's Desk\" RD", "windows, notifications and the top-bar tag follow"),
    ("Rebind anything", "config/shortcuts.conf", "or click a row in Super+/"),
    ("Choose the apps", "apps/flatpaks.txt · apps/dnf-packages.txt", "mk save captures what you installed"),
    ("Extensions", "config/enabled-extensions.txt", "settings saved per extension by mk export"),
    ("Effects and power", "config/effects.conf · config/power.conf", "plain key = value files"),
    ("Keep it current", "mk update", "repo, apps, settings and system, in one go"),
]
ty = y + 16
for title, code, note in items:
    text(cr, f"<b>{title}</b>", M, ty, 170, 11, INK)
    text(cr, f"<tt>{code}</tt>", M + 180, ty + 1, 330, 10, BLUE)
    text(cr, note, M + 520, ty + 1, W - 2 * M - 520, 10, MUTED)
    rgb(cr, LINE)
    cr.rectangle(M, ty + 26, W - 2 * M, 0.75)
    cr.fill()
    ty += 36
text(cr, "Documentation: GUIDE for everyday use, CUSTOMIZING for making it yours, "
         "ARCHITECTURE and REFERENCE for hacking on it.", M, ty + 12, W - 2 * M, 10, MUTED)
footer(cr, page)

# 11 ── Get started
new_page()
grad = cairo.LinearGradient(0, 0, 0, H)
grad.add_color_stop_rgb(0, 0.97, 0.98, 1.0)
grad.add_color_stop_rgb(1, 1, 1, 1)
cr.set_source(grad)
cr.paint()
y = header(cr, "Get started", "Three commands on a fresh Fedora Workstation", y=110)
steps = [("git clone https://github.com/MehulK-techie/fedora-workstation-config", "Download"),
         ("cd fedora-workstation-config &amp;&amp; sudo ./setup.sh", "Install and configure (10–20 min)"),
         ("mk face   ·   mk fingerprint", "Optional: face and fingerprint login")]
ty = y + 20
for i, (cmd, note) in enumerate(steps, 1):
    rounded(cr, M, ty, 26, 26, 13)
    rgb(cr, BLUE)
    cr.fill()
    text(cr, f"<b>{i}</b>", M, ty + 5, 26, 11, (1, 1, 1), align="center")
    rounded(cr, M + 40, ty - 4, 580, 34, 8)
    rgb(cr, (0.06, 0.09, 0.16))
    cr.fill()
    text(cr, f"<tt>{cmd}</tt>", M + 54, ty + 6, 560, 9.5, (0.85, 0.92, 1.0))
    text(cr, note, M + 636, ty + 6, W - M - (M + 636), 10, MUTED)
    ty += 50
text(cr, "Then log out and back in. Press <b>Super + /</b> to see every shortcut, "
         "<b>Super + Shift + N</b> for notes and tasks, and run <b>mk doctor</b> anytime.",
     M, ty + 10, 640, 11, INK, spacing=1.15)
footer(cr, page)

surface.finish()
print(f"{page} pages -> {OUT}")
