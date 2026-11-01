"""Open in VS Code from GNOME Files (nautilus-python): right-click a folder, or
the empty background of the folder you're in, for "Open in VS Code".

Installed by sync.sh into ~/.local/share/nautilus-python/extensions/; needs
nautilus-python (setup.sh installs it) and VS Code (`code`, from Microsoft's
repo, which setup.sh adds). The menu item only appears when `code` is found.
"""
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse

from gi.repository import GObject, Nautilus


def path_of(info):
    uri = info.get_uri()
    if not uri.startswith("file://"):
        return None
    return Path(unquote(urlparse(uri).path))


def open_in_code(path):
    code = shutil.which("code")
    if code:
        # (an argument list, never a shell: any folder name is safe)
        subprocess.Popen([code, str(path)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)


def item(name, path):
    entry = Nautilus.MenuItem(name=name, label="Open in VS Code", tip=f"Open {path.name or path} in VS Code")
    entry.connect("activate", lambda *_: open_in_code(path))
    return entry


class OpenInCode(GObject.GObject, Nautilus.MenuProvider):
    def get_file_items(self, files):
        if len(files) != 1 or not files[0].is_directory() or not shutil.which("code"):
            return []
        path = path_of(files[0])
        return [item("OpenInCode::folder", path)] if path else []

    def get_background_items(self, folder):
        if not shutil.which("code"):
            return []
        path = path_of(folder)
        return [item("OpenInCode::here", path)] if path else []
