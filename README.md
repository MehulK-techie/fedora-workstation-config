<div align="center">

# MK Workstation

**One command turns a fresh Fedora Workstation into a fast, keyboard-first, fully equipped GNOME desktop, and keeps it that way.**

![Fedora](https://img.shields.io/badge/Tested_on-Fedora_44-blue?logo=fedora)
![GNOME](https://img.shields.io/badge/Desktop-GNOME_50_(Wayland)-blue?logo=gnome)
[![ShellCheck](https://github.com/MehulK-techie/fedora-workstation-config/actions/workflows/shellcheck.yml/badge.svg)](https://github.com/MehulK-techie/fedora-workstation-config/actions/workflows/shellcheck.yml)
![License](https://img.shields.io/badge/License-MIT-green)

[Quick start](#quick-start) · [Guide](docs/GUIDE.md) · [Face unlock](docs/FACE-UNLOCK.md) · [Extensions](docs/EXTENSIONS.md) · [Audit](docs/BUGS.md)

</div>

---

## What makes it different

Most Fedora post-install scripts ([fedorable](https://github.com/chetripley/fedorable), [Linutil](https://github.com/ChrisTitusTech/linutil) and others) install a list of packages once. MK Workstation also **remembers how your desktop is set up** and puts it back, safely, as often as you like.

| | Typical post-install script | MK Workstation |
| :--- | :--- | :--- |
| Run it twice | Often duplicates config lines or fails | Same result every time, nothing duplicated |
| Your own shortcuts and extensions | Frequently overwritten | Kept; MK settings are added alongside |
| GNOME extensions | Installed, settings lost | Installed **with your saved settings**, matched to your GNOME version |
| System files (`dnf.conf`, PAM) | Edited in place | Backed up once to `.bak` before the first change |
| Codecs and video | `ffmpeg` swap at best | Full codecs **plus** GPU video decoding for AMD, Intel or NVIDIA |
| Face unlock | Not offered, or one quick scan | Guided wizard: up to 5 face models across lighting conditions, several people, IR-aware security |
| After setup | You're on your own | `mk doctor` health check, daily update notifications, `mk sync` to restore |
| Failures | Hidden or fatal | Listed at the end with what to do; full log in `/var/log` |

---

## Features

**Performance and system**
- DNF tuned: 10 parallel downloads, fastest mirror, `defaultyes`
- RPM Fusion (free and nonfree), Flathub, and Microsoft's VS Code repo
- Fewer false "not responding" popups while games or builds are busy
- Firmware update check through `fwupd`; it reports updates and never flashes anything on its own

**Multimedia**
- Full `ffmpeg` and GStreamer codecs (H.264, HEVC, AAC…)
- Hardware video decoding: detects your GPU and installs the right VA-API driver, so video plays on the GPU instead of the CPU

**Desktop, kept in sync**
- 10 curated GNOME extensions, installed from extensions.gnome.org for your exact GNOME version, **restored with their saved settings**
- `mk export` saves your current extensions and their settings into the repo; `mk sync` puts them back on any machine
- Alt+Tab across all workspaces, window snapping, screenshot and power keys, blur and dock styling

**Face unlock** ([details](docs/FACE-UNLOCK.md))
- A guided wizard records face models in normal, dim and bright light, so unlock keeps working as the room changes
- Several people can enroll on one computer
- IR cameras are picked automatically. On a regular webcam it keeps strict matching and asks before enabling face unlock for `sudo`

**Tools and upkeep**
- `mk doctor`: one-screen health check covering updates, codecs, GPU decoding, broken extensions, failed services, disk space and face unlock
- Daily background check that tells you when a new version of this repo is available
- OCR text-from-screen, a live shortcut cheat sheet, notes and a focus timer, webcam controls
- `just` recipes and GitHub Actions ShellCheck on every push

---

## Quick start

On Fedora Workstation, open **Terminal** and run:

```bash
sudo dnf install -y git
git clone https://github.com/MehulK-techie/fedora-workstation-config.git ~/fedora-workstation-config
cd ~/fedora-workstation-config
sudo ./setup.sh
```

Log out and back in, then optionally set up face unlock:

```bash
mk face
```

Skip face unlock entirely with `sudo ./setup.sh --no-face`. New to Linux? Follow the [step-by-step guide](docs/GUIDE.md).

---

## What gets installed

Edit [`apps/flatpaks.txt`](apps/flatpaks.txt) and [`apps/dnf-packages.txt`](apps/dnf-packages.txt) to choose your own. Both are grouped by purpose, so you can delete whole sections.

| Group | Apps |
| :--- | :--- |
| Browsing, notes, office | Zen Browser, Obsidian, Joplin, ONLYOFFICE |
| Desktop tools | Extension Manager, GNOME Tweaks, Frog (text from images), Cameractrls, FlipClock, Flameshot |
| Communication and audio | ZapZap (WhatsApp), Spotify, SonoBus, EasyEffects |
| Gaming | Lutris, GameMode, Gamescope, MangoHud, vkBasalt |
| Development | VS Code, Distrobox, Android tools, GCC, Make, Node.js, pip |
| Terminal | btop, fastfetch, fzf, ripgrep, zoxide, ncdu, just, chezmoi, 7-Zip, unrar |
| Media and codecs | full ffmpeg, GStreamer plugins, VA-API driver for your GPU, gThumb, Kamoso, Media Writer |

**Extensions** ([guide](docs/EXTENSIONS.md)): Blur my Shell, Dash to Dock, Astra Monitor, Clipboard Indicator, Touchpad Gesture Customization, Transparent Top Bar, WACK Shell, WACK Lockscreen Clock, Text Extractor, Places Menu, and the MK top-bar mark.

---

## Everyday commands

| `mk` command | `just` recipe | What it does |
| :--- | :--- | :--- |
| `mk doctor` | | Health check with a fix for every problem it finds |
| `mk sync` | `just sync` | Re-apply desktop settings and saved extension settings |
| `mk export` | `just export` | Save your current settings and extensions into the repo |
| `mk update` | `just update` | Pull the latest version and re-apply settings |
| `mk face` | `just face` | Face unlock wizard (`--models N`, `--user NAME`, `--tune-only`) |
| `mk shortcuts` | | Open the shortcut cheat sheet |
| | `just setup` | Full system setup (`sudo ./setup.sh`) |
| | `just check` | Lint every script (same as CI) |

## Keyboard shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt+Tab` / `Super+Tab` | Switch windows (all workspaces) / switch apps |
| `Super+Q` | Close window |
| `Super+←` / `→` / `↑` / `↓` | Snap left / snap right / maximize / restore |
| `Super+Page Up` / `Page Down` | Previous / next workspace (also `Super+Alt+←/→`) |
| `Print` / `Alt+Print` / `Super+Shift+S` | Screenshot screen / window / pick an area |
| `Super+Backspace` or `Super+Shift+X` | Shut down / restart dialog |
| `Super+Shift+T` / `Super+Alt+T` | OCR: copy text from the screen (MK tool / Text Extractor) |
| `Super+V` | Clipboard history |
| `Super+.` / `Super+/` | Emoji board / shortcut cheat sheet |
| `Super+N` / `Super+C` | Notes and focus timer / webcam controls |
| 3-finger / 4-finger pinch | Volume / show desktop |

`Ctrl+Alt+←/→` is left free for Zen Browser's workspace switching.

---

## Repository structure

```text
.
├── setup.sh              System setup (sudo); finishes by running sync.sh as you
├── sync.sh               Every desktop setting, extension and shortcut (no sudo)
├── register-face.sh      Face unlock wizard (sudo)
├── sync-shortcuts.sh     Compatibility shim for older installs; runs sync.sh
├── justfile              just setup | sync | face | export | update | check
├── apps/                 dnf-packages.txt, flatpaks.txt
├── bin/                  mk, mk-doctor, ocr-snip, show-shortcuts, mk-scratchpad, camera-controls …
├── config/
│   ├── enabled-extensions.txt   Extensions sync.sh installs and enables
│   ├── extension-settings/      One saved .dconf per extension
│   └── *.dconf                  Reference snapshots written by mk export
├── extensions/           mk-indicator plus offline fallback copies
├── scripts/              update-repo.sh (mk export), lint.sh
├── docs/                 GUIDE, FACE-UNLOCK, EXTENSIONS, BUGS, AI_PROMPT_TEMPLATE
└── .github/workflows/    ShellCheck CI
```

## Documentation

| Document | For |
| :--- | :--- |
| [docs/GUIDE.md](docs/GUIDE.md) | Installing and using it: beginners, everyday users, and contributors. Includes undo and troubleshooting. |
| [docs/FACE-UNLOCK.md](docs/FACE-UNLOCK.md) | Face unlock in three steps, multiple faces, lighting, and security |
| [docs/EXTENSIONS.md](docs/EXTENSIONS.md) | What each extension does and how to adjust it, with clicks or with commands |
| [docs/BUGS.md](docs/BUGS.md) | Full audit: bugs, duplicated code, false claims, and how this compares to similar projects |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Rules and checks for changes |
| [CHANGELOG.md](CHANGELOG.md) | What changed between versions |

---

## FAQ

**Does it work on other distributions, Silverblue or KDE?** No. `setup.sh` checks for Fedora Workstation with GNOME and stops before changing anything on anything else.

**Will it delete my settings?** No. Lists such as enabled extensions and custom shortcuts are added to, not replaced. System files get a `.bak` copy before their first change. See [Undo and uninstall](docs/GUIDE.md#undo-and-uninstall).

**Is face unlock safe?** With an IR camera (the Windows Hello kind), it's much harder to fool than a webcam, though Howdy itself warns it is less secure than a password. With a regular webcam a printed photo may pass, so the wizard keeps matching strict and only adds face unlock to `sudo` if you say yes. Your password always works.

**How do I keep my own tweaks?** Change anything in GNOME or Extension Manager, then run `mk export` and commit. `mk sync` restores it on any machine.

**My laptop has an NVIDIA GPU.** Setup installs NVIDIA's video-decoding library and tells you how to add the proprietary driver yourself, because with Secure Boot it needs a signing key that only you can approve.

---

## Roadmap

- Interactive section picker (`gum`/`dialog`), inspired by fedorable and Linutil
- Btrfs snapshot before system changes, once a safe Snapper default is in place
- Package the suite properly (the current `.spec` is broken; see [audit](docs/BUGS.md))

## Contributing

Fork, change, run `just check`, open a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Ideas adopted from [fedorable](https://github.com/chetripley/fedorable), [PYFO](https://github.com/d4rklynk/PYFO), [Linutil](https://github.com/ChrisTitusTech/linutil), [Universal Blue Bluefin](https://projectbluefin.io/) and the [RPM Fusion](https://rpmfusion.org/) howtos. Face unlock is powered by [Howdy](https://github.com/boltgolt/howdy). Extensions belong to their authors on [extensions.gnome.org](https://extensions.gnome.org/).

## License

[MIT](LICENSE)
