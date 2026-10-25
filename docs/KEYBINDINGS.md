# Keyboard shortcuts and gestures

Everything you can press or swipe, in one place. The keyboard tables are generated from
[`config/shortcuts.conf`](../config/shortcuts.conf), the file `sync.sh` applies; **Super+/** shows
them live and lets you change any of them. Your changes go to
`~/.config/mk-workstation/shortcuts.conf` and survive updates.

## Windows

| Action | Keys |
| :--- | :--- |
| Switch windows (all workspaces) | Alt+Tab |
| Switch apps | Super+Tab |
| Switch windows of this app | Alt+` · Super+` |
| Close window | Super+Q · Alt+F4 |
| Snap left half | Super+Left · Super+Keypad 4 |
| Snap right half | Super+Right · Super+Keypad 6 |
| Maximize | Super+Up · Super+Keypad 5 |
| Restore | Super+Down |
| Snap layouts | Super+Z |
| Center window | Super+Ctrl+C |
| Always on top | Super+Ctrl+T |
| Full screen | Super+Ctrl+F |
| Show desktop | Super+D |

## Workspaces

| Action | Keys |
| :--- | :--- |
| Previous workspace | Super+PgUp · Super+Alt+Left · Super+Ctrl+Left |
| Next workspace | Super+PgDn · Super+Alt+Right · Super+Ctrl+Right |
| New desktop | Super+End · Super+Ctrl+D |
| Move window left | Super+Shift+PgUp · Super+Shift+Alt+Left |
| Move window right | Super+Shift+PgDn · Super+Shift+Alt+Right |
| Move window to a new desktop | Super+Shift+End · Super+Ctrl+Shift+D |
| Go to workspace 1 | Super+Alt+1 |
| Go to workspace 2 | Super+Alt+2 |
| Go to workspace 3 | Super+Alt+3 |
| Go to workspace 4 | Super+Alt+4 |
| Move window to workspace 1 | Super+Shift+Alt+1 |
| Move window to workspace 2 | Super+Shift+Alt+2 |
| Move window to workspace 3 | Super+Shift+Alt+3 |
| Move window to workspace 4 | Super+Shift+Alt+4 |

## Screenshots

| Action | Keys |
| :--- | :--- |
| Full screen, instantly | Print · Super+Shift+3 |
| Current window | Alt+Print |
| Pick an area or window | Shift+Print · Super+Shift+S · Super+Shift+4 |
| Copy text from screen (OCR) | Super+Shift+T |
| Copy text (Text Extractor) | Super+Alt+T |

## System

| Action | Keys |
| :--- | :--- |
| Search / overview | Super+S |
| App grid | Super+A |
| Quick settings | Super+Shift+A |
| Notifications | Super+M |
| Clipboard history | Super+V |
| Run a command | Alt+F2 · Super+R |
| Files | Super+E |
| Settings | Super+I |
| Shut down / restart | power-off |
| Shut down (asks first) | Ctrl+Alt+End |
| Restart (asks first) | Ctrl+Alt+Home |
| Sleep | Ctrl+Alt+Page Down |
| Tour of the workstation | Super+Shift+/ |
| System Monitor | Ctrl+Shift+Esc |

## Apps

| Action | Keys |
| :--- | :--- |
| Shortcuts (this window) | Super+/ |
| Companion: notes, tasks, timer | Super+Shift+N |
| Terminal | Ctrl+Alt+T |
| Web browser | Super+B |
| MK Notes | Super+N |
| MK Notes: today's note | Super+Alt+N |
| MK Notes: quick note | Super+Ctrl+N |
| Emoji board: search, click, and it's typed where your cursor is | Super+. |
| Photo Booth: webcam with live looks, stickers, captions; its hardware controls | Super+C |

## Touchpad gestures

| Gesture | Does |
| :--- | :--- |
| 3 fingers ←/→ | Window switcher: swipe through every window (same finger travel per window) |
| 4 fingers ←/→ | Switch desktop |
| 3 fingers ↑ | Overview |
| 4 fingers ↑/↓ | Maximize / restore |
| 3-finger pinch | Volume |
| 4-finger pinch | Show the desktop (pinch again to bring windows back) |
| 2 fingers ←/→ in Firefox or Zen | Back / forward |
| Pinch in Firefox or Zen | Zoom the page |

## In the window switcher (Alt+Tab or 3 fingers)

A compact card in the middle of the screen; it appears at once.

| Keys | Does |
| :--- | :--- |
| Tab · Shift+Tab · arrows | Next · previous window |
| 1–9 | Send the selected window to that desktop |
| W · F4 | Close the selected window |
| Q | Quit the selected app |
| Enter or let go | Open it |
| Esc · click outside | Cancel |
| Point · click | Select · open |

## MK Notes

| Keys | Does |
| :--- | :--- |
| Ctrl+N · Ctrl+Shift+N | New note · new folder |
| Ctrl+O · Ctrl+P | Jump to a note · every command |
| Ctrl+E · Ctrl+\\ · F11 | Edit / read · edit with live preview · focus mode |
| Ctrl+F · Ctrl+Shift+T | Search · Tasks |
| Ctrl+Shift+D | Today's note |
| Ctrl+B · Ctrl+I · Ctrl+H · Ctrl+L · Ctrl+K | Bold · italic · heading · checklist · link |
| Ctrl+Shift+S · Ctrl+Shift+P · Ctrl+Shift+I | Insert a screenshot · draw · edit the picture on this line |
| Ctrl+Shift+E · Ctrl+G · Ctrl+T | PDF · graph · template |
| Ctrl+, · F2 · F9 | Preferences · rename · sidebar |
| Quick note window: Ctrl+Enter · Esc | Save to Inbox · close |
| Ctrl+V · drag a file in | Paste or drop an image or file: it's attached and shown, not pasted as a path |
| Ctrl+click | Open a web address or `[[link]]` while editing |

## Screensaver and focus timer

| Keys | Does |
| :--- | :--- |
| Any key, click or pointer move | End the screensaver |
| Type a time, Enter (timer window) | Start: `25`, `25m`, `1:30` or `90s` |
| Space (timer window) | Pause / resume |

## Files (Nautilus)

GNOME Files' own keys; MK adds Space previews (sushi), Loupe for images
and File Roller for archives.

| Keys | Does |
| :--- | :--- |
| Ctrl+L · `/` · `~` | Type a location · start at / · start at your home folder |
| Ctrl+X · Ctrl+C · Ctrl+V | Cut · copy · paste (cut and paste moves the files) |
| Ctrl+. | Open the folder in a terminal (also right-click › Open in Console) |
| F2 | Rename; with several files selected, rename them all at once (patterns, numbering, find and replace) |
| Space | Quick preview |
| Ctrl+T · Ctrl+Page Up/Down | New tab · switch tabs |
| Ctrl+H | Show or hide hidden files |

Files has no split (dual-pane) view. For two folders side by side, open a
second window (Ctrl+N) and tile them with Super+Left and Super+Right, or
drag files between tabs.
