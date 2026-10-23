# Fedora GNOME Workstation Config & Provisioning Suite

![Fedora](https://img.shields.io/badge/Tested_on-Fedora_44-blue?logo=fedora)
![GNOME](https://img.shields.io/badge/Desktop-GNOME_50_(Wayland)-blue?logo=gnome)
![License](https://img.shields.io/badge/License-MIT-green)

Shell scripts that turn a fresh Fedora Workstation into the **MK Workstation**: faster DNF, RPM Fusion and Flathub apps, a curated set of GNOME extensions, keyboard-first window management, a few handy desktop tools, and optional Howdy face unlock. Every script is safe to run again.

**New here? Read the [step-by-step guide](GUIDE.md).** It has separate paths for Linux beginners, everyday Fedora users, and people who want to customize or contribute.

---

## Quick start

On Fedora Workstation, open **Terminal** and run:

```bash
sudo dnf install -y git
git clone https://github.com/MehulK-techie/fedora-workstation-config.git ~/fedora-workstation-config
cd ~/fedora-workstation-config
sudo ./setup.sh
```

Then log out and back in. To set up face unlock afterwards (optional):

```bash
sudo ./register-face.sh
```

Don't want face unlock at all? Use `sudo ./setup.sh --no-face`.

---

## What's included

| Component | What it does | Where |
| :--- | :--- | :--- |
| **System setup** | Faster DNF (10 parallel downloads, fastest mirror), RPM Fusion free + nonfree, packages from `apps/dnf-packages.txt`, Flathub apps from `apps/flatpaks.txt`. Backs up `dnf.conf` first. | `setup.sh` (sudo) |
| **Desktop settings** | Enables 8 GNOME extensions, Alt+Tab across all workspaces, window snapping and screenshot keys, blur tweaks, and the MK custom shortcuts. Keeps your own extensions and custom shortcuts. | `sync.sh` (no sudo; `setup.sh` runs it for you) |
| **Face unlock** | Howdy face recognition for the login screen and `sudo`, with an IR camera picked automatically when present. Your password always still works. | `register-face.sh` (sudo) |
| **Desktop tools** | OCR screen-to-text, shortcut cheat sheet, notes and focus timer, webcam controls, and the `mk` command. | `bin/` → `~/.local/bin` |
| **Settings export** | Saves your live GNOME settings and extensions into the repo, with home paths removed, so you can keep your own fork. | `mk export` |

## Keyboard shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt+Tab` / `Super+Tab` | Switch windows (all workspaces) / switch apps |
| `Super+Q` | Close window |
| `Super+←` / `Super+→` / `Super+↑` / `Super+↓` | Snap left / snap right / maximize / restore |
| `Super+Page Up` / `Super+Page Down` | Previous / next workspace (also `Super+Alt+←/→`) |
| `Print` / `Alt+Print` / `Super+Shift+S` | Screenshot screen / window / pick an area |
| `Super+Backspace` or `Super+Shift+X` | Shut down / restart dialog |
| `Super+Shift+T` | OCR: copy text from any part of the screen |
| `Super+.` / `Super+/` | Emoji board / shortcut cheat sheet |
| `Super+N` / `Super+C` | Notes and focus timer / webcam controls |

`Ctrl+Alt+←/→` is deliberately left free for Zen Browser's workspace switching.

## The `mk` command

| Command | What it does |
| :--- | :--- |
| `mk update` | Pull the latest version and re-apply desktop settings |
| `mk sync` | Re-apply desktop settings |
| `mk export` | Save this machine's GNOME settings into the repo |
| `mk shortcuts` | Open the shortcut cheat sheet |

## Requirements

- Fedora Workstation (GNOME). Tested on Fedora 44 with GNOME 50. Fedora Atomic editions (Silverblue, Kinoite) and other distributions aren't supported, and `setup.sh` stops with a message on them.
- An account with administrator (sudo) rights and an internet connection.
- A camera is only needed for face unlock. An IR camera is strongly recommended; with a regular webcam, a photo of you may be enough to unlock.

## Undoing changes

See [Undo and uninstall](GUIDE.md#undo-and-uninstall) in the guide. In short, the scripts keep a `.bak` copy of every system file before their first change (`/etc/dnf/dnf.conf`, `/etc/pam.d/sudo`, `/etc/pam.d/gdm-password`, the Howdy config).

## License

[MIT](LICENSE)
