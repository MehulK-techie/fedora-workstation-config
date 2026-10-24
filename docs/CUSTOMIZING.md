# Make it yours

MK Workstation is meant to be changed. Almost everything is a plain text file
in `config/` or `apps/`, so you can rename it, rebind any key, swap apps or
extensions and restyle it without editing the scripts.

There are two ways to customize:

- **Just your computer:** use the app windows or the `mk` commands below.
  Your choices live in `~/.config/mk-workstation/` and survive `mk sync` and
  `mk update`.
- **Your own version for others (a fork):** fork the repository on GitHub,
  edit the files in `config/` and `apps/`, and share your fork's link. Everyone
  who installs it gets your defaults.

| What | On your computer | In a fork (default for everyone) |
| :--- | :--- | :--- |
| Name and top-bar tag | `mk rename "My Desk" MD`, or Companion › menu › Rename | `config/brand.conf` |
| Accent colour | `mk accent auto` (from your wallpaper) or `mk accent \#00c8ff` | `config/theme.conf` |
| Mouse pointer | `CURSOR=Adwaita` (or any installed theme) in `~/.config/mk-workstation/theme.conf`, then `mk sync` | `config/theme.conf` |
| Notes folder, phone sync, history | `~/.config/mk-workstation/notes.conf` | `config/notes.conf` |
| Screensaver | `mk screensaver scene web` (or knight, matrix, aurora, random), `mk screensaver delay 300`, `mk screensaver off` | `config/screensaver.conf` |
| Focus timer's screen | Focus timer › Screensaver | `AMBIENT_STYLE` in `timer.conf` |
| Greetings | `mk welcome lines` (your own), `mk welcome variety off`, `mk welcome birthday 07-14` | `config/greetings.conf`, `config/welcome.conf` |
| Media tile | `MEDIA=off` or `TICKER=off` in `~/.config/mk-workstation/media.conf` | `config/media.conf` |
| Zen Browser look | your own lines in the profile's `chrome/userChrome.css`, outside the MK block | `config/browser/zen-userChrome.css` |
| Browser touchpad prefs | your profile's `user.js`, outside the MK block | `config/browser/user.js` |
| Keyboard shortcuts | Super+/ › click a shortcut | `config/shortcuts.conf` |
| Your own command shortcuts | Super+/ › **+** | `config/shortcuts.conf` (`custom:` lines) |
| Apps installed | Install them, then `mk save` | `apps/dnf-packages.txt`, `apps/flatpaks.txt` |
| Extensions and their settings | Extension Manager, then `mk save` | `config/enabled-extensions.txt`, `config/extension-settings/` |
| Snap layouts (Super+Z) | `~/.config/tiling-assistant/layouts.json` | `config/tiling-layouts.json` |
| Window open/close effect | Burn My Windows settings (make your own profile) | `config/burn-my-windows-profile.conf` |
| Power profiles (laptops) | `~/.config/mk-workstation/power.conf`, or `mk power off` | `config/power.conf` |
| Heavy effects on or off | `mk effects full`, `lite` or `auto` | `config/effects.conf` (which effects count as heavy, and the auto threshold) |
| Focus timer silencing notifications | The switch in the timer | default in `bin/mk-timer` (`SILENCE`) |
| App icons | `mk icon companion ~/Pictures/me.png` (SVG or PNG) | `assets/icons/` |
| Files look | — | `config/gtk/files.css` |
| Calendar look | — | `extensions/mk-indicator@mehulk/stylesheet.css` (`.calendar` rules) |
| Speaker sound | Tweak live in the EasyEffects app, `mk sound off` to stop | `assets/sound/MK Laptop Speakers.json` |
| Welcome greeting | Quick Settings › Welcome light, Companion › Welcome greeting, `mk welcome` | `config/welcome.conf` |
| Dock magnification | `~/.config/mk-workstation/dock.conf` (`MAGNIFY=1` turns it off) | `config/dock.conf` |
| Dock hover colours | Automatic from each app's icon | `extensions/mk-indicator@mehulk/dockGlow.js` (glow strength in `_hover`) |
| Alt+Tab, dock and hover colours | — | `extensions/mk-indicator@mehulk/stylesheet.css` |

## Rename it

The name appears in the Companion, the Shortcuts window, update notifications
and the small tag in the top bar.

```bash
mk rename "Riya's Workstation" RW
```

The top-bar tag changes at once; open windows pick up the new name the next
time they open. To undo, delete `~/.config/mk-workstation/brand.conf`.

For a fork, edit `config/brand.conf`:

```ini
NAME=Riya's Workstation
SHORT=RW
```

## Shortcuts

Press **Super+/**. Every shortcut is listed with its status:

| Mark | Meaning |
| :--- | :--- |
| ✔ green | Working |
| ⚠ yellow | Another shortcut uses the same keys; the row says which |
| ✖ red | The command it runs isn't installed |
| ⏸ grey | No key set, or its extension is off |

- **Change keys:** click the row and press the new keys. *Set* replaces the
  keys, *Add as extra key* keeps the old ones too, *No key* frees them.
  Esc cancels.
- **Add your own:** click **+**, give it a name, the command to run
  (for example `flatpak run com.spotify.Client`) and keys.
- **Undo:** the ↶ button on a row puts MK's keys back; menu › *Reset all to
  MK defaults* does it for every shortcut (yours stay).

Changes apply immediately and are stored in
`~/.config/mk-workstation/shortcuts.conf`. Anything you change in GNOME
Settings shows up in the window right away too, marked *Changed outside MK*.

### The shortcuts file

`config/shortcuts.conf` is one line per shortcut:

```text
group | label | target | keys
Apps  | Terminal | custom:terminal @terminal | <Control><Alt>t
Windows | Close window | org.gnome.desktop.wm.keybindings close | <Super>q, <Alt>F4
```

- `target` is a GNOME setting (`schema key`), an extension's setting
  (`ext:<uuid> schema key`), or a command (`custom:<id> <command>`).
  In commands, `~` is the home folder and `@terminal` / `@browser` pick the
  installed terminal and the default browser.
- `keys` are GTK accelerators, separated by commas. Empty means no key.
- Group `-` applies the line but hides it from the window (used to free keys).

To find a GNOME setting's name, run
`gsettings list-recursively | grep -i <word>`.

## Apps and extensions

The easiest way is to set things up on your own desktop and let `mk save`
write the files: it adds apps you installed to `apps/*.txt` and saves your
extensions and their settings to `config/`, then commits. Push that to your
fork and every install gets the same.

You can also edit the lists by hand: one Flatpak ID or dnf package name per
line, and one extension UUID per line in `config/enabled-extensions.txt`.
`mk update` installs anything newly added.

## Effects and performance

`mk effects` shows the current profile. `lite` keeps blur, window open/close
effects and the genie minimize installed but switched off, which keeps older
laptops and virtual machines smooth; `full` turns them on; `auto` (the
default) chooses lite when the computer has less than 4 GiB of RAM, two CPU
cores or fewer, or no GPU rendering. Change which effects count as heavy, or
the RAM threshold, in `config/effects.conf`.

## Colours and look

`extensions/mk-indicator@mehulk/stylesheet.css` styles the Alt+Tab switcher,
the dock's hover glow, overview window titles and the top-bar buttons. Change
the `rgba(0, 200, 255, …)` cyan to your colour, run `mk sync`, then log out and
back in. Dock icons don't use the cyan when they can help it: each glows in
its app's own colour, worked out from the icon (`dockGlow.js`).

The Companion and Focus Timer set their accent colour in the `CSS` block at
the top of `bin/mk-companion` and `bin/mk-timer`.

## Share your changes back

If your change would help others (a new app, a fix, a better default), open a
pull request: see [CONTRIBUTING.md](../CONTRIBUTING.md). Personal choices like
names and colours are better kept in your fork.
