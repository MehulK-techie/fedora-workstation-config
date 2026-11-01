# Windows: what a port takes

Status: **not started.** This is the plan, written before any Windows code,
so the work can be judged and scheduled. Nothing on `main` builds for Windows
today, and no Windows branch or CI workflow exists yet.

## Why it isn't a build setting

MK Notes, the Companion, Focus Timer and Speed Test are Python programs on
GTK 4 and libadwaita (`bin/mk-notes`, `bin/mk-companion`, `bin/mk-timer`,
`bin/mk-speedtest`, sharing `lib/mkworkstation`). They are not Electron or
Node apps, so there's no `npm run build:win` to switch on. Several features
are GNOME itself rather than the apps: the top-bar to-do pill, the clipboard
deck and the dock are a GNOME Shell extension (`mk-indicator`); unlocking uses
PAM, Howdy and fprintd; the timer's focus screen borrows the screensaver's
scenes; settings are dconf.

## What carries over, app by app

| App | Runs on Windows as is | Needs replacing or switching off |
|---|---|---|
| MK Notes | The editor, pages, ink, tables, PDF export (GTK 4, cairo, Pango) | Lock/unlock prompts (PAM, Howdy): off on Windows, see *Security* below. Notes folder: `%USERPROFILE%\Documents\Notes` instead of `~/Notes`. Phone sync's LAN server: check firewall prompts |
| Companion (tasks, notes) | The window and `companion.json` | The top-bar pill is a GNOME Shell extension: on Windows a **tray icon** with the tooltip `MK To-Do: N remaining \| M scheduled` and Add Task / Open Companion / Exit. GTK 4 has no tray, so this is a small separate process (`pystray` reading the same `companion.json`) |
| Focus Timer | Countdown, presets, sounds, mini timer | The screensaver focus screen and screen dimming: off. A native **toast** when a session ends (`winotify` or the WinRT notification API) |
| Speed Test | Most of it | Whatever shells out to Linux tools (`ip`, `nmcli`): needs a Windows path or hiding |

## Building `.exe` files

The workable route is **PyInstaller with GTK 4 from MSYS2** (or gvsbuild),
one bundle per app, built on a `windows-latest` runner. Expect each bundle to
be large (GTK, libadwaita, icons: roughly 80 to 150 MB) and the first green
build to take real iteration: missing typelibs, GSettings schemas compiled
into the bundle, fonts, the icon theme. A Windows machine (or VM) to try the
results on is needed; CI can only prove they start.

Platform checks belong in one place (`lib/mkworkstation/platform.py`:
`IS_WINDOWS = sys.platform == "win32"`), read by each app to hide what doesn't
exist there, rather than in scattered `if` statements.

## Branches and CI

The suggested workflow kept `main` for Linux and merged it into a `windows`
branch on every push with `git merge -X ours`. Two problems with that:

- `-X ours` on the `windows` branch keeps the **Windows side of every
  conflicting hunk**, so a fix on `main` that touches the same lines is
  silently dropped from Windows, with nothing to say it happened.
- A long-lived fork of the same Python files drifts; every Linux change has
  to survive a merge.

Better: **one branch.** The Windows differences live behind the platform
checks above plus a `windows/` folder (tray helper, PyInstaller specs,
icons), and one workflow builds on pushes to `main` and tags:

```yaml
name: Windows builds
on:
  push:
    branches: [main]
    tags: ['v*']
jobs:
  build:
    runs-on: windows-latest
    defaults:
      run:
        shell: msys2 {0}
    steps:
      - uses: actions/checkout@v4
      - uses: msys2/setup-msys2@v2
        with:
          msystem: UCRT64
          install: >-
            mingw-w64-ucrt-x86_64-gtk4 mingw-w64-ucrt-x86_64-libadwaita
            mingw-w64-ucrt-x86_64-python-gobject mingw-w64-ucrt-x86_64-python-cairo
            mingw-w64-ucrt-x86_64-pyinstaller
      - run: pyinstaller windows/mk-notes.spec   # one spec per app
      - uses: actions/upload-artifact@v4
        with:
          name: windows-apps
          path: dist/*.exe
```

## Security

Locking a note in MK Notes is a **gate, not encryption**: the locked notes are
listed in `.mknotes/state.json`, and the notes themselves stay ordinary
Markdown files that any program (or anyone with the disk) can read, on Linux
too. So turning the lock off on Windows removes no protection the files had,
but the Settings window must not offer a lock there that does nothing. If
locked notes should really be private, that's a separate piece of work
(encrypting them at rest, with a passphrase that works on both systems).

## Order of work

1. `platform.py`, and MK Notes running from source on Windows (MSYS2), lock
   hidden. Proves the GTK stack and the notes folder.
2. PyInstaller spec for MK Notes and the workflow above, one artifact.
3. Companion plus the tray helper; Focus Timer with toasts; Speed Test.
4. Signed installers, if they're to be shared (an unsigned `.exe` triggers
   SmartScreen warnings).
