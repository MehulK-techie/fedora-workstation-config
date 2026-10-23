# Changelog

## 2.0.0 (unreleased, branch `fix/dbus-pam-dnf`)

### Added
- **Face unlock wizard:** up to 5 face models recorded in different lighting, a light check before each one, camera-type tuning, camera auto-exposure, `--user` for other people, `--tune-only`, and `mk face`.
- **Extensions with settings:** `mk export` saves enabled extensions and their settings to `config/`; `sync.sh` installs them from extensions.gnome.org for your GNOME version and restores the settings.
- **`mk doctor`** health check, and a daily update notification (systemd user timer).
- Full ffmpeg and GStreamer codecs, GPU-aware VA-API drivers, firmware update check, VS Code repo, run log in `/var/log/mk-workstation-setup.log`.
- Full workstation app set: Zen, Obsidian, Lutris, Extension Manager, Joplin, ONLYOFFICE, Spotify, ZapZap and more (all names verified).
- `justfile`, `scripts/lint.sh`, GitHub Actions ShellCheck.
- Docs: `docs/GUIDE.md`, `docs/FACE-UNLOCK.md`, `docs/EXTENSIONS.md`, `docs/BUGS.md` (full audit), `CONTRIBUTING.md`.

### Changed
- `sync.sh` is the single source of desktop settings; `setup.sh` runs it as the desktop user.
- Custom shortcuts use named `mk-*` slots; your own shortcuts and extensions are kept.
- `setup.sh` refuses non-Fedora and Fedora Atomic systems, takes `--no-face`, and skips Howdy when there's no camera.
- Busy apps get 20 s before GNOME shows "not responding".
- Docs moved to `docs/`.

### Fixed
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
