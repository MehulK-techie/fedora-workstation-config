// Windows come to the front when you ask for them. Apps often can't raise
// their own window on Wayland (no activation token from a notification click
// or a D-Bus call), so GNOME shows "<app> is ready" instead. If a window asks
// for attention within 3 seconds of you clicking a notification or "Open
// player", it is brought to the front. Windows asking at any other time still
// get GNOME's usual "is ready" notification: nothing steals focus while you type.
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const WINDOW_US = 3 * 1000 * 1000;
let expectUntil = 0;

// Call when the user just asked for some app's window.
export function expectFocus() {
    expectUntil = GLib.get_monotonic_time() + WINDOW_US;
}

export class FocusHelper {
    enable() {
        this._displayIds = ['window-demands-attention', 'window-marked-urgent'].map(signal =>
            global.display.connect(signal, (_d, win) => this._attention(win)));
        this._sourceIds = new Map();
        this._noteIds = new Map();
        const watch = source => {
            if (!this._sourceIds.has(source)) {
                this._sourceIds.set(source, source.connect('notification-added', (_s, note) => {
                    const id = note.connect('activated', () => expectFocus());
                    this._noteIds.set(note, id);
                    note.connect('destroy', () => this._noteIds.delete(note));
                }));
            }
        };
        Main.messageTray.getSources().forEach(watch);
        this._trayIds = [
            Main.messageTray.connect('source-added', (_t, source) => watch(source)),
            Main.messageTray.connect('source-removed', (_t, source) => {
                const id = this._sourceIds.get(source);
                if (id)
                    source.disconnect(id);
                this._sourceIds.delete(source);
            }),
        ];
    }

    _attention(win) {
        if (GLib.get_monotonic_time() > expectUntil || win.skip_taskbar)
            return;
        expectUntil = 0;
        Main.activateWindow(win);
    }

    disable() {
        this._displayIds?.forEach(id => global.display.disconnect(id));
        this._trayIds?.forEach(id => Main.messageTray.disconnect(id));
        for (const [source, id] of this._sourceIds ?? [])
            source.disconnect(id);
        for (const [note, id] of this._noteIds ?? [])
            note.disconnect(id);
        this._displayIds = this._trayIds = this._sourceIds = this._noteIds = null;
    }
}
