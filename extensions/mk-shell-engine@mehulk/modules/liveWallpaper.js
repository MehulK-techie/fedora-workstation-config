// MK Shell Engine: a video as the desktop background (GNOME's way; mpvpaper and
// its kind need wlroots' layer-shell, which GNOME doesn't have).
//
// live-wallpaper (a video's path; '' = off) starts bin/mk-live-wallpaper, a
// small GTK player that shows the video looping and muted in a plain window.
// This module recognises that window (by its process) and makes it the
// desktop itself: a DESKTOP-type window, which GNOME keeps below every other
// window, on every workspace, out of Alt+Tab, the overview, the dock and the
// window lists; sized to the primary monitor; clicks pass through it to the
// desktop. Workspaces slide over it, so it never moves or gets rescaled (no
// blocky frames as you switch). It pauses while a window is full screen or the
// screen is locked, and the player is restarted (up to three times) if it
// stops on its own. The lock screen's own playback comes later.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PLAYER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-live-wallpaper']);
const SIGUSR1 = 10, SIGUSR2 = 12, SIGTERM = 15;

export class LiveWallpaper {
    constructor(settings) {
        this._settings = settings;
        this._proc = null;
        this._win = null;
        this._restarts = 0;
        this._ids = [
            [settings, settings.connect('changed::live-wallpaper', () => this._restart())],
            [global.display, global.display.connect('window-created', (_d, win) => this._claim(win))],
            [global.display, global.display.connect('in-fullscreen-changed', () => this._syncPlaying())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._fit())],
            [Main.sessionMode, Main.sessionMode.connect('updated', () => this._syncPlaying())],
        ];
        this._restart();
    }

    _path() {
        const path = this._settings.get_string('live-wallpaper');
        return path && GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? path : null;
    }

    _restart() {
        this._stop();
        this._restarts = 0;
        this._start();
    }

    _start() {
        const path = this._path();
        if (!path || !GLib.file_test(PLAYER, GLib.FileTest.IS_EXECUTABLE))
            return;
        try {
            // its output goes to ~/.cache/mk-live-wallpaper.log (what went wrong, if it stops)
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            const log = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-live-wallpaper.log']);
            launcher.set_stdout_file_path(log);
            launcher.set_stderr_file_path(log);
            this._proc = launcher.spawnv([PLAYER, 'run', path]);
        } catch (e) {
            console.warn(`mk-shell-engine: live wallpaper: ${e.message}`);
            return;
        }
        const proc = this._proc;
        proc.wait_async(null, () => {
            if (proc !== this._proc)
                return;                         // (stopped on purpose)
            this._proc = this._win = null;
            if (this._restarts++ < 3)
                this._retry = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                    this._retry = 0;
                    this._start();
                    return GLib.SOURCE_REMOVE;
                });
            else
                console.warn('mk-shell-engine: live wallpaper: the player keeps stopping; left off');
        });
    }

    _stop() {
        if (this._retry)
            GLib.source_remove(this._retry);
        this._retry = 0;
        if (this._setupIdle)
            GLib.source_remove(this._setupIdle);
        this._setupIdle = 0;
        const proc = this._proc;
        if (this._win && this._sizeId)
            this._win.disconnect(this._sizeId);
        this._sizeId = 0;
        this._proc = null;
        this._win = null;
        proc?.send_signal(SIGTERM);
    }

    // the player's window: made the desktop
    _claim(win) {
        if (!this._proc || win.get_pid() !== Number(this._proc.get_identifier()))
            return;
        this._win = win;
        const setUp = () => {
            if (this._win !== win)
                return;
            win.set_type(Meta.WindowType.DESKTOP);
            win.stick();
            const actor = win.get_compositor_private();
            if (actor) {
                actor.reactive = false;                     // clicks go through, to the desktop
                for (const child of actor.get_children())
                    child.reactive = false;
            }
            this._fit();
            this._refit();
            this._syncPlaying();
        };
        // once it's shown (stacked and with a frame): changing its type any earlier trips
        // Mutter's stacking. If GNOME trims it to the work area later, it's put back.
        const id = win.connect('shown', () => {
            win.disconnect(id);
            this._setupIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._setupIdle = 0;
                setUp();
                this._sizeId = win.connect('size-changed', () => this._refit());
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    // the whole primary monitor, under the top bar too (a user operation: the work-area
    // rule that keeps windows clear of the bar would otherwise cut off its bottom)
    _fit() {
        const win = this._win, m = Main.layoutManager.primaryMonitor;
        if (!win || !m)
            return;
        win.move_resize_frame(true, m.x, m.y, m.width, m.height);
        this._refit();
    }

    // GNOME keeps windows to the work area's height (the screen less the top bar): the
    // picture is scaled from the top-left corner to the whole monitor instead (a few
    // percent, of a video already drawn to cover). (Full screen would hide the top bar.)
    _refit() {
        const win = this._win, m = Main.layoutManager.primaryMonitor;
        const actor = win?.get_compositor_private();
        const f = win?.get_frame_rect();
        if (!actor || !m || !f || f.width <= 0 || f.height <= 0)
            return;
        actor.set_pivot_point(0, 0);
        actor.set_scale(m.width / f.width, m.height / f.height);
    }

    // paused under a full-screen window and on the lock screen (nothing sees it there)
    _syncPlaying() {
        // only once its window is up: before that it hasn't set up its signal handlers, and
        // USR1 / USR2 would end it
        if (!this._proc || !this._win)
            return;
        const m = Main.layoutManager.primaryIndex;
        const hidden = Main.sessionMode.isLocked || (m >= 0 && global.display.get_monitor_in_fullscreen(m));
        this._proc.send_signal(hidden ? SIGUSR1 : SIGUSR2);
    }

    destroy() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._stop();
    }
}
