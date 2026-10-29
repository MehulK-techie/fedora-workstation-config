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

The default theme is Deep Obsidian (OLED): a #121417 page and #1c1f24 sidebars; five more in the palette menu.

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
- **Focus canvas** (⤢ in the header, Ctrl+Shift+F): the notebooks and the note list slide away together for a wide page; again brings them back. F11: full screen.

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
| Link to another note | Ctrl+K, or type `[[`: matching note names pop up as you type; Enter or Tab takes one. A link to a note that doesn't exist yet creates it when you click the link |
| Open a link while editing | Ctrl+click a web address or `[[link]]`. Web links open in your default browser (as `xdg-open` does) |
| Embed | `![[image.png]]` for a picture, `![[Other note]]` for another note's text |
| Tags | `#project`. Nested tags work too: `#project/apollo` |
| Callouts | `> [!note] Title`. Other kinds: `tip`, `warning`, `danger`, `question`. `> [!tip]- Title` folds closed, `> [!tip]+ Title` folds open |
| Code | Fenced code blocks (```` ```python ````) are coloured when Pygments is installed (`setup.sh` installs it) |
| PDFs | Drop a PDF in, or write `![[file.pdf]]`: the note shows its first page, and a click opens it. The preview is made in a sandbox (bubblewrap), since a PDF can come from anywhere |
| Tables, code, dividers | Use the buttons |
| Edit or read | Ctrl+E. In the reading view you can tick checkboxes and click links and tags |

## Screenshots, pictures and drawings

- **Shapes** (Shapes in the ribbon): lines (line, arrow, double arrow, elbow
  connector), basic shapes (rectangle, rounded rectangle, oval, triangle,
  diamond) and graphs (X–Y axes with ticks, a 4-quadrant grid, 3D axes),
  picked from one menu, drawn by dragging.
- **Tables** (grid button in the ribbon): hover to pick up to 8 x 8, click to
  insert a lined-up Markdown table.

- **Paste:** Ctrl+V pastes an image from the clipboard (screenshots, "Copy
  image" in a browser), read fresh with `wl-paste`, or files copied in Files. A copied file path or
  `file://` address is attached as the file itself, not pasted as text. The
  note gets `![[name.png]]`, which shows the picture in Read and in Edit with
  preview.
- **See them while you write:** every `![[picture]]` line shows the picture
  right under it in the editor. Drag its right edge to resize it there; the
  width is kept in the line (`![[picture.png|300]]`) and used when reading too.
- **Zoom:** Ctrl+scroll, pinch on the touchpad, or Ctrl+plus / minus; Ctrl+0
  goes back to 100%. Text, line length and pictures scale together.
- **Edit a picture:** click it (or Ctrl+Shift+I on its line). Rotate (Ctrl+[
  and Ctrl+]), flip, crop (C, then drag), resize, and looks: Thermal, Pop Art,
  Distort and a vintage Polaroid with a paper frame. Save copy keeps the
  original and points the note at the new picture.
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
- Tasks are kept in the Companion (Super+Shift+N); checkboxes in notes stay
  ordinary checklists.
- **Calendar** (the calendar button) marks the days that have a daily note.
  Pick any day to open or start its note.
- **Graph view** (Ctrl+G) shows every note and link. You can drag it, zoom
  it, and click a note to open it. Preferences › Writing › Graph view turns
  it off.

## Organising

- **Pin:** the pin button, or right-click a note. Pinned notes stay at the top.
- **Colour:** the dots in the toolbar, or right-click a note.
- **Move to a folder:** right-click a note.
- **Rename:** edit the title (F2). Every `[[link]]` to the note is updated.
- **Delete:** the note moves to `.trash/`, and **Undo** brings it back.

## Tables, comments, stickies and pages

- **Tables** (grid button: hover up to 8 x 8, click): a real table in the
  text, Google Docs style. Cells wrap their text and a row grows to its
  tallest cell; drag the line between two columns (the pointer turns into
  ⟷) to resize them; ▼ adds or deletes rows and columns around the cell
  you're in, or deletes the table; ⠿ Move table drags it to another place in
  the text; Tab goes to the next cell and adds a row from the last one.
  Text above and below never overlaps it. MK Notes keeps the cells with the
  note and also writes the tables as Markdown at the end of the file, so
  other apps and the phone see them. Older notes' Markdown tables still
  show as styled text tables.
- **Comments** open as a slim card in the right margin; click highlighted
  text to find its comment. On a small window the side panels step aside
  while the margin is open (⤢ brings them back).
- **Sticky notes**: rename the title, pick a colour from the palette
  (Yellow, Mint, Sky, Rose, Lavender, Coral, Charcoal); they're printed as
  coloured callouts at the end of a PDF.
- **Layers**: pictures and sticky notes have an order; a new one goes on top. A picture's bar and a sticky's layers button (▤) have Bring Forward, Send Backward, Bring to Front and Send to Back. Drawings stay on their own layer above the page.
- **Pages**: dashed lines mark where each A4 page ends.
- **Locks**: right-click a locked note for Lock Now or Remove Lock
  Permanently; a note you unlocked locks again after a minute without input.
- **PDFs**: insert one as a 📎 chip (click to open) or as printout pages to
  draw on.
- **Mind map** (Ctrl+G): notebooks as hubs with their notes around them,
  curved links, no overlapping bubbles; it fits itself to the window until
  you zoom or pan.

## PDF, website and history

- **Export to PDF** (Ctrl+Shift+E): straight to a PDF file, no print dialog.
  It suggests `~/Documents/Notes/`; A4, light theme, with pictures, drawings,
  checkboxes and callouts.
  - It needs WeasyPrint, which `setup.sh` installs. If it's missing, MK
    Notes offers to install it (your password, once) and then exports: no
    print dialog. A notification says when the PDF is ready; click to open.
- **Export to Word** (menu, or right-click a note): a `.docx` written
  directly, no extra software: headings, lists, checklists, callouts, code,
  tables, links and pictures at their set width.
- **Graph view** (Ctrl+G) can be switched off in Preferences › Writing.
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
| Ctrl+N · Ctrl+Shift+N | New note · new notebook |
| Ctrl+B · Ctrl+I · Ctrl+U · Ctrl+L · Ctrl+K | Bold · italic · underline · checklist · link to a note |
| Ctrl+Shift+P · Ctrl+Alt+M | Draw · comment on the selection |
| Ctrl+Shift+E · Ctrl+G · Ctrl+T | Export to PDF · graph · insert template |
| F8 · F9 · Ctrl+Shift+F · F11 | Notes list · notebooks · both away (focus canvas) · full screen |
| Ctrl+plus · Ctrl+minus · Ctrl+0 | Zoom in · out · 100 % |
| Alt+Left · Ctrl+? | Back · this list |

## What it doesn't do (yet)

- iPhone app. The browser version works on an iPhone, but there's no App
  Store build.
- Sync over the internet. Sync works on the same Wi-Fi only.
- Password-locked notes.
- Plugins and Canvas (a whiteboard of cards).
