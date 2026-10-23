"""Shared helpers for MK Workstation's own tools.

- brand(): the name shown in MK windows (config/brand.conf, then your
  ~/.config/mk-workstation/brand.conf).
- Shortcuts: the catalogue in config/shortcuts.conf plus your changes in
  ~/.config/mk-workstation/shortcuts.conf, applied to GNOME with apply().

sync.sh installs this package and the config folder side by side in
~/.local/share/mk-workstation/, so the defaults are always the ones of the
installed version.
"""
import shlex
import shutil
import subprocess
from dataclasses import dataclass, replace
from pathlib import Path

from gi.repository import Gio, GLib

HOME = Path.home()
CONFIG_DIR = Path(GLib.get_user_config_dir()) / "mk-workstation"
DATA_DIR = Path(GLib.get_user_data_dir()) / "mk-workstation"
DEFAULTS_DIR = Path(__file__).resolve().parents[2] / "config"

BRAND_FILE = CONFIG_DIR / "brand.conf"
OVERRIDES_FILE = CONFIG_DIR / "shortcuts.conf"
DEFAULT_SHORTCUTS = DEFAULTS_DIR / "shortcuts.conf"

MEDIA_KEYS = "org.gnome.settings-daemon.plugins.media-keys"
CUSTOM_SCHEMA = MEDIA_KEYS + ".custom-keybinding"
CUSTOM_BASE = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/"
KEYBINDING_SCHEMAS = [
    "org.gnome.desktop.wm.keybindings",
    "org.gnome.shell.keybindings",
    "org.gnome.mutter.keybindings",
    "org.gnome.mutter.wayland.keybindings",
    MEDIA_KEYS,
]
EXTENSION_DIRS = [Path(GLib.get_user_data_dir()) / "gnome-shell/extensions",
                  Path("/usr/share/gnome-shell/extensions")]


# ---------------------------------------------------------------- branding
def _read_kv(path):
    values = {}
    try:
        for line in Path(path).read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    except OSError:
        pass
    return values


def brand():
    """(name, short tag), e.g. ("MK Workstation", "MK")."""
    values = {"NAME": "MK Workstation", "SHORT": "MK"}
    values.update(_read_kv(DEFAULTS_DIR / "brand.conf"))
    values.update({k: v for k, v in _read_kv(BRAND_FILE).items() if v})
    return values["NAME"], values["SHORT"]


def set_brand(name, short):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    BRAND_FILE.write_text(
        "# Your name for MK Workstation (mk rename, or the Companion's menu).\n"
        f"NAME={name.strip()}\nSHORT={short.strip()}\n")


# ---------------------------------------------------------------- catalogue
@dataclass
class Shortcut:
    group: str
    label: str
    target: str
    keys: list
    overridden: bool = False
    user_added: bool = False

    @property
    def kind(self):
        if self.target.startswith("custom:"):
            return "custom"
        return "ext" if self.target.startswith("ext:") else "gsettings"

    @property
    def ident(self):
        """What two lines must share to describe the same shortcut."""
        if self.kind == "custom":
            return self.target.split()[0]
        parts = self.target.split()
        return " ".join(parts[-2:])

    @property
    def custom_id(self):
        return self.target.split()[0][len("custom:"):]

    @property
    def command(self):
        return self.target.split(None, 1)[1] if " " in self.target else ""

    @property
    def uuid(self):
        return self.target.split()[0][len("ext:"):] if self.kind == "ext" else ""

    @property
    def schema(self):
        return self.target.split()[-2] if self.kind != "custom" else CUSTOM_SCHEMA

    @property
    def keyname(self):
        return self.target.split()[-1] if self.kind != "custom" else "binding"

    @property
    def hidden(self):
        return self.group == "-"

    def line(self):
        return f"{self.group} | {self.label} | {self.target} | {', '.join(self.keys)}"


def parse(path):
    shortcuts = []
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return shortcuts
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            continue
        # Commands may contain "|": group and label come first, keys last.
        target = " | ".join(parts[2:-1]) if parts[2].startswith("custom:") else "|".join(parts[2:-1])
        keys = [k.strip() for k in parts[-1].split(",") if k.strip()]
        shortcuts.append(Shortcut(parts[0], parts[1], target, keys))
    return shortcuts


def load_shortcuts():
    """Defaults with your overrides applied; shortcuts you added come last."""
    merged = {s.ident: s for s in parse(DEFAULT_SHORTCUTS)}
    order = list(merged)
    for o in parse(OVERRIDES_FILE):
        if o.ident in merged:
            base = merged[o.ident]
            merged[o.ident] = replace(o, group=o.group or base.group,
                                      label=o.label or base.label, overridden=True)
        else:
            merged[o.ident] = replace(o, overridden=True, user_added=True)
            order.append(o.ident)
    return [merged[i] for i in order]


def default_for(ident):
    return next((s for s in parse(DEFAULT_SHORTCUTS) if s.ident == ident), None)


def _write_overrides(shortcuts):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    header = ("# Your shortcut changes, applied on top of MK's defaults by `mk sync`\n"
              "# and the Shortcuts window (Super+/). Same format as config/shortcuts.conf.\n")
    OVERRIDES_FILE.write_text(header + "".join(s.line() + "\n" for s in shortcuts))


def save_override(shortcut):
    items = [s for s in parse(OVERRIDES_FILE) if s.ident != shortcut.ident]
    items.append(shortcut)
    _write_overrides(items)


def remove_override(ident):
    _write_overrides([s for s in parse(OVERRIDES_FILE) if s.ident != ident])


def clear_overrides(keep_added=True):
    defaults = {s.ident for s in parse(DEFAULT_SHORTCUTS)}
    _write_overrides([s for s in parse(OVERRIDES_FILE)
                      if keep_added and s.ident not in defaults])


# ---------------------------------------------------------------- GNOME side
def resolve_command(command):
    """Expand ~ and the @terminal / @browser placeholders. '' if unavailable."""
    words = command.split()
    if not words:
        return ""
    if words[0] == "@terminal":
        term = next((t for t in ("ptyxis", "kgx", "gnome-terminal") if shutil.which(t)), "")
        return " ".join([term] + words[1:]) if term else ""
    if words[0] == "@browser":
        try:
            desktop = subprocess.run(["xdg-settings", "get", "default-web-browser"],
                                     capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            desktop = ""
        return f"gtk-launch {desktop.removesuffix('.desktop')}" if desktop else ""
    return " ".join(str(HOME) + w[1:] if w.startswith("~/") else w for w in words)


def command_available(command):
    resolved = resolve_command(command)
    if not resolved:
        return False
    try:
        words = shlex.split(resolved)
    except ValueError:
        return False
    if words[:2] == ["flatpak", "run"] and len(words) > 2:
        app = words[2]
        return any(Path(d, app).exists() for d in
                   (HOME / ".local/share/flatpak/app", "/var/lib/flatpak/app"))
    return bool(shutil.which(words[0]))


def _ext_source(uuid):
    default = Gio.SettingsSchemaSource.get_default()
    for base in EXTENSION_DIRS:
        schemas = base / uuid / "schemas"
        if (schemas / "gschemas.compiled").exists():
            return Gio.SettingsSchemaSource.new_from_directory(str(schemas), default, False)
    return default


def settings_for(shortcut):
    """(Gio.Settings, key) for a shortcut, or (None, None) if not installed."""
    if shortcut.kind == "custom":
        path = f"{CUSTOM_BASE}mk-{shortcut.custom_id}/"
        return Gio.Settings.new_with_path(CUSTOM_SCHEMA, path), "binding"
    source = _ext_source(shortcut.uuid) if shortcut.kind == "ext" else \
        Gio.SettingsSchemaSource.get_default()
    schema = source.lookup(shortcut.schema, True) if source else None
    if schema is None:
        return None, None
    for key in shortcut.keyname.split("|"):
        if schema.has_key(key):
            return Gio.Settings.new_full(schema, None, None), key
    return None, None


def extension_enabled(uuid):
    shell = Gio.Settings.new("org.gnome.shell")
    return uuid in shell.get_strv("enabled-extensions") and \
        uuid not in shell.get_strv("disabled-extensions")


def live_keys(shortcut):
    settings, key = settings_for(shortcut)
    if settings is None:
        return []
    if shortcut.kind == "custom":
        value = settings.get_string("binding")
        return [value] if value else []
    return [k for k in settings.get_strv(key) if k]


def _register_custom_path(path):
    media = Gio.Settings.new(MEDIA_KEYS)
    paths = media.get_strv("custom-keybindings")
    if path not in paths:
        media.set_strv("custom-keybindings", paths + [path])


def apply(shortcut):
    """Write one shortcut to GNOME. False if its app or extension is missing."""
    settings, key = settings_for(shortcut)
    if settings is None:
        return False
    keys = list(shortcut.keys)
    if shortcut.kind == "custom":
        command = resolve_command(shortcut.command)
        if not command:
            return False
        settings.set_string("name", shortcut.label)
        settings.set_string("command", command)
        settings.set_string("binding", keys[0] if keys else "")
        _register_custom_path(settings.props.path)
        return True
    if key == "power-off" and "XF86PowerOff" not in keys:
        keys.append("XF86PowerOff")
    settings.set_strv(key, keys)
    return True


def remove_custom(custom_id):
    path = f"{CUSTOM_BASE}mk-{custom_id}/"
    settings = Gio.Settings.new_with_path(CUSTOM_SCHEMA, path)
    for key in ("name", "command", "binding"):
        settings.reset(key)
    media = Gio.Settings.new(MEDIA_KEYS)
    media.set_strv("custom-keybindings",
                   [p for p in media.get_strv("custom-keybindings") if p != path])


def apply_all(verbose=False):
    skipped = []
    for shortcut in load_shortcuts():
        if not apply(shortcut):
            skipped.append(shortcut.label)
    Gio.Settings.sync()
    if verbose and skipped:
        print("    [*] Skipped (app or extension not installed): " + ", ".join(skipped))
    return skipped
