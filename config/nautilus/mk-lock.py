"""MK Lock in GNOME Files (nautilus-python): right-click a folder for
"Lock with MK Lock" or "Unlock with MK Lock", and a lock badge on locked
folders while they're closed.

Installed by sync.sh into ~/.local/share/nautilus-python/extensions/; needs
the nautilus-python package (setup.sh installs it). Everything is done by
mk-lock, so Files, the MK Control Center and the mk command always agree.
"""
import os
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse

from gi.repository import GObject, Nautilus

HOME = Path.home()
MK_LOCK = str(HOME / ".local/bin/mk-lock")
LOCKED_LIST = Path(os.environ.get("XDG_CONFIG_HOME") or HOME / ".config") / "mk-workstation/locked-folders"


def path_of(info):
    uri = info.get_uri()
    if not uri.startswith("file://"):
        return None
    return Path(unquote(urlparse(uri).path))


def is_locked(path):
    return (path.parent / f".{path.name}.mklock").is_dir()


def locked_folders():
    try:
        return {line.strip() for line in LOCKED_LIST.read_text().splitlines() if line.strip()}
    except OSError:
        return set()


def run(*args):
    subprocess.Popen([MK_LOCK, *args], stdin=subprocess.DEVNULL, start_new_session=True)


class MKLockMenu(GObject.GObject, Nautilus.MenuProvider, Nautilus.InfoProvider):
    def get_file_items(self, files):
        if len(files) != 1 or not files[0].is_directory():
            return []
        path = path_of(files[0])
        if not path or path == HOME or HOME not in path.parents:
            return []
        if is_locked(path):
            if os.path.ismount(path):
                item = Nautilus.MenuItem(name="MKLock::close", label="🔒 Lock with MK Lock",
                                         tip="Close it: the files are encrypted again")
                item.connect("activate", lambda *_: run("folder", "close", str(path)))
            else:
                item = Nautilus.MenuItem(name="MKLock::open", label="🔓 Unlock with MK Lock",
                                         tip="Confirm it's you, then open it")
                item.connect("activate", lambda *_: run("folder", "open", str(path)))
            return [item]
        item = Nautilus.MenuItem(name="MKLock::add", label="🔒 Lock with MK Lock",
                                 tip="Encrypt this folder; it opens only after you confirm it's you")
        item.connect("activate", lambda *_: self._confirm_and_lock(path))
        return [item]

    def get_background_items(self, folder):
        return []

    @staticmethod
    def _confirm_and_lock(path):
        # Encrypting moves the files into an encrypted store: ask first.
        subprocess.Popen(["bash", "-c",
                          'zenity --question --title="MK Lock" --ok-label="Lock" '
                          '--text="Encrypt \\"$1\\"?\n\nIts files move into an encrypted store and open only after '
                          'your fingerprint, face or password. Nothing is deleted until the copy is checked." '
                          '&& "$0" folder add "$1"', MK_LOCK, str(path)],
                         stdin=subprocess.DEVNULL, start_new_session=True)

    def update_file_info(self, info):
        if not info.is_directory():
            return Nautilus.OperationResult.COMPLETE
        path = path_of(info)
        if path and str(path) in locked_folders() and not os.path.ismount(path):
            info.add_emblem("emblem-readonly")
        return Nautilus.OperationResult.COMPLETE
