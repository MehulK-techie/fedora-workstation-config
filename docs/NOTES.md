# MK Notes

Notes for the laptop and the phone. MK Notes takes ideas from three apps:

- **Obsidian:** a vault of plain Markdown files, links, backlinks, a graph,
  tags, and Obsidian's paid extras, Sync and Publish.
- **Apple Notes:** three panes, pins, checklists, and screenshots that paste
  straight in.
- **Samsung Notes:** handwriting and drawing with a pen, on the paper of
  your choice.

Open it with **Super+N**, from the app grid, or with `mk notes`.

## Your notes are files

Everything lives in `~/Notes`. Obsidian can open the same folder, so you can
use both apps on the same notes.

| Path | What it holds |
| :--- | :--- |
| `~/Notes/**/*.md` | Notes: one Markdown file each, in any folder |
| `~/Notes/attachments/` | Pasted screenshots, photos, drawings (`.svg`) and files |
| `~/Notes/Daily/` | Daily notes (`2026-10-24.md`) |
| `~/Notes/Templates/` | Templates; `{{title}}`, `{{date}}` and `{{time}}` are filled in |
| `~/Notes/.trash/` | Deleted notes, as Obsidian does it |
| `~/Notes/.mknotes/` | Pins, colours, version history and sync records |

To use a different folder, set `NOTES_DIR=` in `~/.config/mk-workstation/notes.conf`.
The defaults are in [`config/notes.conf`](../config/notes.conf).

## Make it yours

Menu › **Preferences** (Ctrl+,):

- style: light, dark, or follow the system
- font: sans, serif or monospace, and its size
- line length (narrow, medium, wide, full) and line spacing
- the formatting bar on or off
- which view notes open in, and how the list is sorted
- the notes folder: any folder of Markdown files, an existing Obsidian vault included

## Three ways to look at a note

- **Edit** (Ctrl+E switches with Read): the Markdown, with formatting buttons.
- **Edit with preview** (Ctrl+\\): writing on the left, the finished note on the right, updating as you type.
- **Read**: the finished note; tick checkboxes and follow links.
- **Focus mode** (F11): full screen, nothing but the text.

## Quick capture

**Super+Ctrl+N** from anywhere opens a small window. Type, press
**Ctrl+Enter**, and it goes to the top of `Inbox.md` with the time. Esc
closes it without saving.

## Writing

| What | How |
| :--- | :--- |
| New note | Ctrl+N, or **+** in the list. The title is the file name |
| Bold, italic, highlight, strikethrough | Ctrl+B, Ctrl+I, or the buttons |
| Heading | Ctrl+H cycles through `#`, `##` and `###` |
| Checklist | Ctrl+L. Enter continues the list, and Enter on an empty item ends it |
| Link to another note | Ctrl+K, or type `[[Note name]]`. A link to a note that doesn't exist yet creates it when you click the link |
| Embed | `![[image.png]]` for a picture, `![[Other note]]` for another note's text |
| Tags | `#project`. Nested tags work too: `#project/apollo` |
| Callouts | `> [!note] Title`. Other kinds: `tip`, `warning`, `danger`, `question`. `> [!tip]- Title` folds closed, `> [!tip]+ Title` folds open |
| Code | Fenced code blocks (```` ```python ````) are coloured when Pygments is installed (`setup.sh` installs it) |
| PDFs | Drop a PDF in, or write `![[file.pdf]]`: the note shows its first page, and a click opens it. The preview is made in a sandbox (bubblewrap), since a PDF can come from anywhere |
| Tables, code, dividers | Use the buttons |
| Edit or read | Ctrl+E. In the reading view you can tick checkboxes and click links and tags |

## Screenshots, pictures and drawings

- **Paste:** Ctrl+V pastes an image from the clipboard, or files copied in Files.
- **Capture:** the camera button (Ctrl+Shift+S) hides the window while you pick
  an area, then puts the picture in your note.
- **Drop:** drag files onto the editor.
- **Draw or handwrite:** the pen button (Ctrl+Shift+P).
  - Tools: pen, highlighter and eraser. The eraser removes whole strokes.
  - Pressure works with a stylus. You can also draw with a finger or the mouse.
  - 7 inks, any thickness.
  - Paper: light or dark; plain, lined, grid or dots.
  - To edit a drawing later, put the cursor on its line and press the pen button.
  - Drawings are SVG files, and the strokes are saved inside them, so they
    stay editable.

## Finding things

- **Ctrl+O** jumps to a note. It matches loosely, and creates the note if
  nothing matches.
- **Ctrl+P** lists every command.
- **Ctrl+F** searches. `tag:project` and `path:Work` narrow the search.
- **Sidebar:** All notes, Pinned, Daily notes, your folders, and your tags
  with how many notes use each.
- **Info pane** (the right-sidebar button) shows the note's outline, its
  backlinks (other notes that link here), its links and its tags.
- **Tasks** (sidebar, Ctrl+Shift+T) lists every checkbox in every note, open
  ones first. Tick them off right there, or click to jump to the note.
- **Calendar** (the calendar button) marks the days that have a daily note.
  Pick any day to open or start its note.
- **Graph view** (Ctrl+G) shows every note and link. You can drag it, zoom
  it, and click a note to open it.

## Organising

- **Pin:** the pin button, or right-click a note. Pinned notes stay at the top.
- **Colour:** the dots in the toolbar, or right-click a note.
- **Move to a folder:** right-click a note.
- **Rename:** edit the title (F2). Every `[[link]]` to the note is updated.
- **Delete:** the note moves to `.trash/`, and **Undo** brings it back.

## PDF, website and history

- **Export to PDF** (Ctrl+Shift+E): A4, light theme, with pictures, drawings,
  checkboxes and callouts.
  - It needs WeasyPrint. `setup.sh` installs it; you can also run
    `sudo dnf install python3-weasyprint`.
  - Without WeasyPrint, the system print dialog opens instead. Choose
    "Print to File".
- **Publish vault as website:** writes a folder of HTML pages with a note
  list and working links. Upload it to GitHub Pages, Netlify or any web
  host. This is Obsidian Publish without the subscription.
- **Version history:** MK Notes keeps a copy of each note every few minutes
  while you edit it, up to 60 copies per note. Menu › Version history lets
  you look back and restore any copy. Restoring is itself kept in history.
  To turn this off, set `HISTORY=off`.

## On your phone

The phone keeps its own copy of your notes, so you can write offline. It syncs
with the laptop whenever both are on the same Wi-Fi and MK Notes is open on the
laptop. If you'd rather not keep the window open, run `mk notes serve` instead.

1. On the laptop, open MK Notes › menu › **Phone**, and switch **Phone sync** on.
2. Choose one of these:
   - **Browser (any phone):** scan the left QR code with the camera. The
     notes open in the browser. In Chrome, use ⋮ › **Add to Home screen**
     to get an app icon.
   - **Android app:** build it once on the laptop with
     `scripts/build-apk.sh --install` (phone on USB, USB debugging on), or
     copy `dist/MK-Notes.apk` to the phone. Open the app, then scan the
     **right** QR code with the camera.
3. That's all. The phone syncs when you open the app, every 30 seconds while
   it's open, and when you tap the sync button.

On the phone you can:

- write and read notes
- use checklists
- add photos (they're shrunk to 2000 px) and pasted screenshots
- draw with a finger or stylus (pressure works); drawings use the same
  format as on the laptop
- pin notes, colour them, move them to folders and search them

**If a note was changed on both the phone and the laptop**, you keep both
versions. The phone's version is saved as "Note (phone conflict <time>)",
the same way Obsidian Sync handles it.

**Security:**

- Only paired devices can sync. Each request is signed with the pairing
  key, the key itself is never sent, and a recorded request can't be
  replayed.
- **Encrypted** when the laptop has PyNaCl (`python3-pynacl`, installed by
  `setup.sh`): everything that crosses the Wi-Fi, the list of notes included,
  is sealed with a key derived from the pairing key. The phone's status line
  says "encrypted". Once a phone has seen encryption it refuses unencrypted
  replies, so nobody can quietly switch it off.
- Without PyNaCl, notes travel **unencrypted** (still signed). Then use phone
  sync on your home network only.
- **New pairing key** in the Phone dialog unpairs every phone.

### Building the Android app

`scripts/build-apk.sh` builds the app without Android Studio. It needs:

- **A Java compiler:** `sudo dnf install java-25-openjdk-devel`.
- **Google's Android SDK tools** (about 250 MB). The script downloads them the
  first time. Google's licence is shown, and you accept it yourself.

The app is signed with a key made just for you,
`~/.local/share/mk-workstation/android-key.jks`, with its password in
`android-key.pass` next to it. Back both up: updates to the app need the
same key.

## Shortcuts

| Keys | Action |
| :--- | :--- |
| Ctrl+N · Ctrl+Shift+N | New note · new folder |
| Ctrl+O · Ctrl+P | Jump to a note · commands |
| Ctrl+E · Ctrl+\\ · F11 | Edit / read · edit with preview · focus mode |
| Ctrl+, · Ctrl+Shift+T | Preferences · Tasks |
| Ctrl+F | Search |
| Ctrl+Shift+D | Today's note (also Super+Alt+N anywhere) |
| Ctrl+B · Ctrl+I · Ctrl+H · Ctrl+L · Ctrl+K | Bold · italic · heading · checklist · link |
| Ctrl+Shift+S · Ctrl+Shift+P | Screenshot · draw |
| Ctrl+Shift+E | Export to PDF |
| Ctrl+G · Ctrl+T | Graph · insert template |
| F2 · F9 | Rename · show or hide the sidebar |

## What it doesn't do (yet)

- iPhone app. The browser version works on an iPhone, but there's no App
  Store build.
- Encrypted sync, or sync over the internet. Sync works on the same Wi-Fi
  only.
- Password-locked notes.
- Plugins and Canvas (a whiteboard of cards).
