# Reference

Every command, file and format. How the parts fit together is in
[ARCHITECTURE.md](ARCHITECTURE.md); task-oriented help is in
[GUIDE.md](GUIDE.md) and [CUSTOMIZING.md](CUSTOMIZING.md).

## `mk` commands

| Command | Does |
| :--- | :--- |
| `mk update [--check] [--no-upgrade]` | Pull the repo, install newly listed apps, re-apply settings and extensions, then system and Flatpak updates. `--check` only reports. |
| `mk save` | Add apps you installed yourself to `apps/*.txt`, save extensions and settings to `config/`, and commit |
| `mk sync` | Re-apply everything in `sync.sh` (no sudo) |
| `mk export` | Save current GNOME settings and extensions into `config/` (no commit) |
| `mk restore [FILE]` | Restore the settings snapshot taken before the last sync |
| `mk doctor` | Read-only health check: updates, codecs, GPU decoding, extensions, shortcut clashes, face unlock |
| `mk face [--models N] [--user NAME] [--tune-only]` | Face unlock wizard (sudo) |
| `mk shortcuts` | Shortcuts window (same as Super+/) |
| `mk note "TEXT" [WHEN]` | Add a Companion note; the first line is its title |
| `mk task "TEXT" [WHEN]` | Add a Companion task |
| `mk remind "TEXT" WHEN` | Add a task with a reminder |
| `mk list` | Print notes, tasks and reminders |
| `mk welcome [on\|off\|test\|edit\|title T\|greeting "TEXT"\|voice on\|off\|install\|remove\|notify on\|off]` | Welcome light and spoken greeting after login |
| `mk notes [today \| serve \| NOTE]` | MK Notes; `serve` runs phone sync without the window ([NOTES.md](NOTES.md)) |
| `mk sound [on\|off\|status]` | Laptop speaker tuning with EasyEffects |
| `mk icon [list \| APP IMAGE \| APP reset]` | Your own icon for companion, notes, timer, shortcuts, camera or ocr |
| `mk device` | What this computer has and what MK tunes for it ([HARDWARE.md](HARDWARE.md)) |
| `mk fingerprint [enroll [FINGER]\|list\|delete\|settings\|check]` | Fingerprint enrollment for login and sudo; `check` reports why the lock screen may not use it |
| `mk focus [DURATION] ["LABEL"]` | Start the focus timer in the background (`25`, `1:30`, `90s`) |
| `mk power [status\|on\|off]` | Smart power profiles on laptops |
| `mk effects [full\|lite\|auto]` | Show or set the visual effects profile |
| `mk screensaver [on \| off \| show [SCENE] \| scene NAME \| delay SECONDS \| list]` | Screensaver scenes when you step away |
| `mk welcome variety on\|off` · `birthday [YYYY-]MM-DD` · `lines` | A different greeting each time; a birthday greeting and countdown; edit your own lines |
| `mk accent [auto \| #rrggbb \| system on\|off \| status]` | Accent colour: from the wallpaper, or fixed; also sets GNOME's accent |
| `mk rename "NAME" [TAG]` | Rename MK's windows, notifications and top-bar tag |
| `mk check` | Notify if a new version of the repo is available (run daily by a timer) |
| `mk uninstall` | Remove MK's tools, shortcuts, timers and top-bar extension from your account |

`WHEN` accepts `30m`, `2h`, `1h30m`, `90s`, `18:00`, `6pm`, `tomorrow`,
`tomorrow 9:00`. A clock time that has already passed today means tomorrow.

Every `mk` command has a `just` twin for the common ones (`just --list`).

## Tools in `~/.local/bin`

| Tool | Key | Does |
| :--- | :--- | :--- |
| `show-shortcuts` | Super+/ | Shortcuts window |
| `mk-companion [tasks \| note ID]` | Super+Shift+N | Notes, tasks, reminders, timer and MK Notes buttons |
| `mk-notes [NOTE \| --daily \| --quick \| --serve]` | Super+N · Super+Alt+N · Super+Ctrl+N | MK Notes; today's note; quick capture into Inbox; phone sync only |
| `mk-screensaver [show [SCENE] \| list]` | login | Watches for idle time and plays a scene; `show` plays one now |
| `mk-timer [DURATION [LABEL]]` | via Companion | Focus timer; `mk-timer 25`, `mk-timer 1:30 "Reading"` start it in the background |
| `mk-reminders [snooze ID SECONDS]` | timer | Fires due reminders and the morning brief |
| `mk-power [status]` | service | Smart power profiles (laptops) |
| `mk-voice [say\|render\|install\|remove\|status]` | login | Spoken greeting (cached WAV) |
| `mk-sound [on\|off\|status]` | login | Speaker tuning profile |
| `ocr-snip` | Super+Shift+T | Copy text from a screen area |
| `camera-controls` | Super+C | Webcam brightness, contrast, focus… |
| `mk-doctor` | | Same as `mk doctor` |
| `mk-apps missing \| capture` | | Used by `mk update` / `mk save` |
| `mk-scratchpad` | | Old name; opens the Companion |

## Files in the repo

| Path | Format | Read by |
| :--- | :--- | :--- |
| `config/shortcuts.conf` | `group \| label \| target \| keys` (see below) | `sync.sh`, Shortcuts window |
| `config/brand.conf` | `NAME=`, `SHORT=` | every MK window, top-bar tag, `mk` |
| `config/gtk/files.css` | GTK 4 CSS scoped to `.nautilus-window` | `sync.sh` (marked block in `~/.config/gtk-4.0/gtk.css`) |
| `assets/icons/*.svg`, `assets/applications/*.desktop` | App icons and launchers (`@BIN@` becomes `~/.local/bin`) | `sync.sh` |
| `assets/sound/MK Laptop Speakers.json` | EasyEffects output preset | `mk sound` |
| `config/welcome.conf` | `WELCOME`, `GREETING` (`{title}`, `{name}`), `TITLE` (sir/maam/name/none), `SUBTITLE`, `VOICE`, `EDGE_NOTIFY`, `COLOR_A/B` (`auto` or `#rrggbb`), `TASKS` (pinned tasks and next reminder under the greeting), `VARIETY`, `BIRTHDAY` (`MM-DD` or `YYYY-MM-DD`), `BIRTHDAY_COUNTDOWN` (on/off) | mk-indicator, mk-voice |
| `config/theme.conf` | `ACCENT=` (`auto` or `#rrggbb`), `SYSTEM_ACCENT=` (on/off), `CURSOR=` (cursor theme) | mk-indicator (`accent.js`), `mk accent`, `sync.sh` |
| `config/notes.conf` | `NOTES_DIR=`, `SYNC=`, `SYNC_PORT=`, `HISTORY=`; look: `THEME=`, `FONT=`, `FONT_SIZE=`, `WIDTH=`, `SPACING=`, `FORMAT_BAR=`, `OPEN_IN=`, `SORT=` | `mk-notes` (Preferences writes them) |
| `config/monitor.conf` | `PANEL=` (cpu, mem, temp, net, power), `INTERVAL=` (s) | mk-indicator system monitor |
| `config/screensaver.conf` | `SCREENSAVER=` (on/off), `DELAY=` (s, 30+), `SCENE=` (random, aurora, web, knight, matrix) | `mk-screensaver`, `mk screensaver` |
| `config/media.conf` | `MEDIA=` (on/off), `TICKER=` (on/off: the song title beside the record) | mk-indicator media tile |
| `config/greetings.conf` | `[section]` then one greeting per line; sections morning, afternoon, evening, night, monday, friday, weekend, return, long, birthday, newyear, any | mk-indicator, `mk-voice prepare` (yours: `~/.config/mk-workstation/greetings.conf`) |
| `config/browser/zen-userChrome.css` | CSS with `@ACCENT@` | `sync.sh` (marked block in each Zen profile's `chrome/userChrome.css`) |
| `config/browser/user.js` | Firefox prefs (`user_pref(...)`) | `sync.sh` (marked block in each Firefox / Zen profile's `user.js`) |
| `assets/notes-web/` | The phone app (HTML, JS, manifest) | `mk-notes` sync server, `scripts/build-apk.sh` |
| `android/` | Android WebView wrapper for the phone app | `scripts/build-apk.sh` |
| `config/dock.conf` | `MAGNIFY=`, `MAGNIFY_SPREAD=`, `MAGNIFY_MS=` | mk-indicator (dock magnification) |
| `~/.config/mk-workstation/timer.conf` | `SILENCE=`, `AMBIENT=`, `AMBIENT_IDLE=` (s), `AMBIENT_STYLE=` (random, aurora, web, knight, matrix) | `mk-timer` (written by its window) |
| `config/power.conf` | `ON_AC=`, `ON_BATTERY=`, `LOW_BATTERY=`, `LOW_PERCENT=` | `mk-power` |
| `config/effects.conf` | `HEAVY=` UUIDs, `AUTO_LITE_BELOW_GB=` | `sync.sh` |
| `config/enabled-extensions.txt` | one UUID per line | `sync.sh` |
| `config/extension-settings/<uuid>.dconf` | `# dconf path: …` header, then `dconf dump` output | `sync.sh` |
| `config/tiling-layouts.json` | Tiling Assistant layouts | `sync.sh` (only if you have none) |
| `config/burn-my-windows-profile.conf` | Burn My Windows profile keyfile | `sync.sh` |
| `config/*-full.dconf`, `keybindings.dconf` | reference dumps from `mk export`; not applied | you |
| `apps/dnf-packages.txt`, `apps/flatpaks.txt` | one name per line | `setup.sh`, `mk update`, `mk save` |

### `shortcuts.conf` targets

| Target | Example | Sets |
| :--- | :--- | :--- |
| `<schema> <key>` | `org.gnome.desktop.wm.keybindings close` | a GNOME keybinding (string list) |
| `<schema> <key1>\|<key2>` | `… media-keys shutdown\|power-off` | the first key that exists on this GNOME version |
| `ext:<uuid> <schema> <key>` | `ext:clipboard-indicator@tudmotu.com org.gnome.shell.extensions.clipboard-indicator toggle-menu` | an extension's keybinding (schema read from the extension's folder) |
| `custom:<id> <command>` | `custom:terminal @terminal` | a GNOME custom shortcut in slot `mk-<id>` |

In commands, `~/` is your home folder, `@terminal` is Ptyxis, Console or GNOME
Terminal (first found) and `@browser` is your default browser. Keys are GTK
accelerators (`<Super><Shift>s`, `Print`, `<Control><Alt>t`), comma-separated;
empty means none. Group `-` applies but hides the line.

## Files on your computer

| Path | What | Safe to delete? |
| :--- | :--- | :--- |
| `~/.config/mk-workstation/repo-path` | Where your clone is | Yes; `mk sync` rewrites it |
| `~/.config/mk-workstation/shortcuts.conf` | Your shortcut changes | Yes: back to MK's keys after `mk sync` |
| `~/.config/mk-workstation/brand.conf` | Your name for it | Yes: back to the default name |
| `~/.config/mk-workstation/effects` | `full`, `lite` or `auto` | Yes: auto |
| `~/.config/mk-workstation/timer.conf` | Focus timer preferences | Yes |
| `~/.config/mk-workstation/icons/APP.svg\|png` | Your own app icons | Yes: back to MK's icons |
| `~/.config/gtk-4.0/gtk.css` | The block between `>>> MK Workstation` and `<<< MK Workstation` is MK's | Only that block (`mk uninstall` removes it) |
| `~/.config/autostart/mk-sound.desktop` | Starts speaker tuning at login | Yes: `mk sound off` |
| `~/.config/mk-workstation/welcome.conf` | Your greeting and voice choices | Yes |
| `~/.local/share/mk-workstation/voice/` | Natural voice (Piper + British "Alan" model, ~260 MB) | Yes: `mk welcome voice remove` |
| `~/.cache/mk-workstation/timer.json` · `welcome.wav` | Timer state for the top bar · rendered greeting | Yes |
| `~/.config/mk-workstation/dock.conf` | Your dock magnification values | Yes |
| `~/.config/mk-workstation/power.conf` | Your power profile choices (same keys as `config/power.conf`) | Yes |
| `~/.config/mk-workstation/power-off` | Present after `mk power off` | Yes: `mk power on` |
| `~/.config/mk-workstation/backups/` | Settings snapshots; `original-dconf.ini` is your pre-MK desktop | Keep `original-dconf.ini` |
| `~/.local/share/mk-workstation/companion.json` | Your notes and tasks | **No**: it's your data |
| `~/.local/share/mk-workstation/reminders-state.json` | Which reminders already fired | Yes (due ones may fire again) |
| `~/.local/share/mk-workstation/{lib,config}` | Installed copy of the library and defaults | Yes; `mk sync` reinstalls |
| `~/.config/systemd/user/mk-update-check.*`, `mk-reminders.*` | Timers | `mk uninstall` removes them |
| `/var/log/mk-workstation-setup.log` | Log of every `setup.sh` run | Yes |

## Timers

```bash
systemctl --user list-timers 'mk-*'
journalctl --user -u mk-reminders.service -n 20
```

| Unit | Runs | When |
| :--- | :--- | :--- |
| `mk-update-check.timer` | `mk check` | daily, 15 min after boot |
| `mk-reminders.timer` | `mk-reminders` | every minute (`Persistent`, catches up after sleep); morning brief once a day after 07:00 |
| `mk-power.service` | `mk-power` | laptops only; sleeps until plugged in, unplugged or battery low |

## Environment

The Python tools honour `XDG_CONFIG_HOME` and `XDG_DATA_HOME`, which is handy
for testing without touching your real data:

```bash
XDG_DATA_HOME=/tmp/mk-test PYTHONPATH=lib python3 -m mkworkstation task "try me" 10m
```
