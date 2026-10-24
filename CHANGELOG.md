# Changelog

## 2.0.0 (unreleased, branch `fix/dbus-pam-dnf`)

### Added
- **macOS feel:** trackpad gestures (4 fingers ←/→ workspaces, 3 fingers ←/→ windows, 3 fingers ↑ overview), 25% faster animations (Impatience), genie minimize (Magic Lamp), a subtle glide when windows open and close (Burn My Windows), Super+Ctrl+F full screen, Finder-style Files, sharp X11 apps at fractional scaling.
- **Windows feel:** taskbar-style dock (click focuses or minimizes, thumbnails for apps with several windows, middle-click for a new window), Super+Ctrl+D new desktop (Shift takes the window along).
- **Shortcuts window (Super+/, GTK4):** every shortcut and touchpad gesture read live from GNOME, each marked working, clashing (with what), unset or broken; click to change keys, + to add command shortcuts, per-shortcut and full reset. All defaults now live in `config/shortcuts.conf`; your changes in `~/.config/mk-workstation/shortcuts.conf` survive `mk sync`.
- **Companion (Super+Shift+N, GTK4):** multiple notes you can pin (always open, on top), reorder and fold away; a task list with checkboxes, pins, a progress bar, a Done section and undo; buttons for the focus timer and Obsidian. Imports the old `~/.mk_scratchpad.md` once.
- **Focus timer (`mk-timer`):** minutes and seconds, presets, a glowing ring that turns amber then red, pause / +1 min. It hides while counting (not in Alt+Tab), then the pixel-robot celebration fills the screen instead of an alarm sound.
- **Reminders** on notes and tasks (in N minutes, at a time, daily or weekly) that fire even with the Companion closed (`mk-reminders.timer`), with Open and Snooze; `mk note`, `mk task`, `mk remind`, `mk list` from a terminal, merged live into an open Companion.
- **Focus mode:** the timer can silence notifications while it counts, and always restores them.
- **Dock glow in each app's colour** (Spotify green, Obsidian purple…), worked out from the app icon; running-app dots match.
- **`mk effects full | lite | auto`:** heavy effects off on weak machines (auto: under 4 GiB RAM, ≤2 cores or software graphics); list in `config/effects.conf`.
- **Smart power profiles (laptops, `mk-power`):** performance on AC, balanced on battery, power-saver when low; only switches on changes, so manual choices stick; `config/power.conf`, `mk power`.
- **Morning brief**, **`mk focus`**, automatic Trash/temp cleanup after 30 days, and slow search providers (Boxes, Contacts, Passwords) skipped.
- Dock glow is now a subtle circular tint.
- **Dock magnification** (macOS-style wave, `config/dock.conf`), tested in a headless GNOME Shell.
- **Fingerprint login:** setup turns it on when a reader exists (authselect with PAM backup); `mk fingerprint` enrolls; `mk doctor` reports it.
- **Hardware detection** (`mk device`, docs/HARDWARE.md): CPU driver, GPU decoding, touch, 2-in-1 sensors, readers, cameras; 2-in-1s get iio-sensor-proxy.
- **Smoother login and unlock:** the login screen uses your monitor layout; mk-indicator stays loaded across the lock screen and no longer re-applies the top-bar blur after each unlock.
- **docs/MK-Workstation-Overview.pdf** (12 slides) with its builder and screenshot script in docs/overview/; README gallery; screenshots now use Fedora's wallpaper.
- **Welcome light:** neon edge line and greeting after login, once all extensions have loaded; titles (sir, ma'am, name, none), editable text, optional JARVIS-style spoken greeting (espeak-ng or Piper "Alan", `mk welcome voice install`); Quick Settings menu toggle; Companion editor.
- **Focus timer on the desktop:** top-bar countdown, screensaver-style focus view when idle, fireworks.
- **Wobbly windows**, Alt+Tab pop-in animation, Alt+` for windows of one app; dock icons follow the dock while it slides.
- **docs/FEATURES.md:** everything MK built vs what it configures or installs.
- **Speaker tuning** (`mk sound`): EasyEffects profile replacing the Windows-only vendor DSP (B&O on HP).
- **App icons and launchers** for MK's apps, with `mk icon` for your own images.
- **Calendar and Files styling** matching the workstation; workspace dots no longer overlap the volume pop-up.
- Fixed: `sync.sh` aborting when `bin/` contained a `__pycache__` folder (found by a fresh-account test).
- **Alt+Tab redesign:** frosted card, bright cyan ring on the selection, others shrink and dim, selection glides; smooth with 3-finger swipes too (switcher appears after 60 ms instead of 150 ms).
- **Window switcher, rebuilt:** Alt+Tab and the 3-finger swipe open a frosted grid of live windows with icons, titles and desktop numbers; hover, click, 1–9 to send a window to another desktop.
- **Screensaver** (`mk-screensaver`, `mk screensaver`): full-screen scenes after a few idle minutes: Web Hang, Night Watch, Neon Cascade, Aurora. The focus timer uses them too; the over-the-desktop Bubbles/Mystify/Starfield are gone.
- **Speed test** in the system monitor (ping, download, upload on a gauge), with the active connection and a live traffic graph.
- **Media tile** for Spotify and any MPRIS player: spinning album art, scrolling title, seek, controls, speaker choice (`config/media.conf`).
- **A different greeting each time** (`config/greetings.conf`, `mk welcome variety|birthday|lines`); the voice says the line picked, rendered once and cached.
- **MK Notes:** quick capture (Super+Ctrl+N into Inbox), foldable callouts, PDF previews (sandboxed), coloured code, **encrypted phone sync** (PyNaCl / TweetNaCl).
- **Zen Browser** takes the desktop accent; redrawn app icons in GNOME's flat style; `docs/KEYBINDINGS.md`.
- **Heavy loads:** zram-friendly swap and small write-back batches (`/etc/sysctl.d/99-mk-desktop.conf`, by setup.sh).
- Fixed: a 292 ms freeze leaving the overview (the dock was re-laid out mid-animation); the Companion's MK Notes button did nothing. `mk fingerprint check` explains a lock screen that ignores the reader.
- **System monitor in the top bar** (mk-indicator), replacing Astra Monitor: CPU sparkline, memory, temperatures, network, battery draw, busiest apps; reads the kernel's counters every 2 s.
- **Welcome:** comet light that meets at the top, timed for when the desktop is ready; pinned tasks, next reminder and low battery under the greeting; pinned-task notification.
- **Alt+Tab** as fast as GNOME's own (measured), and 3-finger swipes take the same finger travel per window however many are open.
- **MK Notes replaces Obsidian:** not installed on new setups; the Companion opens MK Notes. New in MK Notes: edit with live preview, preferences (theme, font, size, line length, spacing, sort, folder), focus mode, Tasks view, daily-notes calendar, reading time.
- **MK Notes** (`mk-notes`, Super+N, [docs/NOTES.md](docs/NOTES.md)):
  - An Obsidian-compatible Markdown vault, with folders, pins, colours, links, backlinks, an outline, a graph and #tags.
  - Checklists, callouts and tables, a quick switcher, a command palette, daily notes and templates.
  - Paste or capture screenshots; draw with a pressure-sensitive pen.
  - PDF export (WeasyPrint), publish the vault as a website, and version history.
  - A phone app (browser or Android, `scripts/build-apk.sh`) that syncs over Wi-Fi with signed requests. Conflicts keep both copies.
- **Focus screensavers over your work:** Bubbles, Mystify and Starfield, drawn by mk-indicator at 60 fps. Pick one, or let the timer surprise you.
- **Alt+Tab glide:** one accent ring follows the selection on a spring, so fast 3-finger swipes are fluid. Lighter shadows.
- **Speaker tuning** retuned toward B&O: more bass the speaker can play, clearer voices, smoother treble.
- **Touchpad-friendly browsing** (Firefox, Zen): swipe back/forward, momentum scrolling, pinch zoom. Palm rejection now lets go 300 ms after typing.
- **Bibata Modern Classic cursor**, from a pinned, checksummed release.
- **Shut down and restart shortcuts:** Ctrl+Alt+End and Ctrl+Alt+Home (both ask first).
- **Smoother unlock:** six animation and gesture extensions stay loaded while locked instead of being rebuilt as you unlock.
- **Wallpaper accent** (`mk accent`, `config/theme.conf`): the most vivid wallpaper colour tints Alt+Tab, the calendar, hover glows, workspace thumbnails, the welcome line, the timer ring and GNOME's accent; updates when the wallpaper changes. Files and the Companion follow GNOME's accent.
- **Faster touchpad Alt+Tab:** no delay before the switcher takes the swipe (was 60 ms, inputs were dropped), 90 ms glide.
- **Smoother welcome line:** drawn as four thin edge strips instead of a full-screen canvas.
- Fixed: EasyEffects' window opening at login with `mk sound on`; it now starts hidden as a background service.
- **docs/ARCHITECTURE.md** (how it works, how to extend it) and **docs/REFERENCE.md** (every command, file, format, timer).
- **Rename it:** `mk rename "Name" TAG` or Companion › Rename; the top-bar tag follows live. Forks set the default in `config/brand.conf`.
- **docs/CUSTOMIZING.md:** how to make it yours or fork it without editing scripts.
- **Livelier desktop:** soft cyan hover glow on top-bar buttons, dock icons and overview windows; touchpad gestures in the Super+/ cheat sheet.
- **`mk uninstall`**, a permanent pre-MK settings snapshot, SECURITY.md, CODE_OF_CONDUCT.md, THIRD_PARTY.md, issue and PR templates, .editorconfig.
- **Themed Alt+Tab:** GNOME's flat switcher with live thumbnails of every window on every workspace, styled by mk-indicator's stylesheet (frosted navy panel, cyan selection).
- **Windows-style multitasking** (Tiling Assistant): snap halves and quarters, Snap Assist, six snap layouts on Super+Z, tile groups, always on top (Super+Ctrl+T), Super+Ctrl+←/→ desktops.
- **Super+N** Obsidian and **Super+B** default browser; duplicate user shortcuts are folded into the mk-* versions.
- **`mk update`** updates everything (repo, newly listed apps, settings, extensions, system) with `--check` preview; **`mk save`** captures apps, extensions and settings you added and commits them.
- Blur my Shell's top-bar blur is rebuilt by mk-indicator once GNOME has finished starting, so it shows right after login.
- **Windows & macOS conveniences** with one conflict-free keymap (Super+E/I/D/R/S, Ctrl+Shift+Esc, Super+1–9, Super+Shift+3/4, Ctrl+Alt+T, Quick Look), AppIndicator tray icons and Caffeine.
- **Settings snapshot before every sync** and `mk restore`.
- **Shortcut conflict check** in `mk doctor`; live, grouped cheat sheet on Super+/.
- README hero screenshot.
- **Face unlock wizard:** up to 5 face models recorded in different lighting, a light check before each one, camera-type tuning, camera auto-exposure, `--user` for other people, `--tune-only`, and `mk face`.
- **Extensions with settings:** `mk export` saves enabled extensions and their settings to `config/`; `sync.sh` installs them from extensions.gnome.org for your GNOME version and restores the settings.
- **`mk doctor`** health check, and a daily update notification (systemd user timer).
- Full ffmpeg and GStreamer codecs, GPU-aware VA-API drivers, firmware update check, VS Code repo, run log in `/var/log/mk-workstation-setup.log`.
- Full workstation app set: Zen, Obsidian, Lutris, Extension Manager, Joplin, ONLYOFFICE, Spotify, ZapZap and more (all names verified).
- `justfile`, `scripts/lint.sh`, GitHub Actions ShellCheck.
- Docs: `docs/GUIDE.md`, `docs/FACE-UNLOCK.md`, `docs/EXTENSIONS.md`, `docs/BUGS.md` (full audit), `CONTRIBUTING.md`.

### Changed
- Third-party extensions are no longer bundled (licensing); `extensions/` keeps only mk-indicator and WACK Shell.
- Removed: the broken RPM spec, `close-workspace-apps`, `fix-alt-tab`.
- `sync.sh` is the single source of desktop settings; `setup.sh` runs it as the desktop user.
- Custom shortcuts use named `mk-*` slots; your own shortcuts and extensions are kept.
- `setup.sh` refuses non-Fedora and Fedora Atomic systems, takes `--no-face`, and skips Howdy when there's no camera.
- Busy apps get 20 s before GNOME shows "not responding".
- Docs moved to `docs/`.

### Fixed
- Stutter when minimizing or restoring with the 4-finger pinch: Magic Lamp played its genie after the gesture's own animation. `sync.sh` patches it to honour GNOME's skip-effect request.
- WACK Shell logging an error and stack trace on every dock movement on GNOME 50.
- Window titles in the overview hidden behind the dock: the dock still auto-hides on the desktop and now also fades out in the overview.
- Blur my Shell missing after login (only appeared after lock/unlock); old autostart hacks retired.
- Extensions on GNOME's disabled list never loading even when enabled.
- 500 WACK Shell JS errors per session on GNOME 50.
- GNOME settings not reaching the session under sudo (DBus scope).
- Setup aborting on GNOME 50 (`blur-my-shell.modal-dialogs`, `power-off` keys don't exist).
- OCR shortcut never working on GNOME (grim unsupported; now uses the screenshot portal).
- Text Extractor grabbing Shift+T globally.
- `camera-controls` writing wrong values on open; a Reset button that did nothing.
- `mk export` deleting the project's own extension; personal history in committed dumps.
- End-of-life Zen Browser Flatpak ID.

See [docs/BUGS.md](docs/BUGS.md) for every finding and its commit.

## 1.0.0
- Initial release: `setup.sh`, `sync.sh`, Howdy enrollment, MK shortcuts and tools.
