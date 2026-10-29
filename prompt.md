# MK Workstation: the prompt history and how to build it

This file records how MK Workstation was built: the vision, the standards it
is held to, what was asked in each phase, and how to build and check it. It
is a summary of the prompts, phase by phase, not a verbatim log; the
commit history (`git log`) has every change with its reason.

## Vision

A zero-touch Infrastructure-as-Code suite that turns a stock **Fedora
Workstation (GNOME, Wayland)** into the MK Workstation: one command
(`./setup.sh`, then `./sync.sh` for settings) gives a polished, private,
student-friendly desktop with Windows habits, macOS smoothness and tools of
its own, all reproducible from plain text in this repository.

- **Target:** Fedora 44, GNOME Shell 50, Wayland.
- **Everyday use without a terminal:** locks, face and fingerprint
  enrollment, notes, the security check, clipboard history and wallpapers
  all have windows; only setup itself is run from a terminal.
- **Honest engineering:** every feature works for real (hardware released,
  real scan counts, real PAM and polkit), and the docs only claim what the
  code does.

## Standards

| Area | Standard | Measured (headless GNOME Shell, this machine) |
| :--- | :--- | :--- |
| Clipboard deck (Super+V) | opens instantly, smooth in and out | first open ~35 ms, then ~17 ms each; 120 ms in, 90 ms out |
| Screensaver scenes | cached Cairo drawing, little CPU | Web Hang ~4.4 ms a frame at 1080p, ~3.3 ms at the half size of the lock screen and live wallpaper |
| System monitor menu | fits a 1366 x 768 screen | 480 px, fixed footer, no network use of its own |
| Webcam | off whenever it isn't needed | Photo Booth stops the pipeline while you decorate |
| Security scans | real numbers, never stuck | ClamAV file counts from its own output; scans stop with their caller |
| Privacy | nothing of the session on the lock screen | no notifications or media player there; no screenshots while locked |
| Scripts | idempotent and linted | `bash -n` + ShellCheck on every shell script, `py_compile` on Python |

## Phases (what was asked, in order)

1. **Foundation (IaC).** `setup.sh` (root installer: packages, RPM Fusion,
   codecs, Howdy, PAM with backups, faillock, polkit helpers) and `sync.sh`
   (every GNOME setting, extensions, shortcuts, MK's own tools), `mk export`
   to write settings back to `config/`, `mk doctor`, `mk update`.
2. **Shell and top bar.** `mk-indicator`: the MK tag, a system monitor with
   sparklines and temperatures, a media tile, the timer pill, the task pill,
   App Nap (freezing idle apps under memory pressure), the welcome voice.
3. **Dock and touchpad.** Dash to Dock with macOS magnification and no hover
   glow, intellihide that hides over windows right after login, calm
   one-desktop-per-swipe gestures, Alt+Tab as a card of live previews.
4. **Biometrics.** Howdy face unlock (IR or webcam, several lighting
   models, stricter matching), fingerprint with fprintd, `mk-face-auth` for
   Face ID inside MK's apps (a yes/no gate, never a key), MK's unlock window
   (scanner ring, PIN, fingerprint only when a reader exists), enrollment
   from the Control Center (`mk-face-add`, async fprintd with the reader's
   real stage count, delete enrolled fingers).
5. **MK Lock and the vault.** App gates, gocryptfs folders with root-held
   keys behind polkit, item passwords, the vault, Lock all on screen lock,
   Files right-click Lock / Unlock, confirmation before changing a lock.
6. **MK Notes.** Rich text with Markdown files, notebooks, links and graph,
   comments in the margin, stickies with colours and layers, images with
   Word-style rotation, shapes and graphs, PDF attach or printout, real
   table widgets in the text, A4 pages with Page X of Y, PDF and Word
   export, locks with auto-lock, phone sync.
7. **Photo Booth.** Live looks in three kinds (a 3 x 3 grid at 30 fps),
   instant-film cards, light leaks, lettering, stamps, the developing print,
   the camera off while decorating.
8. **Security suite.** `mk security`: a posture check with a score, a
   quick ClamAV scan of downloads and running programs with a live count,
   a deep rootkit audit with steps and Cancel; fixes on request.
9. **Desktop ergonomics.** Shortcuts window (Super+/), clipboard deck
   (Super+V), emoji board at the caret (Super+.), Super+1-9 dock apps,
   Super+Tab apps, OCR (Super+Shift+C), scratchpad, exam mode, live
   wallpaper, transient notifications.
10. **Screensavers.** Web Hang (a brick-built Spider-Man, the MK sign and a
    Stan Lee tribute lit in skyscraper windows), Night Watch (Batman, rain,
    the MK signal), Terminal Stream, Aurora; on the lock screen too, with
    OLED drift.
11. **Control Center and tour.** MK Control Center (quick actions, every
    command as a card, MK Lock, biometrics, security) and a GNOME Tour-style
    six-slide tour (Super+Shift+/).
12. **Release.** A clean lock screen, repository hygiene, this file.

## Default keyboard shortcuts

From `config/shortcuts.conf` (change them in the Shortcuts window, Super+/).

| Group | Action | Keys |
| :--- | :--- | :--- |
| Windows | Switch windows (all workspaces) | `Alt+Tab` |
| Windows | Switch apps | `Super+Tab` |
| Windows | Switch windows of this app | `Alt+Above_Tab, Super+Above_Tab` |
| Windows | Close window | `Super+q, Alt+F4` |
| Windows | Snap left half | `Super+Left, Super+KP_4` |
| Windows | Snap right half | `Super+Right, Super+KP_6` |
| Windows | Maximize | `Super+Up, Super+KP_5` |
| Windows | Restore | `Super+Down` |
| Windows | Snap layouts | `Super+z` |
| Windows | Center window | `Super+Ctrl+c` |
| Windows | Always on top | `Super+Ctrl+t` |
| Windows | Full screen | `Super+Ctrl+f` |
| Windows | Show desktop | `Super+d` |
| Workspaces | Previous workspace | `Super+Page Up, Super+Alt+Left, Super+Ctrl+Left` |
| Workspaces | Next workspace | `Super+Page Down, Super+Alt+Right, Super+Ctrl+Right` |
| Workspaces | New desktop | `Super+End, Super+Ctrl+d` |
| Workspaces | Move window left | `Super+Shift+Page Up, Super+Shift+Alt+Left` |
| Workspaces | Move window right | `Super+Shift+Page Down, Super+Shift+Alt+Right` |
| Workspaces | Move window to a new desktop | `Super+Shift+End, Super+Ctrl+Shift+d` |
| Workspaces | Go to workspace 1 | `Super+Alt+1` |
| Workspaces | Go to workspace 2 | `Super+Alt+2` |
| Workspaces | Go to workspace 3 | `Super+Alt+3` |
| Workspaces | Go to workspace 4 | `Super+Alt+4` |
| Workspaces | Move window to workspace 1 | `Super+Shift+Alt+1` |
| Workspaces | Move window to workspace 2 | `Super+Shift+Alt+2` |
| Workspaces | Move window to workspace 3 | `Super+Shift+Alt+3` |
| Workspaces | Move window to workspace 4 | `Super+Shift+Alt+4` |
| Screenshots | Full screen, instantly | `Print, Super+Shift+3` |
| Screenshots | Current window | `Alt+Print` |
| Screenshots | Pick an area or window | `Shift+Print, Super+Shift+s, Super+Shift+4` |
| Screenshots | Copy text from screen (OCR) | `Super+Shift+c` |
| Screenshots | Copy text (Text Extractor) | `Super+Alt+t` |
| System | Search / overview | `Super+s` |
| System | App grid | `Super+a` |
| System | Quick settings | `Super+Shift+a` |
| System | Notifications | `Super+m` |
| System | Clipboard history (opens at the text cursor) | `Super+v` |
| System | Run a command | `Alt+F2, Super+r` |
| System | Files | `Super+e` |
| System | Settings | `Super+i` |
| System | Shut down / restart | `power-off` |
| System | Shut down (asks first) | `Ctrl+Alt+End` |
| System | Restart (asks first) | `Ctrl+Alt+Home` |
| System | Sleep | `Ctrl+Alt+Page Down` |
| System | System Monitor | `Ctrl+Shift+Escape` |
| Apps | Shortcuts (this window) | `Super+/` |
| Apps | Companion: notes, tasks, timer | `Super+Shift+n` |
| Apps | Scratchpad (the Companion, drop-down) | `Super+Return` |
| System | Exam mode: no notifications, media paused, quiet power (toggle) | `Super+F10` |
| Apps | Tour of the workstation | `Super+?` |
| Apps | Terminal | `Ctrl+Alt+t` |
| Apps | Web browser | `Super+b` |
| Apps | MK Notes | `Super+n` |
| Apps | MK Notes: today's note | `Super+Alt+n` |
| Apps | MK Notes: quick note | `Super+Ctrl+n` |
| Apps | Emoji board (types the emoji for you) | `Super+.` |
| Apps | Photo Booth (webcam, looks, stickers) | `Super+c` |

Touchpad: four fingers left/right switch desktops; three fingers left/right
switch windows; three fingers up show the overview.

## Build, check and apply

```bash
git clone https://github.com/MehulK-techie/fedora-workstation-config.git
cd fedora-workstation-config
sudo ./setup.sh          # once: packages, PAM, polkit helpers (asks before changes)
./sync.sh                # settings, extensions, shortcuts, MK's tools (any time)
# then log out and back in once
```

Checking before a commit:

```bash
bash scripts/lint.sh                         # bash -n + ShellCheck on every script, py_compile on Python
python3 -m py_compile lib/mkworkstation/*.py
mk doctor                                    # health of the installed system
```

Everything is plain text: change a file, run `./sync.sh`, and it's applied.
MIT License.
