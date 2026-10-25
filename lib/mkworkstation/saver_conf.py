"""Screensaver settings and checks, without GTK (the idle watcher stays small).

config/screensaver.conf, yours in ~/.config/mk-workstation/screensaver.conf.
"""
import json
import os
from pathlib import Path

from gi.repository import GLib

CONFIG = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "mk-workstation"
DATA = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "mk-workstation"
TIMER_STATE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "mk-workstation/timer.json"


def conf():
    values = {"SCREENSAVER": "on", "DELAY": "180", "SCENE": "random"}
    for path in (DATA / "config/screensaver.conf", CONFIG / "screensaver.conf"):
        try:
            for line in path.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    key, value = line.split("=", 1)
                    values[key.strip()] = value.strip()
        except OSError:
            pass
    return values


def set_conf(key, value):
    """Write KEY=VALUE to your screensaver.conf (the watcher picks it up at once)."""
    path = CONFIG / "screensaver.conf"
    try:
        lines = path.read_text().splitlines()
    except OSError:
        lines = ["# Screensaver: your choices (Screensaver settings, mk screensaver)"]
    for i, line in enumerate(lines):
        if line.split("=", 1)[0].strip() == key and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    CONFIG.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def screen_kept_awake(bus):
    """A video, a call or Caffeine is keeping the screen awake."""
    sm = ("org.gnome.SessionManager", "/org/gnome/SessionManager", "org.gnome.SessionManager")
    try:
        paths = bus.call_sync(*sm, "GetInhibitors", None, GLib.VariantType("(ao)"), 0, 1000, None).unpack()[0]
        for path in paths:
            flags = bus.call_sync(sm[0], path, "org.gnome.SessionManager.Inhibitor", "GetFlags", None,
                                  GLib.VariantType("(u)"), 0, 1000, None).unpack()[0]
            if flags & 8:
                return True
    except GLib.Error:
        pass
    return False


def focus_timer_running():
    try:
        return bool(json.loads(TIMER_STATE.read_text()).get("running"))
    except (OSError, ValueError):
        return False
