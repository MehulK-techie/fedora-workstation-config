"""The screensaver's windows (GTK): the full-screen scene and the settings
gallery. Loaded only when one of them is shown, never by the idle watcher.
"""
import os
import sys
import time

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_foreign("cairo")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk  # noqa: E402

from . import scenes  # noqa: E402
from .saver_conf import conf, set_conf  # noqa: E402

APP_ID = "io.github.mehulk.MkScreensaver"
FPS = 30
SAVER = os.path.join(os.path.expanduser("~/.local/bin"), "mk-screensaver")


class SaverWindow(Gtk.ApplicationWindow):
    def __init__(self, app, name):
        super().__init__(application=app, title="Screensaver", decorated=False)
        self.scene = scenes.pick(name)
        self.started = time.monotonic()
        self.pointer = None
        area = Gtk.DrawingArea(hexpand=True, vexpand=True)
        area.set_draw_func(self._draw)
        self.last_frame = 0.0
        area.add_tick_callback(self._tick)
        self.set_child(area)
        self.set_cursor(Gdk.Cursor.new_from_name("none"))
        motion = Gtk.EventControllerMotion()
        motion.connect("motion", self._motion)
        self.add_controller(motion)
        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", lambda *_: self._wake())
        self.add_controller(keys)
        click = Gtk.GestureClick(button=0)
        click.connect("pressed", lambda *_: self._wake())
        self.add_controller(click)
        scroll = Gtk.EventControllerScroll(flags=Gtk.EventControllerScrollFlags.BOTH_AXES)
        scroll.connect("scroll", lambda *_: self._wake())
        self.add_controller(scroll)
        self.fullscreen()

    def _tick(self, widget, clock):
        now = time.monotonic()
        if now - self.last_frame >= 1 / FPS - 0.002:  # 30 fps is plenty, and kinder
            self.last_frame = now
            widget.queue_draw()
        return GLib.SOURCE_CONTINUE

    def _draw(self, _area, cr, w, h):
        t = time.monotonic() - self.started
        scenes.burn_in_shift(cr, w, h, t)
        self.scene.draw(cr, w, h, t)

    def _motion(self, _c, x, y):
        if self.pointer is None:
            self.pointer = (x, y)
        elif abs(x - self.pointer[0]) + abs(y - self.pointer[1]) > 10:
            self._wake()

    def _wake(self):
        if time.monotonic() - self.started > 0.7:  # ignore the input that arrives while going full screen
            self.close()


class ShowApp(Gtk.Application):
    """One scene, full screen, until the first touch."""

    def __init__(self, name):
        super().__init__(flags=Gio.ApplicationFlags.NON_UNIQUE)
        self.name = name

    def do_activate(self):
        SaverWindow(self, self.name).present()


SETTINGS_CSS = b"""
.mk-scene-card { border-radius: 14px; padding: 8px; }
.mk-scene-card.selected { box-shadow: inset 0 0 0 3px @accent_color; background: alpha(@accent_color, 0.12); }
.mk-scene-thumb { border-radius: 10px; }
"""


class SceneCard(Gtk.Button):
    """A live, small preview of a scene (or of all of them, for Shuffle)."""
    W, H = 256, 144

    def __init__(self, key, label):
        super().__init__(css_classes=["flat", "mk-scene-card"])
        self.key = key
        self.names = list(scenes.SCENES) if key == "random" else [key]
        self.scenes = {}
        self.started = time.monotonic()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.area = Gtk.DrawingArea(content_width=self.W, content_height=self.H, css_classes=["mk-scene-thumb"],
                                    overflow=Gtk.Overflow.HIDDEN)
        self.area.set_draw_func(self._draw)
        self.area.add_tick_callback(self._tick)
        self.last = 0.0
        box.append(self.area)
        row = Gtk.Box(spacing=8)
        row.append(Gtk.Label(label=label, xalign=0, hexpand=True, css_classes=["heading"]))
        self.check = Gtk.Image(icon_name="object-select-symbolic", visible=False)
        row.append(self.check)
        box.append(row)
        self.set_child(box)

    def _tick(self, widget, _clock):
        now = time.monotonic()
        if now - self.last >= 1 / 15:  # thumbnails at 15 fps: smooth enough, light
            self.last = now
            widget.queue_draw()
        return GLib.SOURCE_CONTINUE

    def _draw(self, _area, cr, w, h):
        t = time.monotonic() - self.started
        name = self.names[int(t / 4) % len(self.names)]  # Shuffle: a new scene every 4 s
        scene = self.scenes.get(name) or self.scenes.setdefault(name, scenes.SCENES[name]())
        # Drawn at 1280x720 and scaled down, so the thumbnail looks like the real thing.
        cr.scale(w / 1280, h / 720)
        scene.draw(cr, 1280, 720, t + 3)

    def set_selected(self, on):
        self.check.set_visible(on)
        (self.add_css_class if on else self.remove_css_class)("selected")


class SettingsWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Screensaver", default_width=980, default_height=760)
        provider = Gtk.CssProvider()
        provider.load_from_data(SETTINGS_CSS)
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        c = conf()
        view = Adw.ToolbarView()
        view.add_top_bar(Adw.HeaderBar())
        page = Adw.PreferencesPage()
        general = Adw.PreferencesGroup(
            description="Plays when you step away. GNOME still dims and locks at its own time "
                        "(Settings › Power and Privacy); the focus timer uses the scene you pick here.")
        on = Adw.SwitchRow(title="Screensaver", active=c["SCREENSAVER"] != "off")
        on.connect("notify::active", lambda r, _p: set_conf("SCREENSAVER", "on" if r.get_active() else "off"))
        general.add(on)
        delay = Adw.SpinRow.new_with_range(1, 60, 1)
        delay.set_title("Start after (minutes without input)")
        delay.set_value(max(1, round(int(c.get("DELAY") or 180) / 60)))
        delay.connect("notify::value", lambda r, _p: set_conf("DELAY", str(int(r.get_value()) * 60)))
        general.add(delay)
        page.add(general)

        gallery = Adw.PreferencesGroup(title="Scene", description="Click one to use it, or Shuffle for a different one each time.")
        flow = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, max_children_per_line=2, min_children_per_line=2,
                           column_spacing=12, row_spacing=12, homogeneous=True)
        self.cards = []
        current = c.get("SCENE", "random") if c.get("SCENE") in scenes.SCENES else "random"
        for key, label in [("random", "Shuffle")] + [(n, cls.label) for n, cls in scenes.SCENES.items()]:
            card = SceneCard(key, label)
            card.set_selected(key == current)
            card.connect("clicked", self._chosen)
            menu_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
            menu_box.append(card)
            preview = Gtk.Button(label="Preview full screen", css_classes=["flat"], halign=Gtk.Align.CENTER)
            preview.connect("clicked", lambda _b, k=key: Gio.Subprocess.new([SAVER if os.path.exists(SAVER) else sys.argv[0], "show", k], Gio.SubprocessFlags.NONE))
            menu_box.append(preview)
            flow.append(menu_box)
            self.cards.append(card)
        gallery.add(flow)
        page.add(gallery)
        view.set_content(page)
        self.set_content(view)

    def _chosen(self, card):
        set_conf("SCENE", card.key)
        for other in self.cards:
            other.set_selected(other is card)


class SettingsApp(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID + "Settings")

    def do_activate(self):
        window = self.get_active_window() or SettingsWindow(self)
        window.present()
