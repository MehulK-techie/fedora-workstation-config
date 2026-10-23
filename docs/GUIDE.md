# MK Workstation Guide

This guide takes you from a fresh Fedora install to a working MK Workstation, and shows how to change or undo anything afterwards. Pick the path that fits you:

| You are… | Start here |
| :--- | :--- |
| New to Linux, or haven't installed Fedora yet | [Path 1: First-time setup](#path-1-first-time-setup) |
| Already on Fedora and comfortable with a terminal | [Path 2: Everyday Fedora users](#path-2-everyday-fedora-users) |
| Want to customize, fork, or contribute | [Path 3: Customizing and contributing](#path-3-customizing-and-contributing) |

Everyone: [Face unlock](#face-unlock) · [Undo and uninstall](#undo-and-uninstall) · [Troubleshooting](#troubleshooting)

---

## Before you start

**You need:**

- Fedora Workstation, the standard edition with the GNOME desktop. This was tested on Fedora 44 (GNOME 50).
- Your account password, with administrator rights. The account you created while installing Fedora has them.
- An internet connection.
- A camera, but only if you want face unlock.

**Not supported:** other Linux distributions, Fedora Atomic editions (Silverblue, Kinoite), and Fedora spins with other desktops such as KDE. `setup.sh` checks for these and stops before changing anything.

---

## Path 1: First-time setup

### Step 1: Install Fedora

If Fedora is already installed, skip to [Step 2](#step-2-open-the-terminal).

**Back up anything important first.** Installing an operating system changes your disk's partitions.

If you're keeping Windows alongside Fedora (dual boot), prepare Windows first:

1. **Turn off BitLocker.** In Windows, open Control Panel › BitLocker Drive Encryption and choose *Turn off BitLocker*. Wait until decryption reaches 100%.
2. **Turn off Fast Startup.** Open Control Panel › Power Options › *Choose what the power buttons do* › *Change settings that are currently unavailable*. Untick *Turn on fast startup* and save. Otherwise Windows leaves the disk locked when it shuts down.
3. **Make room for Fedora.** Open *Disk Management* (`diskmgmt.msc`), right-click your largest partition, and choose *Shrink Volume*. 60 GB or more is comfortable.
4. **Create a bootable USB stick** (8 GB or larger; it will be erased):
   - The easiest way is [Fedora Media Writer](https://fedoraproject.org/workstation/download), which downloads Fedora and writes the stick for you.
   - Or download the full Fedora Workstation ISO (a few GB, not the small checksum file) and write it with **Rufus**. Choose partition scheme **GPT**, target **UEFI (non CSM)**, and when asked, **Write in DD Image mode**.
5. **Check the BIOS/UEFI settings.** Restart and open the setup screen (often `F2`, `F10`, `F12` or `Del`). Make sure the boot mode is **UEFI** and the storage mode is **AHCI**, not Intel RST/VMD.

Boot from the USB stick and follow the Fedora installer.

### Step 2: Open the Terminal

Press the **Super** key (the Windows key), type `Terminal`, and press **Enter**.

### Step 3: Download and run the setup

Copy each line into the Terminal and press **Enter** after each one:

```bash
sudo dnf install -y git
git clone https://github.com/MehulK-techie/fedora-workstation-config.git ~/fedora-workstation-config
cd ~/fedora-workstation-config
sudo ./setup.sh
```

- When asked for your password, type it and press Enter. **Nothing appears on screen while you type**; that's normal.
- Setup downloads a lot of software, so it can take a while on slower connections. Let it finish.
- If it ends with **⚠ Completed with warnings**, read the list. Each line says what was skipped and why. See [Troubleshooting](#troubleshooting).

### Step 4: Log out and back in

Click the top-right corner of the screen, choose the power icon, then **Log Out**, and log back in. This loads the new extensions.

### Step 5: Try it out

- Press **Super + /** to see every shortcut.
- Press **Alt + Tab** to switch between windows on all workspaces.
- Press **Super + Shift + T**, select some text on screen, and copy it.

Want to unlock with your face? Continue to [Face unlock](#face-unlock).

---

## Path 2: Everyday Fedora users

### Install

```bash
git clone https://github.com/MehulK-techie/fedora-workstation-config.git ~/fedora-workstation-config
cd ~/fedora-workstation-config
sudo ./setup.sh            # or: sudo ./setup.sh --no-face
```

Log out and back in afterwards. Run `./setup.sh --help` for the options.

### Exactly what changes

**System-wide** (`setup.sh`, needs sudo):

| Change | Details |
| :--- | :--- |
| `/etc/dnf/dnf.conf` | Sets `max_parallel_downloads=10`, `fastestmirror=True`, `defaultyes=True`. The original is saved as `dnf.conf.bak`. |
| Repositories | RPM Fusion free and nonfree; Microsoft's VS Code repo; the `principis/howdy` COPR (face unlock only); Flathub. |
| Packages | Everything listed in `apps/dnf-packages.txt`, plus `howdy` when a camera is present. |
| Codecs and video decoding | Replaces `ffmpeg-free` with RPM Fusion's full `ffmpeg`. Detects your graphics chip and installs its hardware video driver: `mesa-va-drivers-freeworld` (AMD), `intel-media-driver` (Intel) or `libva-nvidia-driver` (NVIDIA). The NVIDIA proprietary driver itself is not installed; see [Troubleshooting](#troubleshooting). |
| Flatpaks | Everything listed in `apps/flatpaks.txt`: Zen Browser, Obsidian, Joplin, ONLYOFFICE, Extension Manager, Frog, Cameractrls, FlipClock, ZapZap, Spotify, SonoBus and Lutris. Then updates all Flatpaks. |
| SELinux | Turns on `authlogin_camera` so the login screen can use the camera (face unlock only). |
| Firmware | Checks for firmware updates with `fwupdmgr` and tells you if any exist. It never installs firmware by itself. |
| Log | Everything setup prints is also saved to `/var/log/mk-workstation-setup.log`. |

**Your desktop** (`sync.sh`, no sudo; `setup.sh` runs it for you):

| Change | Details |
| :--- | :--- |
| Command-line tools | Copies `bin/*` to `~/.local/bin`: `mk`, `mk-doctor`, `ocr-snip`, `show-shortcuts`, `mk-companion`, `mk-timer`, `camera-controls`; the shared Python library and defaults go to `~/.local/share/mk-workstation/`. |
| Update check | A daily, low-priority background check (systemd user timer) that shows a notification when a new version of this repo is available. |
| Extensions | Installs and enables the 12 extensions in `config/enabled-extensions.txt` plus the small **MK** mark in the top bar, then restores their saved settings from `config/extension-settings/`. Missing extensions are downloaded from extensions.gnome.org for your GNOME version. Extensions you already enabled stay enabled. See [EXTENSIONS.md](EXTENSIONS.md). |
| Window shortcuts | Alt+Tab switches windows across all workspaces, Super+Tab switches apps, plus snap, maximize and workspace keys. Ctrl+Alt+arrows are left free for Zen Browser. |
| Screenshots and power | `Print`, `Alt+Print`, `Shift+Print` / `Super+Shift+S`; Super+Backspace or Super+Shift+X opens the shut-down dialog. |
| Look and feel | Blur on the top bar (off in the overview and lock screen), fractional scaling support, rounded dialogs (`~/.config/gnome-shell/gnome-shell.css`), and 20 s instead of 5 s before GNOME calls a busy app "not responding". |
| Calendar | Hides week numbers and **clears world clocks and weather locations** from the top-bar calendar. |
| Windows & macOS habits | Super+E Files, Super+I Settings, Super+D desktop, Super+R run, Super+S search, Super+1–9 dock apps, Super+Shift+3/4 screenshots, minimize/maximize buttons, centred new windows. Notifications move to Super+M and quick settings to Super+Shift+A. Workspaces use Super+Alt+1–4. |
| Custom shortcuts | Adds `mk-…` shortcuts (OCR, emoji, cheat sheet, notes on Super+Shift+N, camera, System Monitor on Ctrl+Shift+Esc, terminal on Ctrl+Alt+T). Your own custom shortcuts are kept. |
| Safety net | Saves a snapshot of all your desktop settings before changing anything (newest 5 kept). `mk restore` undoes the last sync. |

The full shortcut list is in the [README](../README.md#keyboard-shortcuts), and on your screen with **Super + /**.

### Run only part of it

| I want… | Run |
| :--- | :--- |
| Only the desktop settings, no system changes | `./sync.sh` (no sudo) |
| Everything except face unlock | `sudo ./setup.sh --no-face` |
| Only face unlock (Howdy already installed) | `mk face` |
| Check that everything is healthy | `mk doctor` |

### Choose your apps

Edit `apps/dnf-packages.txt` (Fedora packages) or `apps/flatpaks.txt` (Flathub app IDs), one per line. Lines starting with `#` are ignored. Then run `sudo ./setup.sh` again. Anything that fails to install is listed at the end instead of stopping the run.

### Stay up to date

```bash
mk update            # update everything (see below)
mk update --check    # preview what mk update would do; changes nothing
mk save              # keep what you added yourself (apps, extensions, settings)
mk doctor            # health check: updates, codecs, GPU video, extensions, shortcuts, face unlock
```

**`mk update`** does four things in order:

1. Pulls the newest version of this repo (skipped if you have uncommitted changes).
2. Installs anything that is in `apps/dnf-packages.txt` or `apps/flatpaks.txt` but not on your computer (asks for your password once).
3. Re-applies desktop settings, and installs and enables any extension added to `config/enabled-extensions.txt`.
4. Installs system and Flatpak updates (`--no-upgrade` skips this).

**`mk save`** works the other way round. Install an app, or enable and tune an extension, then run `mk save`. It:

- adds new Flatpaks and new Fedora packages to the app lists,
- saves your extensions and their settings,
- makes a Git commit of `apps/` and `config/`.

Push the commit (`git push`) and every other computer gets the change on its next `mk update`.

A background check also notifies you once a day when a new version is available.

All scripts are safe to run again: re-running never duplicates lines or settings.

### Task shortcuts with `just`

From the repo folder you can use short commands instead of script names:

| Command | Same as |
| :--- | :--- |
| `just setup` (or `just setup --no-face`) | `sudo ./setup.sh` |
| `just sync` | `./sync.sh` |
| `just face` | `mk face` |
| `just export` | `mk export` |
| `just update` | pull the latest version and re-apply settings |
| `just check` | lint every script |

---

## Path 3: Customizing and contributing

### Repository layout

| Path | Purpose |
| :--- | :--- |
| `setup.sh` | System provisioning (root). Ends by running `sync.sh` as the desktop user. |
| `sync.sh` | **The only place desktop settings are defined.** Runs as your user. |
| `register-face.sh` | Face unlock wizard: camera detection, tuning, multi-model enrollment, PAM. |
| `sync-shortcuts.sh` | Compatibility shim that runs `sync.sh`. |
| `bin/` | Desktop tools copied to `~/.local/bin`, including `mk` and `mk-doctor`. |
| `apps/` | Package and Flatpak lists read by `setup.sh`. |
| `extensions/` | This project's own `mk-indicator@mehulk`, plus WACK Shell, which extensions.gnome.org has no GNOME 50 build of (see [THIRD_PARTY.md](../THIRD_PARTY.md)). Every other extension is downloaded. |
| `config/enabled-extensions.txt`, `config/extension-settings/` | Which extensions to enable and their saved settings. Written by `mk export`, applied by `sync.sh`. |
| `config/*.dconf` | Full GNOME settings snapshots written by `mk export`, for reference. No script applies them. |
| `docs/` | This guide, [FACE-UNLOCK.md](FACE-UNLOCK.md), [EXTENSIONS.md](EXTENSIONS.md), [BUGS.md](BUGS.md). |
| `scripts/update-repo.sh` | The engine behind `mk export`. |
| `scripts/lint.sh` | `bash -n` + ShellCheck + Python syntax check for every script; used by `just check` and CI. |
| `justfile` | Task shortcuts (`just setup`, `just check`, …). |
| `.github/workflows/shellcheck.yml` | Runs `scripts/lint.sh` on every push and pull request. |

### Make it yours

1. Fork the repo on GitHub and clone your fork.
2. Change what you like:
   - **Extensions:** enable and tune them in Extension Manager, then run `mk export`. Or edit `config/enabled-extensions.txt` directly. Details in [EXTENSIONS.md](EXTENSIONS.md).
   - **Shortcuts:** add an `add_shortcut <slot> "<name>" "<command>" "<keys>"` line in `sync.sh`. Slots become `mk-<slot>`.
   - **Any GNOME setting:** add a `gsettings set …` line to the matching section of `sync.sh`. For keys that belong to an extension, use `ext_set <uuid> <schema> <key> <value>`.
3. Run `./sync.sh` to apply, and `mk export` to snapshot your live settings into `config/`.
4. Commit and push to your fork.

### How the scripts stay safe

- **Idempotent:** every step checks before it changes anything, so running twice gives the same result and no duplicate lines.
- **Backups:** system files get a `.bak` copy before their first change, and an existing `.bak` is never overwritten. That keeps the original.
- **Right user, right session:** when `setup.sh` runs as root it calls `sync.sh` through `as_user()`, which sets `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR` and `HOME` so settings reach your live session.
- **Additive:** list settings (enabled extensions, custom shortcuts, mutter features) are appended to, never replaced.
- **Visible failures:** optional steps that fail are collected and printed at the end, not hidden.

### Before you commit

```bash
sudo dnf install -y ShellCheck
just check
```

GitHub runs the same check on every push. When you add a script, add it to the list in `scripts/lint.sh`.

Never commit browser profile secrets (`logins.json`, `key4.db`, `cert9.db`, cookies, `sessionstore-backups/`). `.gitignore` already excludes them.

---

## Face unlock

Run `mk face` (or `sudo ./register-face.sh`) and follow the prompts. The wizard picks the best camera, tunes Howdy for it, and records up to three face models in different lighting so unlock keeps working in a dim room or by a window. Other people can enroll with `mk face --user NAME`. Your password always keeps working.

Everything else, including multiple faces, lighting, security and troubleshooting, is in [FACE-UNLOCK.md](FACE-UNLOCK.md).

---

## Fingerprint login

If your laptop has a fingerprint reader, `sudo ./setup.sh` turns on fingerprint login for the login screen and `sudo`. Enroll a finger with `mk fingerprint` (touch the sensor 8–12 times), then lock the screen and try it. `mk device` shows whether a reader was found; [HARDWARE.md](HARDWARE.md) has the details.

## Undo and uninstall

**Undo the last desktop sync:** `mk restore`. It puts back the settings snapshot `sync.sh` saved just before it ran, then you log out and back in. Snapshots are in `~/.config/mk-workstation/backups/`.

**Turn off face unlock** (password-only login again):

```bash
sudo sed -i '/pam_howdy\.so/d' /etc/pam.d/sudo /etc/pam.d/gdm-password
```

**Restore the original DNF settings:**

```bash
sudo cp /etc/dnf/dnf.conf.bak /etc/dnf/dnf.conf
```

**Remove the MK custom shortcuts:** open Settings › Keyboard › View and Customize Shortcuts › Custom Shortcuts, and delete the MK entries (OCR Text Extractor, Emoji Board, Workstation Shortcuts HUD, Quick Notes & Timer, Camera Studio Controls).

**Reset window, screenshot and tiling shortcuts to GNOME defaults.** This also resets any of these you changed yourself:

```bash
gsettings reset-recursively org.gnome.desktop.wm.keybindings
gsettings reset-recursively org.gnome.shell.keybindings
gsettings reset-recursively org.gnome.mutter.keybindings
```

**Disable extensions:** open Extension Manager and switch off the ones you don't want.

**Remove the rounded dialog style:** open `~/.config/gnome-shell/gnome-shell.css` and delete the block that starts with `/* MK Workstation: modal dialog styling */`.

**Remove the VS Code repository:** `sudo rm /etc/yum.repos.d/vscode.repo`

**Remove the MK top-bar watermark:** switch off *MK Workstation Indicator* in Extension Manager.

**Bring back the old login scripts** that sync replaced (they toggled every extension at login): move them from `~/.config/mk-workstation/retired-autostart/` back to `~/.config/autostart/`.

**Turn off the daily update check:** `systemctl --user disable --now mk-update-check.timer`

**Remove MK from your account:** `mk uninstall`. It asks first, then removes the MK tools, the daily update check, the login helper, the `mk-*` shortcuts and the MK extension. Your own shortcuts and extensions stay.

**Get your desktop back exactly as it was before MK** (all GNOME settings):

```bash
dconf reset -f / && dconf load / < ~/.config/mk-workstation/backups/original-dconf.ini
```

Then log out and back in.

Installed apps and repositories stay. Remove them with `sudo dnf remove <package>` or `flatpak uninstall <app-id>`.

---

## Troubleshooting

| Message or problem | What to do |
| :--- | :--- |
| Not sure what's wrong | Run `mk doctor`. It checks the common problems and prints a fix for each. |
| Anything went wrong during setup | Read `/var/log/mk-workstation-setup.log`. It has the full output of every run. |
| `setup.sh requires root privileges` | Run it with `sudo ./setup.sh`. |
| `sync.sh … Do NOT run with sudo` | Run `./sync.sh` without `sudo`. |
| `Can't reach a GNOME session` / `No GNOME session for …` | Log into the GNOME desktop and run the command from its Terminal, not from a text console or SSH. |
| `This suite supports Fedora only` / `Fedora Atomic` | These systems aren't supported. Nothing was changed. |
| `No camera found; skipped Howdy face unlock` | Expected on computers without a camera. Everything else was set up. |
| `NVIDIA GPU found: the proprietary driver isn't installed automatically` | Follow RPM Fusion's NVIDIA guide (`akmod-nvidia`). With Secure Boot on, you must enroll a signing key and reboot, which is why setup doesn't do it for you. |
| `Firmware updates are available` | Close your work, plug in the charger, then run `fwupdmgr update` and follow the prompts. |
| `Howdy could not be installed` | The Howdy COPR may not support your Fedora version yet. Try `sudo ./setup.sh` again later. |
| `DNF package not installed: …` / `Flatpak failed to install: …` | That app isn't available for your system. Remove it from the list in `apps/`, or install an alternative. |
| `Skipped … (… not installed or too old)` | That extension isn't installed, so its tweak was skipped. Install it with Extension Manager and run `./sync.sh` again. |
| Extensions don't appear | Log out and back in. GNOME loads new extensions only at login. Run `mk sync` once if an extension you switched off earlier won't come back: sync takes it off GNOME's *disabled* list. |
| Blur missing right after login, back after locking the screen | Blur my Shell started before the desktop was ready. `mk sync` installs a login helper that re-applies it a few seconds after login; run `mk sync` once, then log out and in. |
| An extension shows as "outdated" or ERROR | It doesn't support your GNOME version yet. Update it in Extension Manager or switch it off; `mk doctor` lists them. |
| OCR shortcut does nothing | Run `ocr-snip` in a Terminal to see the error. It needs `tesseract`, `zenity` and `wl-clipboard` (all in `apps/dnf-packages.txt`). |
| `mk: command not found` | Open a new Terminal. If it persists, run `./sync.sh` from the repo folder. |
| Face unlock problems | See [FACE-UNLOCK.md › Troubleshooting](FACE-UNLOCK.md#troubleshooting). |
| Can't log in at all | Your password always works. If the login screen itself is broken, press `Ctrl+Alt+F3`, log in with your username and password, and run `sudo sed -i '/pam_howdy\.so/d' /etc/pam.d/gdm-password`. Then reboot. |
