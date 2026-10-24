// Windows come to the front when you ask for them. Apps often can't raise
// their own window on Wayland (no activation token from a notification click
// or a D-Bus call), so GNOME shows "<app> is ready" instead. If a window asks
// for attention within 3 seconds of you clicking that app's notification or
// "Open player", it is brought to the front, once. Other apps' windows, and
// windows asking at any other time, still get GNOME's usual "is ready"
// notification: nothing steals focus while you type.
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const WINDOW_US = 3 * 1000 * 1000;
let expected = null;   // {app, until}

// Call when the user just asked for this app's window (a Shell.App).
export function expectFocus(app) {
    expected = app ? {app, until: GLib.get_monotonic_time() + WINDOW_US} : null;
}

// The app behind a notification: Fdo sources keep it in .app, GTK ones in ._app.
function notificationApp(note) {
    const source = note.source;
    return source?.app ?? source?._app ?? null;
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
                    const id = note.connect('activated', () => expectFocus(notificationApp(note)));
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
        if (!expected || GLib.get_monotonic_time() > expected.until || win.skip_taskbar)
            return;
        if (Shell.WindowTracker.get_default().get_window_app(win) !== expected.app)
            return;
        expected = null;
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
