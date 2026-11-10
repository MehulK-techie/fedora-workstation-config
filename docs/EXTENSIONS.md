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
| **Blur my Shell** | Frosted-glass blur on the top bar, dock and app grid | On (sync.sh switches it on when installed). Top bar: dynamic blur (`static-blur` false) with its background overridden dynamically (`override-background`, `override-background-dynamically`, `style-panel` 0), so the bar is see-through glass over the desktop and solid over a window; static blur on app folders, and none for Dash to Dock (MK's dock isn't Dash to Dock: that pass only left a rectangle of blurred still wallpaper); blur off in the overview and lock screen; strength 16, brightness 0.75 | Extension Manager ⚙ |
| **Dash to Dock** | A dock at the bottom of the screen | Bottom, icon size 38, out of the way of windows: it steps aside when a window covers its spot (intellihide) and comes back when you push the pointer against the bottom edge (autohide); mk-indicator re-checks it right after login, unlock and waking, so it never stays up over a window and hidden in the overview (mk-indicator fades it out there so window titles stay readable), shows only apps on the current workspace and monitor, a dot under running apps, click focuses / minimizes / shows window thumbnails like the Windows taskbar, middle-click opens a new window, scroll cycles windows, 30% background | Right-click the dock's *Show Apps* button › *Dash to Dock Settings* |
| **Touchpad Gesture Customization** | macOS-style touchpad gestures | 4 fingers ←/→ switch workspaces (deliberate: `touchpad-speed-scale=0.85`, one desktop per swipe however fast the flick, settling in at least 300 ms; `sync.sh` patches the extension for that), 3 fingers ←/→ switch windows on every workspace, 3 fingers ↑ overview, 4 fingers ↑/↓ maximize / restore, 3-finger pinch volume, 4-finger pinch show desktop; Alt+Tab takes the swipe from the first moment (`alttab-delay=0`), and `sync.sh` patches it so every window takes the same finger travel however many are open | Extension Manager ⚙ |
| **Transparent Top Bar** | Top bar turns transparent when no window touches it | GNOME default behaviour | Extension Manager ⚙ |
| **WACK Shell** | macOS-style touches: logo menu, app menu, rounded look | Custom logo with menu and label, app menu shown, no bottom bar, desktop scroll on | Extension Manager ⚙ |
| **WACK Lockscreen Clock** | A styled clock and wallpaper on the lock screen | "WACK" style, full date, fade animations, Esc puts the screen to sleep | Extension Manager ⚙ |
| **Text Extractor** | Select any area of the screen and copy its text (OCR inside GNOME) | **Super+Alt+T**; no top-bar icon | Extension Manager ⚙ |
| **AppIndicator Support** | Shows tray icons for apps like Spotify, ZapZap, Lutris and Steam (the Windows system tray / macOS menu-bar icons) | GNOME default | Extension Manager ⚙ |
| **Caffeine** | A coffee-cup toggle in Quick Settings that keeps the screen awake (like PowerToys Awake or Amphetamine) | GNOME default | Click the toggle in Quick Settings |
| **Tiling Assistant** | Windows-style split screen: snap halves and quarters, Snap Assist offers your other windows for the free space, snapped windows raise together | Super+←/→ halves; then Super+↑/↓ for quarters; Super+Ctrl+C centre; no animations; its own layout key is switched off (Super+Z is mk-indicator's snap layouts) | Extension Manager ⚙ |
| **Impatience** | Speeds up every GNOME animation for a snappier, macOS-like feel | Speed factor 0.75 (25% faster); 1.0 is GNOME's normal speed | Extension Manager ⚙ |
| **Magic Lamp** | macOS genie effect when minimizing into the dock | 350 ms (default 500). `sync.sh` patches it to skip the genie when a gesture already animates the window (4-finger pinch), which removes a double animation that stuttered | Extension Manager ⚙ |
| **Burn My Windows** | Window open and close effects | One subtle effect, *Glide*: windows scale in and out in 220 ms. Stored as the high-priority profile `~/.config/burn-my-windows/profiles/mk-glide.conf` (from `config/burn-my-windows-profile.conf`); `sync.sh` rewrites it, so make your own profile in its settings instead of editing this one | Extension Manager ⚙ |
| **Places Status Indicator** | Top-bar menu for Home, Downloads, drives and network places | GNOME default | (no settings) |
| **MK Workstation Indicator** (`mk-indicator`, made for MK) | The **MK** mark in the top bar, and: the accent colour taken from your wallpaper; the window switcher (a compact card of live windows); the system monitor with an internet speed test; the media tile for Spotify and other players; the welcome light with a different greeting each time and your pinned tasks; dock glow in each app's colour and magnification; the focus-timer countdown; workspace dots that don't collide with the volume pop-up | `config/theme.conf`, `welcome.conf`, `greetings.conf`, `dock.conf`, `monitor.conf`, `media.conf` (`mk accent`, `mk welcome`) | Switch off in Extension Manager to remove it |
| **MehulK Workstation & Sonoma Suite** (`wack-sonoma-lockscreen`, by MehulK: MK's merge of WACK Sonoma Lockscreen and Live Lock Screen plus its own modules, AGPL-3.0; formerly WACK Sonoma Live Lockscreen) | The lock screen: Sonoma clock and date (style, font, colours, offset), user pill and frosted password field, a video / GIF / picture behind them (mpv, hardware decoding, in step with the screen's refresh rate; silent unless its sound is on; paused when the screen is off or the computer sleeps, playing again 250 ms after waking), five clock layouts (Sonoma: centred, 88 pt, bold and tight, the date above and the tagline and pill under it; Sequoia: the date and time 80 px from the left, weather, battery and media as frosted cards in a column 80 px from the right; Cyberpunk: hours over minutes in a mono face glowing in the dock's glow colour, with a `[ 13:45:07 ] BAT 97% · 22°C` HUD line; Corner HUD: small, 48 px from the bottom-left corner, the rest of the screen clear; Glass Card: the whole clock stack in one frosted pane, 28 × 56 px padding), switched live from the Command Centre, clock typography (SF Pro Rounded Heavy, JetBrains Mono Tech, Editorial Serif, Futura Geometric, or any font), a glow / shadow slider, a glass card with its own opacity, date formats, a tagline under the clock (always: yours, else the Cupertino message, else "MK Workstation"), a greeting above the password field, the top bar hidden while locked (no second battery), the unlock hint as a frosted badge that shows only after the mouse moves (180 ms in, out after 2.5 s still, and at once on Esc), your picture at 56 px, the video hidden as the computer sleeps and faded back 600 ms after waking, a light scrim (0-85 %) instead of GNOME's heavy blur (one blur pass only while the password field shows), the password field at once on waking, battery and weather in one pill under the time (nowhere else), **the media hub** (frosted glass under the clock: a 52 px rounded cover, title and artist, a green Spotify or red YouTube badge, round Previous / Play-Pause / Next, a thin progress bar you can click or drag with 01:24 / 03:45; hidden while nothing plays, fading in over 250 ms the moment Spotify, a browser or any MPRIS player starts, and kept, paused, for a player that played while locked), compact notification pills (three, a count of the rest, Clear), a 44 px frosted power button (one 18 px icon) 24 px from the bottom-right corner with a 170 px card above it (Sleep, Hibernate, Restart, Shut Down, straight to systemd-logind, so they work while locked); the tagline, the battery and weather row and Now Playing always right under the time, inside WACK's own clock (never left at the screen's top-left corner), with the glass card (rgba(16,20,32,0.58), a 24 % white edge, 28 px corners) sized around the whole block; live weather from Open-Meteo (located by IP over HTTPS, Jaipur if offline, the last reading cached for boot; weather-enabled turns it off); lock and unlock animations (Sonoma Slow-Stop & Dissolve, Cupertino Scale Zoom, Smooth Crossfade, None; the crossfade takes 450 ms, and with every animation but None the lock video's sound ramps down over the same 450 ms). In the user session: **the desktop's live wallpaper** (optional sound, decoded on the graphics card (VA-API, the frames staying in GPU memory) at most 30 frames a second (half the repaints for GNOME Shell, so the dock and top bar keep their frame rate), drawn edge to edge as the one live wallpaper actor (a clone the size of the whole monitor, first in the background layer, GNOME's still wallpaper turned transparent under it so nothing of it ever shows, under the dock or anywhere; black letterbox bands encoded in a video are measured by the player and zoomed past, so no black bar shows) in the background layer, under the top bar and the dock; by default heard only on the bare desktop: its sound (Desktop Video Sound, Desktop Volume) is heard all the time you're logged in, windows open or not, sent straight to PipeWire (the default output); silent while locked, and, with Mute While Other Media Plays (or Wallpaper Bg Play) on, while another app plays media (a media player saying it plays AND its own sound stream open: never the wallpaper's own stream or a sound filter such as the B&O speaker tuning), fading out and back in over 350 ms; the video itself streams on behind your windows and menus, pausing only while the screen is locked or a window is full screen (and then holding its frame as a picture of its own, so it never blanks to GNOME's still wallpaper); it's never hidden or dimmed, and never takes a click; muted while other media plays; **Wallpaper Bg Play** (Quick Settings, `wallpaper-background-play`) keeps it playing, sound and all, under your apps and fades it out only while other media plays (any MPRIS player, or another app's open sound stream; event sounds don't count), back in 600 ms after that stops; top-bar menus never pause it; switching workspaces (keys, swipes, the grid) slides the windows over the video, which stays pinned to the monitor and keeps playing from the same GPU texture, instead of GNOME's still wallpaper made afresh for each switch (MK Shell Engine glides keyboard and dot switches over 260 ms, EASE_OUT_EXPO, the workspaces easing back to 0.96x as they pass); kept out of the media pill, the calendar's media card and the lock screen's Now Playing), and in the top bar **Finder** (Fedora's logo in its blue by default, or Fedora Monochrome, MK Emblem, Apple Fruit, a custom image (a round avatar by default), none; 14-30 px; a plain list: About This Workstation, MK Command Centre…, System Settings…, App Store…, Extension Settings…, System Monitor, then Sleep, Hibernate, Restart…, Shut Down…, Log Out…, each with its keyboard shortcut on the right, read from GNOME's settings and updated when you change one), an icon-only **Places** (Home, Desktop, Documents, Downloads, Music, Pictures, Videos, Trash full or empty, Network, Recent Files) and the **app indicator**, a capsule of its own (New Window, Hide, Maximize, Close, Quit; it always fades and shrinks away, 180 ms, on an empty desktop); **Hibernate** in Quick Settings' power menu too. MK Shell Engine's own Finder, app pill and desktop wallpaper stand aside while it runs, and GNOME's Places button hides while its own shows | The gear in Extension Manager (five pages: Wallpapers & Audio, Finder & Top Bar, Sonoma Lock Screen, Performance & Refresh Rate, Power & Hibernate, with a live preview of the screen); the Command Centre's Studio (`mk-control-center studio`); `mk-live-wallpaper set-desktop / set-lockscreen FILE`, `audio desktop|lockscreen on|off|0-100`, `automute on|off`, `sync on|off`, `loop on|off`, `hwaccel`, `list`; `mk-hibernate [--check]` (real hibernation when set up, otherwise sleep with everything kept in memory); once, as root: `scripts/setup-hibernate.sh` (swap file, resume=, polkit rule), `scripts/setup-system-optimizations.sh` (your display settings for GDM) | Off until you switch it on in Extension Manager |
| **MK Shell Engine** (`mk-shell-engine`, made for MK) | MK's own replacements for third-party extensions, one module at a time: **snap layouts** (Super+Z, Super+Shift+Z coder desktop); a **glass dock** (favourites, running apps, Show Apps; 40 px full-colour icons; only the one under the pointer grows (1.32x, a 12 px lift, a 120 ms spring), so the dock never shifts; the app you're working in sits raised (1.15x, 9 px up, 180 ms) on a tile in the glow colour (22 % fill, 70 % edge, a 16 px glow); four looks (`dock-style`: obsidian-glass, cupertino-frost, spider-glow, minimal-flat); a small dot under each running app (two for several windows; your accent colour for the app you're in); click focuses or minimizes, middle-click a new window, scroll cycles windows, right-click New Window / Keep in Dock / Quit / Force Quit…; intellihide: fully shown on a clean desktop, it fades out (200 ms, shrinking to 0.95x from its bottom middle, then taking no clicks) the moment any window on this workspace overlaps its spot (a maximized or tiled window, one dragged onto it) and fades back in (220 ms) when nothing does; the pointer on the bottom 4 px brings it back over the window, and it fades away again once the pointer leaves it; the app you're working in sits 6 px up; fades away while the overview is open, where GNOME's own overview dash is folded away too; never comes up over a full-screen video or game); a **minimize glide** (the window slides and shrinks into its dock icon in 220 ms, dissolving at the end, and launches back out in 220 ms; **windows open and close** without a bounce: opening grows from 0.94x in 220 ms, closing shrinks to 0.94x and glides 12 px down as it dissolves in 130 ms; it always hands the window back to GNOME, even if something goes wrong, so a minimize can't hang); a **Super+Tab app switcher** (compact cards: 56 px icon, name, workspace pill; the highlight snaps when Tab is held, so it never lags; ` cycles the app's windows, Q closes the picked window, M minimizes it); **the top bar as three glass islands** (left, centre, right: GNOME's own groups and everything in them, each on its own blurred rounded capsule; or `top-bar-style` `edge` for one seamless glass bar), with the left as separate islands 6 px apart (the logo, a divider and Places; the workspace dots; **the app you're using** in its own colours (nothing on an empty desktop, and nothing at all while the Suite's own app indicator is switched off), its pill gliding to the name's width, then the workspace dots and Places; click: New Window, Split Left / Right, Center Stage, Pin on Top, Quit), a **tray chevron** that folds apps' tray icons away (`tray-collapsed`), and a **typographic clock** (Thu Nov 5 · 2:25 PM, 24-hour if GNOME is); **the calendar's notification side** (the weather beside the date, GNOME's media card with its cover as a blurred backdrop and a progress bar you can click to seek, a 4-entry clipboard shelf that marks the entry on the clipboard "Selected" without reordering, Focus 25m beside Clear: no banners and a live countdown; a daily checklist under Add to Agenda: tick, strike-through, ×; screenshot notifications: Open Viewer, Annotate Markup, Delete); **Quick Settings as a bento grid** (wider, so no toggle title is cut short; quiet glass tiles; one that's on is translucent glass in your accent colour with a glow inside its own edge; thicker sliders; a **live wallpaper volume** slider right under the speaker's, shown only while the live wallpaper is a video with a sound track and its sound is on (its icon mutes the wallpaper at once) and a **Wallpaper Bg Play** tile ("Auto-pauses on media"); the header keeps the battery and Settings plus an MK Command Centre button with the MK emblem (not a second gear): no screenshot, lock or power buttons there, those live in the Finder menu); **Snip & Sketch screenshots** (Super+Shift+S opens with no box from last time: drag any area and it's saved to Pictures/Screenshots and copied the moment you let go); **real glass** (each island, the dock and the Super+Tab card blur a copy of what's behind them on the GPU, as Blur my Shell does: the wallpaper, or for the switcher the desktop and its windows; cut to their rounded corners; gone while a window is full screen). The dock only starts while Dash to Dock is off, the blur while Blur my Shell is off, the genie while Magic Lamp is off, so there's never two of either | live wallpaper (while WACK Sonoma Live Lockscreen, which plays it otherwise, is off): `mk-live-wallpaper set-desktop FILE`, `off`, `hwaccel`, `list` (~/.config/mk/wallpaper.json); its Finder and app pill also stand aside while that extension shows its own; `gsettings` keys `finder-show-button`, `finder-logo-mode` (fedora, mk, apple, distro, custom, none), `finder-custom-logo-path`, `finder-icon-size` (14-30, default 22), `finder-logo-circular`, `finder-show-label`, `finder-label-text`, `dock`, `dock-style` (obsidian-glass, crystal-clear, tahoe-pill, cyber-neon, floating-icons, and three older), `dock-opacity` (0.10-0.95), `dock-corner-radius` (12-32), `dock-focused-raise`, `dock-icon-glass` (frosted glass behind each icon), `dock-indicator-style` (glowing-dot, wide-pill, underline), `dock-glow-color` (#rrggbb, default #ef4444: the dots, the focused app's glow and the glow themes' edge), `dock-icon-size` (36-68), `dock-hover-scale` (1.00-1.50), `blur`, `top-bar-style` (islands, edge), `show-active-app`, `tray-collapsed`, `qs-hidden`, `media-previous`, `media-next`, `fresh-snip`, `snip-auto-capture` under `org.gnome.shell.extensions.mk-shell-engine` | `mk sync` switches Dash to Dock off for the engine's dock (it stays installed); to go back, `gsettings set org.gnome.shell.extensions.mk-shell-engine dock false` and switch Dash to Dock on in Extension Manager |

The MK desktop also has its own OCR tool on **Super+Shift+C**, separate from Text Extractor. Use whichever you prefer.

`mk sync` also switches **Space Bar** (`space-bar@luchrioh`) and GNOME's **Window List** off every time it runs: their workspace labels ("W.S 1") and bottom bar clash with MK's top bar and dock. Switch them on again in Extension Manager if you want them; the next sync turns them off again.

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

GNOME switches off every extension that isn't made for the lock screen when you lock, and builds them all again as you unlock; that rebuild is the hitch you see as the lock screen slides away, and why gestures don't answer for a moment after. `sync.sh` keeps six of them loaded while locked: Impatience, Burn My Windows, Wobbly Windows, Magic Lamp, Touchpad Gesture Customization and Transparent Top Bar. These only animate windows or the top bar. The gestures only act on the normal desktop and overview (`Shell.ActionMode.NORMAL`/`OVERVIEW`), never on the lock screen. That was checked in the extension's code, and an update could change it, so `mk sync` is where to look if a gesture ever does something on the lock screen. Text Extractor is not kept: it would work on the lock screen. MK's clipboard history (in mk-indicator) records nothing while locked and its Super+V only works on the desktop and overview. MK's own system monitor hides itself while locked.

---

## Split screen and snap layouts

| Do this | Result |
| :--- | :--- |
| `Super+←` or `Super+→` | Window takes the left or right half. Snap Assist then shows your other windows: click one to fill the other half. |
| `Super+←`, then `Super+↑` (or `↓`) | Window takes the top-left (or bottom-left) quarter. Same on the right. |
| Drag a window to a screen edge or corner | Half or quarter, with a preview |
| `Super+Z` | MK snap layouts (mk-shell-engine): a card of five layouts chosen for the windows on this desktop, the likeliest already picked: one window: Center Stage (80 %), Left / Right Half; two: 50 / 50 Split, 70 / 30 Duo; three: 3-Column Studio (25 / 50 / 25), Main + 2 Stacked; four or more: 2 x 2 Grid. A maximized window snaps on the first press. Hover or arrow onto one to see its parts on the desktop; `1`-`5`, Enter or a click tiles the focused window into the main (lit) part and your other windows on this desktop, most recent first, into the rest. Esc closes |
| `Super+Shift+Z` | Coder desktop: VS Code (or Zed, Builder, a JetBrains IDE), a terminal and a browser window on localhost move to a fresh desktop as terminal / editor / browser. Two of the three are enough (70 / 30 then) |
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
