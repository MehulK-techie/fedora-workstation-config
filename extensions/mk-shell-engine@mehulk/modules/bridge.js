// MK Shell Engine: a small session D-Bus door for your own tools (Spidey, scripts, a keyboard
// macro), on GNOME Shell's own bus name, so nothing new owns a name:
//
//   gdbus call --session --dest org.gnome.Shell --object-path /org/mk/ShellEngine \
//       --method org.mk.ShellEngine.DeepFocus toggle          # on | off | toggle | status -> b
//   ... --method org.mk.ShellEngine.Wallpaper pause           # pause | resume | status   -> s
//   ... --method org.mk.ShellEngine.Island 'emblem-ok-symbolic' 'Done'
//   ... --method org.mk.ShellEngine.Screenshot false             # true: the focused window -> s
//
// Screenshot: GNOME only lets its own allow-listed apps use org.gnome.Shell.Screenshot, so Spidey's
// "See Screen" asks here. The picture always goes to $XDG_RUNTIME_DIR/spidey/screen.png (yours
// only, in RAM, never a path the caller picks), and every capture shows in the Dynamic Island
// ("Spidey looked at your screen"), so it can't happen without you seeing it.
//
// Unlock: locking takes the engine's parts down and unlocking builds them again, so a bridge built
// right after a lock runs `~/.local/bin/spidey --greet --unlock` (if Spidey is installed) 1.5 s
// later, once the unlock has settled; Spidey itself decides whether this part of the day was
// already greeted, and its config's "greet": false silences it.
//
// Only your session's bus reaches it (the same user who could press the keys). Idle it costs
// nothing: one exported object, no timers.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { UNIFIED } from './conflicts.js';

const PATH = '/org/mk/ShellEngine';
const SPIDEY = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'spidey']);
const GREET_DELAY_MS = 1500;

let lockedAway = false;              // (set as the bridge goes down for the lock screen)
const XML = `<node>
  <interface name="org.mk.ShellEngine">
    <method name="DeepFocus">
      <arg type="s" direction="in" name="action"/>
      <arg type="b" direction="out" name="on"/>
    </method>
    <method name="Wallpaper">
      <arg type="s" direction="in" name="action"/>
      <arg type="s" direction="out" name="state"/>
    </method>
    <method name="Screenshot">
      <arg type="b" direction="in" name="window"/>
      <arg type="s" direction="out" name="path"/>
    </method>
    <method name="Island">
      <arg type="s" direction="in" name="icon"/>
      <arg type="s" direction="in" name="text"/>
    </method>
  </interface>
</node>`;

export class Bridge {
    constructor(getDeepFocus) {
        this._getDeepFocus = getDeepFocus;
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._dbus.export(Gio.DBus.session, PATH);
        if (lockedAway) {
            lockedAway = false;
            this._greetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GREET_DELAY_MS, () => {
                this._greetId = 0;
                this._greet();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _greet() {
        if (Main.sessionMode.isLocked || !GLib.file_test(SPIDEY, GLib.FileTest.IS_EXECUTABLE))
            return;
        try {
            Gio.Subprocess.new([SPIDEY, '--greet', '--unlock'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.warn(`mk-shell-engine: spidey greet: ${e.message}`);
        }
    }

    _desktop() {
        return Main.extensionManager.lookup(UNIFIED)?.stateObj?._desktop ?? null;
    }

    DeepFocus(action) {
        const focus = this._getDeepFocus();
        if (!focus)
            throw new Error('Deep Focus is not running');
        const on = Boolean(focus._on);
        if (action === 'toggle' || (action === 'on' && !on) || (action === 'off' && on))
            focus.toggle();
        else if (!['on', 'off', 'status'].includes(action))
            throw new Error(`unknown action ${action}: on, off, toggle or status`);
        return Boolean(focus._on);
    }

    Wallpaper(action) {
        const desktop = this._desktop();
        if (!desktop?.setHeld)
            return 'none';                               // (no live wallpaper on the desktop)
        if (action === 'pause' || action === 'resume')
            desktop.setHeld(action === 'pause');
        else if (action !== 'status')
            throw new Error(`unknown action ${action}: pause, resume or status`);
        return desktop._held ? 'paused' : 'playing';
    }

    Island(icon, text) {
        Main.panel._mkIsland?.show({icon: icon || 'dialog-information-symbolic', text});
    }

    ScreenshotAsync([window], invocation) {
        const fail = message => invocation.return_dbus_error('org.mk.ShellEngine.Error.Failed', message);
        let path, stream;
        try {
            const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'spidey']);
            GLib.mkdir_with_parents(dir, 0o700);
            path = GLib.build_filenamev([dir, 'screen.png']);
            stream = Gio.File.new_for_path(path).replace(null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            fail(e.message);
            return;
        }
        const shooter = new Shell.Screenshot();
        const done = (obj, res) => {
            try {
                if (window)
                    obj.screenshot_window_finish(res);
                else
                    obj.screenshot_finish(res);
                stream.close(null);
            } catch (e) {
                try {
                    stream.close(null);
                } catch {}
                fail(e.message);                     // (no focused window, say: Spidey takes the screen)
                return;
            }
            Main.panel._mkIsland?.show({icon: 'camera-photo-symbolic', text: 'Spidey looked at your screen'});
            invocation.return_value(new GLib.Variant('(s)', [path]));
        };
        if (window)
            shooter.screenshot_window(false, false, stream, done);
        else
            shooter.screenshot(false, stream, done);
    }

    destroy() {
        if (this._greetId)
            GLib.source_remove(this._greetId);
        this._greetId = 0;
        if (Main.sessionMode.isLocked)
            lockedAway = true;
        this._dbus?.unexport();
        this._dbus = null;
    }
}
