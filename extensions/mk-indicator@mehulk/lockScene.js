// The screensaver scene on the lock screen, behind GNOME's clock.
//
// Space, a click, a key or a swipe already slides GNOME's clock away and the
// password / fingerprint prompt in; the scene rides that same transition:
// it slides up and fades as the prompt arrives, and stops drawing once the
// prompt is up (and whenever the screen is blanked), so it costs nothing then.
//
// The scenes are the Python ones (lib/mkworkstation/scenes.py): mk-screensaver
// renders frames at half the screen's size into $XDG_RUNTIME_DIR, 15 a second,
// and they're shown here as a GPU texture. LOCKSCREEN=off in screensaver.conf
// turns it off.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FRAME = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'mk-lockscene.raw']);
const SAVER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-screensaver']);
const CONF = [GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'screensaver.conf']),
    GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'screensaver.conf'])];

function saverConf() {
    const out = {SCREENSAVER: 'on', LOCKSCREEN: 'on', SCENE: 'random'};
    for (const path of CONF) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                continue;
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
                const m = line.match(/^\s*([A-Z_]+)\s*=\s*(\S*)/);
                if (m)
                    out[m[1]] = m[2];
            }
        } catch (e) {
            // defaults
        }
    }
    return out;
}

export class LockScene {
    // Called when the screen locks; returns false when there's nothing to show.
    start() {
        const conf = saverConf();
        if (conf.SCREENSAVER === 'off' || conf.LOCKSCREEN === 'off' || !GLib.file_test(SAVER, GLib.FileTest.EXISTS))
            return false;
        this._conf = conf;
        this._tries = 0;
        // The unlock dialog is built a moment after the lock begins.
        this._findId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const dialog = Main.screenShield?._dialog;
            if (dialog?._backgroundGroup && dialog._adjustment) {
                this._findId = 0;
                this._attach(dialog);
                return GLib.SOURCE_REMOVE;
            }
            if (++this._tries > 50) {
                this._findId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        return true;
    }

    _attach(dialog) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._dialog = dialog;
        this._w = Math.round(monitor.width / 2);
        this._h = Math.round(monitor.height / 2);
        this._content = St.ImageContent.new_with_preferred_size(this._w, this._h);
        this._actor = new St.Widget({
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            content: this._content, content_gravity: Clutter.ContentGravity.RESIZE_FILL,
            opacity: 0, reactive: false,
        });
        dialog.insert_child_above(this._actor, dialog._backgroundGroup);
        // Ride GNOME's own clock-to-prompt transition (0 = clock, 1 = prompt).
        this._progressId = dialog._adjustment.connect('notify::value', () => this._onProgress());
        // A blanked screen shows nothing: don't draw for it.
        this._monitors = global.backend.get_monitor_manager();
        this._powerId = this._monitors.connect('power-save-mode-changed', () => this._sync());
        this._lastMtime = 0;
        this._sync();
    }

    _onProgress() {
        const p = this._dialog._adjustment.value;
        this._actor.translation_y = -p * this._actor.height * 0.35;
        this._actor.opacity = Math.round(255 * (1 - p) * (this._shown ? 1 : 0));
        this._sync();
    }

    // Draw only while the clock page is up and the screen is on.
    _sync() {
        const p = this._dialog?._adjustment?.value ?? 1;
        // ON is 0; UNSUPPORTED (-1) means it can't blank, so it's on too.
        const screenOn = (this._monitors?.power_save_mode ?? 0) <= 0;
        const want = screenOn && p < 1;
        if (want && !this._proc)
            this._spawn();
        else if (!want && this._proc)
            this._stopRenderer();
    }

    _spawn() {
        try {
            this._proc = Gio.Subprocess.new(['nice', '-n', '5', SAVER, 'frames', this._conf.SCENE,
                String(this._w), String(this._h), FRAME], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn(`mk-indicator: lock-screen scene: ${e.message}`);
            return;
        }
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 66, () => {
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
            return;  // no frame yet
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
        this._content.set_bytes(cogl, new GLib.Bytes(bytes), Cogl.PixelFormat.BGRA_8888_PRE,
            this._w, this._h, this._w * 4);
        if (!this._shown) {
            this._shown = true;
            this._actor.ease({opacity: Math.round(255 * (1 - (this._dialog._adjustment.value ?? 0))),
                duration: 600, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _stopRenderer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._proc?.force_exit();
        this._proc = null;
    }

    stop() {
        if (this._findId)
            GLib.source_remove(this._findId);
        this._findId = 0;
        this._stopRenderer();
        try {
            if (this._progressId)
                this._dialog?._adjustment?.disconnect(this._progressId);
        } catch (e) {
            // the dialog is already gone (unlocked)
        }
        if (this._powerId)
            this._monitors.disconnect(this._powerId);
        this._progressId = this._powerId = 0;
        this._actor?.destroy();
        this._actor = this._dialog = this._content = null;
        this._shown = false;
        try {
            GLib.unlink(FRAME);
        } catch (e) {
            // already gone
        }
    }
}
