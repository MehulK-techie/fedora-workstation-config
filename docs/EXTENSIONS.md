# Extensions Guide

MK Workstation enables 16 GNOME extensions plus its own small top-bar mark, and restores each one **with its saved settings**. This guide shows what each does and how to change it, whether you prefer clicking or the terminal.

- **Everyone:** [Change an extension in 30 seconds](#change-an-extension-in-30-seconds) · [The extensions](#the-extensions) · [Keep it smooth](#keep-it-smooth)
- **Tech-savvy:** [How syncing works](#how-syncing-works) · [Command-line tweaking](#command-line-tweaking) · [Add or remove an extension](#add-or-remove-an-extension)

---

## Change an extension in 30 seconds

1. Open **Extension Manager** (press Super, type *Extension Manager*).
2. On the **Installed** tab, find the extension and click its **⚙ gear** to open its settings.
3. Change what you like. It applies immediately.
4. Want to keep the change on other computers or after a reinstall? Run `mk export` in a terminal (see [How syncing works](#how-syncing-works)).

To switch an extension off, use the toggle next to it in Extension Manager. `mk doctor` lists any extension that is broken on your GNOME version.

---

## The extensions

| Extension | What it does | MK settings | Where to change it |
| :--- | :--- | :--- | :--- |
| **Blur my Shell** | Frosted-glass blur on the top bar, dock and app grid | Static blur on panel, dock and app folders (fast); blur off in the overview and lock screen; strength 16, brightness 0.75 | Extension Manager ⚙ |
| **Dash to Dock** | A dock at the bottom of the screen | Bottom, icon size 38, hidden until you push the pointer against the bottom edge (autohide; also right after unlocking or waking) and hidden in the overview (mk-indicator fades it out there so window titles stay readable), shows only apps on the current workspace and monitor, a dot under running apps, click focuses / minimizes / shows window thumbnails like the Windows taskbar, middle-click opens a new window, scroll cycles windows, 30% background | Right-click the dock's *Show Apps* button › *Dash to Dock Settings* |
| **Clipboard Indicator** | Clipboard history | Open it with **Super+V** | Click the clipboard icon › *Settings* |
| **Touchpad Gesture Customization** | macOS-style touchpad gestures | 4 fingers ←/→ switch workspaces (medium speed: `touchpad-speed-scale=1.25`, a desktop per 80% of the pad, momentum from GNOME's swipe tracker), 3 fingers ←/→ switch windows on every workspace, 3 fingers ↑ overview, 4 fingers ↑/↓ maximize / restore, 3-finger pinch volume, 4-finger pinch show desktop; Alt+Tab takes the swipe from the first moment (`alttab-delay=0`), and `sync.sh` patches it so every window takes the same finger travel however many are open | Extension Manager ⚙ |
| **Transparent Top Bar** | Top bar turns transparent when no window touches it | GNOME default behaviour | Extension Manager ⚙ |
| **WACK Shell** | macOS-style touches: logo menu, app menu, rounded look | Custom logo with menu and label, app menu shown, no bottom bar, desktop scroll on | Extension Manager ⚙ |
| **WACK Lockscreen Clock** | A styled clock and wallpaper on the lock screen | "WACK" style, full date, fade animations, Esc puts the screen to sleep | Extension Manager ⚙ |
| **Text Extractor** | Select any area of the screen and copy its text (OCR inside GNOME) | **Super+Alt+T**; no top-bar icon | Extension Manager ⚙ |
| **AppIndicator Support** | Shows tray icons for apps like Spotify, ZapZap, Lutris and Steam (the Windows system tray / macOS menu-bar icons) | GNOME default | Extension Manager ⚙ |
| **Caffeine** | A coffee-cup toggle in Quick Settings that keeps the screen awake (like PowerToys Awake or Amphetamine) | GNOME default | Click the toggle in Quick Settings |
| **Tiling Assistant** | Windows-style split screen: snap halves and quarters, Snap Assist offers your other windows for the free space, snapped windows raise together, snap layouts | Super+←/→ halves; then Super+↑/↓ for quarters; **Super+Z** layouts; Super+Ctrl+C centre; no animations | Extension Manager ⚙ (layouts: *Layouts* tab, saved in `~/.config/tiling-assistant/layouts.json`) |
| **Impatience** | Speeds up every GNOME animation for a snappier, macOS-like feel | Speed factor 0.75 (25% faster); 1.0 is GNOME's normal speed | Extension Manager ⚙ |
| **Magic Lamp** | macOS genie effect when minimizing into the dock | 350 ms (default 500). `sync.sh` patches it to skip the genie when a gesture already animates the window (4-finger pinch), which removes a double animation that stuttered | Extension Manager ⚙ |
| **Burn My Windows** | Window open and close effects | One subtle effect, *Glide*: windows scale in and out in 220 ms. Stored as the high-priority profile `~/.config/burn-my-windows/profiles/mk-glide.conf` (from `config/burn-my-windows-profile.conf`); `sync.sh` rewrites it, so make your own profile in its settings instead of editing this one | Extension Manager ⚙ |
| **Places Status Indicator** | Top-bar menu for Home, Downloads, drives and network places | GNOME default | (no settings) |
| **MK Workstation Indicator** (`mk-indicator`, made for MK) | The **MK** mark in the top bar, and: the accent colour taken from your wallpaper; the window switcher (a compact card of live windows); the system monitor with an internet speed test; the media tile for Spotify and other players; the welcome light with a different greeting each time and your pinned tasks; dock glow in each app's colour and magnification; the focus-timer countdown; workspace dots that don't collide with the volume pop-up | `config/theme.conf`, `welcome.conf`, `greetings.conf`, `dock.conf`, `monitor.conf`, `media.conf` (`mk accent`, `mk welcome`) | Switch off in Extension Manager to remove it |

The MK desktop also has its own OCR tool on **Super+Shift+T**, separate from Text Extractor. Use whichever you prefer.

---

## Keep it smooth

Extensions run inside GNOME Shell, so a heavy or broken one can make the whole desktop stutter.

| If you notice… | Try |
| :--- | :--- |
| Stutter when opening the overview or app grid | Blur my Shell › keep **static blur** on (MK default) and leave overview blur off |
| Top bar CPU use | MK's system monitor reads a handful of kernel files every 2 s; set `INTERVAL=5` in `~/.config/mk-workstation/monitor.conf` if you want it even lighter |
| Desktop feels slow after a GNOME upgrade | Run `mk doctor`; disable anything it reports as ERROR or OUTDATED |
| Not sure which extension is the cause | Turn them all off with the main switch in Extension Manager, then enable them one at a time |

### Smoother unlock

GNOME switches off every extension that isn't made for the lock screen when you lock, and builds them all again as you unlock; that rebuild is the hitch you see as the lock screen slides away, and why gestures don't answer for a moment after. `sync.sh` keeps six of them loaded while locked: Impatience, Burn My Windows, Wobbly Windows, Magic Lamp, Touchpad Gesture Customization and Transparent Top Bar. These only animate windows or the top bar. The gestures only act on the normal desktop and overview (`Shell.ActionMode.NORMAL`/`OVERVIEW`), never on the lock screen. That was checked in the extension's code, and an update could change it, so `mk sync` is where to look if a gesture ever does something on the lock screen. Clipboard Indicator and Text Extractor are not kept: they would work on the lock screen. MK's own system monitor hides itself while locked.

---

## Split screen and snap layouts

| Do this | Result |
| :--- | :--- |
| `Super+←` or `Super+→` | Window takes the left or right half. Snap Assist then shows your other windows: click one to fill the other half. |
| `Super+←`, then `Super+↑` (or `↓`) | Window takes the top-left (or bottom-left) quarter. Same on the right. |
| Drag a window to a screen edge or corner | Half or quarter, with a preview |
| `Super+Z` | Pick a layout, then a window for each part: Halves, Main + side (66/34), Three columns, Left + two stacked, Four quarters, Focus centre |
| Click one window of a snapped group | The whole group comes to the front |

The six MK layouts live in `config/tiling-layouts.json` and are installed only if you haven't made your own. Edit them in Extension Manager › Tiling Assistant ⚙ › *Layouts*.

---

## How syncing works

```text
config/enabled-extensions.txt      which extensions to install and enable
config/extension-settings/*.dconf  each extension's saved settings (one file per extension)
```

- **`mk sync`** (or `./sync.sh`) installs any missing extension from extensions.gnome.org, choosing the build for your GNOME version. It falls back to a copy in `extensions/` when you're offline or the site has no compatible build. It then enables everything in the list and loads the saved settings. Saved settings are applied last, so they win over MK defaults. Extensions you enabled yourself stay enabled.
- **`mk export`** writes your **current** working extensions and their settings back into those files. Extensions in an ERROR or OUTDATED state are skipped. Home-folder paths become `__USER_HOME__`, and machine-specific values such as disk IDs are left out. Commit the result to keep it.

---

## Command-line tweaking

Each settings file starts with the dconf folder it belongs to, for example:

```ini
# dconf path: /org/gnome/shell/extensions/dash-to-dock/
[/]
dash-max-icon-size=38
```

**Change a value now**, for example the dock icon size:

```bash
dconf write /org/gnome/shell/extensions/dash-to-dock/dash-max-icon-size 48
```

**Find which key a setting uses:** run `dconf watch /org/gnome/shell/extensions/` and change the setting in the extension's settings window. The key and its new value are printed.

**Read or reset an extension's settings:**

```bash
dconf dump  /org/gnome/shell/extensions/blur-my-shell/    # show all
dconf reset -f /org/gnome/shell/extensions/blur-my-shell/ # back to defaults
```

**Use `gsettings` with type checking.** User-installed extensions keep their schema in their own folder:

```bash
EXT=~/.local/share/gnome-shell/extensions/blur-my-shell@aunetx
gsettings --schemadir "$EXT/schemas" list-recursively org.gnome.shell.extensions.blur-my-shell
```

**Make a change permanent for the repo:** edit the matching file in `config/extension-settings/`, or change it live and run `mk export`. Then commit.

---

## Add or remove an extension

**Add:** install it with Extension Manager and enable it, tune its settings, then run `mk export`. It is added to `config/enabled-extensions.txt` together with its settings. Alternatively, add its UUID (shown in Extension Manager's details) as a new line in that file and run `mk sync`.

**Remove:** delete its line from `config/enabled-extensions.txt` and its file from `config/extension-settings/`, then switch it off in Extension Manager. `mk sync` never disables extensions, so turning one off is up to you.

**Useful commands:**

```bash
gnome-extensions list --enabled          # what's on
gnome-extensions info <uuid>             # version, state, location
gnome-extensions prefs <uuid>            # open its settings window
gnome-extensions disable <uuid>          # switch one off
```

---

## Other installed extensions

These are on the reference machine but not part of the MK set. Enable them in Extension Manager if you like, then `mk export`.

| Extension | What it does |
| :--- | :--- |
| Burn My Windows | Animated window open and close effects |
| Compiz Windows Effect | Wobbly windows |
| Just Perfection | Hide or resize parts of the GNOME interface |
| Quick Settings Tweaks | Extra quick-settings controls (GNOME 48 only; doesn't load on GNOME 50) |
| Screenshot OCR | Superseded by Text Extractor (doesn't load on GNOME 50) |
