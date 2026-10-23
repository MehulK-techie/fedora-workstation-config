"""MK Notes vault: plain Markdown files in a folder (~/Notes by default), laid
out the way Obsidian expects, so the same vault opens in Obsidian too.

  Notes        any *.md file, in any folder
  Attachments  attachments/ (pasted screenshots, drawings, files)
  Trash        .trash/ (deleted notes, as Obsidian does)
  MK's state   .mknotes/ (pins, colours, version history, sync tombstones)

Links are Obsidian's: [[Note]], [[Note|label]], [[Note#Heading]]; embeds are
![[image.png]] and ![[Other note]].
"""
import hashlib
import html
import json
import os
import re
import secrets
import shutil
import time
from datetime import datetime
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "mk-workstation"
DATA_DIR = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "mk-workstation"
CONF_FILES = (DATA_DIR / "config/notes.conf", CONFIG_DIR / "notes.conf")

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
WIKILINK = re.compile(r"(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]")
TAG = re.compile(r"(?<![\w/&#])#([A-Za-z][\w/-]*)")
TASK = re.compile(r"^(\s*[-*+] )\[( |x|X)\]", re.M)
HEADING = re.compile(r"^(#{1,6})\s+(.*)$", re.M)
HISTORY_EVERY = 300      # seconds between saved versions of one note
HISTORY_KEEP = 60        # versions kept per note


def load_conf():
    conf = {"NOTES_DIR": "~/Notes", "SYNC_PORT": "8765", "HISTORY": "on"}
    for path in CONF_FILES:
        try:
            for line in path.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    key, value = line.split("=", 1)
                    conf[key.strip()] = value.strip()
        except OSError:
            pass
    return conf


def digest(data):
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha1(data).hexdigest()[:16]


def safe_name(title):
    """A file name from a title: no slashes or characters Android can't store."""
    name = re.sub(r'[\\/:*?"<>|#^\[\]]', " ", title).strip().strip(".")
    return re.sub(r"\s+", " ", name)[:120] or "Untitled"


class Vault:
    def __init__(self, root=None):
        conf = load_conf()
        self.root = Path(os.path.expanduser(root or conf["NOTES_DIR"])).resolve()
        self.attachments = self.root / "attachments"
        self.meta_dir = self.root / ".mknotes"
        self.history_enabled = conf.get("HISTORY", "on") != "off"
        for folder in (self.root, self.attachments, self.meta_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self.state_file = self.meta_dir / "state.json"
        self.state = self._load_state()
        if not any(self.root.rglob("*.md")):
            self._welcome()

    # ---------- state: pins, colours, tombstones ----------
    def _load_state(self):
        try:
            state = json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            state = {}
        state.setdefault("pinned", [])
        state.setdefault("colors", {})
        state.setdefault("deleted", {})
        return state

    def save_state(self):
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1))
        tmp.replace(self.state_file)

    def is_pinned(self, rel):
        return rel in self.state["pinned"]

    def set_pinned(self, rel, pinned):
        pins = [p for p in self.state["pinned"] if p != rel]
        if pinned:
            pins.insert(0, rel)
        self.state["pinned"] = pins
        self.save_state()

    def color(self, rel):
        return self.state["colors"].get(rel)

    def set_color(self, rel, color):
        if color:
            self.state["colors"][rel] = color
        else:
            self.state["colors"].pop(rel, None)
        self.save_state()

    # ---------- files ----------
    def path(self, rel):
        full = (self.root / rel).resolve()
        if full != self.root and self.root not in full.parents:
            raise ValueError(f"outside the vault: {rel}")
        return full

    def rel(self, path):
        return Path(path).resolve().relative_to(self.root).as_posix()

    def _hidden(self, rel_parts):
        return any(part.startswith(".") for part in rel_parts)

    def notes(self, folder=None):
        """All notes, newest first: dicts with rel, title, folder, mtime, size."""
        base = self.path(folder) if folder else self.root
        out = []
        for path in base.rglob("*.md"):
            parts = path.relative_to(self.root).parts
            if self._hidden(parts):
                continue
            stat = path.stat()
            rel = "/".join(parts)
            out.append({"rel": rel, "title": path.stem, "folder": "/".join(parts[:-1]),
                        "mtime": stat.st_mtime, "size": stat.st_size})
        out.sort(key=lambda n: n["mtime"], reverse=True)
        return out

    def folders(self):
        out = []
        for path in sorted(self.root.rglob("*")):
            if path.is_dir():
                parts = path.relative_to(self.root).parts
                if not self._hidden(parts) and parts[0] != "attachments":
                    out.append("/".join(parts))
        return out

    def read(self, rel):
        try:
            return self.path(rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return ""

    def write(self, rel, text):
        path = self.path(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        if self.history_enabled and path.exists():
            self._snapshot(rel, path)
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
        self.state["deleted"].pop(rel, None)

    def unique(self, folder, stem, ext=".md"):
        base = self.path(folder) if folder else self.root
        candidate = base / f"{stem}{ext}"
        n = 1
        while candidate.exists():
            n += 1
            candidate = base / f"{stem} {n}{ext}"
        return self.rel(candidate)

    def create(self, folder="", title="Untitled", text=None):
        rel = self.unique(folder, safe_name(title))
        self.write(rel, text if text is not None else "")
        return rel

    def create_folder(self, name, parent=""):
        rel = "/".join(p for p in (parent, safe_name(name)) if p)
        self.path(rel).mkdir(parents=True, exist_ok=True)
        return rel

    def rename(self, rel, new_title=None, new_folder=None):
        """Rename or move a note and update every [[link]] pointing at it."""
        old = self.path(rel)
        folder = Path(rel).parent.as_posix() if new_folder is None else new_folder
        folder = "" if folder == "." else folder
        new_rel = self.unique(folder, safe_name(new_title or old.stem))
        if new_rel == rel:
            return rel
        self.path(new_rel).parent.mkdir(parents=True, exist_ok=True)
        old.rename(self.path(new_rel))
        old_name, new_name = old.stem, Path(new_rel).stem
        if old_name != new_name:
            pattern = re.compile(r"(!?\[\[)" + re.escape(old_name) + r"(\]\]|[|#])", re.I)
            for note in self.notes():
                text = self.read(note["rel"])
                updated = pattern.sub(lambda m: m.group(1) + new_name + m.group(2), text)
                if updated != text:
                    self.write(note["rel"], updated)
        for key in ("pinned",):
            self.state[key] = [new_rel if p == rel else p for p in self.state[key]]
        if rel in self.state["colors"]:
            self.state["colors"][new_rel] = self.state["colors"].pop(rel)
        self.state["deleted"][rel] = time.time()
        self.save_state()
        return new_rel

    def delete(self, rel):
        """Move to .trash/ (as Obsidian does) and remember it for phone sync."""
        path = self.path(rel)
        if not path.exists():
            return
        trash = self.root / ".trash" / rel
        trash.parent.mkdir(parents=True, exist_ok=True)
        if trash.exists():
            trash = trash.with_name(f"{trash.stem} {int(time.time())}{trash.suffix}")
        shutil.move(str(path), str(trash))
        self.state["pinned"] = [p for p in self.state["pinned"] if p != rel]
        self.state["colors"].pop(rel, None)
        self.state["deleted"][rel] = time.time()
        self.save_state()

    # ---------- attachments ----------
    def save_attachment(self, data, ext, stem=None):
        """Store bytes in attachments/ with Obsidian's "Pasted image" naming."""
        stem = stem or f"Pasted image {datetime.now():%Y%m%d%H%M%S}"
        rel = self.unique("attachments", safe_name(stem), ext if ext.startswith(".") else "." + ext)
        self.path(rel).write_bytes(data)
        return rel

    def resolve(self, name):
        """[[name]] to a vault path: exact path, then file name, case-insensitive."""
        name = name.strip()
        for candidate in (name, name + ".md"):
            try:
                if self.path(candidate).is_file():
                    return self.rel(self.path(candidate))
            except ValueError:
                return None
        low = name.lower()
        for path in self.root.rglob("*"):
            if path.is_file() and not self._hidden(path.relative_to(self.root).parts):
                if path.name.lower() == low or (path.suffix == ".md" and path.stem.lower() == low):
                    return self.rel(path)
        return None

    # ---------- links, tags, search ----------
    def links(self, text):
        return [m.group(2).strip() for m in WIKILINK.finditer(text) if not m.group(1)]

    def backlinks(self, rel):
        stem = Path(rel).stem.lower()
        out = []
        for note in self.notes():
            if note["rel"] == rel:
                continue
            text = self.read(note["rel"])
            for line in text.splitlines():
                if any(target.lower() in (stem, rel.lower(), rel[:-3].lower())
                       for target in self.links(line)):
                    out.append((note["rel"], line.strip()))
                    break
        return out

    def tags(self, text):
        body = re.sub(r"```.*?```|`[^`\n]*`", "", text, flags=re.S)
        return sorted({t.lower() for t in TAG.findall(body)})

    def all_tags(self):
        counts = {}
        for note in self.notes():
            for tag in self.tags(self.read(note["rel"])):
                counts[tag] = counts.get(tag, 0) + 1
        return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    def search(self, query, limit=200):
        """Notes matching every word (title counts double), with a snippet.
        tag:x and path:x narrow it down, as in Obsidian."""
        words = query.lower().split()
        tags = [w[4:].lstrip("#") for w in words if w.startswith("tag:")]
        paths = [w[5:] for w in words if w.startswith("path:")]
        words = [w for w in words if not w.startswith(("tag:", "path:"))]
        results = []
        for note in self.notes():
            if paths and not all(p in note["rel"].lower() for p in paths):
                continue
            text = self.read(note["rel"])
            low = text.lower()
            note_tags = self.tags(text) if tags else []
            if tags and not all(any(n == t or n.startswith(t + "/") for n in note_tags) for t in tags):
                continue
            title = note["title"].lower()
            if not all(w in low or w in title for w in words):
                continue
            score = sum(2 * (w in title) + low.count(w) for w in words)
            snippet = ""
            if words:
                at = low.find(words[0])
                if at >= 0:
                    snippet = text[max(0, at - 40):at + 80].replace("\n", " ")
            results.append((score, note, snippet))
        results.sort(key=lambda r: (-r[0], -r[1]["mtime"]))
        return [(note, snippet) for _, note, snippet in results[:limit]]

    def outline(self, text):
        out = []
        in_code = False
        for line in text.splitlines():
            if line.startswith("```"):
                in_code = not in_code
            m = None if in_code else HEADING.match(line)
            if m:
                out.append((len(m.group(1)), m.group(2).strip()))
        return out

    def graph(self):
        """Nodes and edges of the whole vault, for the graph view."""
        notes = self.notes()
        index = {n["title"].lower(): n["rel"] for n in notes}
        nodes, edges = [], []
        for note in notes:
            nodes.append({"id": note["rel"], "label": note["title"]})
            for target in self.links(self.read(note["rel"])):
                dest = index.get(target.lower()) or index.get(Path(target).stem.lower())
                if dest and dest != note["rel"]:
                    edges.append({"from": note["rel"], "to": dest})
        return {"nodes": nodes, "edges": edges}

    def toggle_task(self, rel, number):
        """Tick or untick the Nth checkbox of a note (from the reading view)."""
        text = self.read(rel)
        count = -1

        def flip(m):
            nonlocal count
            count += 1
            if count != number:
                return m.group(0)
            return m.group(1) + ("[ ]" if m.group(2).lower() == "x" else "[x]")
        self.write(rel, TASK.sub(flip, text))

    # ---------- daily notes, templates ----------
    def daily(self):
        rel = f"Daily/{datetime.now():%Y-%m-%d}.md"
        if not self.path(rel).exists():
            self.write(rel, f"# {datetime.now():%A, %d %B %Y}\n\n## Tasks\n- [ ] \n\n## Notes\n")
        return rel

    def templates(self):
        folder = self.root / "Templates"
        return sorted(p.stem for p in folder.glob("*.md")) if folder.is_dir() else []

    def template(self, name, title=""):
        text = self.read(f"Templates/{name}.md")
        now = datetime.now()
        return (text.replace("{{date}}", now.strftime("%Y-%m-%d"))
                .replace("{{time}}", now.strftime("%H:%M")).replace("{{title}}", title))

    # ---------- version history ----------
    def _history_dir(self, rel):
        return self.meta_dir / "history" / rel

    def _snapshot(self, rel, path):
        folder = self._history_dir(rel)
        versions = sorted(folder.glob("*.md")) if folder.is_dir() else []
        if versions and time.time() - versions[-1].stat().st_mtime < HISTORY_EVERY:
            return
        old = path.read_bytes()
        if versions and versions[-1].read_bytes() == old:
            return
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{datetime.now():%Y%m%d-%H%M%S}.md").write_bytes(old)
        for stale in versions[:-(HISTORY_KEEP - 1)] if len(versions) >= HISTORY_KEEP else []:
            stale.unlink(missing_ok=True)

    def history(self, rel):
        folder = self._history_dir(rel)
        if not folder.is_dir():
            return []
        out = []
        for version in sorted(folder.glob("*.md"), reverse=True):
            when = datetime.strptime(version.stem, "%Y%m%d-%H%M%S")
            out.append((when, version))
        return out

    # ---------- rendering ----------
    def render(self, rel, text, depth=0):
        """Markdown to HTML for the reading view, PDF export and publishing.

        Raw HTML in a note is never rendered (Markdown's HTML support is
        switched off): notes can come from the phone, a shared vault or a
        download. MK's own HTML (checkboxes, links, embeds, callouts) goes in
        through placeholders after Markdown has escaped everything else."""
        import markdown
        from markdown.extensions import Extension

        class NoRawHTML(Extension):
            def extendMarkdown(self, md):
                for name in ("html_block",):
                    if name in md.preprocessors:
                        md.preprocessors.deregister(name)
                if "html" in md.inlinePatterns:
                    md.inlinePatterns.deregister("html")

        slots = []
        task_no = [0]

        def slot(markup):
            slots.append(markup)
            return f"MKSLOT{len(slots) - 1}X"

        def outside_code(source, fn):
            parts = re.split(r"(^```.*?^```|`[^`\n]*`)", source, flags=re.S | re.M)
            return "".join(part if i % 2 else fn(part) for i, part in enumerate(parts))

        def task(m):
            n = task_no[0]
            task_no[0] += 1
            checked = " checked" if m.group(2).lower() == "x" else ""
            return m.group(1) + slot(f'<input type="checkbox" data-task="{n}"{checked}>')

        def wiki(m):
            embed, target, heading, label = m.group(1), m.group(2).strip(), m.group(3) or "", m.group(4)
            dest = self.resolve(target)
            if embed and dest and Path(dest).suffix.lower() in IMAGE_EXT:
                width = f' width="{html.escape(label)}"' if label and label.isdigit() else ""
                return slot(f'<img src="{html.escape(self.path(dest).as_uri())}" alt="{html.escape(target)}"{width}>')
            if embed and dest and dest.endswith(".md") and depth < 1:
                inner = self.render(dest, self.read(dest), depth + 1)
                return "\n\n" + slot(f'<div class="embed"><div class="embed-title">{html.escape(Path(dest).stem)}'
                                      f'</div>{inner}</div>') + "\n\n"
            if embed and dest:
                return slot(f'<a class="file" href="{html.escape(self.path(dest).as_uri())}">'
                            f'📎 {html.escape(Path(dest).name)}</a>')
            cls = "internal" if dest else "internal unresolved"
            href = "mknote:" + (dest or target) + heading
            return slot(f'<a class="{cls}" href="{html.escape(href)}">{html.escape(label or target + heading)}</a>')

        def to_html(source):
            # "#tag" at the start of a line is a tag, not a heading (as in Obsidian).
            source = outside_code(source, lambda part: re.sub(r"^#(?=[^\s#])", r"\\#", part, flags=re.M))
            # Nested lists: Obsidian indents by tab or 2 spaces, Markdown wants 4.
            items = re.findall(r"^( +)(?:[-*+]|\d+\.)[ \t]", source, flags=re.M)
            unit = 2 if any(len(i) % 4 for i in items) else 4

            def level(indent):
                return indent.count("\t") + len(indent.replace("\t", "")) // unit
            source = re.sub(r"^([ \t]+)(?=(?:[-*+]|\d+\.)[ \t])",
                            lambda m: "    " * level(m.group(1)), source, flags=re.M)
            # A list right under a paragraph is a list (Markdown wants a blank line).
            source = outside_code(source, lambda part: re.sub(
                r"^((?![ \t]*(?:[-*+]|\d+\.)[ \t]).*\S.*)\n(?=[ \t]*(?:[-*+]|\d+\.)[ \t])", r"\1\n\n", part, flags=re.M))
            source = outside_code(source, lambda part: WIKILINK.sub(wiki, TASK.sub(task, part)))

            def callout(m):  # Obsidian callouts: > [!note] Title
                kind, title, rest = m.group(1).lower(), m.group(2).strip(), m.group(3)
                inner = to_html(re.sub(r"^> ?", "", rest, flags=re.M))
                return "\n\n" + slot(f'<div class="callout callout-{html.escape(kind)}"><div class="callout-title">'
                                      f'{html.escape(title or kind.title())}</div>{inner}</div>') + "\n\n"
            source = re.sub(r"^> \[!(\w+)\][+-]? ?(.*)\n?((?:>.*\n?)*)", callout, source, flags=re.M)
            return markdown.markdown(source, extensions=["extra", "sane_lists", "nl2br", "toc", NoRawHTML()])

        out = to_html(re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.S))  # without front matter
        # Links only to the web, mail, other notes and tags: no javascript:, no file:.
        out = re.sub(r'href="(?!https?:|mailto:|mknote:|mktag:|#)[^"]*"', 'href="#"', out)
        # ==highlights== and #tags, in text only (not code, tags or attributes).
        parts = re.split(r"(<pre.*?</pre>|<code.*?</code>|<a\b.*?</a>|<[^>]+>)", out, flags=re.S)

        def decorate(part):
            part = re.sub(r"==(.+?)==", r"<mark>\1</mark>", part)
            return TAG.sub(lambda m: f'<a class="tag" href="mktag:{m.group(1)}">#{m.group(1)}</a>', part)
        out = "".join(part if i % 2 else decorate(part) for i, part in enumerate(parts))
        # MK's own HTML back in: blocks first (Markdown wrapped them in <p>), then inline.
        out = re.sub(r"<p>MKSLOT(\d+)X</p>", lambda m: slots[int(m.group(1))], out)
        for _ in range(3):  # slots can hold slots (callouts with links)
            out = re.sub(r"MKSLOT(\d+)X", lambda m: slots[int(m.group(1))], out)
        # Relative image paths (standard Markdown) resolve against the note.
        base = self.path(rel).parent.as_uri() + "/"
        return re.sub(r'<img src="(?!file:|https?:|data:)([^"]+)"',
                      lambda m: f'<img src="{base}{m.group(1)}"', out)

    def page(self, rel, text, dark=True, printing=False):
        """A full HTML page around render()."""
        body = self.render(rel, text)
        if printing:
            body = f'<h1 class="note-title">{html.escape(Path(rel).stem)}</h1>' + re.sub(
                r'<input type="checkbox"[^>]*?( checked)?>',
                lambda m: '<span class="box">☑</span>' if m.group(1) else '<span class="box">☐</span>', body)
        return PAGE.format(title=html.escape(Path(rel).stem), body=body, nonce=secrets.token_hex(8),
                           scheme="dark" if dark else "light", printing="print" if printing else "")

    def pdf(self, rel, out_path):
        """Export a note to PDF (needs WeasyPrint: python3-weasyprint)."""
        import weasyprint

        page = self.page(rel, self.read(rel), dark=False, printing=True)
        weasyprint.HTML(string=page, base_url=self.path(rel).parent.as_uri() + "/").write_pdf(out_path)

    def publish(self, out_dir):
        """Obsidian Publish, at home: the vault as a static website folder."""
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        notes = self.notes()
        slug = {n["rel"]: re.sub(r"[^\w-]+", "-", n["rel"][:-3]).strip("-").lower() + ".html" for n in notes}
        nav = "".join(f'<li><a href="{slug[n["rel"]]}">{html.escape(n["title"])}</a></li>'
                      for n in sorted(notes, key=lambda n: n["title"].lower()))
        if (out / "attachments").exists():
            shutil.rmtree(out / "attachments")
        shutil.copytree(self.attachments, out / "attachments")
        for note in notes:
            body = self.render(note["rel"], self.read(note["rel"]))
            body = body.replace(self.attachments.as_uri() + "/", "attachments/")
            body = re.sub(r'href="mknote:([^"#]+)[^"]*"',
                          lambda m: f'href="{slug.get(self.resolve(html.unescape(m.group(1))) or "", "#")}"', body)
            page = PAGE.format(title=html.escape(note["title"]), scheme="light", printing="", nonce=secrets.token_hex(8),
                               body=f'<nav><ul>{nav}</ul></nav><article><h1 class="note-title">'
                                    f'{html.escape(note["title"])}</h1>{body}</article>')
            (out / slug[note["rel"]]).write_text(page, encoding="utf-8")
        first = slug[notes[0]["rel"]] if notes else ""
        (out / "index.html").write_text(f'<meta http-equiv="refresh" content="0; url={first}">')
        return out

    # ---------- phone sync ----------
    def manifest(self):
        """Every synced file (notes and attachments) with a content hash."""
        files = []
        for path in self.root.rglob("*"):
            if not path.is_file():
                continue
            parts = path.relative_to(self.root).parts
            if self._hidden(parts):
                continue
            if path.suffix != ".md" and parts[0] != "attachments":
                continue
            files.append({"path": "/".join(parts), "hash": digest(path.read_bytes()),
                          "mtime": path.stat().st_mtime})
        return {"files": files, "deleted": self.state["deleted"],
                "pinned": self.state["pinned"], "colors": self.state["colors"]}

    def _welcome(self):
        self.write("Welcome.md", WELCOME)


WELCOME = """# Welcome to MK Notes

Your notes are plain Markdown files in this folder, so they also open in
Obsidian, and they're yours forever.

- [ ] Paste a screenshot with **Ctrl+V**, or press the camera button
- [ ] Draw or handwrite with the pen button (works with a stylus)
- [ ] Link notes like this: [[Ideas]], then see the **backlinks** and the **graph**
- [ ] Export a note to **PDF** from the menu
- [ ] Open your notes on your phone: menu › Phone

> [!tip] Shortcuts
> Ctrl+N new note · Ctrl+O jump to a note · Ctrl+P every command ·
> Ctrl+E read / edit · Ctrl+F search · Ctrl+Shift+D today's note

#welcome
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: https:; style-src 'unsafe-inline'; script-src 'nonce-{nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><style>
:root {{ color-scheme: {scheme}; --accent: #2fa8ff; }}
html {{ background: transparent; }}
body {{ font: 16px/1.65 "Inter", "Cantarell", system-ui, sans-serif; margin: 0 auto;
  max-width: 760px; padding: 28px 40px 80px; color: light-dark(#1d2330, #e6ecf5); }}
body.print {{ color: #1d2330; padding: 0; max-width: none; }}
h1, h2, h3, h4 {{ line-height: 1.25; margin: 1.4em 0 .5em; }}
h1 {{ font-size: 1.9em; }} h2 {{ font-size: 1.45em; }} h3 {{ font-size: 1.2em; }}
a {{ color: var(--accent); text-decoration: none; }}
a.unresolved {{ opacity: .6; }}
a.tag {{ background: color-mix(in srgb, var(--accent) 16%, transparent); padding: 1px 8px;
  border-radius: 10px; font-size: .9em; }}
img {{ max-width: 100%; border-radius: 10px; }}
code {{ font-family: "JetBrains Mono", monospace; font-size: .9em; padding: 2px 5px; border-radius: 5px;
  background: light-dark(#eef1f6, #1d2433); }}
pre {{ background: light-dark(#f3f5f9, #141a26); padding: 14px 16px; border-radius: 10px; overflow-x: auto; }}
pre code {{ background: none; padding: 0; }}
blockquote {{ margin: 1em 0; padding: 4px 16px; border-left: 3px solid var(--accent);
  color: light-dark(#4a5568, #b4bfd0); }}
table {{ border-collapse: collapse; }} th, td {{ border: 1px solid light-dark(#d8dee8, #2c3546); padding: 6px 12px; }}
mark {{ background: #ffe066; color: #1d2330; border-radius: 3px; padding: 0 2px; }}
li:has(> input[type=checkbox]) {{ list-style: none; margin-left: -1.3em; }}
input[type=checkbox] {{ width: 1.05em; height: 1.05em; accent-color: var(--accent); vertical-align: -2px; margin-right: 6px; }}
li:has(> input:checked) {{ text-decoration: line-through; opacity: .55; }}
.callout {{ border-radius: 10px; padding: 10px 16px; margin: 1em 0;
  background: color-mix(in srgb, var(--accent) 10%, transparent); border-left: 4px solid var(--accent); }}
.callout-warning, .callout-caution {{ --accent: #f0a020; }} .callout-danger, .callout-bug {{ --accent: #ff5577; }}
.callout-tip, .callout-success {{ --accent: #2ecc8f; }} .callout-question {{ --accent: #a070ff; }}
.callout-title {{ font-weight: 700; }}
.embed {{ border-left: 2px solid var(--accent); padding-left: 14px; margin: 1em 0; }}
.embed-title {{ font-size: .8em; opacity: .6; text-transform: uppercase; letter-spacing: .05em; }}
nav {{ float: left; width: 200px; margin-left: -240px; font-size: .9em; }}
nav ul {{ list-style: none; padding: 0; }}
@media (max-width: 1100px) {{ nav {{ float: none; width: auto; margin: 0 0 20px; }} }}
.box {{ font-size: 1.15em; margin-right: 6px; }}
@page {{ size: A4; margin: 18mm; }}
@media print {{ a {{ color: inherit; }} }}
</style></head><body class="{printing}">{body}
<script nonce="{nonce}">
document.addEventListener('change', e => {{
  if (e.target.dataset.task !== undefined && window.webkit?.messageHandlers?.mk)
    window.webkit.messageHandlers.mk.postMessage('task:' + e.target.dataset.task);
}});
</script></body></html>"""
