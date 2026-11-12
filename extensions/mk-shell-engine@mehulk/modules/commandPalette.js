// MK Shell Engine: the command palette (Super+Space, `command-palette`): a 560 px frosted search bar.
// Type, and it filters as you go; Up / Down pick, Enter runs, Esc closes:
//   your open windows on every workspace (app icon, title, a workspace badge): Enter goes to it
//   the shell's actions: Shuffle Wallpaper, Pick Screen Color, Area Snip, OCR Text Snip, Free RAM
//     Cache, Toggle Caffeine, Lock Screen
//   math: 1450 * 1.18 shows the answer (calc.js, never eval); Enter copies it
//   ? a question: opens S.P.I.D.E.Y with the question on the clipboard to paste
// Taken through modal.js (top-bar menus closed first, an 8 s idle failsafe).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { evaluate, format } from './calc.js';
import { openModal } from './modal.js';

const WIDTH = 560, MAX_ROWS = 8;
const BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin']);

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        return true;
    } catch (e) {
        console.warn(`mk-shell-engine: palette: ${argv[0]}: ${e.message}`);
        return false;
    }
}

function caffeine() {
    const ext = Main.extensionManager.lookup('caffeine@patapon.info');
    const dir = ext?.dir?.get_child('schemas')?.get_path();
    if (!dir)
        return null;
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.caffeine', false);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

export class CommandPalette {
    // actions: {shuffle(), pickColor()} from the engine's other parts
    constructor(settings, actions) {
        this._actions = actions;
        Main.wm.addKeybinding('command-palette', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.open());
    }

    _builtins() {
        const a = this._actions;
        return [
            ['Shuffle Wallpaper', 'media-playlist-shuffle-symbolic', () => a.shuffle?.()],
            ['Pick Screen Color', 'color-select-symbolic', () => a.pickColor?.()],
            ['Area Snip', 'screenshot-recorded-symbolic', () => Main.screenshotUI?.open()],
            ['OCR Text Snip', 'insert-text-symbolic', () => spawn([`${BIN}/ocr-snip`])],
            ['Free RAM Cache', 'drive-harddisk-solidstate-symbolic',
                () => GLib.file_test('/usr/local/libexec/mk-drop-caches', GLib.FileTest.IS_EXECUTABLE)
                    ? spawn(['pkexec', '/usr/local/libexec/mk-drop-caches'])
                    : Main.panel._mkIsland?.show({icon: 'dialog-information-symbolic', text: 'Free RAM needs sudo ./setup.sh once'})],
            ['Toggle Caffeine', 'my-caffeine-on-symbolic', () => {
                const s = caffeine();
                if (s) {
                    s.set_boolean('toggle-state', !s.get_boolean('toggle-state'));
                    Main.panel._mkIsland?.show({icon: 'weather-clear-symbolic',
                        text: s.get_boolean('toggle-state') ? 'Caffeine on: the screen stays awake' : 'Caffeine off'});
                } else {
                    Main.panel._mkIsland?.show({icon: 'dialog-information-symbolic', text: 'Caffeine isn\'t installed'});
                }
            }],
            ['Lock Screen', 'system-lock-screen-symbolic', () => Main.screenShield?.lock(true)],
        ].map(([title, icon, run]) => ({title, icon, run, kind: 'action'}));
    }

    _windows() {
        const tracker = Shell.WindowTracker.get_default();
        return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).map(win => {
            const app = tracker.get_window_app(win);
            const ws = win.get_workspace();
            return {title: win.get_title() || app?.get_name() || 'Window', sub: app?.get_name() ?? '',
                gicon: app?.get_icon(), badge: ws ? `${ws.index() + 1}` : '', kind: 'window',
                run: () => Main.activateWindow(win)};
        });
    }

    open() {
        if (this._actor)
            return;
        const m = Main.layoutManager.primaryMonitor;
        this._actor = new St.Widget({reactive: true, x: m.x, y: m.y, width: m.width, height: m.height,
            style: 'background-color: rgba(0,0,0,0.22);', opacity: 0});
        this._actor.connect('button-press-event', (_a, e) => {
            if (e.get_source() === this._actor)
                this.close();
            return Clutter.EVENT_STOP;
        });
        const card = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-palette',
            reactive: true, width: WIDTH});
        this._entry = new St.Entry({hint_text: 'Windows, actions, 1450 * 1.18, or ? ask S.P.I.D.E.Y', can_focus: true,
            style_class: 'mk-palette-entry', x_expand: true});
        this._entry.clutter_text.connect('text-changed', () => this._refresh());
        this._entry.clutter_text.connect('activate', () => this._run());
        this._entry.clutter_text.connect('key-press-event', (_a, e) => this._key(e));
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-palette-list'});
        card.add_child(this._entry);
        card.add_child(this._list);
        this._actor.add_child(card);
        card.set_position(Math.round((m.width - WIDTH) / 2), Math.round(m.height * 0.2));
        Main.layoutManager.addTopChrome(this._actor);
        this._modal = openModal(this._actor, () => this.close());
        if (!this._modal) {
            this.close();
            return;
        }
        this._all = [...this._windows(), ...this._builtins()];
        this._refresh();
        this._entry.grab_key_focus();
        this._actor.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        card.set_pivot_point(0.5, 0);
        card.set_scale(0.96, 0.96);
        card.ease({scale_x: 1, scale_y: 1, duration: 190, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    _refresh() {
        const text = this._entry.get_text().trim();
        const q = text.toLowerCase();
        let rows;
        if (text.startsWith('?')) {
            const question = text.slice(1).trim();
            rows = [{title: question ? `Ask S.P.I.D.E.Y: ${question}` : 'Ask S.P.I.D.E.Y…', icon: 'dialog-question-symbolic',
                kind: 'ai', run: () => {
                    if (question)
                        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, question);
                    const toggle = `${BIN}/spidey-toggle`;
                    if (!GLib.file_test(toggle, GLib.FileTest.IS_EXECUTABLE) || !spawn([toggle]))
                        Main.panel._mkIsland?.show({icon: 'dialog-information-symbolic', text: 'S.P.I.D.E.Y isn\'t installed'});
                    else if (question)
                        Main.panel._mkIsland?.show({icon: 'edit-paste-symbolic', text: 'Your question is copied: paste it in'});
                }}];
        } else {
            const value = evaluate(text);
            rows = value !== null ? [{title: `= ${format(value)}`, sub: text, icon: 'accessories-calculator-symbolic',
                kind: 'math', run: () => {
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(Number(value.toPrecision(10))));
                    Main.panel._mkIsland?.show({icon: 'accessories-calculator-symbolic', text: `${format(value)} copied`});
                }}] : [];
            rows.push(...this._all.filter(r => !q || r.title.toLowerCase().includes(q) || r.sub?.toLowerCase().includes(q)));
        }
        this._rows = rows.slice(0, MAX_ROWS);
        this._list.destroy_all_children();
        this._rows.forEach((row, i) => {
            const box = new St.BoxLayout({style_class: 'mk-palette-row', reactive: true, track_hover: true, x_expand: true});
            box.add_child(row.gicon ? new St.Icon({gicon: row.gicon, icon_size: 22}) : new St.Icon({icon_name: row.icon, icon_size: 18}));
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            text.add_child(new St.Label({text: row.title, style_class: 'mk-palette-title'}));
            if (row.sub && row.kind === 'window')
                text.add_child(new St.Label({text: row.sub, style_class: 'mk-palette-sub'}));
            box.add_child(text);
            if (row.badge)
                box.add_child(new St.Label({text: row.badge, style_class: 'mk-palette-badge', y_align: Clutter.ActorAlign.CENTER}));
            box.connect('button-press-event', () => {
                this._index = i;
                this._run();
                return Clutter.EVENT_STOP;
            });
            box.connect('notify::hover', () => box.hover && this._select(i));
            this._list.add_child(box);
        });
        this._select(0);
    }

    _select(i) {
        const rows = this._list.get_children();
        if (!rows.length)
            return;
        this._index = Math.max(0, Math.min(rows.length - 1, i));
        rows.forEach((r, k) => (k === this._index ? r.add_style_class_name : r.remove_style_class_name).call(r, 'selected'));
    }

    _key(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
            this._select(this._index + (key === Clutter.KEY_Down ? 1 : -1));
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _run() {
        const row = this._rows?.[this._index ?? 0];
        this.close();
        if (!row)
            return;
        // after the palette is gone (an action that takes the screen, a snip, the picker, needs it closed)
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                row.run();
            } catch (e) {
                console.warn(`mk-shell-engine: palette: ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        this._modal?.close();
        this._modal = null;
        if (!this._actor)
            return;
        const actor = this._actor;
        this._actor = this._entry = this._list = null;
        Main.layoutManager.removeChrome(actor);
        actor.destroy();
    }

    destroy() {
        this.close();
        Main.wm.removeKeybinding('command-palette');
    }
}
