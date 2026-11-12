// MK Shell Engine: a small session D-Bus door for your own tools (Spidey, scripts, a keyboard
// macro), on GNOME Shell's own bus name, so nothing new owns a name:
//
//   gdbus call --session --dest org.gnome.Shell --object-path /org/mk/ShellEngine \
//       --method org.mk.ShellEngine.DeepFocus toggle          # on | off | toggle | status -> b
//   ... --method org.mk.ShellEngine.Wallpaper pause           # pause | resume | status   -> s
//   ... --method org.mk.ShellEngine.Island 'emblem-ok-symbolic' 'Done'
//
// Only your session's bus reaches it (the same user who could press the keys). Idle it costs
// nothing: one exported object, no timers.
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { UNIFIED } from './conflicts.js';

const PATH = '/org/mk/ShellEngine';
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

    destroy() {
        this._dbus?.unexport();
        this._dbus = null;
    }
}
