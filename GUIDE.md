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
| Repositories | RPM Fusion free and nonfree; the `principis/howdy` COPR (face unlock only); Flathub. |
| Packages | Everything listed in `apps/dnf-packages.txt`, plus `howdy` when a camera is present. |
| Flatpaks | Everything listed in `apps/flatpaks.txt` (Zen Browser, VS Code, Extension Manager). |
| SELinux | Turns on `authlogin_camera` so the login screen can use the camera (face unlock only). |

**Your desktop** (`sync.sh`, no sudo; `setup.sh` runs it for you):

| Change | Details |
| :--- | :--- |
| Command-line tools | Copies `bin/*` to `~/.local/bin`: `mk`, `ocr-snip`, `show-shortcuts`, `mk-scratchpad`, `camera-controls`. |
| Extensions | Enables 8 extensions (see [Extensions_guide.md](Extensions_guide.md)). Any that are missing are installed from the repo's `extensions/` folder. Extensions you already enabled stay enabled. |
| Window shortcuts | Alt+Tab switches windows across all workspaces, Super+Tab switches apps, plus snap, maximize and workspace keys. Ctrl+Alt+arrows are left free for Zen Browser. |
| Screenshots and power | `Print`, `Alt+Print`, `Shift+Print` / `Super+Shift+S`; Super+Backspace or Super+Shift+X opens the shut-down dialog. |
| Look and feel | Blur on the top bar (off in the overview and lock screen), fractional scaling support, rounded dialogs (`~/.config/gnome-shell/gnome-shell.css`). |
| Calendar | Hides week numbers and **clears world clocks and weather locations** from the top-bar calendar. |
| Custom shortcuts | Adds five shortcuts named `mk-…`. Your own custom shortcuts are kept. |

The full shortcut list is in the [README](README.md#keyboard-shortcuts), and on your screen with **Super + /**.

### Run only part of it

| I want… | Run |
| :--- | :--- |
| Only the desktop settings, no system changes | `./sync.sh` (no sudo) |
| Everything except face unlock | `sudo ./setup.sh --no-face` |
| Only face unlock (Howdy already installed) | `sudo ./register-face.sh` |

### Choose your apps

Edit `apps/dnf-packages.txt` (Fedora packages) or `apps/flatpaks.txt` (Flathub app IDs), one per line. Lines starting with `#` are ignored. Then run `sudo ./setup.sh` again. Anything that fails to install is listed at the end instead of stopping the run.

### Stay up to date

```bash
mk update      # pulls the latest version and re-applies desktop settings
mk check       # just tells you whether an update is available
```

All scripts are safe to run again: re-running never duplicates lines or settings.

---

## Path 3: Customizing and contributing

### Repository layout

| Path | Purpose |
| :--- | :--- |
| `setup.sh` | System provisioning (root). Ends by running `sync.sh` as the desktop user. |
| `sync.sh` | **The only place desktop settings are defined.** Runs as your user. |
| `register-face.sh` | Howdy enrollment: camera detection, PAM setup. |
| `sync-shortcuts.sh` | Compatibility shim that runs `sync.sh`. |
| `bin/` | Desktop tools copied to `~/.local/bin`. |
| `apps/` | Package and Flatpak lists read by `setup.sh`. |
| `extensions/` | Bundled extension copies, used only when an extension isn't installed. Includes this project's own `mk-indicator@mehulk`. |
| `config/` | Snapshots of GNOME settings written by `mk export`, for reference. No script applies them. |
| `scripts/update-repo.sh` | The engine behind `mk export`. |

### Make it yours

1. Fork the repo on GitHub and clone your fork.
2. Change what you like:
   - **Extensions:** edit the `ACTIVE_EXTENSIONS` list in `sync.sh`.
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
for f in *.sh scripts/*.sh bin/mk bin/fix-alt-tab bin/ocr-snip bin/show-shortcuts bin/mk-scratchpad; do
  bash -n "$f" && shellcheck "$f"
done
```

Never commit browser profile secrets (`logins.json`, `key4.db`, `cert9.db`, cookies, `sessionstore-backups/`). `.gitignore` already excludes them.

---

## Face unlock

Face unlock uses [Howdy](https://github.com/boltgolt/howdy). It runs entirely on your computer; nothing is uploaded.

```bash
cd ~/fedora-workstation-config
sudo ./register-face.sh
```

What happens:

1. The script lists your cameras. It prefers an **IR camera** (the kind used by Windows Hello). If you have several, it asks you to pick one by number.
2. You look at the camera while Howdy records your face.
3. Face unlock is added to the login screen and to `sudo`. Your password keeps working as a fallback.
4. A test window opens. Close it with `Ctrl + C` in the Terminal.

> **No IR camera?** The script still works with a normal webcam, but warns you: without IR, a photo of your face may be enough to unlock. Keep a strong password.

Useful commands:

```bash
sudo howdy -U "$USER" add      # add another face model (glasses, different lighting)
sudo howdy -U "$USER" list     # list your face models
sudo howdy disable 1           # pause face unlock (use 0 to turn it back on)
```

---

## Undo and uninstall

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

**Remove the desktop tools:**

```bash
rm -f ~/.local/bin/{mk,ocr-snip,show-shortcuts,mk-scratchpad,camera-controls,close-workspace-apps,fix-alt-tab}
rm -rf ~/.config/mk-workstation
```

Installed apps and repositories stay. Remove them with `sudo dnf remove <package>` or `flatpak uninstall <app-id>`.

---

## Troubleshooting

| Message or problem | What to do |
| :--- | :--- |
| `setup.sh requires root privileges` | Run it with `sudo ./setup.sh`. |
| `sync.sh … Do NOT run with sudo` | Run `./sync.sh` without `sudo`. |
| `Can't reach a GNOME session` / `No GNOME session for …` | Log into the GNOME desktop and run the command from its Terminal, not from a text console or SSH. |
| `This suite supports Fedora only` / `Fedora Atomic` | These systems aren't supported. Nothing was changed. |
| `No camera found; skipped Howdy face unlock` | Expected on computers without a camera. Everything else was set up. |
| `Howdy could not be installed` | The Howdy COPR may not support your Fedora version yet. Try `sudo ./setup.sh` again later. |
| `DNF package not installed: …` / `Flatpak failed to install: …` | That app isn't available for your system. Remove it from the list in `apps/`, or install an alternative. |
| `Skipped … (… not installed or too old)` | That extension isn't installed, so its tweak was skipped. Install it with Extension Manager and run `./sync.sh` again. |
| Extensions don't appear | Log out and back in. GNOME loads new extensions only at login. |
| An extension shows as "outdated" | Its bundled copy doesn't support your GNOME version. Update it from Extension Manager. |
| OCR shortcut does nothing | Run `ocr-snip` in a Terminal to see the error. It needs `tesseract`, `zenity` and `wl-clipboard` (all in `apps/dnf-packages.txt`). |
| `mk: command not found` | Open a new Terminal. If it persists, run `./sync.sh` from the repo folder. |
| Face unlock stopped working after a Fedora upgrade | Run `sudo ./register-face.sh` again. It's safe to repeat. |
| Can't log in at all | Your password always works. If the login screen itself is broken, press `Ctrl+Alt+F3`, log in with your username and password, and run `sudo sed -i '/pam_howdy\.so/d' /etc/pam.d/gdm-password`. Then reboot. |
