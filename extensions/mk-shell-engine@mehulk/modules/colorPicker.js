// MK Shell Engine: the eyedropper. Its button in the top bar (right side) turns the pointer into a
// crosshair: click anywhere and that pixel's colour is copied as #rrggbb (the clipboard history then
// shows it with a swatch), with a notice in the Dynamic Island. Esc or a right click: nothing.
// The pixel comes from GNOME Shell's own Shell.Screenshot.pick_color: nothing leaves the shell.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { openModal } from './modal.js';

const Eyedropper = GObject.registerClass(class MkEyedropper extends PanelMenu.Button {
    constructor(onClick) {
        super(0.5, 'Color picker', true);
        this.add_child(new St.Icon({icon_name: 'color-select-symbolic', style_class: 'system-status-icon'}));
        // on release, once the click is over: the overlay takes the pointer only after this
        // button has let it go (taking it mid-click left the two fighting over it)
        this.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.connect('button-release-event', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                onClick();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_STOP;
        });
    }
});

export class ColorPicker {
    constructor() {
        this._button = new Eyedropper(() => this.pick());
        Main.panel.addToStatusArea('mk-eyedropper', this._button, 0, 'right');
    }

    pick() {
        if (this._overlay)
            return;
        const stage = global.stage;
        this._overlay = new St.Widget({reactive: true, x: 0, y: 0, width: stage.width, height: stage.height});
        Main.layoutManager.addTopChrome(this._overlay);
        this._modal = openModal(this._overlay, () => this._end());
        if (!this._modal) {
            this._end();
            return;
        }
        global.display.set_cursor(Meta.Cursor.CROSSHAIR);
        this._overlay.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
                this._end();
                return Clutter.EVENT_STOP;
            }
            const [x, y] = event.get_coords();
            this._end();
            this._read(Math.round(x), Math.round(y));
            return Clutter.EVENT_STOP;
        });
        this._overlay.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this._end();
            return Clutter.EVENT_STOP;
        });
    }

    _read(x, y) {
        const shot = new Shell.Screenshot();
        shot.pick_color(x, y, (_s, res) => {
            try {
                const [ok, colour] = shot.pick_color_finish(res);
                if (!ok)
                    throw new Error('no colour');
                const hex = `#${[colour.red, colour.green, colour.blue].map(v => v.toString(16).padStart(2, '0')).join('')}`;
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, hex);
                Main.panel._mkIsland?.show({icon: 'color-select-symbolic', text: `${hex} copied`});
            } catch (e) {
                console.warn(`mk-shell-engine: color picker: ${e.message}`);
            }
        });
    }

    _end() {
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this._modal?.close();
        this._modal = null;
        if (this._overlay) {
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
        }
        this._overlay = null;
    }

    destroy() {
        this._end();
        this._button.destroy();
    }
}
