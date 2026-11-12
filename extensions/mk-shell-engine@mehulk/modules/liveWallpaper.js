// MK Shell Engine: a video (or picture) as the desktop background, GNOME's way
// (mpvpaper and its kind need wlroots' layer-shell, which GNOME doesn't have).
//
// ~/.config/mk/wallpaper.json (bin/mk-live-wallpaper writes it; followed as it
// changes): {"desktop": path, "hwaccel": "vaapi" | "none"}.
//
// bin/mk-live-wallpaper plays the file in a plain window (silent: no audio
// stream at all); this module recognises that window (by its process) and makes
// it the desktop itself: a DESKTOP-type window (below every window, on every
// workspace, out of Alt+Tab, the overview and the dock), clicks passing through,
// covering the primary monitor. Workspaces slide over it, so it never moves or
// gets rescaled. Paused under a full-screen window and while the screen is
// locked; it plays on the moment you unlock (the engine stays loaded on the lock
// screen for that alone: extension.js). The lock screen itself is WACK Sonoma
// Live Lockscreen's, with its own media.
//
// The player takes commands on stdin (play, pause, decelerate MS, quit) and
// quits when it closes; one that stops on its own is restarted up to 3 times.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PLAYER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-live-wallpaper']);
const CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk', 'wallpaper.json']);
const LOG = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-live-wallpaper.log']);

function readConf() {
    try {
        const [ok, bytes] = GLib.file_get_contents(CONF);
        if (ok)
            return JSON.parse(new TextDecoder().decode(bytes));
    } catch {}
    return {};
}

const usable = path => typeof path === 'string' && path !== '' && GLib.file_test(path, GLib.FileTest.IS_REGULAR);

// a live wallpaper player's window (bin/mk-live-wallpaper's app id and title, or the lock
// screen's mpv): kept unseen until it's the desktop; marked so MK Shell Engine's effects skip it
const PLAYER_IDS = ['mk-live-wallpaper', 'mk-live-wallpaper-lock'];
function isWallpaperWindow(win) {
    try {
        return Boolean(win._mkWallpaper) || PLAYER_IDS.includes((win.get_wm_class() ?? '').toLowerCase()) ||
            ['MK Live Wallpaper', ...PLAYER_IDS].includes(win.get_title() ?? '');
    } catch {
        return false;
    }
}
function conceal(win) {
    win._mkWallpaper = true;
    const actor = win.get_compositor_private();
    if (actor)
        actor.opacity = 0;
}

// One player process and its window. onWindow(win) once the window is shown.
class Player {
    constructor(name, onWindow) {
        this._name = name;
        this._onWindow = onWindow;
        this.win = null;
        this._restarts = 0;
        this._createdId = global.display.connect('window-created', (_d, win) => this._claim(win));
        // (a player already there, from before this loaded: unseen too)
        for (const actor of global.get_window_actors()) {
            if (actor.meta_window && isWallpaperWindow(actor.meta_window))
                conceal(actor.meta_window);
        }
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
            console.warn(`mk-shell-engine: live wallpaper (${this._name}): ${e.message}`);
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
                console.warn(`mk-shell-engine: live wallpaper (${this._name}) keeps stopping: see ${LOG}`);
            }
        });
    }

    get running() {
        return Boolean(this._proc);
    }

    send(command) {
        try {
            this._proc?.get_stdin_pipe()?.write_all(new TextEncoder().encode(`${command}\n`), null);
        } catch {}                                 // (it has just gone: the restart follows)
    }

    // The player's window, the moment it exists (matched by its process, or by its app id
    // "mk-live-wallpaper"): unseen from the first frame (its actor at opacity 0, marked so the
    // engine's open animation, dock and minimize glide leave it alone), then, once shown, made
    // the desktop (DESKTOP type: below everything, out of the dock, Alt+Tab and the overview)
    // and only then visible. A player window that isn't this one's (left by an earlier shell)
    // is kept unseen too, never shown as an app.
    _claim(win) {
        try {
            const ours = this._proc && win.get_pid() === Number(this._proc.get_identifier());
            if (!ours) {
                if (isWallpaperWindow(win))
                    conceal(win);
                else                                 // (the app id can arrive a moment later)
                    win.connectObject('notify::wm-class', () => isWallpaperWindow(win) && conceal(win), this);
                return;
            }
            this.win = win;
            conceal(win);
            const id = win.connect('shown', () => {
                win.disconnect(id);
                conceal(win);
                // a moment later: changing its type while Mutter is still stacking it trips Mutter
                this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._idle = 0;
                    if (this.win !== win)
                        return GLib.SOURCE_REMOVE;
                    try {
                        win.set_type(Meta.WindowType.DESKTOP);   // below everything, out of every window list
                        win.stick();
                        const actor = win.get_compositor_private();
                        if (actor) {
                            actor.reactive = false;              // clicks go through
                            for (const child of actor.get_children())
                                child.reactive = false;
                            actor.opacity = 255;                 // (the desktop now: it may show)
                        }
                        this._onWindow(win);
                    } catch (e) {
                        console.warn(`live wallpaper window: ${e.message}`);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            console.warn(`live wallpaper window: ${e.message}`);
        }
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
            // (and if it hasn't gone 3 s later, it's ended: a stuck player never lingers)
            let killId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                killId = 0;
                try {
                    proc.force_exit();
                } catch {}
                return GLib.SOURCE_REMOVE;
            });
            proc.wait_async(null, () => {
                if (killId)
                    GLib.source_remove(killId);
                killId = 0;
            });
            this._send(proc, 'quit');
            try {
                proc.get_stdin_pipe()?.close(null);      // (it quits when its stdin closes, too)
            } catch {}
        }
    }

    _send(proc, command) {
        try {
            proc.get_stdin_pipe()?.write_all(new TextEncoder().encode(`${command}\n`), null);
        } catch {}
    }

    destroy() {
        this.stop();
        global.display.disconnect(this._createdId);
        for (const actor of global.get_window_actors())
            actor.meta_window?.disconnectObject?.(this);
    }
}


export class LiveWallpaper {
    constructor() {
        this._conf = readConf();
        this._desktop = new Player('desktop', win => this._placeDesktop(win));
        this._monitor = Gio.File.new_for_path(CONF).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', (_m, _f, _o, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event === Gio.FileMonitorEvent.CREATED ||
                event === Gio.FileMonitorEvent.DELETED)
                this._reload();
        });
        this._ids = [
            [global.display, global.display.connect('in-fullscreen-changed', () => this._syncDesktop())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._fitDesktop())],
            [Main.sessionMode, Main.sessionMode.connect('updated', () => this._syncDesktop())],
        ];
        this._startDesktop();
    }

    _reload() {
        const old = this._conf;
        this._conf = readConf();
        if (old.desktop !== this._conf.desktop || old.hwaccel !== this._conf.hwaccel)
            this._startDesktop();
    }

    _startDesktop() {
        if (usable(this._conf.desktop))
            this._desktop.start(this._conf.desktop);
        else
            this._desktop.stop();
    }

    _placeDesktop(win) {
        this._sizeId = win.connect('size-changed', () => this._scaleDesktop());
        this._fitDesktop();
        this._syncDesktop();
    }

    // the whole primary monitor, under the top bar too; GNOME holds windows to the work area's
    // height, so the picture is scaled the rest of the way from the top-left corner (a few
    // percent of a picture already drawn to cover; full screen would hide the top bar)
    _fitDesktop() {
        const win = this._desktop.win, m = Main.layoutManager.primaryMonitor;
        if (!win || !m)
            return;
        win.move_resize_frame(true, m.x, m.y, m.width, m.height);
        this._scaleDesktop();
    }

    _scaleDesktop() {
        const win = this._desktop.win, m = Main.layoutManager.primaryMonitor;
        const actor = win?.get_compositor_private(), f = win?.get_frame_rect();
        if (!actor || !m || !f || f.width <= 0 || f.height <= 0)
            return;
        actor.set_pivot_point(0, 0);
        actor.set_scale(m.width / f.width, m.height / f.height);
    }

    // paused under a full-screen window and while locked; playing again the moment that ends
    _syncDesktop() {
        if (!this._desktop.win)
            return;                                  // (not set up yet: no commands before its window)
        const m = Main.layoutManager.primaryIndex;
        const hidden = Main.sessionMode.isLocked || (m >= 0 && global.display.get_monitor_in_fullscreen(m));
        this._desktop.send(hidden ? 'pause' : 'play');
    }

    destroy() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._monitor.cancel();
        if (this._desktop.win && this._sizeId)
            this._desktop.win.disconnect(this._sizeId);
        this._desktop.destroy();
    }
}
