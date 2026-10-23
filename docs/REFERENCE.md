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
| `mk focus [DURATION] ["LABEL"]` | Start the focus timer in the background (`25`, `1:30`, `90s`) |
| `mk power [status\|on\|off]` | Smart power profiles on laptops |
| `mk effects [full\|lite\|auto]` | Show or set the visual effects profile |
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
| `mk-companion [tasks \| note ID]` | Super+Shift+N | Notes, tasks, reminders, timer and Obsidian buttons |
| `mk-timer [DURATION [LABEL]]` | via Companion | Focus timer; `mk-timer 25`, `mk-timer 1:30 "Reading"` start it in the background |
| `mk-reminders [snooze ID SECONDS]` | timer | Fires due reminders and the morning brief |
| `mk-power [status]` | service | Smart power profiles (laptops) |
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
