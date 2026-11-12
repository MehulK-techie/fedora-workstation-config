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
import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Adw, Gdk, GdkPixbuf, Gio, GLib, Gtk, Pango  # noqa: E402

EXT_DIR = Path(GLib.get_user_data_dir()) / "gnome-shell/extensions"
SUITE = "wack-sonoma-lockscreen@rinzler69-wastaken.github.com"
SUITE_SCHEMA = "org.gnome.shell.extensions.wack-sonoma-lockscreen"
ENGINE = "mk-shell-engine@mehulk"
ENGINE_SCHEMA = "org.gnome.shell.extensions.mk-shell-engine"
MEDIA_TYPES = ["video/mp4", "video/webm", "video/x-matroska", "video/quicktime", "image/gif", "image/png",
               "image/jpeg", "image/webp"]
IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
VIDEO = re.compile(r"\.(mp4|webm|mkv|mov|m4v|avi)$", re.I)
W, H = 380, 214
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
LAYOUTS = {
    "sonoma-center": {"time": 117, "date": 30, "place": "center"},
    "sequoia-split": {"time": 104, "date": 26, "place": "left", "split": True, "inset": 80},
    "vertical-stacked": {"time": 112, "date": 24, "place": "center", "stack": True, "neon": True},
    "corner-hud": {"time": 56, "date": 16, "place": "corner", "inset": 48},
    "glass-framed": {"time": 112, "date": 26, "place": "center", "card": True},
    "sequoia-compact": {"time": 84, "date": 22, "place": "center"},
    "minimal-left": {"time": 96, "date": 24, "place": "left"},
}
FONTS.update({
    "sf-rounded-heavy": 'font-family: "SF Pro Rounded", "Nunito", "Inter Display", Inter, sans-serif; font-weight: 900;',
    "jetbrains-mono": 'font-family: "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace; font-weight: 600;',
    "editorial-serif": 'font-family: "Playfair Display", "Noto Serif Display", "DejaVu Serif", serif; font-weight: 600; font-style: italic;',
    "futura-geometric": 'font-family: "Futura", "Jost", "Century Gothic", "URW Gothic", sans-serif; font-weight: 500;',
})
DATES = {"full": "%A, %B {day}", "short": "%a, %b {day}", "numeric": "%x", "iso": "%Y-%m-%d"}


def scaled(path, size):
    """A picture scaled to fit SIZE x SIZE: its natural size is then SIZE, never the file's
    (a full-size logo used to fill the whole preview)."""
    try:
        return Gdk.Texture.new_for_pixbuf(GdkPixbuf.Pixbuf.new_from_file_at_scale(str(path), size, size, True))
    except GLib.Error:
        return None


def avatar_path():
    for p in (Path.home() / ".face", Path("/var/lib/AccountsService/icons") / GLib.get_user_name()):
        try:
            if p.is_file():
                return p
        except OSError:
            pass
    return None


class Preview(Gtk.Frame):
    """The screen at 360 x 210: media, scrim, a mini 18 px top bar with the Finder logo,
    the clock, tagline, pill, your 28 px picture and name, the greeting, a password field."""

    serial = 0

    def __init__(self, suite):
        super().__init__(halign=Gtk.Align.CENTER, valign=Gtk.Align.START, css_classes=["mk-preview"])
        Preview.serial += 1
        self.id = i = f"mkstudio{Preview.serial}"
        self.s = suite
        self.media_path = None
        self.stream = None
        self.round = False
        overlay = Gtk.Overlay(width_request=W, height_request=H)
        overlay.set_overflow(Gtk.Overflow.HIDDEN)
        self.set_child(overlay)
        # (a fixed-size base, the picture over it: a big wallpaper never makes the preview grow)
        overlay.set_child(Gtk.Box(width_request=W, height_request=H, hexpand=False, vexpand=False))
        self.picture = Gtk.Picture(content_fit=Gtk.ContentFit.COVER, can_shrink=True)
        overlay.add_overlay(self.picture)
        overlay.set_clip_overlay(self.picture, True)
        overlay.add_overlay(Gtk.Box(css_classes=[f"{i}-scrim"]))
        bar = Gtk.Box(valign=Gtk.Align.START, spacing=4, height_request=18, css_classes=[f"{i}-bar"])
        self.logo = Gtk.Picture(margin_start=6, valign=Gtk.Align.CENTER, halign=Gtk.Align.START,
                                content_fit=Gtk.ContentFit.COVER, can_shrink=False)
        self.logo.set_overflow(Gtk.Overflow.HIDDEN)
        self.logo_label = Gtk.Label(css_classes=[f"{i}-barlabel"], valign=Gtk.Align.CENTER)
        bar.append(self.logo)
        bar.append(self.logo_label)
        overlay.add_overlay(bar)
        overlay.set_clip_overlay(bar, True)
        self.clock = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.START, margin_top=30,
                             css_classes=[f"{i}-card"])
        self.date = Gtk.Label(css_classes=[f"{i}-date"])
        self.time = Gtk.Label(css_classes=[f"{i}-time"], justify=Gtk.Justification.CENTER)
        self.tagline = Gtk.Label(css_classes=[f"{i}-tagline"])
        self.pill = Gtk.Label(label="82%  ·  21°C", halign=Gtk.Align.CENTER, margin_top=4, css_classes=[f"{i}-pill"])
        for w in (self.date, self.time, self.pill, self.tagline):
            self.clock.append(w)
        overlay.add_overlay(self.clock)
        self.column = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.START, halign=Gtk.Align.END,
                              margin_top=60, margin_end=18, spacing=4)
        self.col_pill = Gtk.Label(label="82%  ·  21°C", css_classes=[f"{i}-pill"])
        self.col_media = Gtk.Label(label="♪  Now Playing", css_classes=[f"{i}-pill"])
        self.column.append(self.col_pill)
        self.column.append(self.col_media)
        overlay.add_overlay(self.column)
        bottom = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.END, halign=Gtk.Align.CENTER,
                         margin_bottom=12, spacing=3)
        self.greeting = Gtk.Label(css_classes=[f"{i}-greeting"])
        # (an Image keeps its 28 px: a Picture took the column's width)
        avatar = Gtk.Image(halign=Gtk.Align.CENTER, pixel_size=28, css_classes=[f"{i}-avatar"])
        avatar.set_overflow(Gtk.Overflow.HIDDEN)
        face = avatar_path()
        tex = scaled(face, 28) if face else None
        if tex:
            avatar.set_from_paintable(tex)
        else:
            avatar.set_from_icon_name("avatar-default-symbolic")
        name = Gtk.Label(label=GLib.get_real_name() or GLib.get_user_name(), css_classes=[f"{i}-name"])
        for w in (self.greeting, avatar, name, Gtk.Label(label="••••••", width_request=96, css_classes=[f"{i}-field"])):
            bottom.append(w)
        overlay.add_overlay(bottom)
        self.css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), self.css,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
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
            self.picture.set_paintable(scaled(path, 720))

    def _sync_logo(self):
        """The Finder logo in the mini bar: the slider's 14-30 px, scaled to the 18 px bar (8-15 px)."""
        s = self.s
        preset = s.get_string("finder-logo-preset")
        px = max(8, min(15, round(s.get_int("finder-icon-size") / 2)))
        custom = str(Path(s.get_string("finder-custom-logo")).expanduser()) if s.get_string("finder-custom-logo") else ""
        path = None
        if preset == "custom" and _exists(custom):
            path = custom
        elif preset in ("mk", "apple"):
            path = EXT_DIR / SUITE / "icons" / ("mk-emblem-symbolic.svg" if preset == "mk" else "mk-apple-symbolic.svg")
        tex = scaled(path, px) if path else None
        if not tex and preset != "none":
            theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default())
            tex = theme.lookup_icon("fedora-logo-icon", None, px, 1, Gtk.TextDirection.NONE, 0)
        self.logo.set_paintable(None if preset == "none" else tex)
        self.logo.set_visible(preset != "none" and tex is not None)
        self.logo.set_size_request(px, px)
        self.round = preset == "custom" and path == custom and s.get_boolean("finder-logo-circular") \
            and not custom.lower().endswith(".svg")
        self.logo_label.set_label(s.get_string("finder-label") if s.get_boolean("finder-show-label") else "")

    def sync(self):
        s = self.s
        self._sync_media()
        self._sync_logo()
        name = s.get_string("lock-clock-layout")
        layout = LAYOUTS.get(name, LAYOUTS["sonoma-center"])
        left = layout["place"] != "center"
        self.clock.set_halign(Gtk.Align.START if left else Gtk.Align.CENTER)
        self.clock.set_margin_start(round(layout.get("inset", 96) * SCALE) + 8 if left else 0)
        corner = layout["place"] == "corner"                 # (the corner HUD sits at the bottom left)
        self.clock.set_valign(Gtk.Align.END if corner else Gtk.Align.START)
        self.clock.set_margin_bottom(round(48 * SCALE) + 8 if corner else 0)
        self.clock.set_margin_top(0 if corner else 24 if name == "sequoia-compact" else 30)
        for label in (self.date, self.time, self.tagline):
            label.set_halign(Gtk.Align.START if left else Gtk.Align.CENTER)
        self.time.set_justify(Gtk.Justification.LEFT if left else Gtk.Justification.CENTER)
        twelve = Gio.Settings(schema_id="org.gnome.desktop.interface").get_string("clock-format") == "12h"
        now = datetime.now()
        text = now.strftime("%I:%M").lstrip("0") if twelve else now.strftime("%H:%M")
        self.time.set_label(text.replace(":", "\n") if layout.get("stack") else text)
        self.date.set_label(now.strftime(DATES.get(s.get_string("lock-date-format"), DATES["full"]).replace("{day}", str(now.day))))
        self.tagline.set_label(s.get_string("lock-tagline").strip()
                               or s.get_string("cupertino-lockscreen-message-text").strip() or "MK Workstation")
        pill = s.get_boolean("lock-status-pill")
        self.pill.set_visible(pill and not layout.get("split"))   # (Sequoia: cards in the right-hand column)
        self.column.set_visible(bool(layout.get("split")))
        self.col_pill.set_visible(pill and bool(layout.get("split")))
        self.col_media.set_visible(s.get_boolean("lock-media-controls"))
        greeting = s.get_string("lock-greeting").strip()
        self.greeting.set_label(greeting)
        self.greeting.set_visible(bool(greeting))
        style = s.get_string("clock-style")
        font = FONTS.get(style, "")
        size = layout["time"] * SCALE
        if style == "custom" and s.get_string("clock-font"):
            fd = Pango.FontDescription.from_string(s.get_string("clock-font"))
            family = (fd.get_family() or "").replace('"', "")
            font = (f'font-family: "{family}"; ' if family else "") + f"font-weight: {int(fd.get_weight())};"
            if fd.get_size() > 0:
                size = fd.get_size() / Pango.SCALE * (1 if fd.get_size_is_absolute() else 4 / 3) * SCALE
        colour = lambda key, default: s.get_string(key) if s.get_string(key) and COLOUR.match(s.get_string(key)) else default  # noqa: E731
        neon = layout.get("neon", False)
        glow = max(s.get_int("lock-clock-glow"), 45 if neon else 0)
        shadow = (f"text-shadow: 0 {glow / 60:.1f}px {1 + glow * 0.06:.1f}px "
                  + (f"rgba(34,211,238,{glow / 100:.2f});" if neon else f"rgba(0,0,0,{0.2 + glow / 160:.2f});")) if glow else ""
        card = (f"background-color: rgba(16,20,32,{s.get_int('lock-card-opacity') / 100:.2f}); "
                "border: 1px solid rgba(255,255,255,0.24); border-radius: 10px; padding: 6px 14px;") \
            if s.get_boolean("lock-glass-card") or layout.get("card") else "background: none; border: none; padding: 0;"
        i = self.id
        self.css.load_from_string(f"""
            .mk-preview {{ border-radius: 10px; }}
            .{i}-scrim {{ background-color: rgba(12, 14, 20, {s.get_int('dim-opacity') / 100:.2f}); }}
            .{i}-bar {{ background-color: rgba(0, 0, 0, 0.30); min-height: 18px; }}
            .{i}-barlabel {{ color: white; font-weight: 800; font-size: 8px; }}
            .{i}-card {{ {card} }}
            .{i}-time {{ {font} font-size: {size:.1f}px; {shadow}
                color: {colour('clock-color', '#67e8f9' if neon else 'rgba(255,255,255,0.85)')}; }}
            .{i}-date {{ font-size: {layout['date'] * SCALE:.1f}px; font-weight: 600;
                color: {colour('date-color', 'rgba(255,255,255,0.65)')}; }}
            .{i}-tagline {{ font-size: 6px; font-weight: 600; color: rgba(255,255,255,0.8); }}
            .{i}-pill {{ font-size: 7px; font-weight: 600; color: white; background-color: rgba(255,255,255,0.14);
                border-radius: 99px; padding: 1px 6px; }}
            .{i}-greeting {{ font-size: 7px; font-weight: 600; color: rgba(255,255,255,0.88); }}
            .{i}-name {{ font-size: 7px; font-weight: 700; color: white; }}
            .{i}-field {{ font-size: 7px; color: rgba(255,255,255,0.7); background-color: rgba(255,255,255,0.16);
                border-radius: 99px; padding: 2px 10px; }}
            image.{i}-avatar {{ border-radius: 999px; }}
            picture.{i}-round {{ border-radius: 999px; }}
        """)
        self.logo.set_css_classes([f"{i}-round"] if self.round else [])


# ----------------------------------------------------------------- rows
def choice_buttons(s, key, title, choices):
    """A row of linked buttons, one per choice; the one in the setting is pressed (live both ways)."""
    row = Adw.ActionRow(title=title)
    box = Gtk.Box(css_classes=["linked"], valign=Gtk.Align.CENTER)
    buttons, group = {}, None
    for value, label in choices:
        b = Gtk.ToggleButton(label=label, group=group)
        group = group or b
        b.connect("toggled", lambda btn, v=value: btn.get_active() and s.get_string(key) != v and s.set_string(key, v))
        buttons[value] = b
        box.append(b)

    def show(*_):
        b = buttons.get(s.get_string(key))
        if b and not b.get_active():
            b.set_active(True)
    show()
    s.connect(f"changed::{key}", show)
    row.add_suffix(box)
    return row


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


def desktop_sound_status(s):
    """What the desktop wallpaper's sound is doing right now, asked of the sound server itself
    (the player's stream, "MK Live Wallpaper"), every 2 s while the window is open."""
    row = Adw.ActionRow(title="Status", subtitle="…")
    row.add_css_class("property")

    def state():
        if not s.get_boolean("desktop-audio-enabled"):
            return "Off: the desktop video plays without opening any sound stream"
        if not s.get_string("desktop-wallpaper-path"):
            return "No desktop video chosen (Media › Desktop)"
        try:
            info = json.loads((Path(GLib.get_user_runtime_dir()) / "mk-live-wallpaper.json").read_text())
            if info.get("path") == os.path.expanduser(s.get_string("desktop-wallpaper-path")) and info.get("audio") is False:
                return "This video has no sound track"
        except (OSError, ValueError):
            pass
        try:
            out = subprocess.run(["pactl", "-f", "json", "list", "sink-inputs"], capture_output=True, text=True,
                                 timeout=2).stdout
            streams = [x for x in json.loads(out or "[]")
                       if x.get("properties", {}).get("application.name") == "MK Live Wallpaper"]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return "On (the sound server didn't answer)"
        if not streams:
            return "On: starting…"
        x = streams[0]
        level = max((int(str(v.get("value_percent", "0")).rstrip("%") or 0) for v in x.get("volume", {}).values()),
                    default=0)
        if x.get("mute") or level == 0 or x.get("corked"):
            return "Quiet for now (an app covers the desktop, the screen's locked, or other media plays)"
        return f"Active (PipeWire sink · {level} %)"

    def update():
        if row.get_root() is None:
            return GLib.SOURCE_REMOVE              # (the window closed)
        row.set_subtitle(state())
        return GLib.SOURCE_CONTINUE
    s.connect("changed::desktop-audio-enabled", lambda *_: update())
    s.connect("changed::desktop-wallpaper-path", lambda *_: update())
    row.connect("map", lambda *_: update())
    GLib.timeout_add_seconds(2, lambda: update() if row.get_mapped() or row.get_root() else GLib.SOURCE_REMOVE)
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
    def do_clear(_b):
        if key == "desktop-wallpaper-path":         # (cleared on purpose: the shell mustn't put it back)
            note = Path(GLib.get_user_config_dir()) / "mk" / "wallpaper.json"
            try:
                data = json.loads(note.read_text())
                data["desktop"] = ""
                note.write_text(json.dumps(data, indent=2))
            except (OSError, ValueError):
                pass
        s.set_string(key, "")
    clear.connect("clicked", do_clear)
    row.add_suffix(choose)
    row.add_suffix(clear)
    return row


def colour_row(s, key, title, subtitle=""):
    row = Adw.ActionRow(title=title, subtitle=subtitle)
    button = Gtk.ColorDialogButton(dialog=Gtk.ColorDialog(title=title, with_alpha=False), valign=Gtk.Align.CENTER)
    rgba = Gdk.RGBA()
    if rgba.parse(s.get_string(key) or "white"):
        button.set_rgba(rgba)
    def chosen(b, _p):
        c = b.get_rgba()
        # the dock takes #rrggbb; the lock screen's colours any CSS colour
        s.set_string(key, f"#{round(c.red * 255):02x}{round(c.green * 255):02x}{round(c.blue * 255):02x}"
                     if key == "dock-glow-color" else c.to_string())
    button.connect("notify::rgba", chosen)
    reset = Gtk.Button(icon_name="edit-undo-symbolic", valign=Gtk.Align.CENTER, css_classes=["flat"],
                       tooltip_text="The theme's colour")
    reset.connect("clicked", lambda _b: s.set_string(key, ""))
    row.add_suffix(button)
    row.add_suffix(reset)
    return row


TINTS = [("auto", "Wallpaper Auto", None), ("#0f1117", "Obsidian", "#0f1117"), ("#22d3ee", "Arctic Cyan", "#22d3ee"),
         ("#a855f7", "Amethyst", "#a855f7"), ("#10b981", "Emerald", "#10b981"), ("#f59e0b", "Warm Amber", "#f59e0b")]


def tint_row(s, key="panel-tint-color"):
    """Glass Tint Colour: a swatch per preset (Wallpaper Auto first), and a colour of your own, all
    live both ways (as the dock's Glow Colour row)."""
    row = Adw.ActionRow(title="Glass Tint Colour", subtitle="The top bar's capsules, the dock and popovers only")
    box = Gtk.Box(css_classes=["linked"], valign=Gtk.Align.CENTER)
    buttons, group = {}, None
    css = Gtk.CssProvider()
    css.load_from_string("".join(f".mk-tint-{v[1:]} {{ background: {c}; min-width: 18px; min-height: 18px; }}"
                                 for v, _l, c in TINTS if c))
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    for value, label, colour in TINTS:
        b = Gtk.ToggleButton(group=group, tooltip_text=label)
        if colour:
            b.set_child(Gtk.Box(css_classes=[f"mk-tint-{value[1:]}"]))
        else:
            b.set_label("Auto")
        group = group or b
        b.connect("toggled", lambda btn, v=value: btn.get_active() and s.get_string(key) != v and s.set_string(key, v))
        buttons[value] = b
        box.append(b)
    own = Gtk.ColorDialogButton(dialog=Gtk.ColorDialog(title="Glass Tint Colour", with_alpha=False),
                                valign=Gtk.Align.CENTER, tooltip_text="A colour of your own")

    def chosen(b, _p):
        c = b.get_rgba()
        hexed = f"#{round(c.red * 255):02x}{round(c.green * 255):02x}{round(c.blue * 255):02x}"
        if s.get_string(key) != hexed:
            s.set_string(key, hexed)
    own.connect("notify::rgba", chosen)

    def show(*_):
        value = s.get_string(key)
        b = buttons.get(value)
        if b and not b.get_active():
            b.set_active(True)
        elif not b:
            for other in buttons.values():
                other.set_active(False)
            rgba = Gdk.RGBA()
            if rgba.parse(value):
                own.set_rgba(rgba)
    show()
    s.connect(f"changed::{key}", show)
    row.add_suffix(box)
    row.add_suffix(own)
    return row


def open_wallpaper_grid(_button=None):
    """The shell's wallpaper grid (Super+W), through MK Shell Engine's D-Bus bridge."""
    try:
        Gio.DBus.session.call_sync("org.gnome.Shell", "/org/mk/ShellEngine", "org.mk.ShellEngine", "WallpaperGrid",
                                   None, None, Gio.DBusCallFlags.NONE, 2000, None)
    except GLib.Error as e:
        print(f"Wallpaper grid: {e.message}")


def missing(page, what):
    group = Adw.PreferencesGroup(title="Not installed yet",
                                 description=f"{what} isn't installed: run ./sync.sh (mk sync) once.")
    page.add(group)
    return page


def lock_now(_b=None):
    subprocess.Popen(["loginctl", "lock-session"])


# ----------------------------------------------------------------- the split view
PRESETS = [("sonoma-center", "Sonoma"), ("sequoia-split", "Sequoia"), ("vertical-stacked", "Cyberpunk"),
           ("corner-hud", "Corner HUD"), ("glass-framed", "Glass Card")]


def split(s, page, title):
    """Two columns: on the left (always in view, it never scrolls away) the live preview, the
    lock screen button and the layout presets; on the right the settings, scrolling. Every
    change shows in the preview beside it at once."""
    outer = Gtk.Box(spacing=0, hexpand=True, vexpand=True)
    left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=18, margin_bottom=18,
                   margin_start=18, margin_end=12, width_request=W + 24, css_classes=["mk-studio-sticky"])
    left.append(Gtk.Label(label=title.replace("&amp;", "&"), xalign=0, css_classes=["title-4"]))
    left.append(Preview(s))
    lock = Gtk.Button(label="Preview Fullscreen Lock Screen", css_classes=["pill"],
                      tooltip_text="Locks the screen now (your password unlocks it)")
    lock.connect("clicked", lock_now)
    left.append(lock)
    left.append(Gtk.Label(label="Lock screen layout", xalign=0, css_classes=["caption-heading", "dim-label"]))
    presets = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, max_children_per_line=3, min_children_per_line=3,
                          column_spacing=6, row_spacing=6, homogeneous=True)
    buttons = {}
    group = None
    for value, label in PRESETS:
        b = Gtk.ToggleButton(label=label, css_classes=["pill"])
        if group:
            b.set_group(group)
        group = group or b
        b.connect("toggled", lambda btn, v=value: btn.get_active() and s.get_string("lock-clock-layout") != v
                  and s.set_string("lock-clock-layout", v))
        buttons[value] = b
        presets.append(b)

    def follow(*_):
        b = buttons.get(s.get_string("lock-clock-layout"))
        if b and not b.get_active():
            b.set_active(True)
    follow()
    s.connect("changed::lock-clock-layout", follow)
    left.append(presets)
    outer.append(left)
    outer.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
    page.set_hexpand(True)
    outer.append(page)                       # (an Adw.PreferencesPage scrolls by itself)
    return outer


# ----------------------------------------------------------------- the pages
def wallpaper_studio(window):
    page = Adw.PreferencesPage()
    s = settings_for(SUITE, SUITE_SCHEMA)
    if not s:
        return missing(page, "MehulK Workstation &amp; Sonoma Suite")
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

    sound = Adw.PreferencesGroup(title="Sound")
    sound.add(switch_row(s, "desktop-audio-enabled", "Desktop Video Sound"))
    sound.add(desktop_sound_status(s))
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
    clock.add(combo_row(s, "lock-clock-layout", "Layout", [("sonoma-center", "Sonoma Classic Center"),
                                                          ("sequoia-split", "Sequoia Split (Clock Left, Widgets Right)"),
                                                          ("vertical-stacked", "Cyberpunk Vertical Stack"),
                                                          ("corner-hud", "Minimalist Corner HUD"),
                                                          ("glass-framed", "Glass Card Framed")]))
    clock.add(combo_row(s, "clock-style", "Typography", [("sf-rounded-heavy", "SF Pro Rounded Heavy"),
                                                        ("jetbrains-mono", "JetBrains Mono Tech"),
                                                        ("editorial-serif", "Editorial Serif"),
                                                        ("futura-geometric", "Futura Geometric"),
                                                        ("sonoma-bold", "Sonoma Bold Rounded"),
                                                        ("cupertino-thin", "Cupertino Thin"),
                                                        ("digital", "Classic Digital"), ("custom", "Custom System Font")]))
    clock.add(scale_row(s, "lock-clock-glow", "Glow &amp; Shadow", 0, 100, 5, lambda v: f"{round(v)} %"))
    clock.add(combo_row(s, "lock-date-format", "Date Format", [("full", "Monday, November 9"), ("short", "Mon, Nov 9"),
                                                              ("numeric", "Numeric (your locale)"),
                                                              ("iso", "ISO (2026-11-09)")]))
    clock.add(colour_row(s, "clock-color", "Clock Colour"))
    clock.add(colour_row(s, "date-color", "Date Colour"))
    clock.add(scale_row(s, "dim-opacity", "Scrim", 0, 85, 5, lambda v: f"{round(v)} %"))
    clock.add(switch_row(s, "weather-enabled", "Live Weather",
                         "Open-Meteo for where your connection is (no account); shown under the clock and by the calendar's date"))
    clock.add(switch_row(s, "lock-glass-card", "Glass Card Behind the Clock"))
    clock.add(scale_row(s, "lock-card-opacity", "Glass Card Opacity", 10, 90, 2, lambda v: f"{round(v)} %"))
    tagline = Adw.EntryRow(title="Tagline Under the Clock", text=s.get_string("lock-tagline"), show_apply_button=True)
    tagline.connect("apply", lambda e: s.set_string("lock-tagline", e.get_text().strip()))
    clock.add(tagline)
    greeting = Adw.EntryRow(title="Greeting or Quote Above the Password Field", text=s.get_string("lock-greeting"),
                            show_apply_button=True)
    greeting.connect("apply", lambda e: s.set_string("lock-greeting", e.get_text().strip()))
    clock.add(greeting)
    more = Adw.ActionRow(title="Every Setting", subtitle="The suite's own window (five pages)", activatable=True)
    more.add_suffix(Gtk.Image(icon_name="go-next-symbolic"))
    more.connect("activated", lambda _r: subprocess.Popen(["gnome-extensions", "prefs", SUITE]))
    clock.add(more)
    page.add(clock)
    return split(s, page, "Wallpaper &amp; Sonoma Lockscreen Studio")


def topbar_studio(window):
    page = Adw.PreferencesPage()
    s = settings_for(SUITE, SUITE_SCHEMA)
    engine = settings_for(ENGINE, ENGINE_SCHEMA)
    if not s:
        return missing(page, "MehulK Workstation &amp; Sonoma Suite")
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
    page.add(app)

    if engine:
        bar = Adw.PreferencesGroup(title="Top Bar")
        bar.add(choice_buttons(engine, "panel-backdrop-mode", "Backdrop",
                               [("adaptive-solid", "Adaptive (Solid on Window)"), ("always-blurred", "Always Frosted Blur")]))
        # the shell's glass, live: its frost and its tint (glassControls.js in the engine applies them)
        bar.add(switch_row(engine, "panel-blur-enabled", "Frosted Glass", "The blur behind the capsules, the dock and popovers"))
        bar.add(scale_row(engine, "panel-blur-sigma", "Frosted Blur Strength", 0, 64, 1,
                          lambda v: "Clear" if v < 0.5 else f"{round(v)}", subtitle="0 clear glass, 64 heavy frost; MK's own is 38"))
        bar.add(tint_row(engine))
        bar.add(scale_row(engine, "panel-tint-opacity", "Tint Opacity", 0, 45, 1, lambda v: f"{round(v)} %",
                          subtitle="Never application windows"))
        page.add(bar)

        walls = Adw.PreferencesGroup(title="Wallpapers")
        grid = Adw.ActionRow(title="Wallpaper Grid", subtitle="Pictures/Wallpapers and MK's own: search, shuffle, auto-rotate (Super+W)")
        button = Gtk.Button(label="Open Wallpaper Grid", valign=Gtk.Align.CENTER, css_classes=["suggested-action"])
        button.connect("clicked", open_wallpaper_grid)
        grid.add_suffix(button)
        walls.add(grid)
        page.add(walls)

    dock = Adw.PreferencesGroup(title="Dock")
    if engine:
        dock.add(combo_row(engine, "dock-style", "Theme", [("spider-glow", "Spider-Verse Crimson Glow"),
                                                          ("obsidian-glass", "Obsidian Frosted Glass"),
                                                          ("crystal-clear", "Crystal Clear Translucent"),
                                                          ("tahoe-pill", "macOS Tahoe Pill"),
                                                          ("cyber-neon", "Cyberpunk Neon Edge"),
                                                          ("floating-icons", "Minimal Floating Icons (No Backplate)"),
                                                          ("cupertino-frost", "Cupertino Frost"),
                                                          ("minimal-flat", "Minimal Flat")]))
        dock.add(colour_row(engine, "dock-glow-color", "Glow Colour",
                            "The running dots and the focused app's glow; the edge of the glow themes"))
        dock.add(scale_row(engine, "dock-icon-size", "Icon Size", 36, 68, 2, lambda v: f"{round(v)} px"))
        dock.add(scale_row(engine, "dock-hover-scale", "Magnification", 1.0, 1.5, 0.02,
                           lambda v: "Off" if v < 1.005 else f"{v:.2f}x", "d", subtitle="Only the icon under the pointer"))
        dock.add(switch_row(engine, "dock-focused-raise", "Raise the Focused App",
                            "The app you're in sits a little higher and larger, with a soft glow"))
        dock.add(choice_buttons(engine, "dock-animation-style", "Dock Animation",
                                [("fade-scale", "Soft Fade"), ("elastic-slide", "Elastic Slide"),
                                 ("magnetic-wave", "Magnetic Wave"), ("instant-glass", "Instant Glass")]))
        dock.add(switch_row(engine, "dock-icon-glass", "Frosted Glass Icons",
                            "Each icon on a small pane of frosted glass"))
        dock.add(scale_row(engine, "dock-opacity", "Glass Opacity", 10, 95, 1, lambda v: f"{round(v)} %", "pct"))
        dock.add(scale_row(engine, "dock-corner-radius", "Corner Radius", 12, 32, 1, lambda v: f"{round(v)} px"))
        dock.add(combo_row(engine, "dock-indicator-style", "Running Indicator", [("glowing-dot", "Glowing Dot"),
                                                                                ("wide-pill", "Wide Pill Dash"),
                                                                                ("underline", "Subtle Underline")]))
    else:
        dock.set_description("MK Shell Engine isn't installed: run ./sync.sh (mk sync) once.")
    page.add(dock)
    return split(s, page, "Top Bar, Circular Logo &amp; Dock Studio")
