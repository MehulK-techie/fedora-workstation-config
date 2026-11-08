// MK: a video (or picture) as the desktop background, GNOME's way (mpvpaper and
// its kind need wlroots' layer-shell, which GNOME doesn't have). Moved here from
// MK Shell Engine, which stands aside while this extension runs.
//
// Settings: desktop-wallpaper-path, desktop-hwaccel, desktop-audio-enabled,
// desktop-audio-volume (followed live), audio-auto-mute-on-other-media.
//
// ~/.local/bin/mk-live-wallpaper plays the file in a plain window; this module
// recognises that window (by its process) and makes it the desktop itself: a
// DESKTOP-type window (below every window, on every workspace, out of Alt+Tab,
// the overview and the dock), clicks passing through, covering the primary
// monitor. Paused under a full-screen window and while the screen is locked.
// Silent unless desktop-audio-enabled: no audio stream is opened at all then.
//
// The player takes commands on stdin (play, pause, decelerate MS, volume V,
// quit) and quits when it closes; one that stops on its own is restarted up to
// 3 times.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { MediaWatcher } from './media.js';

const PLAYER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-live-wallpaper']);
const LOG = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-live-wallpaper.log']);
const KEYS = ['desktop-wallpaper-path', 'desktop-hwaccel', 'desktop-audio-enabled'];

const usable = path => typeof path === 'string' && path !== '' && GLib.file_test(path, GLib.FileTest.IS_REGULAR);

// One player process and its window. onWindow(win) once the window is shown.
class Player {
    constructor(onWindow) {
        this._onWindow = onWindow;
        this.win = null;
        this._restarts = 0;
        this._createdId = global.display.connect('window-created', (_d, win) => this._claim(win));
    }

    start(path, args = []) {
        this.stop();
        this._path = path;
        this._args = args;
        this._restarts = 0;
        this._spawn();
    }

    _spawn() {
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE});
            launcher.set_stdout_file_path(LOG);
            launcher.set_stderr_file_path(LOG);
            this._proc = launcher.spawnv([PLAYER, 'run', this._path, ...this._args]);
        } catch (e) {
            console.warn(`wack-sonoma-lockscreen: desktop wallpaper: ${e.message}`);
            return;
        }
        const proc = this._proc;
        proc.wait_async(null, () => {
            if (proc !== this._proc)
                return;                             // (stopped on purpose)
            this._proc = this.win = null;
            if (this._restarts++ < 3) {
                this._retry = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                    this._retry = 0;
                    this._spawn();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                console.warn(`wack-sonoma-lockscreen: the desktop wallpaper keeps stopping: see ${LOG}`);
            }
        });
    }

    send(command) {
        try {
            this._proc?.get_stdin_pipe()?.write_all(new TextEncoder().encode(`${command}\n`), null);
        } catch {}                                 // (it has just gone: the restart follows)
    }

    _claim(win) {
        if (!this._proc || win.get_pid() !== Number(this._proc.get_identifier()))
            return;
        this.win = win;
        const id = win.connect('shown', () => {
            win.disconnect(id);
            // a moment later: changing its type while Mutter is still stacking it trips Mutter
            this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idle = 0;
                if (this.win !== win)
                    return GLib.SOURCE_REMOVE;
                win.set_type(Meta.WindowType.DESKTOP);   // below everything, out of every window list
                win.stick();
                const actor = win.get_compositor_private();
                if (actor) {
                    actor.reactive = false;              // clicks go through
                    for (const child of actor.get_children())
                        child.reactive = false;
                }
                this._onWindow(win);
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    stop() {
        for (const id of ['_retry', '_idle']) {
            if (this[id])
                GLib.source_remove(this[id]);
            this[id] = 0;
        }
        const proc = this._proc;
        this._proc = this.win = null;
        if (proc) {
            try {
                proc.get_stdin_pipe()?.write_all(new TextEncoder().encode('quit\n'), null);
                proc.get_stdin_pipe()?.close(null);      // (it quits when its stdin closes, too)
            } catch {}
        }
    }

    destroy() {
        this.stop();
        global.display.disconnect(this._createdId);
    }
}

export class DesktopWallpaper {
    constructor(settings) {
        this._settings = settings;
        this._player = new Player(win => this._place(win));
        this._setIds = [
            ...KEYS.map(k => settings.connect(`changed::${k}`, () => this._start())),
            settings.connect('changed::desktop-audio-volume', () => this._syncVolume()),
            settings.connect('changed::audio-auto-mute-on-other-media', () => this._syncVolume()),
        ];
        this._ids = [
            [global.display, global.display.connect('in-fullscreen-changed', () => this._syncPlaying())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._fit())],
            [Main.sessionMode, Main.sessionMode.connect('updated', () => this._syncPlaying())],
        ];
        this._media = new MediaWatcher();
        this._media.connect('changed', () => this._syncVolume());
        this._start();
    }

    get audio() {
        return this._settings.get_boolean('desktop-audio-enabled');
    }

    _start() {
        const path = this._settings.get_string('desktop-wallpaper-path').replace(/^~(?=\/)/, GLib.get_home_dir());
        if (!usable(path)) {
            this._player.stop();
            return;
        }
        const args = ['--hwaccel', this._settings.get_string('desktop-hwaccel')];
        if (this.audio)
            args.push('--audio', this._volume().toFixed(2));
        this._player.start(path, args);
    }

    // the slider's volume; nothing while another player is playing (with auto-mute on)
    _volume() {
        const muted = this._settings.get_boolean('audio-auto-mute-on-other-media') && this._media?.anyPlaying;
        return muted ? 0 : this._settings.get_double('desktop-audio-volume');
    }

    _syncVolume() {
        if (this.audio && this._player.win)
            this._player.send(`volume ${this._volume().toFixed(2)}`);
    }

    _place(win) {
        this._sizeWin = win;
        this._sizeId = win.connect('size-changed', () => this._scale());
        this._fit();
        this._syncPlaying();
        this._syncVolume();
    }

    // the whole primary monitor, under the top bar too; GNOME holds windows to the work area's
    // height, so the picture is scaled the rest of the way from the top-left corner
    _fit() {
        const win = this._player.win, m = Main.layoutManager.primaryMonitor;
        if (!win || !m)
            return;
        win.move_resize_frame(true, m.x, m.y, m.width, m.height);
        this._scale();
    }

    _scale() {
        const win = this._player.win, m = Main.layoutManager.primaryMonitor;
        const actor = win?.get_compositor_private(), f = win?.get_frame_rect();
        if (!actor || !m || !f || f.width <= 0 || f.height <= 0)
            return;
        actor.set_pivot_point(0, 0);
        actor.set_scale(m.width / f.width, m.height / f.height);
    }

    // paused under a full-screen window and while locked; playing again the moment that ends
    _syncPlaying() {
        if (!this._player.win)
            return;                                  // (no commands before its window)
        const m = Main.layoutManager.primaryIndex;
        const hidden = Main.sessionMode.isLocked || (m >= 0 && global.display.get_monitor_in_fullscreen(m));
        this._player.send(hidden ? 'pause' : 'play');
    }

    destroy() {
        for (const id of this._setIds)
            this._settings.disconnect(id);
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._media.destroy();
        this._media = null;
        if (this._sizeWin && this._sizeId) {
            try {
                this._sizeWin.disconnect(this._sizeId);
            } catch {}
        }
        this._player.destroy();
    }
}
