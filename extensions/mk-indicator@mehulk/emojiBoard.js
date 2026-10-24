// Emoji board (Super+.): search or browse, click (or Enter) and the emoji is
// typed where your cursor is, in any app. No copy-paste step.
//
// Typing goes through GNOME's own input method (the same path as IBus), which
// GTK, Qt, Firefox and Chromium apps accept. For an app that doesn't take it,
// the emoji goes on the clipboard and the board presses Ctrl+V (Ctrl+Shift+V
// in terminals). Recent picks come first; emoji.json is generated from the
// Unicode character names.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const RECENT = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'emoji-recent.json']);
const COLUMNS = 10, MAX_SHOWN = 240;
const TABS = [['recent', '🕘'], ['smileys', '😀'], ['people', '👋'], ['nature', '🌿'], ['food', '🍕'],
    ['activities', '⚽'], ['travel', '✈️'], ['objects', '💡'], ['symbols', '❤️']];
const TERMINALS = /terminal|ptyxis|kgx|console|kitty|alacritty|wezterm|ghostty|foot|tilix|konsole/i;

function readJson(path, fallback) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? JSON.parse(new TextDecoder().decode(bytes)) : fallback;
    } catch (e) {
        return fallback;
    }
}

export class EmojiBoard {
    constructor(dir) {
        this._all = readJson(GLib.build_filenamev([dir, 'emoji.json']), []);
    }

    open() {
        if (this._dialog)
            return;
        this._target = global.display.focus_window;
        const dialog = new ModalDialog.ModalDialog({styleClass: 'mk-emoji-dialog', destroyOnClose: true});
        this._dialog = dialog;
        const box = dialog.contentLayout;
        this._entry = new St.Entry({hint_text: 'Search emoji (heart, laugh, pizza…)', can_focus: true,
            style_class: 'mk-emoji-search', x_expand: true});
        box.add_child(this._entry);
        const tabs = new St.BoxLayout({style_class: 'mk-emoji-tabs'});
        this._tabButtons = TABS.map(([key, icon]) => {
            const b = new St.Button({label: icon, style_class: 'mk-emoji-tab', can_focus: true, toggle_mode: true,
                style: 'font-size: 18px;'});
            b.connect('clicked', () => this._show(key));
            tabs.add_child(b);
            return [key, b];
        });
        box.add_child(tabs);
        this._grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_homogeneous: true}),
            style_class: 'mk-emoji-grid'});
        // A ScrollView needs a scrollable child: the grid sits in a box.
        const holder = new St.BoxLayout({vertical: true});
        holder.add_child(this._grid);
        const scroll = new St.ScrollView({style_class: 'mk-emoji-scroll', child: holder,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        box.add_child(scroll);
        this._entry.clutter_text.connect('text-changed', () => this._search());
        this._entry.clutter_text.connect('activate', () => this._first && this._pick(this._first));
        dialog.addButton({label: 'Close', action: () => dialog.close(), key: Clutter.KEY_Escape});
        dialog.connect('destroy', () => {
            this._dialog = null;
        });
        const recent = readJson(RECENT, []);
        this._show(recent.length ? 'recent' : 'smileys');
        dialog.open();
        global.stage.set_key_focus(this._entry.clutter_text);
    }

    _show(tab) {
        this._tab = tab;
        for (const [key, b] of this._tabButtons)
            b.checked = key === tab;
        const list = tab === 'recent'
            ? readJson(RECENT, []).map(ch => this._all.find(e => e[0] === ch) ?? [ch, '', 'recent'])
            : this._all.filter(e => e[2] === tab);
        this._fill(list);
    }

    _search() {
        const words = this._entry.get_text().toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) {
            this._show(this._tab === 'search' ? 'smileys' : this._tab);
            return;
        }
        this._tab = 'search';
        for (const [, b] of this._tabButtons)
            b.checked = false;
        this._fill(this._all.filter(e => words.every(w => e[1].includes(w))));
    }

    _fill(list) {
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        list = list.slice(0, MAX_SHOWN);
        this._first = list[0]?.[0] ?? null;
        list.forEach(([ch, name], i) => {
            const b = new St.Button({label: ch, style_class: 'mk-emoji-cell', can_focus: true,
                style: 'font-size: 26px;'});
            if (name)
                b.accessible_name = name;
            b.connect('clicked', () => this._pick(ch));
            layout.attach(b, i % COLUMNS, Math.floor(i / COLUMNS), 1, 1);
        });
    }

    _pick(ch) {
        const recent = [ch, ...readJson(RECENT, []).filter(c => c !== ch)].slice(0, 30);
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(RECENT), 0o755);
            GLib.file_set_contents(RECENT, JSON.stringify(recent));
        } catch (e) {
            // recents are a nicety
        }
        const target = this._target;
        this._dialog?.close();
        // Give focus back to the app, then type into it.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            if (target && !target.has_focus())
                Main.activateWindow(target);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                this._type(ch, target);
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _type(ch, target) {
        if (Main.inputMethod.currentFocus) {
            Main.inputMethod.commit(ch);
            return;
        }
        // The app doesn't take input-method text: paste it instead.
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, ch);
        const seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const terminal = TERMINALS.test(target?.get_wm_class() ?? '');
        const t = GLib.get_monotonic_time();
        const keys = terminal ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v] : [Clutter.KEY_Control_L, Clutter.KEY_v];
        keys.forEach(k => this._keyboard.notify_keyval(t, k, Clutter.KeyState.PRESSED));
        [...keys].reverse().forEach(k => this._keyboard.notify_keyval(t, k, Clutter.KeyState.RELEASED));
    }

    destroy() {
        this._dialog?.close();
        this._keyboard?.run_dispose();
        this._keyboard = null;
    }
}

export function bindEmojiBoard(extension, board) {
    Main.wm.addKeybinding('emoji-board', extension.getSettings(), Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => board.open());
}

export function unbindEmojiBoard() {
    Main.wm.removeKeybinding('emoji-board');
}
