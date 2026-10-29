// A screensaver scene as the desktop wallpaper (LIVE_WALLPAPER=on in
// screensaver.conf, or the switch in MK Control Center). The same Python
// scenes as the lock screen: mk-screensaver renders frames at half the
// screen's size, 15 a second, into $XDG_RUNTIME_DIR, shown here above
// GNOME's own wallpaper and below every window.
//
// It only draws while you can see it: it pauses when a window is
// maximized or full screen on the primary monitor, while the screen is
// locked or blanked, and the renderer runs at low priority.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { saverConf } from './lockScene.js';

const FRAME = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'mk-livewall.raw']);
const SAVER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-screensaver']);
const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'screensaver.conf']);

export class LiveWallpaper {
    enable() {
        this._confMonitor = Gio.File.new_for_path(USER_CONF).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._confMonitor.connect('changed', () => this._reload());
        this._monitors = global.backend.get_monitor_manager();
        this._monitors.connectObject('power-save-mode-changed', () => this._sync(), this);
        global.display.connectObject(
            'restacked', () => this._sync(),
            'in-fullscreen-changed', () => this._sync(), this);
        global.window_manager.connectObject('size-changed', () => this._sync(), this);
        Main.sessionMode.connectObject('updated', () => this._sync(), this);
        this._reload();
    }

    _reload() {
        const conf = saverConf();
        const on = conf.LIVE_WALLPAPER === 'on' && GLib.file_test(SAVER, GLib.FileTest.EXISTS);
        const scene = conf.LIVE_SCENE || 'aurora';
        if (this._actor && (!on || scene !== this._scene))
            this._teardown();
        this._scene = scene;
        if (on && !this._actor)
            this._build();
        this._sync();
    }

    _build() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._w = Math.round(monitor.width / 2);
        this._h = Math.round(monitor.height / 2);
        this._content = St.ImageContent.new_with_preferred_size(this._w, this._h);
        this._actor = new St.Widget({x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            content: this._content, content_gravity: Clutter.ContentGravity.RESIZE_FILL, opacity: 0, reactive: false});
        // Above GNOME's wallpaper, below the windows.
        Main.layoutManager._backgroundGroup.add_child(this._actor);
        this._lastMtime = 0;
        this._shown = false;
    }

    // Is anything covering the whole primary monitor?
    _covered() {
        const primary = global.display.get_primary_monitor();
        const ws = global.workspace_manager.get_active_workspace();
        return ws.list_windows().some(w => w.get_monitor() === primary && !w.minimized &&
            w.window_type === Meta.WindowType.NORMAL &&
            (w.is_fullscreen() || w.is_maximized()));
    }

    _sync() {
        if (!this._actor)
            return;
        const screenOn = (this._monitors?.power_save_mode ?? 0) <= 0;
        const want = screenOn && !Main.sessionMode.isLocked && !this._covered();
        if (want && !this._proc)
            this._spawn();
        else if (!want && this._proc)
            this._stopRenderer();
    }

    _spawn() {
        try {
            this._proc = Gio.Subprocess.new(['nice', '-n', '10', SAVER, 'frames', this._scene,
                String(this._w), String(this._h), FRAME], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn(`mk-indicator: live wallpaper: ${e.message}`);
            return;
        }
        this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, 66, () => {
            this._showFrame();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _showFrame() {
        let info;
        try {
            info = Gio.File.new_for_path(FRAME).query_info('time::modified-usec,time::modified,standard::size',
                Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return;
        }
        const mtime = info.get_attribute_uint64('time::modified') * 1e6 + info.get_attribute_uint32('time::modified-usec');
        if (mtime === this._lastMtime || info.get_size() !== this._w * this._h * 4)
            return;
        this._lastMtime = mtime;
        let bytes;
        try {
            bytes = GLib.file_get_contents(FRAME)[1];
        } catch (e) {
            return;
        }
        if (bytes.length !== this._w * this._h * 4)
            return;
        const cogl = global.stage.context.get_backend().get_cogl_context();
        this._content.set_bytes(cogl, new GLib.Bytes(bytes), Cogl.PixelFormat.BGRA_8888_PRE, this._w, this._h, this._w * 4);
        if (!this._shown) {
            this._shown = true;
            this._actor.ease({opacity: 255, duration: 800, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _stopRenderer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._proc?.force_exit();
        this._proc = null;
    }

    _teardown() {
        this._stopRenderer();
        this._actor?.destroy();
        this._actor = this._content = null;
        try {
            GLib.unlink(FRAME);
        } catch (e) {
            // already gone
        }
    }

    disable() {
        this._teardown();
        this._confMonitor?.cancel();
        this._confMonitor = null;
        this._monitors?.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
    }
}
