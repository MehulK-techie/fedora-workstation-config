// MK Shell Engine: what the top bar's app menu and the dock's right-click menu
// can do with an app, in one place.
//   about(app)        its page in Software (name, description, version)
//   preferences(app)  its own Preferences, by the shortcut nearly every app
//                     uses for them (Ctrl+,), sent to its window
//   hide(app)         minimize all its windows
//   forceQuit(app)    for an app that has stopped answering: asks first, then
//                     ends its processes at once (SIGKILL). Unsaved work in it
//                     is lost, which is why it asks; never offered for GNOME
//                     Shell itself.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const SHELL_PID = new Gio.Credentials().get_unix_pid();

export function about(app) {
    const id = app.get_id()?.replace(/\.desktop$/, '');
    try {
        Gio.Subprocess.new(['gnome-software', `--details=${id}`], Gio.SubprocessFlags.NONE);
    } catch {
        const info = app.get_app_info();
        Main.notify(app.get_name(), info?.get_description() || info?.get_generic_name() || id);
    }
}

export function hide(app) {
    for (const win of app.get_windows())
        win.minimize();
}

// Ctrl+, to the app's window: GNOME, KDE, VS Code, browsers and most others open their
// preferences with it
export function preferences(app) {
    const win = app.get_windows()[0];
    if (!win)
        return;
    Main.activateWindow(win);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            const kb = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const t = GLib.get_monotonic_time();
            kb.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            kb.notify_keyval(t + 1, Clutter.KEY_comma, Clutter.KeyState.PRESSED);
            kb.notify_keyval(t + 2, Clutter.KEY_comma, Clutter.KeyState.RELEASED);
            kb.notify_keyval(t + 3, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        } catch (e) {
            console.warn(`mk-shell-engine: preferences: ${e.message}`);
        }
        return GLib.SOURCE_REMOVE;
    });
}

function pidsOf(app) {
    return [...new Set(app.get_windows().map(w => w.get_pid()))].filter(pid => pid > 1 && pid !== SHELL_PID);
}

export function canForceQuit(app) {
    return pidsOf(app).length > 0;
}

export function forceQuit(app) {
    const pids = pidsOf(app);
    if (!pids.length)
        return;
    const dialog = new ModalDialog.ModalDialog({styleClass: 'mk-force-quit'});
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'spacing: 8px; padding: 6px 12px;'});
    box.add_child(new St.Label({text: `Force Quit ${app.get_name()}?`, style: 'font-weight: 800; font-size: 1.15em;'}));
    box.add_child(new St.Label({text: 'It closes at once. Anything not saved in it is lost.'}));
    dialog.contentLayout.add_child(box);
    dialog.addButton({label: 'Cancel', action: () => dialog.close(), key: Clutter.KEY_Escape});
    dialog.addButton({label: 'Force Quit', default: true, action: () => {
        dialog.close();
        for (const pid of pids) {
            try {
                Gio.Subprocess.new(['kill', '-KILL', `${pid}`], Gio.SubprocessFlags.STDERR_SILENCE);
            } catch (e) {
                console.warn(`mk-shell-engine: force quit ${pid}: ${e.message}`);
            }
        }
    }});
    dialog.open();
}
