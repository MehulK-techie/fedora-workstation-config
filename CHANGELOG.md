# Changelog

## 2.0.0 (unreleased, branch `fix/dbus-pam-dnf`)

### Added
- **macOS feel:** Spaces-style touchpad gestures, 25% faster animations (Impatience), genie minimize (Magic Lamp), Super+Ctrl+F full screen, Finder-style Files, sharp X11 apps at fractional scaling.
- **`mk uninstall`**, a permanent pre-MK settings snapshot, SECURITY.md, CODE_OF_CONDUCT.md, THIRD_PARTY.md, issue and PR templates, .editorconfig.
- **Themed Alt+Tab:** GNOME's flat switcher with live thumbnails of every window on every workspace, styled by mk-indicator's stylesheet (frosted navy panel, cyan selection).
- **Windows-style multitasking** (Tiling Assistant): snap halves and quarters, Snap Assist, six snap layouts on Super+Z, tile groups, always on top (Super+Ctrl+T), Super+Ctrl+←/→ desktops.
- **Super+N** Obsidian and **Super+B** default browser; duplicate user shortcuts are folded into the mk-* versions.
- **`mk update`** updates everything (repo, newly listed apps, settings, extensions, system) with `--check` preview; **`mk save`** captures apps, extensions and settings you added and commits them.
- Login helper `mk-session` that makes Blur my Shell reliable after login.
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
