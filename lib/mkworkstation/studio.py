"""MK Control Center's Studio pages (bin/mk-center studio | topbar; mk-control-center).

  Wallpaper & Sonoma Lockscreen Studio   a live 16:9 preview of the screen, the
      desktop and lock screen media, their sound and volume, the clock's layout,
      style and colour, the scrim, the glass card, the greeting
  Top Bar, Logo & Dock Studio             the Finder logo (preset, picture, round
      crop, 14-30 px), its label, the app indicator and its animation, the dock's
      look and translucency

Every control writes the same settings as the extensions' own gear
(MehulK Workstation & Sonoma Suite: org.gnome.shell.extensions.wack-sonoma-lockscreen;
MK Shell Engine: org.gnome.shell.extensions.mk-shell-engine), and the shell
follows at once, so this window, Extension Manager and `mk-live-wallpaper`
always agree. There's one wallpaper player: the suite's.
"""
import re
import subprocess
from datetime import datetime
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk, Pango  # noqa: E402

EXT_DIR = Path(GLib.get_user_data_dir()) / "gnome-shell/extensions"
SUITE = "wack-sonoma-lockscreen@rinzler69-wastaken.github.com"
SUITE_SCHEMA = "org.gnome.shell.extensions.wack-sonoma-lockscreen"
ENGINE = "mk-shell-engine@mehulk"
ENGINE_SCHEMA = "org.gnome.shell.extensions.mk-shell-engine"
MEDIA_TYPES = ["video/mp4", "video/webm", "video/x-matroska", "video/quicktime", "image/gif", "image/png",
               "image/jpeg", "image/webp"]
IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
VIDEO = re.compile(r"\.(mp4|webm|mkv|mov|m4v|avi)$", re.I)
W, H = 360, 210
SCALE = W / 1920
FONTS = {
    "sonoma-bold": 'font-family: "SF Pro Rounded", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 700;',
    "cupertino-thin": 'font-family: "SF Pro Display", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 200;',
    "digital": 'font-family: "DSEG7 Classic", "DejaVu Sans Mono", monospace; font-weight: 700;',
}
LAYOUT_SIZE = {"sonoma-center": 128, "sequoia-compact": 84, "minimal-left": 96, "vertical-stacked": 112}
LAYOUT_DATE = {"sonoma-center": 30, "sequoia-compact": 22, "minimal-left": 24, "vertical-stacked": 24}
COLOUR = re.compile(r"^[#a-zA-Z0-9(),.\s%]*$")


def settings_for(uuid, schema_id):
    """The extension's settings (from its own compiled schema), or None when it isn't installed."""
    folder = EXT_DIR / uuid / "schemas"
    if not (folder / "gschemas.compiled").exists():
        return None
    source = Gio.SettingsSchemaSource.new_from_directory(str(folder), Gio.SettingsSchemaSource.get_default(), False)
    schema = source.lookup(schema_id, False)
    return Gio.Settings(settings_schema=schema) if schema else None


def _exists(path):
    return bool(path) and Path(path).expanduser().is_file()


# ----------------------------------------------------------------- the preview
class Preview(Gtk.Frame):
    """The screen at 360 x 210: media, scrim, clock, pill, greeting, the Finder logo."""

    serial = 0

    def __init__(self, suite):
        super().__init__(halign=Gtk.Align.CENTER, css_classes=["mk-preview"])
        Preview.serial += 1
        self.id = f"mkstudio{Preview.serial}"
        self.s = suite
        self.media_path = None
        self.stream = None
        overlay = Gtk.Overlay(width_request=W, height_request=H)
        overlay.set_overflow(Gtk.Overflow.HIDDEN)
        self.set_child(overlay)
        self.picture = Gtk.Picture(content_fit=Gtk.ContentFit.COVER, can_shrink=True, width_request=W, height_request=H)
        overlay.set_child(self.picture)
        overlay.add_overlay(Gtk.Box(css_classes=[f"{self.id}-scrim"]))
        bar = Gtk.Box(valign=Gtk.Align.START, spacing=4, css_classes=[f"{self.id}-bar"])
        self.logo = Gtk.Image(margin_start=8, valign=Gtk.Align.CENTER)
        self.logo_pic = Gtk.Picture(margin_start=8, valign=Gtk.Align.CENTER, content_fit=Gtk.ContentFit.COVER,
                                    can_shrink=True, css_classes=[f"{self.id}-round"])
        self.logo_pic.set_overflow(Gtk.Overflow.HIDDEN)
        self.logo_label = Gtk.Label(css_classes=[f"{self.id}-barlabel"])
        for w in (self.logo, self.logo_pic, self.logo_label):
            bar.append(w)
        overlay.add_overlay(bar)
        self.clock = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.START, margin_top=32,
                             css_classes=[f"{self.id}-card"])
        self.date = Gtk.Label(css_classes=[f"{self.id}-date"])
        self.time = Gtk.Label(css_classes=[f"{self.id}-time"], justify=Gtk.Justification.CENTER)
        self.pill = Gtk.Label(label="82%  ·  21°C", halign=Gtk.Align.CENTER, margin_top=4, css_classes=[f"{self.id}-pill"])
        for w in (self.date, self.time, self.pill):
            self.clock.append(w)
        overlay.add_overlay(self.clock)
        bottom = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.END, halign=Gtk.Align.CENTER,
                         margin_bottom=16, spacing=4)
        self.greeting = Gtk.Label(css_classes=[f"{self.id}-greeting"])
        bottom.append(self.greeting)
        bottom.append(Gtk.Label(label="••••••", width_request=96, css_classes=[f"{self.id}-field"]))
        overlay.add_overlay(bottom)
        self.css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), self.css,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.engine = None
        self.idle = 0
        suite.connect("changed", lambda *_: self.queue())
        GLib.timeout_add_seconds(20, lambda: (self.sync(), True)[1])
        self.sync()

    def queue(self):
        if not self.idle:
            self.idle = GLib.idle_add(self._idle_sync)

    def _idle_sync(self):
        self.idle = 0
        self.sync()
        return False

    def _media(self):
        s = self.s
        lock = (s.get_string("desktop-wallpaper-path") or s.get_string("background-video-path")) \
            if s.get_boolean("wallpaper-sync-mode") else s.get_string("background-video-path")
        if s.get_boolean("live-enabled") and _exists(lock):
            return str(Path(lock).expanduser())
        try:
            bg = Gio.Settings(schema_id="org.gnome.desktop.background")
            dark = Gio.Settings(schema_id="org.gnome.desktop.interface").get_string("color-scheme") == "prefer-dark"
            uri = bg.get_string("picture-uri-dark" if dark else "picture-uri") or bg.get_string("picture-uri")
            return Gio.File.new_for_uri(uri).get_path() if uri else None
        except GLib.Error:
            return None

    def _sync_media(self):
        path = self._media()
        if path == self.media_path:
            return
        self.media_path = path
        if self.stream:
            self.stream.pause()
            self.stream = None
        if not path:
            self.picture.set_paintable(None)
        elif VIDEO.search(path):
            self.stream = Gtk.MediaFile.new_for_filename(path)
            self.stream.set_muted(True)
            self.stream.set_loop(True)
            self.stream.play()
            self.picture.set_paintable(self.stream)
        else:
            self.picture.set_filename(path)

    def _sync_logo(self):
        s = self.s
        preset, size = s.get_string("finder-logo-preset"), s.get_int("finder-icon-size")
        px = round(size * 0.75)
        custom = str(Path(s.get_string("finder-custom-logo")).expanduser()) if s.get_string("finder-custom-logo") else ""
        round_ = preset == "custom" and _exists(custom) and s.get_boolean("finder-logo-circular") and not custom.lower().endswith(".svg")
        self.logo_pic.set_visible(round_)
        self.logo.set_visible(not round_ and preset != "none")
        if round_:
            self.logo_pic.set_filename(custom)
            self.logo_pic.set_size_request(px, px)
        elif preset == "custom" and _exists(custom):
            self.logo.set_from_file(custom)
        elif preset in ("mk", "apple"):
            name = "mk-emblem-symbolic.svg" if preset == "mk" else "mk-apple-symbolic.svg"
            self.logo.set_from_file(str(EXT_DIR / SUITE / "icons" / name))
        else:
            self.logo.set_from_icon_name("fedora-logo-icon")
        self.logo.set_pixel_size(px)
        self.logo_label.set_label(s.get_string("finder-label") if s.get_boolean("finder-show-label") else "")
        return px

    def sync(self):
        s = self.s
        self._sync_media()
        logo = self._sync_logo()
        layout = s.get_string("lock-clock-layout")
        left = layout == "minimal-left"
        self.clock.set_halign(Gtk.Align.START if left else Gtk.Align.CENTER)
        self.clock.set_margin_start(round(96 * SCALE) + 8 if left else 0)
        self.clock.set_margin_top(24 if layout == "sequoia-compact" else 32)
        for label in (self.date, self.time):
            label.set_halign(Gtk.Align.START if left else Gtk.Align.CENTER)
        self.time.set_justify(Gtk.Justification.LEFT if left else Gtk.Justification.CENTER)
        twelve = Gio.Settings(schema_id="org.gnome.desktop.interface").get_string("clock-format") == "12h"
        now = datetime.now()
        text = now.strftime("%I:%M").lstrip("0") if twelve else now.strftime("%H:%M")
        self.time.set_label(text.replace(":", "\n") if layout == "vertical-stacked" else text)
        self.date.set_label(now.strftime("%A, %B ") + str(now.day))
        self.pill.set_visible(s.get_boolean("lock-status-pill"))
        greeting = s.get_string("lock-greeting").strip()
        self.greeting.set_label(greeting)
        self.greeting.set_visible(bool(greeting))
        style = s.get_string("clock-style")
        font = FONTS.get(style, "")
        size = LAYOUT_SIZE.get(layout, 128) * SCALE
        if style == "custom" and s.get_string("clock-font"):
            fd = Pango.FontDescription.from_string(s.get_string("clock-font"))
            family = (fd.get_family() or "").replace('"', "")
            font = (f'font-family: "{family}"; ' if family else "") + f"font-weight: {int(fd.get_weight())};"
            if fd.get_size() > 0:
                size = fd.get_size() / Pango.SCALE * (1 if fd.get_size_is_absolute() else 4 / 3) * SCALE
        colour = lambda key, default: s.get_string(key) if s.get_string(key) and COLOUR.match(s.get_string(key)) else default  # noqa: E731
        card = ("background-color: rgba(18,20,30,0.34); border: 1px solid rgba(255,255,255,0.16); border-radius: 10px; "
                "padding: 6px 14px;") if s.get_boolean("lock-glass-card") else "background: none; border: none; padding: 0;"
        i = self.id
        self.css.load_from_string(f"""
            .mk-preview {{ border-radius: 10px; }}
            .{i}-scrim {{ background-color: rgba(12, 14, 20, {s.get_int('dim-opacity') / 100:.2f}); }}
            .{i}-bar {{ background-color: rgba(0, 0, 0, 0.28); min-height: {max(18, logo + 6)}px; }}
            .{i}-barlabel {{ color: white; font-weight: 800; font-size: 9px; }}
            .{i}-card {{ {card} }}
            .{i}-time {{ {font} font-size: {size:.1f}px; color: {colour('clock-color', 'rgba(255,255,255,0.85)')}; }}
            .{i}-date {{ font-size: {LAYOUT_DATE.get(layout, 30) * SCALE:.1f}px; font-weight: 600;
                color: {colour('date-color', 'rgba(255,255,255,0.65)')}; }}
            .{i}-pill {{ font-size: 7px; font-weight: 600; color: white; background-color: rgba(255,255,255,0.14);
                border-radius: 99px; padding: 1px 6px; }}
            .{i}-greeting {{ font-size: 8px; font-weight: 600; color: rgba(255,255,255,0.88); }}
            .{i}-field {{ font-size: 7px; color: rgba(255,255,255,0.7); background-color: rgba(255,255,255,0.16);
                border-radius: 99px; padding: 2px 10px; }}
            picture.{i}-round {{ border-radius: 999px; }}
        """)


# ----------------------------------------------------------------- rows
def switch_row(s, key, title, subtitle=""):
    row = Adw.SwitchRow(title=title, subtitle=subtitle)
    s.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT)
    return row


def combo_row(s, key, title, choices):
    row = Adw.ComboRow(title=title, model=Gtk.StringList.new([label for _, label in choices]))
    values = [v for v, _ in choices]

    def pull(*_):
        v = s.get_string(key)
        row.set_selected(values.index(v) if v in values else 0)
    pull()
    s.connect(f"changed::{key}", pull)
    row.connect("notify::selected", lambda r, _p: values[r.get_selected()] != s.get_string(key)
                and s.set_string(key, values[r.get_selected()]))
    return row


def scale_row(s, key, title, lo, hi, step, fmt, kind="i", subtitle=""):
    """A slider for an int (kind 'i'), a 0-1 double shown as % ('pct'), or a double ('d')."""
    row = Adw.ActionRow(title=title, subtitle=subtitle)
    scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, lo, hi, step)
    scale.set_hexpand(True)
    scale.set_size_request(220, -1)
    scale.set_valign(Gtk.Align.CENTER)
    scale.set_draw_value(True)
    scale.set_value_pos(Gtk.PositionType.RIGHT)
    scale.set_format_value_func(lambda _s, v: fmt(v))
    get = {"i": lambda: s.get_int(key), "pct": lambda: s.get_double(key) * 100, "d": lambda: s.get_double(key)}[kind]

    def put(_scale):
        v = scale.get_value()
        if kind == "i":
            if round(v) != s.get_int(key):
                s.set_int(key, int(round(v)))
        elif kind == "pct":
            if abs(v / 100 - s.get_double(key)) > 0.001:
                s.set_double(key, round(v) / 100)
        elif abs(v - s.get_double(key)) > 0.001:
            s.set_double(key, round(v, 2))
    scale.set_value(get())
    scale.connect("value-changed", put)
    s.connect(f"changed::{key}", lambda *_: abs(scale.get_value() - get()) > 0.01 and scale.set_value(get()))
    row.add_suffix(scale)
    return row


def file_row(window, s, key, title, types, none, folder):
    row = Adw.ActionRow(title=title)

    def show(*_):
        path = s.get_string(key)
        row.set_subtitle(GLib.markup_escape_text(Path(path).name if path else none))
    show()
    s.connect(f"changed::{key}", show)
    choose = Gtk.Button(label="Choose…", valign=Gtk.Align.CENTER)

    def pick(_b):
        flt = Gtk.FileFilter(name=title)
        for t in types:
            flt.add_mime_type(t)
        filters = Gio.ListStore(item_type=Gtk.FileFilter)
        filters.append(flt)
        dialog = Gtk.FileDialog(title=title, filters=filters, default_filter=flt)
        start = GLib.get_user_special_dir(folder)
        if start:
            dialog.set_initial_folder(Gio.File.new_for_path(start))

        def done(d, res):
            try:
                f = d.open_finish(res)
            except GLib.Error:
                return                               # (cancelled)
            if f:
                s.set_string(key, f.get_path())
        dialog.open(window, None, done)
    choose.connect("clicked", pick)
    clear = Gtk.Button(icon_name="edit-clear-symbolic", valign=Gtk.Align.CENTER, css_classes=["flat"], tooltip_text="Clear")
    clear.connect("clicked", lambda _b: s.set_string(key, ""))
    row.add_suffix(choose)
    row.add_suffix(clear)
    return row


def colour_row(s, key, title):
    row = Adw.ActionRow(title=title)
    button = Gtk.ColorDialogButton(dialog=Gtk.ColorDialog(title=title, with_alpha=False), valign=Gtk.Align.CENTER)
    rgba = Gdk.RGBA()
    if rgba.parse(s.get_string(key) or "white"):
        button.set_rgba(rgba)
    button.connect("notify::rgba", lambda b, _p: s.set_string(key, b.get_rgba().to_string()))
    reset = Gtk.Button(icon_name="edit-undo-symbolic", valign=Gtk.Align.CENTER, css_classes=["flat"],
                       tooltip_text="The theme's colour")
    reset.connect("clicked", lambda _b: s.set_string(key, ""))
    row.add_suffix(button)
    row.add_suffix(reset)
    return row


def missing(page, what):
    group = Adw.PreferencesGroup(title="Not installed yet",
                                 description=f"{what} isn't installed: run ./sync.sh (mk sync) once.")
    page.add(group)
    return page


def lock_now(_b=None):
    subprocess.Popen(["loginctl", "lock-session"])


# ----------------------------------------------------------------- the pages
def wallpaper_studio(window):
    page = Adw.PreferencesPage()
    s = settings_for(SUITE, SUITE_SCHEMA)
    if not s:
        return missing(page, "MehulK Workstation &amp; Sonoma Suite")
    top = Adw.PreferencesGroup(title="Wallpaper &amp; Sonoma Lockscreen Studio",
                               description="The screen as it'll look; everything below changes it as you go.")
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, halign=Gtk.Align.CENTER)
    box.append(Preview(s))
    lock = Gtk.Button(label="Preview Fullscreen Lock Screen", halign=Gtk.Align.CENTER, css_classes=["pill"],
                      tooltip_text="Locks the screen now (your password unlocks it)")
    lock.connect("clicked", lock_now)
    box.append(lock)
    top.add(box)
    page.add(top)

    media = Adw.PreferencesGroup(title="Media")
    media.add(file_row(window, s, "desktop-wallpaper-path", "Desktop", MEDIA_TYPES, "GNOME's own wallpaper",
                       GLib.UserDirectory.DIRECTORY_VIDEOS))
    media.add(switch_row(s, "live-enabled", "Live Lock Screen"))
    media.add(switch_row(s, "wallpaper-sync-mode", "Lock Screen Same as the Desktop"))
    lock_file = file_row(window, s, "background-video-path", "Lock Screen", MEDIA_TYPES, "GNOME's own wallpaper",
                         GLib.UserDirectory.DIRECTORY_VIDEOS)
    s.bind("wallpaper-sync-mode", lock_file, "sensitive", Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN)
    media.add(lock_file)
    page.add(media)

    sound = Adw.PreferencesGroup(title="Sound", description="Off: no audio stream is opened at all.")
    sound.add(switch_row(s, "desktop-audio-enabled", "Desktop Video Sound"))
    vol = scale_row(s, "desktop-audio-volume", "Desktop Volume", 0, 100, 1, lambda v: f"{round(v)} %", "pct")
    s.bind("desktop-audio-enabled", vol, "sensitive", Gio.SettingsBindFlags.GET)
    sound.add(vol)
    sound.add(switch_row(s, "lockscreen-audio-enabled", "Lock Screen Video Sound"))
    lvol = scale_row(s, "lockscreen-audio-volume", "Lock Screen Volume", 0, 100, 1, lambda v: f"{round(v)} %", "pct")
    s.bind("lockscreen-audio-enabled", lvol, "sensitive", Gio.SettingsBindFlags.GET)
    sound.add(lvol)
    sound.add(switch_row(s, "audio-auto-mute-on-other-media", "Mute While Other Media Plays"))
    page.add(sound)

    clock = Adw.PreferencesGroup(title="Clock Styler")
    clock.add(combo_row(s, "lock-clock-layout", "Layout", [("sonoma-center", "Sonoma Center Giant"),
                                                          ("sequoia-compact", "macOS Sequoia Compact"),
                                                          ("minimal-left", "Minimalist Left-Aligned"),
                                                          ("vertical-stacked", "Vertical Stacked")]))
    clock.add(combo_row(s, "clock-style", "Style", [("sonoma-bold", "Sonoma Bold Rounded"),
                                                   ("cupertino-thin", "Cupertino Thin"),
                                                   ("digital", "Classic Digital"), ("custom", "Custom Font")]))
    clock.add(colour_row(s, "clock-color", "Clock Colour"))
    clock.add(colour_row(s, "date-color", "Date Colour"))
    clock.add(scale_row(s, "dim-opacity", "Scrim", 0, 85, 5, lambda v: f"{round(v)} %"))
    clock.add(switch_row(s, "lock-glass-card", "Glass Card Behind the Clock"))
    greeting = Adw.EntryRow(title="Greeting or Quote Above the Password Field", text=s.get_string("lock-greeting"),
                            show_apply_button=True)
    greeting.connect("apply", lambda e: s.set_string("lock-greeting", e.get_text().strip()))
    clock.add(greeting)
    more = Adw.ActionRow(title="Every Setting", subtitle="The suite's own window (five pages)", activatable=True)
    more.add_suffix(Gtk.Image(icon_name="go-next-symbolic"))
    more.connect("activated", lambda _r: subprocess.Popen(["gnome-extensions", "prefs", SUITE]))
    clock.add(more)
    page.add(clock)
    return page


def topbar_studio(window):
    page = Adw.PreferencesPage()
    s = settings_for(SUITE, SUITE_SCHEMA)
    engine = settings_for(ENGINE, ENGINE_SCHEMA)
    if not s:
        return missing(page, "MehulK Workstation &amp; Sonoma Suite")
    top = Adw.PreferencesGroup(title="Top Bar, Circular Logo &amp; Dock Studio")
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, halign=Gtk.Align.CENTER)
    box.append(Preview(s))
    top.add(box)
    page.add(top)

    logo = Adw.PreferencesGroup(title="Finder logo")
    logo.add(combo_row(s, "finder-logo-preset", "Logo", [("fedora-blue", "Fedora Blue"), ("fedora-mono", "Fedora Monochrome"),
                                                        ("mk", "MK Emblem"), ("apple", "Apple Fruit"),
                                                        ("custom", "Custom Image"), ("none", "None")]))
    logo.add(file_row(window, s, "finder-custom-logo", "Custom Logo Image", IMAGE_TYPES, "None chosen",
                      GLib.UserDirectory.DIRECTORY_PICTURES))
    logo.add(switch_row(s, "finder-logo-circular", "Circular Crop", "A picture becomes a round avatar"))
    logo.add(scale_row(s, "finder-icon-size", "Logo Size", 14, 30, 1, lambda v: f"{round(v)} px",
                       subtitle="The top bar follows as you drag"))
    logo.add(switch_row(s, "finder-show-label", "Show the Label"))
    label = Adw.EntryRow(title="Label Text", text=s.get_string("finder-label"), show_apply_button=True)
    label.connect("apply", lambda e: s.set_string("finder-label", e.get_text().strip()))
    logo.add(label)
    page.add(logo)

    app = Adw.PreferencesGroup(title="App indicator")
    app.add(switch_row(s, "show-app-indicator", "App Indicator"))
    app.add(switch_row(s, "app-indicator-animate", "Fade Animation",
                       "Fades and shrinks away on an empty desktop, grows back with the next app"))
    page.add(app)

    dock = Adw.PreferencesGroup(title="Dock")
    if engine:
        dock.add(combo_row(engine, "dock-style", "Look", [("obsidian-glass", "Obsidian Glass"),
                                                         ("cupertino-frost", "Cupertino Frost"),
                                                         ("spider-glow", "Spider Glow"), ("minimal-flat", "Minimal Flat")]))
        dock.add(scale_row(engine, "dock-opacity", "Translucency", 15, 90, 1, lambda v: f"{round(v)} %", "pct",
                           subtitle="How solid Obsidian Glass's tint is"))
        dock.add(scale_row(engine, "dock-icon-size", "Icon Size", 36, 56, 2, lambda v: f"{round(v)} px"))
    else:
        dock.set_description("MK Shell Engine isn't installed: run ./sync.sh (mk sync) once.")
    page.add(dock)
    return page
