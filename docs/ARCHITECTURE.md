# How it works

For people who want to read, change or extend the code. User-level
customization (no code) is in [CUSTOMIZING.md](CUSTOMIZING.md); every command,
file and format is listed in [REFERENCE.md](REFERENCE.md).

## The big picture

```text
sudo ./setup.sh ──► system: dnf, RPM Fusion, codecs, drivers, Flatpaks, Howdy
      │                     (root; backs up dnf.conf and PAM before editing)
      └─► runs as you ──► sync.sh ──► your desktop: settings, extensions,
                                       shortcuts, tools, timers
register-face.sh ──► face unlock (root; backs up PAM and Howdy config)
mk  ──► day-to-day front end for all of the above
```

Two rules shape the code:

1. **Root does system things, you do desktop things.** `setup.sh` never writes
   GNOME settings itself; it runs `sync.sh` as the desktop user through
   `as_user()`, which supplies the session's DBus address. GNOME settings
   written as root land in root's database and silently do nothing.
2. **Idempotent.** Every script can run again and again: lines are only
   appended when missing, system files are backed up once (an existing `.bak`
   is never overwritten), and GNOME lists are merged rather than replaced.

## sync.sh, step by step

| Step | What | Source of truth |
| :--- | :--- | :--- |
| 0 | Snapshot all GNOME settings (`mk restore` undoes the sync); the first one is kept forever as `original-dconf.ini` | `~/.config/mk-workstation/backups/` |
| 1 | Copy `bin/*` to `~/.local/bin`; copy `lib/` and `config/` to `~/.local/share/mk-workstation/`; install the update-check and reminder timers; retire old login hacks | `bin/`, `lib/`, `config/` |
| 2 | Install missing extensions from extensions.gnome.org for the running GNOME version; patch known GNOME 50 bugs in third-party extensions; enable the list, minus heavy effects in lite mode | `config/enabled-extensions.txt`, `config/effects.conf` |
| 3–7 | Window, workspace, Files, touchpad and animation settings | inline in `sync.sh` |
| 7b | Load each extension's saved settings | `config/extension-settings/*.dconf` |
| 8 | Dialog styling | inline CSS |
| 9 | Apply every keyboard shortcut, then your own changes | `config/shortcuts.conf` + `~/.config/mk-workstation/shortcuts.conf` |

Shortcuts are applied last on purpose: extension settings loaded in step 7b
would otherwise overwrite shortcut changes you made for extension keys.

## The shared library: `lib/mkworkstation`

Pure Python (GLib/Gio only, no GTK), used by `sync.sh`, the `mk` command and
the GTK apps.

| Module | Does |
| :--- | :--- |
| `__init__.py` | Branding (`brand()`, `set_brand()`); the shortcut catalogue: parse `shortcuts.conf`, merge your overrides, apply to GNOME (`apply`, `apply_all`), read live keys, check commands and extensions |
| `companion.py` | Notes and tasks storage, time parsing (`30m`, `18:00`, `tomorrow 9:00`), reminder checks and notifications |
| `device.py` | Hardware detection for `mk device` |
| `__main__.py` | `python3 -m mkworkstation apply-shortcuts / brand / note / task / list` |

Apps find the library next to themselves when run from the repo
(`bin/../lib`) and in `~/.local/share/mk-workstation/lib` once installed, so
you can run `./bin/show-shortcuts` straight from a clone while hacking.

## The apps

| App | Toolkit | Data |
| :--- | :--- | :--- |
| `show-shortcuts` (Super+/) | GTK4 + libadwaita | Reads GNOME live and rebuilds whenever any keybinding schema, custom shortcut, extension list or the overrides file changes |
| `mk-companion` (Super+Shift+N) | GTK4 + libadwaita | `~/.local/share/mk-workstation/companion.json`; merges items added by `mk note/task` while open |
| `mk-screensaver` | GTK4 + cairo (`lib/mkworkstation/scenes.py`) | Mutter IdleMonitor `AddIdleWatch`; skips when an idle inhibitor (video, call) or the focus timer is active; full-screen window, 30 fps |
| `mk-timer` | GTK4 + libadwaita + cairo | `~/.config/mk-workstation/timer.conf`; a marker file guarantees notifications are restored after focus mode |
| `mk-reminders` | none | Run each minute by `mk-reminders.timer`; writes only `reminders-state.json` |
| `camera-controls` | GTK 4, GStreamer, Pillow, Pango/cairo | Photo Booth: live webcam with looks (`photo.py`), stickers and captions; v4l2 controls (`v4l2-ctl`) |

Each GTK app above is a single-instance `Adw.Application`: launching it again
brings the existing window forward.

### Reminders

```text
companion.json  (notes/tasks with remind_at, repeat)   ◄── window, mk note/task
        │ read
mk-reminders.timer ─► mk-reminders ─► notify-send (Open · Snooze)
        │ write
reminders-state.json  (what already fired, snoozes)
```

The checker never writes `companion.json`, so it can't overwrite text you are
typing. A reminder is due when its latest occurrence (for daily or weekly
ones) is newer than the one recorded as fired. Reminders missed by more than
12 hours (computer off) are dropped quietly instead of all firing at once.

## The GNOME Shell extension: `mk-indicator@mehulk`

The project's only shell code. It runs inside GNOME Shell, so a bug can affect
the whole desktop: keep it small, disconnect everything in `disable()`, and
test with `journalctl --user -f -o cat /usr/bin/gnome-shell`.

| File | Does |
| :--- | :--- |
| `extension.js` | Top-bar tag (follows `brand.conf` live), hides the dock in the overview, rebuilds Blur my Shell's panel blur after startup |
| `dockGlow.js` | Per-app hover colour for dock icons: saturation-weighted hue histogram of the app icon, cached per app |
| `welcome.js` | Edge light and greeting after login (waits for extensions to settle), Quick Settings menu toggle, optional notification edge light |
| `timerPill.js` | Focus timer countdown in the top bar, from `~/.cache/mk-workstation/timer.json` |
| `switcher.js` | Pop-in animation for Alt+Tab / Super+Tab |
| `osdStack.js` | Keeps the workspace dots above the volume/brightness pop-up |
| `accent.js` | Accent colour from the wallpaper: writes `~/.cache/mk-workstation/accent.css`, loads it over `stylesheet.css`, sets GNOME's accent |
| `systemMonitor.js` | Top-bar system monitor: samples `/proc` and `/sys` (CPU, memory, hwmon temperatures, network, battery, `gpu_busy_percent`), sparkline and menu |
| `windowGrid.js` | The window switcher grid over GNOME's own switcher: live clones, ring, pointer read from the stage (the switcher holds the grab), 1–9 to move windows |
| `speedTest.js` | Internet section of the monitor: live graph, active connection, speed test (Soup 3, Cloudflare) |
| `mediaTile.js` | MPRIS media tile: art (5 MB cap, image check), seek, controls, output sinks via `getMixerControl()` |
| `colour.js` | RGB/HSV helpers and the dominant-hue histogram (dock glow, accent) |
| `dockMagnify.js` | macOS-style magnification: magnified icons are clones on the UI layer (Dash to Dock clips its own icons), cosine falloff across neighbours |
| `stylesheet.css` | Alt+Tab, hover transitions, overview captions, workspace thumbnails |

Changes to extension code load only after logging out and back in (Wayland).
It declares `session-modes: user, unlock-dialog`, so it stays loaded on the
lock screen and pauses its dock work while locked instead of being rebuilt on
every unlock.

To test shell code without logging out, run a headless GNOME Shell with a
throwaway home and D-Bus session:

```bash
RUN=$(mktemp -d /tmp/mkhs.XXXX)   # short path: Wayland socket names are limited to 108 bytes
env -i HOME=/tmp/mk-home XDG_RUNTIME_DIR=$RUN PATH=/usr/bin:/bin \
  dbus-run-session -- gnome-shell --headless --wayland --no-x11 --virtual-monitor 1920x1080
```

Copy the extension (and Dash to Dock if needed) into that home, enable them
with `gsettings` inside the same session, and read the shell log for errors.

## Third-party patches

`sync.sh` patches installed copies of extensions with known GNOME 50 bugs.
Each patch is a `sed` guarded by `grep`, so it applies once, survives re-runs
and becomes a no-op when upstream fixes the bug. See
[THIRD_PARTY.md](../THIRD_PARTY.md) and [BUGS.md](BUGS.md) (B32–B35).

## Adding things

- **A shortcut:** one line in `config/shortcuts.conf`. Nothing else.
- **An extension:** its UUID in `config/enabled-extensions.txt`, and optionally
  a `config/extension-settings/<uuid>.dconf` (`mk export` writes it for you).
- **An app:** its package name in `apps/dnf-packages.txt` or Flatpak ID in
  `apps/flatpaks.txt`.
- **An `mk` command:** a `case` branch in `bin/mk` plus a line in its help.
  Put any logic beyond a few lines in `lib/mkworkstation` so it's testable.
- **A tool:** a script in `bin/` (installed automatically) and, if it needs a
  key, a `custom:` line in `config/shortcuts.conf`. Add it to `scripts/lint.sh`.

Then run `just check` (ShellCheck and Python syntax, the same as CI).
