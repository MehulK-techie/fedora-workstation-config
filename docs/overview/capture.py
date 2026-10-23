#!/usr/bin/env python3
"""Retake the screenshots in docs/assets/screens on your own desktop.

    python3 docs/overview/capture.py        (or: just screenshots)

What it does, so nothing surprises you:
- opens a new empty workspace and stages each scene there with demo data
  (separate Companion/Timer/Shortcuts instances; your notes are untouched),
- presses keys through GNOME's RemoteDesktop interface (you'll see an orange
  "screen is being controlled" icon) and saves screenshots via the portal,
- switches to Fedora's default wallpaper for the shots (your wallpaper may be
  someone else's art) and always restores yours and your workspace at the end.

Don't touch the keyboard or mouse for the ~90 seconds it runs. Then rebuild
the PDF with `python3 docs/overview/build.py`. The dock magnification picture
(dock-magnify.jpg) is made separately in a headless shell; see README there.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import gi

gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf, Gio, GLib  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs/assets/screens"
WALLPAPER = "file:///usr/share/backgrounds/f44/default/f44-01-night.jxl"
NAMES = {"01": "desktop", "02": "overview", "03": "alt-tab", "04": "snap-layouts",
         "05": "shortcuts-window", "06": "companion-notes", "07": "companion-tasks",
         "08": "focus-timer", "09": "timer-celebration", "10": "mk-device", "11": "quick-settings"}

DEMO_APP = '''
import sys, importlib.machinery, importlib.util
bin_dir, which, args = sys.argv[1], sys.argv[2], sys.argv[3:]
name = {"companion": "mk-companion", "timer": "mk-timer", "shortcuts": "show-shortcuts"}[which]
loader = importlib.machinery.SourceFileLoader("m", f"{bin_dir}/{name}")
spec = importlib.util.spec_from_loader("m", loader); m = importlib.util.module_from_spec(spec); loader.exec_module(m)
if which == "shortcuts":
    app = m.ShortcutsApp(); app.set_application_id("io.github.mehulk.DemoShortcuts"); sys.exit(app.run([name]))
if which == "companion":
    app = m.CompanionApp(); app.set_application_id("io.github.mehulk.DemoCompanion"); sys.exit(app.run([name] + args))
auto = (m.parse_duration(args[0]), " ".join(args[1:])) if args else None
app = m.TimerApp(auto)
app.set_application_id("io.github.mehulk.DemoTimer" + ("Fast" if args and args[0].endswith("s") else ""))
sys.exit(app.run([name]))
'''


def make_demo_data(data_home):
    env = {**os.environ, "XDG_DATA_HOME": str(data_home), "PYTHONPATH": str(REPO / "lib")}
    code = '''
from mkworkstation import companion as c
n1 = c.new_note("Sprint plan", "• Ship v2.0 of the dotfiles\\n• Record the demo video\\n• Ask a friend to test it"); n1["pinned"] = True
n2 = c.new_note("Standup notes", "Yesterday: shortcuts window\\nToday: reminders + docs\\nBlockers: none")
n2["pinned"] = True; n2["remind_at"] = c.parse_when("tomorrow 9:30"); n2["repeat"] = "daily"
n3 = c.new_note("Ideas", "Pomodoro stats in the top bar\\nAuto dark mode at sunset")
t1 = c.new_task("Review pull request #42"); t1["pinned"] = True; t1["remind_at"] = c.parse_when("1h")
t2 = c.new_task("Book dentist appointment"); t2["remind_at"] = c.parse_when("tomorrow 10:00")
c.save({"notes": [n1, n2, n3], "tasks": [t1, t2, c.new_task("Push the v2.0.0 tag"),
        c.new_task("Back up the photos folder"), c.new_task("Write release notes", done=True)]})
'''
    subprocess.run([sys.executable, "-c", code], env=env, check=True)


class Desktop:
    """Key presses via Mutter's RemoteDesktop, screenshots via the portal."""
    RD = "org.gnome.Mutter.RemoteDesktop"
    KEYS = {"Super": 0xffeb, "Alt": 0xffe9, "Ctrl": 0xffe3, "Shift": 0xffe1, "Tab": 0xff09,
            "Escape": 0xff1b, "z": 0x7a, "d": 0x64, "a": 0x61, **{str(n): 0x30 + n for n in range(10)}}

    def __init__(self, shots):
        self.shots = shots
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION)
        self.session = self.bus.call_sync(self.RD, "/org/gnome/Mutter/RemoteDesktop", self.RD,
                                          "CreateSession", None, None, 0, 5000, None).unpack()[0]
        self._call("Start")

    def _call(self, method, args=None):
        self.bus.call_sync(self.RD, self.session, self.RD + ".Session", method, args, None, 0, 5000, None)

    def key(self, name, down):
        self._call("NotifyKeyboardKeysym", GLib.Variant("(ub)", (self.KEYS[name], down)))

    def combo(self, keys):
        names = keys.split("+")
        for k in names:
            self.key(k, True)
            time.sleep(0.03)
        time.sleep(0.05)
        for k in reversed(names):
            self.key(k, False)
            time.sleep(0.03)

    def shot(self, prefix):
        token, loop, result = "mk" + uuid.uuid4().hex[:8], GLib.MainLoop(), {}

        def on_response(_c, _s, _p, _i, _sig, params):
            result["uri"] = params.unpack()[1].get("uri")
            loop.quit()
        sub = self.bus.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request",
                                        "Response", None, None, 0, on_response)
        self.bus.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
                           "org.freedesktop.portal.Screenshot", "Screenshot",
                           GLib.Variant("(sa{sv})", ("", {"interactive": GLib.Variant("b", False),
                                                          "handle_token": GLib.Variant("s", token)})),
                           None, 0, -1, None)
        GLib.timeout_add_seconds(15, loop.quit)
        loop.run()
        self.bus.signal_unsubscribe(sub)
        if result.get("uri"):
            shutil.move(Gio.File.new_for_uri(result["uri"]).get_path(), self.shots / f"{prefix}.png")
            print("  captured", NAMES[prefix], flush=True)
        else:
            print("  FAILED", NAMES[prefix], flush=True)

    def stop(self):
        self._call("Stop")


def workspace():
    out = subprocess.run(["xprop", "-root", "_NET_CURRENT_DESKTOP"], capture_output=True, text=True).stdout
    return int(out.split("=")[-1]) if "=" in out else 0


def export_jpegs(shots):
    OUT.mkdir(parents=True, exist_ok=True)
    for prefix, name in NAMES.items():
        src = shots / f"{prefix}.png"
        if not src.exists():
            continue
        pb = GdkPixbuf.Pixbuf.new_from_file(str(src))
        dest = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, 1600, 900)
        pb.composite(dest, 0, 0, 1600, 900, 0, 0, 1600 / pb.get_width(), 900 / pb.get_height(),
                     GdkPixbuf.InterpType.HYPER, 255)
        dest.savev(str(OUT / f"{name}.jpg"), "jpeg", ["quality"], ["84"])


def main():
    work = Path(tempfile.mkdtemp(prefix="mk-capture-"))
    shots = work / "shots"
    shots.mkdir()
    (work / "demo_app.py").write_text(DEMO_APP)
    make_demo_data(work / "demo")
    bin_dir = REPO / "bin"
    demo_env = {**os.environ, "XDG_DATA_HOME": str(work / "demo")}
    term = work / "term.sh"
    term.write_text("clear\nprintf '\\033[1;36m$\\033[0m mk device\\n'; mk device\n"
                    "printf '\\n\\033[1;36m$\\033[0m mk power\\n'; mk power\nsleep 60\n")
    procs = []

    def launch(*argv, env=None):
        procs.append(subprocess.Popen(list(argv), env=env or os.environ, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, start_new_session=True))

    def demo(*args, env=demo_env):
        launch(sys.executable, "-I", str(work / "demo_app.py"), str(bin_dir), *args, env=env)

    bg = "org.gnome.desktop.background"
    saved = {k: subprocess.run(["gsettings", "get", bg, k], capture_output=True, text=True).stdout.strip()
             for k in ("picture-uri", "picture-uri-dark")}
    home = workspace()
    d = Desktop(shots)
    print("Capturing; keep your hands off the keyboard and mouse...", flush=True)
    try:
        for k in saved:
            subprocess.run(["gsettings", "set", bg, k, WALLPAPER])
        d.combo("Super+Ctrl+d"); time.sleep(3); d.shot("01")
        demo("shortcuts", env=os.environ); time.sleep(4); d.shot("05"); d.combo("Escape"); time.sleep(1)
        demo("companion"); time.sleep(3); d.shot("06")
        d.combo("Super+z"); time.sleep(1.2); d.shot("04"); d.combo("Escape"); time.sleep(0.6)
        d.combo("Super"); time.sleep(1.4); d.shot("02"); d.combo("Escape"); time.sleep(0.8)
        demo("companion", "tasks"); time.sleep(1.5); d.shot("07")
        demo("timer", "25", "Deep work"); time.sleep(2.5); demo("timer"); time.sleep(2.5); d.shot("08")
        launch("ptyxis", "--new-window", "-x", f"bash {term}"); time.sleep(6); d.shot("10")
        d.combo("Super+Shift+a"); time.sleep(1.2); d.shot("11"); d.combo("Escape"); time.sleep(0.6)
        d.key("Alt", True); time.sleep(0.1); d.key("Tab", True); d.key("Tab", False); time.sleep(1.2)
        d.shot("03")
        # Esc before releasing Alt, or Alt+Tab would switch to another workspace
        d.key("Escape", True); d.key("Escape", False); time.sleep(0.2); d.key("Alt", False); time.sleep(0.8)
        demo("timer", "4s", "Deep work"); time.sleep(7.5); d.shot("09"); d.combo("Escape"); time.sleep(0.8)
    finally:
        for p in procs:
            try:
                os.killpg(p.pid, 15)
            except ProcessLookupError:
                pass
        time.sleep(1)
        for k, v in saved.items():
            subprocess.run(["gsettings", "set", bg, k, v.strip("'")])
        if home < 9:
            d.combo(f"Super+Alt+{home + 1}")
        d.stop()
    export_jpegs(shots)
    shutil.rmtree(work, ignore_errors=True)
    print(f"Saved to {OUT.relative_to(REPO)}. Rebuild the PDF: python3 docs/overview/build.py")


if __name__ == "__main__":
    main()
