# Changelog

## 2.0.0 (unreleased, branch `fix/dbus-pam-dnf`)

### Added
- **macOS feel:** trackpad gestures (4 fingers ←/→ workspaces, 3 fingers ←/→ windows, 3 fingers ↑ overview), 25% faster animations (Impatience), genie minimize (Magic Lamp), a subtle glide when windows open and close (Burn My Windows), Super+Ctrl+F full screen, Finder-style Files, sharp X11 apps at fractional scaling.
- **Windows feel:** taskbar-style dock (click focuses or minimizes, thumbnails for apps with several windows, middle-click for a new window), Super+Ctrl+D new desktop (Shift takes the window along).
- **Shortcuts window (Super+/, GTK4):** every shortcut and touchpad gesture read live from GNOME, each marked working, clashing (with what), unset or broken; click to change keys, + to add command shortcuts, per-shortcut and full reset. All defaults now live in `config/shortcuts.conf`; your changes in `~/.config/mk-workstation/shortcuts.conf` survive `mk sync`.
- **Companion (Super+Shift+N, GTK4):** multiple notes you can pin (always open, on top), reorder and fold away; a task list with checkboxes, pins, a progress bar, a Done section and undo; buttons for the focus timer and Obsidian. Imports the old `~/.mk_scratchpad.md` once.
- **Focus timer (`mk-timer`):** minutes and seconds, presets, a glowing ring that turns amber then red, pause / +1 min. It hides while counting (not in Alt+Tab), then the pixel-robot celebration fills the screen instead of an alarm sound.
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
