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
        this._clipboard = St.Clipboard.get_default();
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
        this._dialog?.close();
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
            for (const item of this._items.filter(i => drop.has(i.id) && i.image))
                removeFile(item.image);
            this._items = this._items.filter(i => !drop.has(i.id));
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
            return {id, image: path, sum, w, h};
        });
    }

    // ---------------------------------------------------------------- the window
    open() {
        if (this._dialog)
            return;
        const dialog = new ModalDialog.ModalDialog({styleClass: 'mk-clip-dialog', destroyOnClose: true});
        this._dialog = dialog;
        // The backdrop: dimmed and blurred; a click on it closes the deck.
        if (dialog._lightbox) {
            dialog._lightbox.add_effect(new Shell.BlurEffect({radius: 24, brightness: 0.55,
                mode: Shell.BlurMode.BACKGROUND}));
            dialog._lightbox.connect('button-press-event', () => {
                dialog.close();
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
        const scroll = new St.ScrollView({style_class: 'mk-clip-scroll', child: this._list,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        box.add_child(scroll);
        this._entry.clutter_text.connect('text-changed', () => this._fill());
        this._entry.clutter_text.connect('activate', () => this._first && this._copy(this._first));
        this._entry.clutter_text.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Down || !this._firstButton)
                return Clutter.EVENT_PROPAGATE;
            this._firstButton.grab_key_focus();
            return Clutter.EVENT_STOP;
        });
        dialog.addButton({label: 'Close', action: () => dialog.close(), key: Clutter.KEY_Escape});
        dialog.connect('destroy', () => {
            this._dialog = null;
        });
        this._fill();
        dialog.open();
        global.stage.set_key_focus(this._entry.clutter_text);
    }

    _fill() {
        this._list.destroy_all_children();
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
        this._first = shown[0] ?? null;
        this._firstButton = null;
        if (!shown.length) {
            this._list.add_child(new St.Label({text: q ? 'Nothing matches.' : 'Copy something and it shows up here.',
                style_class: 'mk-clip-empty'}));
            return;
        }
        for (const item of shown)
            this._list.add_child(this._card(item));
    }

    _card(item) {
        const card = new St.BoxLayout({style_class: item.pinned ? 'mk-clip-card pinned' : 'mk-clip-card'});
        const main = new St.Button({style_class: 'mk-clip-main', can_focus: true, x_expand: true,
            x_align: Clutter.ActorAlign.FILL});
        if (item.image) {
            const pic = new St.Widget({style_class: 'mk-clip-image',
                style: `background-image: url("file://${item.image}");`});
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
        this._firstButton ??= main;
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
            this._save();
            this._fill();
        });
        if (item.image)
            tool('view-reveal-symbolic', 'Preview full size', () => this._preview(item));
        if (item.text)
            tool('document-edit-symbolic', 'Edit', () => this._edit(card, item));
        tool('bookmark-new-symbolic', 'Tags', () => this._tagEdit(card, item));
        tool('edit-delete-symbolic', 'Delete', () => {
            this._items = this._items.filter(i => i !== item);
            if (item.image)
                removeFile(item.image);
            this._save();
            this._fill();
        });
        card.add_child(tools);
        return card;
    }

    // The picture full size, inside the deck; Back (or Esc) returns.
    _preview(item) {
        this._list.destroy_all_children();
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
        this._list.add_child(big);
        this._list.add_child(row);
        global.stage.set_key_focus(copy);
    }

    // Tags: words to find an entry by (#code, #receipt), space-separated.
    _tagEdit(card, item) {
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

    _copy(item) {
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
        this._dialog?.close();
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('edit-copy-symbolic'), 'Copied: paste with Ctrl+V', null, null);
    }

    _clear() {
        for (const item of this._items.filter(i => !i.pinned && i.image))
            removeFile(item.image);
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
