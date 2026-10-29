// Clipboard history (Super+V): a deck in the middle of the screen over a
// dimmed, blurred backdrop (Esc or a click outside closes it). A click copies
// an entry back to the clipboard (nothing is typed for you: paste with
// Ctrl+V). Tabs: All, Images, Text, Pinned. Pictures show as previews with
// their size, 👁 opens one full size; text can be edited before you paste
// it; 🏷 tags an entry (#code, #receipt) and the search box finds tags with #;
// pins stay on top. Clear keeps the pinned ones.
//
// Kept in ~/.cache/mk-workstation/clipboard (a folder only you can open): the
// last 60 entries plus pinned ones. Copies from password managers (and any
// app that marks a copy as a password) never enter it, nor does anything
// copied while the screen is locked.
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
const TABS = [['all', '📋 All'], ['images', '🖼️ Images'], ['text', '📝 Text'], ['pinned', '⭐ Pinned']];

const DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'clipboard']);
const STORE = GLib.build_filenamev([DIR, 'history.json']);
const KEEP = 60;
const MAX_TEXT = 100000;  // characters; longer copies are kept cut short
const SECRET_HINT = 'x-kde-passwordManagerHint';
const PASSWORD_APPS = /keepassxc|bitwarden|1password|proton.?pass|org\.gnome\.seahorse|secrets/i;
const IMAGE_TYPES = ['image/png'];
const THUMB_W = 360;  // cards show this; the full picture only in the 👁 preview
const TERMINALS = /terminal|ptyxis|kgx|console|kitty|alacritty|wezterm|ghostty|foot|tilix|konsole/i;

function removeFile(path) {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (e) {
        // already gone
    }
}

function pngSize(bytes) {
    // width and height sit in the IHDR chunk, big-endian, at bytes 16..23
    const d = bytes.get_data();
    if (!d || d.length < 24)
        return [0, 0];
    const at = i => ((d[i] << 24) >>> 0) + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3];
    return [at(16), at(20)];
}

export class ClipboardHistory {
    constructor() {
        this._items = this._load();
        this._cards = new Map();     // entry id -> its card, kept between openings
        this._version = 0;           // bumped on every change to the entries
        this._filled = null;         // what the list shows now: [version, tab, query]
        this._orphans = new Set();   // cards to throw away at the next fill
        this._clipboard = St.Clipboard.get_default();
        this._thumbQueue = this._items.filter(i => i.image && !GLib.file_test(this._thumbPath(i), GLib.FileTest.EXISTS));
        this._nextThumb();
        this._selection = global.display.get_selection();
        this._ownerId = this._selection.connect('owner-changed', (_s, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onCopied();
        });
    }

    destroy() {
        if (this._ownerId)
            this._selection.disconnect(this._ownerId);
        this._ownerId = 0;
        if (this._fillId)
            GLib.source_remove(this._fillId);
        this._fillId = 0;
        this._dialog?.destroy();
        this._dialog = null;
        this._cards.clear();
        this._keyboard?.run_dispose();
        this._keyboard = null;
    }

    // ---------------------------------------------------------------- storage
    _load() {
        try {
            const [ok, bytes] = GLib.file_get_contents(STORE);
            const items = ok ? JSON.parse(new TextDecoder().decode(bytes)) : [];
            return Array.isArray(items) ? items : [];
        } catch (e) {
            return [];
        }
    }

    _save() {
        try {
            GLib.mkdir_with_parents(DIR, 0o700);
            Gio.File.new_for_path(DIR).set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
            const unpinned = this._items.filter(i => !i.pinned);
            const drop = new Set(unpinned.slice(KEEP).map(i => i.id));
            for (const item of this._items.filter(i => drop.has(i.id) && i.image)) {
                removeFile(item.image);
                removeFile(this._thumbPath(item));
            }
            this._items = this._items.filter(i => !drop.has(i.id));
            this._version++;
            GLib.file_set_contents(STORE, JSON.stringify(this._items));
        } catch (e) {
            console.warn(`mk-indicator: clipboard history: ${e.message}`);
        }
    }

    _toTop(match, make) {
        const old = this._items.find(match);
        this._items = this._items.filter(i => i !== old);
        const item = old ?? make();
        item.time = Date.now();
        this._items.unshift(item);
        this._save();
    }

    // ---------------------------------------------------------------- watching
    _onCopied() {
        if (Main.sessionMode.isLocked)
            return;
        const app = global.display.focus_window?.get_wm_class() ?? '';
        if (PASSWORD_APPS.test(app))
            return;
        const types = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
        if (types.includes(SECRET_HINT))
            return;
        const image = IMAGE_TYPES.find(t => types.includes(t));
        if (image && !types.some(t => t.startsWith('text/plain'))) {
            this._clipboard.get_content(St.ClipboardType.CLIPBOARD, image, (_c, bytes) => this._addImage(bytes));
            return;
        }
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => {
            if (text && text.trim())
                this._toTop(i => i.text === text, () => ({id: GLib.uuid_string_random(), text: text.slice(0, MAX_TEXT)}));
        });
    }

    _thumbPath(item) {
        return item.image.replace(/\.png$/, '-thumb.png');
    }

    // Shrink pictures to card size off the main thread (GdkPixbuf decodes in
    // a worker), one at a time: a 4K screenshot decoded while drawing the
    // deck is what made Super+V take seconds.
    _nextThumb() {
        if (this._thumbBusy || !this._thumbQueue?.length)
            return;
        const item = this._thumbQueue.shift();
        if (!this._items.includes(item) || !GLib.file_test(item.image, GLib.FileTest.EXISTS)) {
            this._nextThumb();
            return;
        }
        this._thumbBusy = true;
        let stream;
        try {
            stream = Gio.File.new_for_path(item.image).read(null);
        } catch (e) {
            this._thumbBusy = false;
            this._nextThumb();
            return;
        }
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, THUMB_W, THUMB_W, true, null, (_s, res) => {
            try {
                const pix = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
                pix.savev(this._thumbPath(item), 'png', [], []);
                this._forget(item);  // its card is rebuilt with the thumbnail
            } catch (e) {
                // a picture GdkPixbuf can't read keeps the plain card
            }
            stream.close(null);
            this._thumbBusy = false;
            this._nextThumb();
        });
    }

    _addImage(bytes) {
        if (!bytes || !bytes.get_size())
            return;
        const sum = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
        this._toTop(i => i.sum === sum, () => {
            GLib.mkdir_with_parents(DIR, 0o700);
            const id = GLib.uuid_string_random();
            const path = GLib.build_filenamev([DIR, `${id}.png`]);
            GLib.file_set_contents(path, bytes.get_data());
            const [w, h] = pngSize(bytes);
            const item = {id, image: path, sum, w, h};
            this._thumbQueue.push(item);
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                this._nextThumb();
                return GLib.SOURCE_REMOVE;
            });
            return item;
        });
    }

    // ---------------------------------------------------------------- the window
    // Super+V: open, or close when it's open. The deck is built once and
    // kept: opening again only shows it (and builds cards for new entries),
    // so it opens at once however often you press the key.
    open() {
        const d = this._dialog;
        if (d && this._shown) {
            this._hide();
            return;
        }
        if (!d)
            this._build();
        this._show();
    }

    _show() {
        const d = this._dialog;
        this._target = global.display.focus_window;  // where Enter pastes
        this._shown = true;
        this._entry.set_text('');
        // Nothing changed since last time: the list is already right.
        const f = this._filled;
        if (!f || f[0] !== this._version || f[1] !== this._tab || f[2] !== '')
            this._fill();
        this._scroll.vadjustment.value = 0;
        if (d.state !== ModalDialog.State.OPENED && d.state !== ModalDialog.State.OPENING)
            d.open();
        // The card: a quick scale and fade in (ease-out cubic), picked up
        // from wherever a closing one was, so pressing again never jumps.
        const card = d.dialogLayout;
        card.remove_all_transitions();
        card.set_pivot_point(0.5, 0.5);
        if (card.opacity === 255 && !this._closing) {
            card.opacity = 0;
            card.scale_x = card.scale_y = 0.96;
        }
        this._closing = false;
        card.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        global.stage.set_key_focus(this._entry.clutter_text);
    }

    _hide() {
        const d = this._dialog;
        if (!d || !this._shown)
            return;
        this._shown = false;
        this._closing = true;
        const card = d.dialogLayout;
        card.remove_all_transitions();
        card.ease({opacity: 0, scale_x: 0.97, scale_y: 0.97, duration: 90,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._shown) {  // not reopened meanwhile
                    this._closing = false;
                    d.close();
                    card.opacity = 255;
                    card.scale_x = card.scale_y = 1;
                }
            }});
    }

    _build() {
        // GNOME's own 100 ms fades off: the card animates itself (above).
        const dialog = new ModalDialog.ModalDialog({styleClass: 'mk-clip-dialog', destroyOnClose: false,
            shouldFadeIn: false, shouldFadeOut: false});
        this._dialog = dialog;
        // The backdrop: dimmed and blurred; a click on it closes the deck.
        if (dialog._lightbox) {
            dialog._lightbox.add_effect(new Shell.BlurEffect({radius: 24, brightness: 0.55,
                mode: Shell.BlurMode.BACKGROUND}));
            dialog._lightbox.connect('button-press-event', () => {
                this._hide();
                return Clutter.EVENT_STOP;
            });
        }
        this._tab = 'all';
        const box = dialog.contentLayout;
        const head = new St.BoxLayout({style_class: 'mk-clip-head'});
        this._entry = new St.Entry({hint_text: 'Search the clipboard', can_focus: true, x_expand: true,
            style_class: 'mk-clip-search'});
        head.add_child(this._entry);
        const clear = new St.Button({label: 'Clear', style_class: 'mk-clip-clear', can_focus: true,
            y_align: Clutter.ActorAlign.CENTER, accessible_name: 'Clear the history (pinned entries stay)'});
        clear.connect('clicked', () => this._clear());
        head.add_child(clear);
        box.add_child(head);
        const tabs = new St.BoxLayout({style_class: 'mk-clip-tabs'});
        this._tabButtons = TABS.map(([key, label]) => {
            const b = new St.Button({label, style_class: 'mk-clip-tab', can_focus: true, toggle_mode: true,
                checked: key === 'all'});
            b.connect('clicked', () => {
                this._tab = key;
                for (const [k, other] of this._tabButtons)
                    other.checked = k === key;
                this._fill();
            });
            tabs.add_child(b);
            return [key, b];
        });
        box.add_child(tabs);
        this._list = new St.BoxLayout({vertical: true, style_class: 'mk-clip-list'});
        this._scroll = new St.ScrollView({style_class: 'mk-clip-scroll', child: this._list,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        box.add_child(this._scroll);
        this._entry.clutter_text.connect('text-changed', () => this._shown && this._fill());
        this._entry.clutter_text.connect('activate', () => this._first && this._copy(this._first));
        this._entry.clutter_text.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Down || !this._firstButton)
                return Clutter.EVENT_PROPAGATE;
            this._firstButton.grab_key_focus();
            return Clutter.EVENT_STOP;
        });
        dialog.addButton({label: 'Close', action: () => this._hide(), key: Clutter.KEY_Escape});
    }

    // ↑/↓ between cards (↑ from the first goes back to the search box),
    // Enter copies the entry and pastes it into the window you came from,
    // Page Up/Down scroll a screenful.
    _cardKey(main, item, event) {
        const key = event.get_key_symbol();
        const cards = this._list.get_children().map(c => c._mkMain).filter(Boolean);
        const i = cards.indexOf(main);
        if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
            const next = cards[i + (key === Clutter.KEY_Down ? 1 : -1)];
            if (next) {
                next.grab_key_focus();
                this._reveal(next);
            } else if (key === Clutter.KEY_Up) {
                global.stage.set_key_focus(this._entry.clutter_text);
            }
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Page_Down || key === Clutter.KEY_Page_Up) {
            const adj = this._scroll.vadjustment;
            adj.ease(adj.value + (key === Clutter.KEY_Page_Down ? 1 : -1) * adj.page_size * 0.9,
                {duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
            this._copy(item, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // Keep the focused card in view.
    _reveal(actor) {
        const adj = this._scroll.vadjustment;
        const [, y] = actor.get_transformed_position();
        const [, top] = this._scroll.get_transformed_position();
        const rel = y - top;
        if (rel < 0)
            adj.value += rel - 8;
        else if (rel + actor.height > this._scroll.height)
            adj.value += rel + actor.height - this._scroll.height + 8;
    }

    // A card changed (pin, edit, tags, delete): build it again next time.
    _forget(item) {
        const card = this._cards.get(item.id);
        if (card) {
            this._cards.delete(item.id);
            this._orphans.add(card);
        }
        this._version++;
    }

    _fill() {
        this._list.remove_all_children();  // the cards stay alive, cached
        for (const card of this._orphans)
            card.destroy();
        this._orphans.clear();
        this._empty?.destroy();
        this._empty = null;
        const ids = new Set(this._items.map(i => i.id));
        for (const [id, card] of this._cards) {  // entries that are gone
            if (!ids.has(id)) {
                card.destroy();
                this._cards.delete(id);
            }
        }
        const q = this._entry.get_text().toLowerCase().trim();
        const inTab = i => this._tab === 'all' || (this._tab === 'images' && i.image) ||
            (this._tab === 'text' && i.text) || (this._tab === 'pinned' && i.pinned);
        const matches = i => {
            if (!q)
                return true;
            const tags = (i.tags ?? []).map(t => `#${t}`);
            if (q.startsWith('#'))
                return tags.some(t => t.startsWith(q));
            return tags.some(t => t.includes(q)) ||
                (i.text ? i.text.toLowerCase().includes(q) : 'image picture screenshot'.includes(q));
        };
        const shown = [...this._items.filter(i => i.pinned), ...this._items.filter(i => !i.pinned)]
            .filter(i => inTab(i) && matches(i));
        this._filled = [this._version, this._tab, q];
        this._first = shown[0] ?? null;
        this._firstButton = null;
        if (!shown.length) {
            this._empty = new St.Label({text: q ? 'Nothing matches.' : 'Copy something and it shows up here.',
                style_class: 'mk-clip-empty'});
            this._list.add_child(this._empty);
            return;
        }
        // Cached cards go straight back in; new entries get theirs built, the
        // first few at once and the rest while idle, so no opening waits.
        if (this._fillId)
            GLib.source_remove(this._fillId);
        this._fillId = 0;
        const card = item => {
            let c = this._cards.get(item.id);
            if (!c) {
                c = this._card(item);
                this._cards.set(item.id, c);
            }
            return c;
        };
        this._firstButton = card(shown[0])._mkMain;
        const FIRST = 12, BATCH = 16;
        const ready = shown.findIndex((item, i) => i >= FIRST && !this._cards.has(item.id));
        const now = ready === -1 ? shown.length : ready;
        shown.slice(0, now).forEach(item => this._list.add_child(card(item)));
        let next = now;
        if (next < shown.length) {
            this._fillId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
                if (!this._shown) {  // closed before the last cards went in
                    this._fillId = 0;
                    this._filled = null;
                    return GLib.SOURCE_REMOVE;
                }
                shown.slice(next, next + BATCH).forEach(item => this._list.add_child(card(item)));
                next += BATCH;
                if (next < shown.length)
                    return GLib.SOURCE_CONTINUE;
                this._fillId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _card(item) {
        const card = new St.BoxLayout({style_class: item.pinned ? 'mk-clip-card pinned' : 'mk-clip-card'});
        const main = new St.Button({style_class: 'mk-clip-main', can_focus: true, x_expand: true,
            x_align: Clutter.ActorAlign.FILL});
        if (item.image) {
            const thumb = this._thumbPath(item);
            const ready = GLib.file_test(thumb, GLib.FileTest.EXISTS);
            const pic = new St.Widget({style_class: 'mk-clip-image',
                style: ready ? `background-image: url("file://${thumb}");` : ''});
            const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
            holder.add_child(pic);
            holder.add_child(new St.Label({text: item.w ? `${item.w} × ${item.h}` : 'Image', style_class: 'mk-clip-badge',
                x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true}));
            main.set_child(holder);
        } else {
            const label = new St.Label({text: item.text.split('\n').slice(0, 4).join('\n').slice(0, 400),
                style_class: 'mk-clip-text', x_expand: true});
            label.clutter_text.line_wrap = true;
            main.set_child(label);
        }
        if (item.tags?.length) {
            const column = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 4px;'});
            const content = main.get_child();
            main.set_child(column);
            column.add_child(content);
            column.add_child(new St.Label({text: item.tags.map(t => `#${t}`).join('  '), style_class: 'mk-clip-tags'}));
        }
        main.connect('clicked', () => this._copy(item));
        main.connect('key-press-event', (_a, event) => this._cardKey(main, item, event));
        card._mkMain = main;
        card.add_child(main);
        const tools = new St.BoxLayout({vertical: true, style_class: 'mk-clip-tools'});
        const tool = (icon, tip, fn) => {
            const b = new St.Button({style_class: 'mk-clip-tool', can_focus: true, accessible_name: tip,
                child: new St.Icon({icon_name: icon, icon_size: 14})});
            b.connect('clicked', fn);
            tools.add_child(b);
        };
        tool(item.pinned ? 'starred-symbolic' : 'non-starred-symbolic', item.pinned ? 'Unpin' : 'Pin', () => {
            item.pinned = !item.pinned;
            this._forget(item);
            this._save();
            this._fill();
        });
        if (item.image)
            tool('view-reveal-symbolic', 'Preview full size', () => this._preview(item));
        if (item.text)
            tool('document-edit-symbolic', 'Edit', () => this._edit(card, item));
        tool('bookmark-new-symbolic', 'Tags', () => this._tagEdit(card, item));
        tool('edit-delete-symbolic', 'Delete', () => {
            this._forget(item);
            this._items = this._items.filter(i => i !== item);
            if (item.image)
                removeFile(item.image);
                removeFile(this._thumbPath(item));
            this._save();
            this._fill();
        });
        card.add_child(tools);
        return card;
    }

    // The picture full size, inside the deck; Back (or Esc) returns.
    _preview(item) {
        this._filled = null;
        this._list.remove_all_children();
        if (this._preview_box)
            this._preview_box.destroy();
        const scale = Math.min(1, 500 / Math.max(1, item.w || 500), 360 / Math.max(1, item.h || 360));  // fits the deck
        const big = new St.Widget({style_class: 'mk-clip-preview', x_align: Clutter.ActorAlign.CENTER,
            width: Math.round((item.w || 500) * scale), height: Math.round((item.h || 360) * scale),
            style: `background-image: url("file://${item.image}");`});
        const row = new St.BoxLayout({style: 'spacing: 8px;', x_align: Clutter.ActorAlign.END});
        const back = new St.Button({label: 'Back', style_class: 'button', can_focus: true});
        back.connect('clicked', () => this._fill());
        const copy = new St.Button({label: 'Copy', style_class: 'button default', can_focus: true});
        copy.connect('clicked', () => this._copy(item));
        row.add_child(back);
        row.add_child(copy);
        this._preview_box = new St.BoxLayout({vertical: true, style: 'spacing: 8px;'});
        this._preview_box.add_child(big);
        this._preview_box.add_child(row);
        this._list.add_child(this._preview_box);
        global.stage.set_key_focus(copy);
    }

    // Tags: words to find an entry by (#code, #receipt), space-separated.
    _tagEdit(card, item) {
        this._forget(item);
        card.destroy_all_children();
        const entry = new St.Entry({text: (item.tags ?? []).join(' '), hint_text: 'Tags, e.g. code receipt',
            can_focus: true, x_expand: true, style_class: 'mk-clip-search'});
        const save = () => {
            item.tags = [...new Set(entry.get_text().toLowerCase().split(/[\s,#]+/).filter(Boolean))].slice(0, 8);
            this._save();
            this._fill();
        };
        entry.clutter_text.connect('activate', save);
        const ok = new St.Button({label: 'Save', style_class: 'button default', can_focus: true});
        ok.connect('clicked', save);
        card.add_child(entry);
        card.add_child(ok);
        global.stage.set_key_focus(entry.clutter_text);
    }

    // Change the text in place: Save keeps it in the history (and copies it).
    _edit(card, item) {
        this._forget(item);
        card.destroy_all_children();
        const column = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 6px;'});
        const entry = new St.Entry({text: item.text, can_focus: true, x_expand: true, style_class: 'mk-clip-edit'});
        entry.clutter_text.single_line_mode = false;
        entry.clutter_text.line_wrap = true;
        entry.clutter_text.activatable = false;
        column.add_child(entry);
        const row = new St.BoxLayout({style: 'spacing: 6px;', x_align: Clutter.ActorAlign.END});
        const cancel = new St.Button({label: 'Cancel', style_class: 'button', can_focus: true});
        cancel.connect('clicked', () => this._fill());
        const save = new St.Button({label: 'Save and copy', style_class: 'button default', can_focus: true});
        save.connect('clicked', () => {
            const text = entry.get_text();
            if (text.trim())
                item.text = text;
            this._copy(item);
        });
        row.add_child(cancel);
        row.add_child(save);
        column.add_child(row);
        card.add_child(column);
        global.stage.set_key_focus(entry.clutter_text);
    }

    _copy(item, paste = false) {
        if (item.image) {
            try {
                const [, data] = GLib.file_get_contents(item.image);
                this._clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(data));
            } catch (e) {
                return;
            }
        } else {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
        }
        this._toTop(i => i === item, () => item);
        this._hide();
        if (paste)
            this._pasteInto(this._target);
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('edit-copy-symbolic'), 'Copied: paste with Ctrl+V', null, null);
    }

    // Enter: back to the window you came from, then Ctrl+V there
    // (Ctrl+Shift+V in a terminal).
    _pasteInto(target) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
            if (target && !target.has_focus())
                Main.activateWindow(target);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._keyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                const keys = TERMINALS.test(target?.get_wm_class() ?? '')
                    ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v] : [Clutter.KEY_Control_L, Clutter.KEY_v];
                const t = GLib.get_monotonic_time();
                keys.forEach(k => this._keyboard.notify_keyval(t, k, Clutter.KeyState.PRESSED));
                [...keys].reverse().forEach(k => this._keyboard.notify_keyval(t, k, Clutter.KeyState.RELEASED));
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _clear() {
        for (const item of this._items.filter(i => !i.pinned && i.image)) {
            removeFile(item.image);
            removeFile(this._thumbPath(item));
        }
        this._items = this._items.filter(i => i.pinned);
        this._save();
        this._fill();
    }
}

export function bindClipboardHistory(extension, history) {
    Main.wm.addKeybinding('clipboard-history', extension.getSettings(), Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => history.open());
}

export function unbindClipboardHistory() {
    Main.wm.removeKeybinding('clipboard-history');
}
