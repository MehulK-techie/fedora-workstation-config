# Extensions Guide

MK Workstation enables 15 GNOME extensions plus its own small top-bar mark, and restores each one **with its saved settings**. This guide shows what each does and how to change it, whether you prefer clicking or the terminal.

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
| **Dash to Dock** | A dock at the bottom of the screen | Bottom, icon size 38, hides when a window touches it (intellihide), shows only apps on the current workspace and monitor, click minimizes, scroll cycles windows, 30% background | Right-click the dock's *Show Apps* button › *Dash to Dock Settings* |
| **Astra Monitor** | Live CPU, GPU, memory, disk, network and sensor readings in the top bar | Order: processor, GPU, memory, storage, network, sensors; dark theme | Click the monitor in the top bar › ⚙, or Extension Manager ⚙ |
| **Clipboard Indicator** | Clipboard history | Open it with **Super+V** | Click the clipboard icon › *Settings* |
| **Touchpad Gesture Customization** | macOS-style touchpad gestures | 3 fingers ←/→ switch workspaces, 3 fingers ↑ overview, 4 fingers ←/→ switch windows, 3-finger pinch volume, 4-finger pinch show desktop | Extension Manager ⚙ |
| **Transparent Top Bar** | Top bar turns transparent when no window touches it | GNOME default behaviour | Extension Manager ⚙ |
| **WACK Shell** | macOS-style touches: logo menu, app menu, rounded look | Custom logo with menu and label, app menu shown, no bottom bar, desktop scroll on | Extension Manager ⚙ |
| **WACK Lockscreen Clock** | A styled clock and wallpaper on the lock screen | "WACK" style, full date, fade animations, Esc puts the screen to sleep | Extension Manager ⚙ |
| **Text Extractor** | Select any area of the screen and copy its text (OCR inside GNOME) | **Super+Alt+T**; no top-bar icon | Extension Manager ⚙ |
| **AppIndicator Support** | Shows tray icons for apps like Spotify, ZapZap, Lutris and Steam (the Windows system tray / macOS menu-bar icons) | GNOME default | Extension Manager ⚙ |
| **Caffeine** | A coffee-cup toggle in Quick Settings that keeps the screen awake (like PowerToys Awake or Amphetamine) | GNOME default | Click the toggle in Quick Settings |
| **Tiling Assistant** | Windows-style split screen: snap halves and quarters, Snap Assist offers your other windows for the free space, snapped windows raise together, snap layouts | Super+←/→ halves; then Super+↑/↓ for quarters; **Super+Z** layouts; Super+Ctrl+C centre; no animations | Extension Manager ⚙ (layouts: *Layouts* tab, saved in `~/.config/tiling-assistant/layouts.json`) |
| **Impatience** | Speeds up every GNOME animation for a snappier, macOS-like feel | Speed factor 0.75 (25% faster); 1.0 is GNOME's normal speed | Extension Manager ⚙ |
| **Magic Lamp** | macOS genie effect when minimizing into the dock | 350 ms (default 500) | Extension Manager ⚙ |
| **Places Status Indicator** | Top-bar menu for Home, Downloads, drives and network places | GNOME default | (no settings) |
| **MK Workstation Indicator** | A faint **MK** mark in the top bar that brightens on hover, plus the MK Alt+Tab theme (frosted navy panel, cyan highlight on the selected window) | — | Switch off in Extension Manager to remove it |

The MK desktop also has its own OCR tool on **Super+Shift+T**, separate from Text Extractor. Use whichever you prefer.

---

## Keep it smooth

Extensions run inside GNOME Shell, so a heavy or broken one can make the whole desktop stutter.

| If you notice… | Try |
| :--- | :--- |
| Stutter when opening the overview or app grid | Blur my Shell › keep **static blur** on (MK default) and leave overview blur off |
| Top bar CPU use | Astra Monitor › increase the update interval, or hide graphs you don't need |
| Desktop feels slow after a GNOME upgrade | Run `mk doctor`; disable anything it reports as ERROR or OUTDATED |
| Not sure which extension is the cause | Turn them all off with the main switch in Extension Manager, then enable them one at a time |

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
