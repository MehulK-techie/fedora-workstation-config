# Audit: fedora-workstation-config

| | |
| :--- | :--- |
| **Audited** | `main` at `9b74950`, freshly cloned from [GitHub](https://github.com/MehulK-techie/fedora-workstation-config) on 2026-10-23 |
| **Test machine** | Fedora 44 Workstation, GNOME 50.6 (Wayland), AMD Renoir GPU, HP Wide Vision HD camera (RGB only, no IR) |
| **Fixes** | Branch `fix/dbus-pam-dnf`. Each fixed item names the commit that fixed it. |
| **Updated** | 2026-10-23: second pass added B25–B28 and S5, found on the live system and by the automated security review. |
| **Method** | Read every script and document; ran `bash -n` and ShellCheck; ran `sync.sh` against a throwaway dconf database; checked every package name with `dnf repoquery` and every Flatpak ID with `flatpak remote-info`; checked GNOME 50 schemas with `gsettings`. |

**Summary:** 45 findings. 36 are fixed on the branch and 9 are still open.

| Category | Found | Fixed | Open |
| :--- | :---: | :---: | :---: |
| [Bugs](#1-bugs) | 29 | 23 | 6 |
| [Duplicated code](#2-duplicated-code) | 5 | 4 | 1 |
| [Hallucinations and false claims](#3-hallucinations-and-false-claims) | 6 | 5 | 1 |
| [Security and privacy](#4-security-and-privacy) | 5 | 4 | 1 |

Severity: **Critical** = the script aborts or does the wrong thing for everyone · **High** = a headline feature is broken or user data is lost · **Medium** = wrong in some setups, or silently degraded · **Low** = cosmetic, or risk only in edge cases.

---

## 1. Bugs

### Fixed

| # | Severity | Where | Problem | Fixed in |
| :--- | :--- | :--- | :--- | :--- |
| B1 | Critical | `setup.sh` | `gsettings` ran under `sudo -u` with an unquoted `$DBUS_ENV` word (17 × ShellCheck SC2086) and no `XDG_RUNTIME_DIR`, so writes could miss the live session. | `cce59cf` |
| B2 | Critical | `setup.sh:126` | `org.gnome.shell.extensions.blur-my-shell.modal-dialogs` does not exist in any installed blur-my-shell. Under `set -euo pipefail` the script aborted there, so the modal CSS and every later shortcut were never applied. | `cce59cf` |
| B3 | Critical | `setup.sh` | `media-keys power-off` does not exist on GNOME 50 (it was renamed to `shutdown`). This aborted the run a second time. | `89ad4a5` |
| B4 | High | `setup.sh` | Howdy was never installed: it isn't in `apps/dnf-packages.txt`, and the COPR step's `\|\| true` hid that. | `cce59cf` |
| B5 | High | `sync.sh`, `sync-shortcuts.sh` | `custom-keybindings` was overwritten with `custom0…4`. This erased every user custom shortcut, including the existing `custom-obsidian` on the test machine. | `89ad4a5` |
| B6 | High | `setup.sh` | `enabled-extensions` was overwritten (twice), switching off every extension the user had enabled. | `89ad4a5` |
| B7 | High | `bin/ocr-snip` | Captured with `grim`, which GNOME/Mutter doesn't support ("compositor doesn't support the screen capture protocol"). The OCR shortcut never worked on GNOME. Now uses the xdg-desktop-portal Screenshot API. | `47184d7` |
| B8 | High | `scripts/update-repo.sh` | `rm -rf ./extensions/*` followed by copying only locally installed extensions deleted the project's own `mk-indicator@mehulk` source. | `7ddda6a` |
| B9 | Medium | `setup.sh` | The modal-dialog CSS was appended to `gnome-shell.css` on every run. | `cce59cf` |
| B10 | Medium | `bin/camera-controls` | Ranges were hardcoded and wrong even for the HP camera (sharpness 0–10 instead of 0–100, gamma 100–300 instead of 100–500). The sliders wrote those made-up values to the camera as soon as the window opened. The Reset button called `v4l2-ctl --reset-controls`, which doesn't exist. | `47184d7` |
| B11 | Medium | `bin/mk` | Once installed to `~/.local/bin`, the repo-path fallback resolved to `~/.local`, so `mk update` and `mk sync` failed. The branch was hardcoded as `origin main`. | `89ad4a5` |
| B12 | Medium | `apps/flatpaks.txt` | `io.github.zen_browser.zen` is end-of-life on Flathub ("renamed to app.zen_browser.zen"). | `b295a93` |
| B13 | Medium | `sync.sh` | Settings for user-installed extensions (blur-my-shell, tiling-assistant) were hidden behind `2>/dev/null \|\| true`. They silently did nothing whenever the schema wasn't on the default path. | `89ad4a5` |
| B14 | Medium | `sync.sh` | `mutter experimental-features` was overwritten, dropping any other features the user had enabled. | `89ad4a5` |
| B15 | Medium | `setup.sh` | `/etc/dnf/dnf.conf` was edited without a backup, contrary to the project's own rule in CLAUDE.md. | `89ad4a5` |
| B16 | Medium | `register-face.sh` | The camera prompt defaulted to `/dev/video0` without checking the device. A metadata-only node (no video capture) could be chosen. | `cce59cf` |
| B17 | Low | `bin/fix-alt-tab` | Runs at every login (autostart). It re-bound Ctrl+Alt+arrows, which `sync.sh` deliberately frees for Zen Browser, and re-enabled the tiling popup. | `89ad4a5` |
| B18 | Low | `extensions/mk-indicator@mehulk` | Claimed GNOME 44 support but uses ES-module imports (GNOME 45+). No script installed or enabled it. | `1a0d1fe` |
| B25 | High | `config/extension-settings/text-extractor…dconf` (live setting) | Text Extractor's shortcut was saved as `['<Shift>t']`, apparently mis-recorded. The extension registers it with `Main.wm.addKeybinding`, so it grabbed **Shift+T globally** and typing a capital T could trigger OCR. Its default (Super+Shift+T) also collides with the MK OCR shortcut. Now Super+Alt+T. | `62dc7c6` |
| B26 | Medium | GNOME extensions | `screenshot-ocr@nbubis.github.com` was enabled but in ERROR state on GNOME 50. `mk export` now skips extensions that don't load, and `mk doctor` reports them. | `26b41e3`, `947d0eb` |
| B27 | Medium | `setup.sh` (AMD) | On Fedora 44 the VA driver ships inside `mesa-dri-drivers` with H.264/HEVC removed: `vainfo` showed only VP9, so most video was decoded on the CPU. `setup.sh` installs `mesa-va-drivers-freeworld`, and `mk doctor` now checks the real decode profiles instead of whether a driver exists. | `91f1650`, `947d0eb` |
| B29 | Medium | Live keymap | Seven keys were bound to two actions at once: `Print` (screenshot and screenshot UI), `Super+1…4` (workspace and dock app), `Super+S` (overview and quick settings), `Super+N` (GNOME notification focus and the user's own Obsidian shortcut). One keymap now resolves all of them, and `mk doctor` reports any future clash. Verified on the live desktop: 0 conflicts. | `aafe885` |
| B19 | Low | `setup.sh`, `sync.sh` | Home was assumed to be `/home/$USER`. Running outside a GNOME session failed with raw gsettings errors. Repo, COPR and Flatpak failures were hidden by `\|\| true`. | `cce59cf`, `89ad4a5` |

### Open

| # | Severity | Where | Problem | Suggested fix |
| :--- | :--- | :--- | :--- | :--- |
| B20 | Medium | `fedora-workstation-config.spec` | The package can't work. It copies a `zen-config/` folder that doesn't exist, and installs `setup.sh` as `/usr/bin/fedora-workstation-setup`, where `SCRIPT_DIR/apps` doesn't exist. It also `Requires: python3-pip`, which nothing uses. | Install the repo to `%{_datadir}/%{name}` and make the `/usr/bin` entry a wrapper that runs `%{_datadir}/%{name}/setup.sh`. Or remove the spec until packaging is a goal. |
| B21 | Medium | `bin/close-workspace-apps` | Sends Alt+F4 through `wtype` or `xdotool`. GNOME supports neither virtual-keyboard input on Wayland nor `xdotool` for native windows, and no shortcut is bound to it. | Remove it, or rewrite it with a GNOME Shell extension or a D-Bus call. |
| B22 | Low | `extensions/mk-indicator@mehulk/extension.js` | Inserts into `Main.panel._rightBox`, a private API that can change between GNOME releases. | Use `Main.panel.addToStatusArea(this.uuid, button)` with a `PanelMenu.Button`. |
| B23 | Low | `extensions/` | **Partly fixed `26b41e3`:** `sync.sh` now downloads extensions from extensions.gnome.org and `mk export` no longer bundles them; the remaining copies are an offline fallback (wack-shell has no GNOME 50 build on the site). Originally: 14 MB of bundled extensions. `quick-settings-tweaks` (GNOME 48 only) and `screenshot-ocr` (49 only) can't load on GNOME 50. blur-my-shell is also packaged by Fedora. | Bundle only `mk-indicator` and install the rest from extensions.gnome.org or Fedora packages. |
| B28 | Medium | Reference machine (not the repo) | Two swap units fail at every boot: `swap-swapfile.swap` (`/swap/swapfile`) and `swapfile.swap` (`/swapfile`). Probably stale `/etc/fstab` entries or a swap file not created for Btrfs. `mk doctor` reports it. | Check with `systemctl status swapfile.swap`. Fedora already uses zram swap, so removing the stale fstab lines is usually enough. |
| B24 | Low | `sync.sh` | Writes `~/.config/gnome-shell/gnome-shell.css`. That isn't a documented GNOME Shell styling mechanism, and it wasn't confirmed to take effect. | Check that the styling appears. If it doesn't, ship it as a user theme or a small extension stylesheet. |

---

## 2. Duplicated code

| # | Where | Problem | Status |
| :--- | :--- | :--- | :--- |
| D1 | `setup.sh`, `sync.sh`, `sync-shortcuts.sh`, `bin/fix-alt-tab` | Four files set the same keys to **conflicting** values: `switch-applications` (`[]` vs `<Super>Tab`), Ctrl+Alt workspace keys, the tiling popup, and `show-screenshot-ui` (`Print` vs `Shift+Print, Super+Shift+S`). Which value won depended on which script ran last. | Fixed `89ad4a5`: `sync.sh` is the single source; `sync-shortcuts.sh` is a shim. |
| D2 | `setup.sh` | `REAL_USER`/`REAL_UID`/`DBUS_ENV` were defined four times; `enabled-extensions` was set twice (the first was dead code); `show-screenshot-ui` and `power-off` were set four times, with two blocks copy-pasted verbatim. | Fixed `cce59cf`. |
| D3 | `README.md`, `AI_PROMPT_TEMPLATE.md` | The second half of the AI template was a stale copy of an older README, including `[cite: 5]` leftovers. | Fixed `1dba92b`. |
| D4 | `config/gnome-media-keys.dconf`, `config/keybindings.dconf` | Two dumps of the same dconf subtree that contradict each other. Nothing applies either one. | Fixed `26b41e3`: stale `gnome-media-keys.dconf` removed. |
| D5 | `extensions/blur-my-shell@aunetx`, `apps/dnf-packages.txt` | blur-my-shell is both bundled and installed from Fedora. | Open: see B23. (`sync.sh` already prefers the installed copy.) |

---

## 3. Hallucinations and false claims

These are statements in the repo that the code or the real system contradicts.

| # | Where | Claim | Reality | Status |
| :--- | :--- | :--- | :--- | :--- |
| H1 | `README.md` | "Privacy-Safe Sync: backs up Zen Browser CSS (`chrome/`), flags (`user.js`)…" | No script touches any browser profile. | Fixed `1dba92b`: claim removed. |
| H2 | `README.md` | "`sync.sh`: dumps live dconf trees… to Git", "ShellCheck Passed" badge, "GNOME 40+", "Fedora 41/42" | `sync.sh` applies settings; dumping is `scripts/update-repo.sh`. ShellCheck reported 17 warnings and no CI existed. The extensions need GNOME 45+, and the tested system is Fedora 44. | Fixed `1dba92b`, `e8cbbd9` (real CI). |
| H3 | Old `BUGS.md` (Bug 1.4) | "`/dev/video1` is the IR sensor of the HP dual-sensor camera" | `/dev/video1` is a metadata node (Device Caps `0x04a00000`, no video capture). This HP camera has no IR sensor. | Fixed: replaced by this file; `register-face.sh` detects IR from pixel formats `cce59cf`. |
| H4 | `AI_PROMPT_TEMPLATE.md`, GitHub "About" | "instant fingerprint unlock"; 13 active extensions; `Super+Shift+C` closes workspace apps | The project uses Howdy **face** unlock; the code enables 8 extensions; nothing binds `Super+Shift+C`. | Fixed in files `1dba92b`. **Open:** edit the GitHub repo's About text. |
| H5 | `apps/flatpaks.txt`, `mk-indicator` metadata, `camera-controls` | Zen ID `io.github.zen_browser.zen`; GNOME 44 support; `v4l2-ctl --reset-controls` | Respectively: end-of-life ID, ESM-only code, nonexistent flag. | Fixed (B12, B18, B10). |
| H6 | `HANDOFF.md` | "PROJECT_HISTORY.md marks DBus/PAM/SELinux fixes as Solved" | There's no `PROJECT_HISTORY.md` in the repository or its history. | Fixed: those fixes now exist in code (`cce59cf`). |

---

## 4. Security and privacy

| # | Severity | Problem | Status |
| :--- | :--- | :--- | :--- |
| S1 | High | `.gitignore` missed `cert9.db` (certificate store) and `sessionstore-backups/` (open tabs and form data). | Fixed `b58ad03`. |
| S2 | Medium | Face unlock on an RGB-only camera can be fooled by a photo, and nothing warned the user. | Fixed `cce59cf`: `register-face.sh` prefers IR and warns when only RGB is available. |
| S3 | Low | The committed dumps in `config/` contain the home path, wallpaper and lock-screen photo filenames, Run-dialog command history, and recently used emojis. | Fixed `1a0d1fe`, `26b41e3`, `62dc7c6`: `mk export` removes history, home paths and machine disk IDs, and the committed dumps were re-exported clean. |
| S5 | Medium | The new face wizard (`84b93a1`) loosened Howdy's `certainty` to 4.0 on RGB webcams and enabled face unlock for `sudo` without asking. Declining later didn't remove an earlier `sudo` entry. Found by the automated security review. | Fixed `537a310`, `2eecf02`: matching stays at 3.5 everywhere; on RGB, `sudo` is opt-in and "no" removes it. |
| S4 | Low | `config/gnome-desktop-full.dconf` records `[file-sharing] require-password='never'`. If Public-folder sharing is ever turned on, anyone on the network can read that folder. | Open: set `require-password='always'` if you use file sharing. |

---

## 5. How similar projects compare, and what was adopted

Projects reviewed: [fedorable](https://github.com/chetripley/fedorable) (dialog menu, editable package lists), [PYFO](https://github.com/d4rklynk/PYFO) (security-minded post-install, split package lists), [Linutil](https://github.com/ChrisTitusTech/linutil) (modular TUI toolbox, config-driven automation), [Universal Blue Bluefin](https://projectbluefin.io/) (`ujust` task recipes), and current Fedora 44 post-install guides ([debugpoint](https://debugpoint.com/10-things-to-do-fedora-44-after-install), [ostechnix](https://ostechnix.com/things-to-do-after-installing-fedora-44/), [computingforgeeks](https://computingforgeeks.com/rpm-fusion-fedora-44-codecs/)).

| Feature | Seen in | Before | Now |
| :--- | :--- | :--- | :--- |
| Full codecs (`dnf swap ffmpeg-free ffmpeg`) + GStreamer plugins | fedorable, Fedora 44 guides | Missing | Added `91f1650`, `b295a93` |
| GPU-aware hardware video decoding (VA-API) | Fedora 44 guides | Missing (the test machine had no AMD VA driver at all) | Added `91f1650`: AMD, Intel and NVIDIA detected via `lspci` |
| Firmware updates via fwupd | fedorable | Missing | Added `91f1650`: reported, never flashed automatically |
| Editable, categorized package lists | fedorable, PYFO | Flat lists, wrong Zen ID, most workspace apps missing | Categorized and verified; 43 packages and 12 Flatpaks `b295a93` |
| Task runner (`just setup`, `just check`…) | Bluefin `ujust` | Missing | Added `e8cbbd9` |
| CI lint on every push | Most maintained projects | Static badge only | GitHub Actions ShellCheck `e8cbbd9` |
| Run log | Linutil-style tooling | None | `/var/log/mk-workstation-setup.log` `91f1650` |
| Health check (`doctor`) | Bluefin (`ujust`), Linutil | None | `mk doctor` `947d0eb` |
| Automatic update awareness | Bluefin (auto-updates) | Manual `mk check` | Daily systemd user timer with notification `947d0eb` |
| Extensions restored with their settings | (not found in the projects reviewed) | Extension list only, settings lost | `config/extension-settings/` + extensions.gnome.org install `26b41e3` |
| Guided multi-model face enrollment | (not found in the projects reviewed) | One scan | Lighting-guided wizard, several users `84b93a1` |
| Distro and edition detection | Linutil | None | Fedora-only, refuses Atomic `89ad4a5` |
| Interactive TUI menu | fedorable, Linutil | — | **Not adopted yet**: worth adding with `gum` or `dialog` so users can pick sections |
| Btrfs snapshot before changes | Bluefin (image rollback), Snapper-based setups | — | **Not adopted**: the test system uses Btrfs but has no Snapper config; needs a safe default first |
| NVIDIA proprietary driver | fedorable | — | **Not automated on purpose**: Secure Boot needs manual key enrollment; `setup.sh` warns instead |
| Firewall hardening (default zone `drop`) | PYFO (server) | — | **Not adopted**: breaks desktop features such as casting and file sharing |

---

## 6. Recommended next steps

1. Push `fix/dbus-pam-dnf` and merge it. GitHub `main` has none of these fixes yet.
2. Fix the failed swap units on the reference machine (B28).
3. Fix B20 (spec) or delete the spec file.
4. Drop offline extension copies once extensions.gnome.org has GNOME 50 builds for them (B23).
5. Update the GitHub About text (H4).
6. Consider a TUI section picker and Snapper integration (section 5).
