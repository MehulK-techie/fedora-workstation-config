# Standalone apps

Each folder installs one MK app for your user only, without the rest of the
workstation (no root, nothing outside your home):

| App | Install | Program |
|---|---|---|
| MK Notes | `apps/mk-notes/install.sh` | `mk-notes` |
| MK Photo Booth | `apps/mk-photobooth/install.sh` | `camera-controls` |
| MK Control Center | `apps/mk-control-center/install.sh` | `mk-center` |
| MK Lock | `apps/mk-lock/install.sh` | `mk-lock` |

Each script checks what the app needs (GTK 4, libadwaita, the other
typelibs and programs), names the `dnf` packages if something is missing,
then copies the program to `~/.local/bin`, MK's Python library to
`~/.local/share/mk-workstation/lib` and the launcher and icon to
`~/.local/share`. The shared steps are in `install-app.sh`. Run it again
after a `git pull` to update. `./sync.sh` installs all of them, and the
two never conflict.

The package lists `dnf-packages.txt` and `flatpaks.txt` in this folder are
the whole workstation's, used by `setup.sh`.
