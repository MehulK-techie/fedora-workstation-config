# Everything in MK Workstation

Every feature, app and command, split by where it comes from:

- **Built by MK**: code written for this project (MIT licensed).
- **Configured by MK**: existing software (GNOME, extensions, system services)
  that MK installs, sets up and tunes, but didn't write.
- **Installed by MK**: apps from Fedora, RPM Fusion and Flathub, used as they are.

Credit for everything in the last two groups belongs to its authors; see
[THIRD_PARTY.md](../THIRD_PARTY.md).

---

## Built by MK

### Setup and upkeep

| Feature | What it does | Use it | Code |
| :--- | :--- | :--- | :--- |
| One-command setup | Repos, codecs, GPU video drivers, apps, Flatpaks, face/fingerprint login, then all desktop settings; safe to re-run, backs up system files, logs to `/var/log` | `sudo ./setup.sh` | `setup.sh` |
| Desktop sync | Applies every setting, extension, shortcut and tool for your user; snapshot before each run | `mk sync` | `sync.sh` |
| Hardware detection | Fingerprint reader, cameras (IR/RGB), GPU, battery, 2-in-1 sensors, weak hardware, login-screen display layout | `mk device` | `lib/mkworkstation/device.py`, `setup.sh` |
| Health check | Updates, codecs, GPU decoding, extensions, shortcut clashes, fingerprint, face unlock, timers | `mk doctor` | `bin/mk-doctor` |
| Update everything | Repo, newly listed apps, settings, extensions, system and Flatpak updates | `mk update` | `bin/mk` |
| Capture your changes | Apps you installed, extensions and settings saved into the repo | `mk save`, `mk export` | `bin/mk-apps`, `scripts/update-repo.sh` |
| Undo | Restore the settings snapshot before the last sync; remove MK from your account | `mk restore`, `mk uninstall` | `bin/mk` |
| Speaker tuning | EasyEffects profile for laptop speakers: high-pass, warmth, psychoacoustic bass, less harshness, slight widening, compressor, limiter | `mk sound on\|off` | `bin/mk-sound`, `assets/sound/` |
| App icons | Launchers and icons for MK's apps; your own image with one command | `mk icon APP IMAGE` | `assets/icons`, `assets/applications` |
| Effects profile | Heavy effects off on weak machines (auto) or on demand | `mk effects full\|lite\|auto` | `sync.sh`, `config/effects.conf` |
| Smart power (laptops) | Performance on AC, balanced on battery, power-saver when low; only switches on changes | `mk power` | `bin/mk-power`, `config/power.conf` |
| Face unlock wizard | Several face models in different light, IR-aware security, other users | `mk face` | `register-face.sh` |
| Fingerprint enrollment | Enroll, list, delete fingers; login, lock screen and sudo enabled by setup; a login notice when the reader has forgotten your finger | `mk fingerprint` | `bin/mk`, `setup.sh`, `scripts/fingerprint-pam.sh` |
| Rename it | Your name in every MK window, notification and the top-bar tag | `mk rename "Name" TAG` | `config/brand.conf` |
| Daily update check | Notifies when this repo has a new version | automatic | `mk-update-check.timer` |

### Apps

| App | What it does | Open it |
| :--- | :--- | :--- |
| **MK Notes** | The notes app, laptop and phone: quick capture from anywhere (Super+Ctrl+N); a folder of Markdown notes (`~/Notes`, opens in other Markdown apps too); edit, edit with live preview, or read; folders, pins, colours; a Tasks view of every checkbox; a daily-notes calendar; focus mode; your own theme, font, size, line length and spacing; `[[links]]`, backlinks, outline, graph view; #tags; checklists, callouts, tables; quick switcher and command palette; daily notes and templates; paste or capture screenshots, drop files; pen, highlighter and eraser with pressure (stylus, finger or mouse) on plain, lined, grid or dotted paper; PDF export; publish the vault as a website; version history; phone app with encrypted Wi-Fi sync (browser or Android app); foldable callouts, PDF previews, coloured code | Super+N, `mk notes`, [docs/NOTES.md](NOTES.md) |
| **Shortcuts window** | Every shortcut and gesture, live from GNOME; marks each working, clashing, unset or broken; change keys, add commands, reset | Super+/ |
| **Companion** | Notes you pin, reorder and fold; tasks with progress; reminders (in N min, at a time, daily/weekly) that fire even when closed; morning brief; welcome greeting editor | Super+Shift+N |
| **Focus timer** | Type a time (`25`, `1:30`, `90s`) and press Enter, or pick a preset; hides into a top-bar countdown; step away and one of the screensaver scenes plays with a small countdown (or the classic Aurora with the big ring; Surprise me never repeats the last one); can silence notifications; pixel-robot celebration with fireworks and a sound of your choice (Chime, Bell, Soft, Alarm clock or Silent) | Companion › Focus timer, `mk focus 25` |
| **Screensaver** (`mk-screensaver`) | Plays a full-screen scene after a few idle minutes (3 by default), chosen in the Screensaver app from live previews or shuffled (never the same twice running): Web Hang (a brick-built masked hero hanging from a web beside a skyscraper), Night Watch (a brick-built caped knight on a gargoyle in the rain, rim-lit by a searchlight), Terminal Stream (hex code rain in cyan and amber decoding the time) or Aurora; never over a video or call; any touch ends it; GNOME still locks at its own time | `mk screensaver`, `config/screensaver.conf` |
| **Tour** (`mk-tour`) | A 15-page walkthrough of the top bar, windows, desktops, shortcuts, Notes, Companion, screensaver, sign-in (from your hardware: enroll a finger, set up one or two faces), locks and vault, Photo Booth, emoji, security and the `mk` command, each with a button to try it; shown once at the first login | Super+Shift+/, `mk tour`, app grid |
| **App and folder locks** (`mk-lock`) | Apps that ask for your fingerprint or password before they start; folders encrypted with gocryptfs that open only after the same check and close when the screen locks; an optional password of each item's own; Vault, a hidden encrypted folder | `mk lock app NAME`, `mk lock ~/Folder`, `mk vault`, Files › Scripts |
| **Security check** (`mk-security`) | A 0-100 score with colour-coded findings: SELinux, firewall, Secure Boot, disk encryption, waiting and automatic security updates, accounts, SSH, listening servers, home permissions, file sharing, screen lock, remote desktop, and rkhunter, chkrootkit, ClamAV and Lynis; one-line fixes | `mk security`, `mk security fix NAME` |
| **Accounts** (`mk-users`) | A second person's account that gets the MK desktop at their first login; a Guest login with no password that starts empty every time | `mk users add NAME`, `mk guest on` |
| **OCR snip** | Pick a screen area, get its text in the clipboard | Super+Shift+C |
| **Photo Booth** (`camera-controls`) | Your webcam with live looks (Polaroid with a caption frame, Flash, Instant 600, Film, Thermal, Pop Art, Noir, Retro, Comic, Neon, Mirror, Dreamy, Vignette, Hue Shift, Distort), G for nine looks at once (3 x 3, live), a 3-2-1 countdown, then text and colour-emoji stickers you can move, resize from the corners, turn (live degree readout) and stack, and a date stamp (90s digital, typewriter, handwritten); the webcam's hardware sliders with Reset to hardware defaults; photos in ~/Pictures/MK Booth | Super+C |
| **Terminal capture** | Add notes and tasks with reminders without opening anything | `mk note`, `mk task`, `mk remind`, `mk list` |
| **Spoken greeting** | Calm British "JARVIS-style" voice for the welcome (espeak-ng, or the natural Piper voice) | `mk welcome voice install` |

### Desktop touches (the `mk-indicator` GNOME Shell extension)

| Feature | What you see | Settings |
| :--- | :--- | :--- |
| Welcome light | After login, when the desktop is ready and the processor has calmed down: two comets of light run up the screen edges and meet at the top, the greeting lands with them (optionally spoken) and is different each time (time of day, Monday/Friday/weekend, your birthday, the first start of a new day, starting again the same day, long time no see, or your own lines), and underneath: the date, your pinned tasks, your next reminder today, a birthday countdown once a day and a low-battery hint; pinned tasks then get a notification with an Open button | Quick Settings › Welcome light, `mk welcome`, `config/welcome.conf` |
| Dock magnification | The icon under the pointer grows, neighbours follow in a wave | `config/dock.conf` |
| App-coloured dock glow | A soft circular tint in each app's own colour on hover | `dockGlow.js` |
| System monitor | CPU sparkline and your chosen numbers in the top bar; a menu with processor, memory, swap, GPU, disk, temperatures, battery draw and time left, the busiest apps, and an Internet section: active connection, live traffic graph and an on-demand speed test (ping, download, upload on a gauge, against Cloudflare's servers); reads the kernel's counters every 2 s, nothing while locked | `config/monitor.conf` (`systemMonitor.js`, `speedTest.js`) |
| Emoji board | Super+.: search or browse by category, recent picks first; the emoji is typed where your cursor is (through GNOME's input method, or pasted for apps that don't take it) | `emojiBoard.js`, `emoji.json` |
| Task badge | A small "2 Tasks" pill in the top bar: Companion tasks that are pinned or due today; click for the Companion's tasks, right-click to hide; the spoken greeting adds "You have 2 tasks scheduled for today." | `TASK_BADGE=`, `BRIEFING=` in `config/welcome.conf`, `mk tasks badge on\|off` |
| App Nap | Under memory (> 85%) or sustained CPU (> 90% for a minute) pressure, apps unused for 5 minutes with every window minimized or on another desktop are frozen (systemd cgroup freezer); focusing one wakes it instantly. Never: apps playing sound, terminals, editors, browsers, chat apps | `config/appnap.conf`, `mk nap` |
| Lock-screen scene | The chosen screensaver scene behind the lock screen's clock; Space, a click or a swipe slides it up to the password and fingerprint prompt; it stops drawing while the prompt is up or the screen is off | `LOCKSCREEN=` in `config/screensaver.conf` (`lockScene.js`) |
| Timer countdown | Ring + time in the top bar while a focus timer runs; click to open | automatic |
| Media tile | Spotify or any MPRIS player: album art spinning like a record and the song title (cut short with "…", never scrolling) in the top bar; a menu with the art glowing in its own colour, title and artist, seek bar, previous/play/next, More (album, player, which speakers or headphones to use) and Open player, which brings the player's window forward; fades out when playback stops | `config/media.conf` (`mediaTile.js`) |
| Wallpaper accent | The most vivid colour of your wallpaper tints Alt+Tab, the calendar, top-bar and dock hover, workspace thumbnails, the welcome line, the timer ring and GNOME's own accent (Files, Settings); follows wallpaper changes | `mk accent auto\|#hex\|status`, `config/theme.conf` (`accent.js`, `colour.js`) |
| Window switcher | Alt+Tab and the 3-finger swipe open a compact card in the middle of the screen (not full screen) with live window previews, app icons, titles and which desktop each is on; it appears at once, without GNOME's 150 ms wait or any fade; an accent ring marks the selection; hover selects, click opens; 1–9 sends the selected window to that desktop | automatic (`windowGrid.js`, `switcher.js`) |
| Calendar styling | Round day cells with an accent-coloured hover glow, glowing today, softer other-month days | `stylesheet.css` |
| Pop-ups that don't collide | Workspace dots glide above the volume/brightness pop-up when both show | `osdStack.js` |
| Dock out of the way | Hidden in the overview so window titles stay readable, and hidden again right after unlocking or waking, until you push the pointer against the bottom edge | automatic |
| Blur fix | Rebuilds the top-bar blur once after login so it always shows | automatic |
| Top-bar tag | Your short tag (MK), following `mk rename` live | `config/brand.conf` |

Outside the shell: **Files** gets matching hover and selection in the accent colour (`config/gtk/files.css`, kept in a marked block of `~/.config/gtk-4.0/gtk.css`).

### Fixes MK applies to other people's code

| Extension | Problem on GNOME 50 | Fix |
| :--- | :--- | :--- |
| WACK Shell | Hundreds of errors per session from `super.vfunc_event()`; dock snapshot errors on every dock move | Patched by `sync.sh` (bundled copy, GPL-3.0) |
| Magic Lamp | Played its genie even when a gesture already animated the window (stutter) | Patched by `sync.sh` to honour GNOME's skip-effect request |
| Touchpad Gesture Customization | Finger travel per window in 3-finger Alt+Tab shrank as more windows opened, so small moves skipped windows | Patched by `sync.sh`: the same travel per window, always |
| Six animation and gesture extensions | Rebuilt at every unlock (a hitch, gestures dead for a moment) | `sync.sh` marks them for the lock screen too ([why it's safe](EXTENSIONS.md#smoother-unlock)) |

---

## Configured by MK

### GNOME (built into Fedora)

MK changes these GNOME settings; the features themselves are GNOME's.

- **Windows:** Alt+Tab across all workspaces, Super+Tab apps, Alt+` windows of one app, W/F4 in Alt+Tab closes a window, Q in Super+Tab quits an app, minimize and maximize buttons, centred new windows, always on top, full screen, 20 s before "not responding".
- **Workspaces:** dynamic workspaces (Spaces style), new desktop on Super+Ctrl+D, Super+Alt/Ctrl arrows.
- **Screenshots:** full screen, window and area keys (Print, Super+Shift+3/4/S), saved and copied.
- **Files:** expandable folders, folders first, item counts, Create Link, Delete Permanently, Quick Look (Space, via Sushi).
- **Comfort:** tap to click, natural scrolling, palm rejection that lets go 300 ms after typing, Bibata Modern Classic cursor (GPL-3.0, `CURSOR=` in `theme.conf`), battery percentage, weekday in the clock, Night Light, hot corner, dark style.
- **Housekeeping:** Trash and temp files older than 30 days removed; slow search providers (Boxes, Contacts, Passwords) skipped.
- **Login screen:** uses your display layout (no flicker between login and desktop).
- **Firefox and Zen** (`config/browser/user.js`): two-finger swipe back/forward, momentum scrolling with a gentle bounce, pinch zoom, GPU rendering and video decoding.
- **Speaker tuning:** warm bass the speakers can play, clear voices, smooth treble; EasyEffects starts hidden.

### GNOME extensions (from extensions.gnome.org)

Installed for your GNOME version and restored with MK's settings.

| Extension | By | What MK uses it for |
| :--- | :--- | :--- |
| [Dash to Dock](https://extensions.gnome.org/extension/307/dash-to-dock/) | michele_g | The dock: auto-hide, taskbar clicks, running-app dots in app colour |
| [Blur my Shell](https://extensions.gnome.org/extension/3193/blur-my-shell/) | aunetx | Blurred top bar and dock |
| [Tiling Assistant](https://extensions.gnome.org/extension/3733/tiling-assistant/) | Leleat | Windows-style snapping, quarters, Snap Assist, Super+Z layouts |
| [Touchpad Gesture Customization](https://extensions.gnome.org/extension/7850/touchpad-gesture-customization/) | Henry | 3/4-finger gestures for windows, workspaces, overview, volume, desktop |
| [Clipboard Indicator](https://extensions.gnome.org/extension/779/clipboard-indicator/) | Tudmotu | Clipboard history on Super+V |
| [OCR Text Extractor](https://extensions.gnome.org/extension/8240/text-extractor/) | imshaaz | Copy text from the screen (Super+Alt+T) |
| [Caffeine](https://extensions.gnome.org/extension/517/caffeine/) | eon | Keep the screen awake |
| [Transparent Top Bar](https://extensions.gnome.org/extension/3960/transparent-top-bar-adjustable-transparency/) | Gonzague | Clear top bar when no window touches it |
| [AppIndicator Support](https://extensions.gnome.org/extension/615/appindicator-support/) | 3v1n0 | Tray icons for apps like Spotify and Zapzap |
| [Places Status Indicator](https://extensions.gnome.org/extension/8/places-status-indicator/) | fmuellner | Places menu in the top bar |
| [Impatience](https://extensions.gnome.org/extension/277/impatience/) | gfxmonk | Animations 25% faster |
| [Compiz alike magic lamp effect](https://extensions.gnome.org/extension/3740/compiz-alike-magic-lamp-effect/) | hermes83 | macOS genie minimize |
| [Compiz windows effect](https://extensions.gnome.org/extension/3210/compiz-windows-effect/) | hermes83 | Wobbly windows while dragging |
| [Burn My Windows](https://extensions.gnome.org/extension/4679/burn-my-windows/) | Simon Schneegans | Soft glide when windows open and close |
| [WACK - Sonoma Lockscreen](https://extensions.gnome.org/extension/9713/wack-sonoma-lockscreen/) | rinzler69 | macOS-style lock screen clock |
| WACK Shell | rinzler69 | Logo menu and macOS touches (bundled, patched; see THIRD_PARTY.md) |

### System services

| Service | By | Used for |
| :--- | :--- | :--- |
| Howdy | boltgolt and contributors (COPR `principis/howdy`) | Face unlock |
| fprintd / libfprint | freedesktop.org | Fingerprint login |
| tuned-ppd (power profiles) | Red Hat / freedesktop.org | Smart power switching |
| RPM Fusion, ffmpeg, VA-API drivers | RPM Fusion, FFmpeg, Mesa, Intel, NVIDIA | Full codecs and GPU video decoding |
| Flatpak / Flathub | Flatpak, Flathub | Sandboxed apps |
| espeak-ng, Piper, sox | espeak-ng, Rhasspy, SoX | The spoken greeting |
| EasyEffects | Wellington Wallace and contributors | Speaker tuning profile |
| fwupd | LVFS | Firmware update check (never flashes on its own) |

---

## Installed by MK (apps)

From `apps/flatpaks.txt` (Flathub) and `apps/dnf-packages.txt` (Fedora / RPM Fusion). Add or remove lines to change them.

| App | What for |
| :--- | :--- |
| Zen Browser | Web browser (Super+B) |
| Joplin | Notes with sync |
| ONLYOFFICE | Office documents |
| Visual Studio Code | Code editor (Microsoft's repo) |
| Spotify | Music |
| ZapZap | WhatsApp |
| SonoBus | Low-latency audio between computers |
| Lutris, GameMode, Gamescope, MangoHud, vkBasalt | Gaming |
| Extension Manager | Browse and configure extensions |
| Frog | Grab text from images |
| Cameractrls, Kamoso, Guvcview | Webcam settings and capture |
| Flip Clock | Full-screen clock |
| Flameshot, Loupe | Screenshots with annotations; image viewer |
| EasyEffects | Audio equalizer and effects |
| Fedora Media Writer | Make bootable USB sticks |
| Distrobox, Android tools | Other Linux distros in containers; adb/fastboot |
| btop, fastfetch, ncdu, ripgrep, fzf, zoxide, just, chezmoi, 7zip, unrar | Terminal tools |
| GNOME Tweaks, Characters, Sushi | Extra GNOME settings, emoji, Quick Look |
| Tesseract, zenity, wl-clipboard, playerctl, brightnessctl, v4l-utils | Used by MK's own tools |
| GStreamer plugins (bad-freeworld, ugly, libav, openh264) | Media playback |
| gcc, make, python3-pip, Node.js | Development basics |
| espeak-ng, sox | The spoken greeting |

---

## Commands

| Command | Does |
| :--- | :--- |
| `mk update [--check] [--no-upgrade]` | Update everything |
| `mk save` · `mk export` | Capture what you added into the repo |
| `mk sync` · `mk restore` | Re-apply settings · undo the last sync |
| `mk doctor` · `mk device` | Health check · hardware report |
| `mk face` · `mk fingerprint` | Face unlock wizard · fingerprint enrollment |
| `mk shortcuts` | Shortcuts window |
| `mk note` · `mk task` · `mk remind` · `mk list` | Companion from the terminal |
| `mk focus [25 \| 1:30 \| 90s] ["label"]` | Start the focus timer |
| `mk welcome on\|off\|test\|edit\|title\|greeting\|voice\|notify` | The welcome light and greeting |
| `mk power [status\|on\|off]` | Smart power profiles |
| `mk effects [full\|lite\|auto]` | Visual effects profile |
| `mk sound on\|off\|status` | Laptop speaker tuning |
| `mk notes [today \| serve \| NOTE]` | MK Notes; `serve` = phone sync without the window |
| `mk icon APP IMAGE\|reset` · `mk icon list` | Your own app icons |
| `mk accent auto\|#hex\|status` | Accent colour from the wallpaper, or fixed |
| `mk screensaver` · `on\|off\|show\|scene\|delay` | The Screensaver settings window (live previews, Shuffle) · scenes from the terminal |
| `mk welcome variety\|birthday\|lines` | A different greeting each time; your birthday; your own lines |
| `mk fingerprint check` | Why the reader might not answer on the lock screen |
| `mk lock app NAME` · `mk lock ~/Folder` · `mk unlock` | Fingerprint before an app starts · an encrypted folder |
| `mk users add NAME` · `mk guest on\|off` | Another person's account · a Guest login that starts empty |
| `mk speedtest` · `mk nap` · `mk keyring` | Speed test in the terminal · what App Nap paused · why apps ask for the keyring |
| `mk security` · `mk security fix NAME` | Security check with a score · apply one fix |
| `mk vault` · `mk lock password set app NAME \| folder PATH` | Your hidden encrypted folder · an item's own password |
| `mk power comfort\|quiet\|performance` · `mk optimize ram\|cpu` | Power mode · free cached memory or full speed |
| `mk tour` | The walkthrough again |
| `mk rename "Name" TAG` | Rename it |
| `mk uninstall` | Remove MK from your account |
| `just setup \| sync \| face \| export \| update \| save \| check \| overview \| screenshots` | The same for contributors |

Every option of every command: [REFERENCE.md](REFERENCE.md).

---

## Keyboard shortcuts

Generated from [`config/shortcuts.conf`](../config/shortcuts.conf). "Built by"
says whose action it is; the keys are MK's choice either way. Super+/ shows
them live and lets you change any of them.

**Windows**

| Action | Keys | Built by |
| :--- | :--- | :--- |
| Switch windows (all workspaces) | Alt+Tab | GNOME |
| Switch apps | Super+Tab | GNOME |
| Switch windows of this app | Alt+` · Super+` | GNOME |
| Close window | Super+Q · Alt+F4 | GNOME |
| Snap left half | Super+Left | Extension |
| Snap right half | Super+Right | Extension |
| Maximize | Super+Up | Extension |
| Restore | Super+Down | Extension |
| Snap layouts | Super+Z | Extension |
| Center window | Super+Ctrl+C | Extension |
| Always on top | Super+Ctrl+T | GNOME |
| Full screen | Super+Ctrl+F | GNOME |
| Show desktop | Super+D | GNOME |

**Workspaces**

| Action | Keys | Built by |
| :--- | :--- | :--- |
| Previous workspace | Super+PageUp · Super+Alt+Left · Super+Ctrl+Left | GNOME |
| Next workspace | Super+PageDown · Super+Alt+Right · Super+Ctrl+Right | GNOME |
| New desktop | Super+End · Super+Ctrl+D | GNOME |
| Move window left | Super+Shift+PageUp · Super+Shift+Alt+Left | GNOME |
| Move window right | Super+Shift+PageDown · Super+Shift+Alt+Right | GNOME |
| Move window to a new desktop | Super+Shift+End · Super+Ctrl+Shift+D | GNOME |
| Go to workspace 1 | Super+Alt+1 | GNOME |
| Go to workspace 2 | Super+Alt+2 | GNOME |
| Go to workspace 3 | Super+Alt+3 | GNOME |
| Go to workspace 4 | Super+Alt+4 | GNOME |
| Move window to workspace 1 | Super+Shift+Alt+1 | GNOME |
| Move window to workspace 2 | Super+Shift+Alt+2 | GNOME |
| Move window to workspace 3 | Super+Shift+Alt+3 | GNOME |
| Move window to workspace 4 | Super+Shift+Alt+4 | GNOME |

**Screenshots**

| Action | Keys | Built by |
| :--- | :--- | :--- |
| Full screen, instantly | Print · Super+Shift+3 | GNOME |
| Current window | Alt+Print | GNOME |
| Pick an area or window | Shift+Print · Super+Shift+S · Super+Shift+4 | GNOME |
| Copy text from screen (OCR) | Super+Shift+C | MK tool |
| Copy text (Text Extractor) | Super+Alt+T | Extension |

**System**

| Action | Keys | Built by |
| :--- | :--- | :--- |
| Search / overview | Super+S | GNOME |
| App grid | Super+A | GNOME |
| Quick settings | Super+Shift+A | GNOME |
| Notifications | Super+M | GNOME |
| Clipboard history | Super+V | Extension |
| Run a command | Alt+F2 · Super+R | GNOME |
| Files | Super+E | GNOME |
| Settings | Super+I | GNOME |
| Shut down / restart menu | Super+Backspace · Super+Shift+X | GNOME |
| Shut down (asks first) | Ctrl+Alt+End | GNOME |
| Restart (asks first) | Ctrl+Alt+Home | GNOME |
| Sleep | Ctrl+Alt+Page Down | GNOME |
| System Monitor | Ctrl+Shift+Esc | App |

**Apps**

| Action | Keys | Built by |
| :--- | :--- | :--- |
| Shortcuts (this window) | Super+/ | MK tool |
| Companion: notes, tasks, timer | Super+Shift+N | MK tool |
| Terminal | Ctrl+Alt+T | App |
| Web browser | Super+B | App |
| MK Notes | Super+N | MK tool |
| MK Notes: today's note | Super+Alt+N | MK tool |
| Emoji board (types the emoji for you) | Super+. | MK |
| Photo Booth | Super+C | MK tool |

**Touchpad gestures** (Touchpad Gesture Customization, MK's settings)

| Gesture | Does |
| :--- | :--- |
| 4 fingers ←/→ | Switch workspace |
| 3 fingers ←/→ | Switch window, on every workspace |
| 3 fingers ↑ | Overview |
| 4 fingers ↑/↓ | Maximize / restore |
| 3-finger pinch · 4-finger pinch | Volume · show desktop |
