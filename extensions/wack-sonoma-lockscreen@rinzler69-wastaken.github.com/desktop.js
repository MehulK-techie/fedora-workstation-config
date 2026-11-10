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
// With sound on, two ways (wallpaper-background-play, Quick Settings' "Wallpaper
// Bg Play" tile):
//   off (the default): heard only on the bare desktop (unlocked, no overview, no normal
//     window showing on this workspace). A window showing fades the sound out over
//     300 ms (20 ms steps); back on the bare desktop it fades in over 300 ms to the
//     slider's level. Another player playing mutes it too (audio-auto-mute-on-other-media).
//   on: it's heard under your windows too, and steps aside only for other media: an
//     MPRIS player or any other app's sound stream playing (otherMedia.js) fades it out;
//     600 ms after that goes quiet it fades back in.
// The video itself streams on all the while (windows, menus, the overview); it pauses
// only while the screen is locked or a window is full screen.
//
// The picture: a clone of the player's window, the size of the whole monitor, in
// the background layer (under the top bar and the dock, to the bottom edge), the
// window itself kept out of sight: GNOME holds windows to the work area, the
// clone doesn't care.
//
// The player takes commands on stdin (play, pause, decelerate MS, volume V,
// quit) and quits when it closes; one that stops on its own is restarted up to
// 3 times.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import { OtherMedia } from './otherMedia.js';

const PLAYER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-live-wallpaper']);
const LOG = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-live-wallpaper.log']);
const KEYS = ['desktop-wallpaper-path', 'desktop-hwaccel', 'desktop-audio-enabled'];
const FADE_OUT = 300, FADE_IN = 300;          // ms: the sound's ramps, out and in

// Switching workspaces (Super+PageUp/PageDown, a swipe, the grid): GNOME slides a copy of
// each workspace, every one on a still background of its own, made fresh for the switch
// (loading the wallpaper picture each time) and drawn over the live wallpaper. While the
// live wallpaper shows, the primary monitor's copies get no background: one clone of the
// video, pinned to the monitor, sits under them instead, so the windows slide over a
// wallpaper that stays put and keeps playing from the same GPU texture (nothing is made,
// loaded or decoded again for the switch).
const pin = {source: null, saved: null};

function pinWorkspaces(source) {
    pin.source = source;
    if (pin.saved)
        return;
    const groupProto = WorkspaceAnimation.WorkspaceGroup?.prototype;
    const controller = Main.wm?._workspaceAnimation;
    if (!groupProto?._createBackground || !controller?._prepareWorkspaceSwitch)
        return;                                      // (GNOME's animation has changed shape: left as it is)
    pin.saved = {create: groupProto._createBackground, prepare: controller._prepareWorkspaceSwitch, controller};
    const primary = monitor => monitor?.index === Main.layoutManager.primaryIndex;
    groupProto._createBackground = function (...args) {
        if (pin.source && this._workspace && primary(this._monitor))
            return;                                  // (the pinned video is the background)
        return pin.saved.create.apply(this, args);
    };
    controller._prepareWorkspaceSwitch = function (...args) {
        const result = pin.saved.prepare.apply(this, args);
        for (const group of this._switchData?.monitors ?? []) {
            if (!pin.source || !primary(group._monitor))
                continue;
            const m = group._monitor;
            group.insert_child_at_index(new Clutter.Clone({source: pin.source, reactive: false,
                x: 0, y: 0, width: m.width, height: m.height}), 0);
        }
        return result;
    };
}

function unpinWorkspaces() {
    pin.source = null;
    if (!pin.saved)
        return;
    WorkspaceAnimation.WorkspaceGroup.prototype._createBackground = pin.saved.create;
    if (pin.saved.controller._prepareWorkspaceSwitch !== pin.saved.prepare)
        delete pin.saved.controller._prepareWorkspaceSwitch;   // (the class's own again)
    if (pin.saved.controller._prepareWorkspaceSwitch !== pin.saved.prepare)
        pin.saved.controller._prepareWorkspaceSwitch = pin.saved.prepare;
    pin.saved = null;
}

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
            settings.connect('changed::wallpaper-background-play', () => this._queueVolume()),
        ];
        this._ids = [
            [global.display, global.display.connect('in-fullscreen-changed', () => this._syncPlaying())],
            // the desktop showing or not: focus, windows coming, going, minimized, other workspaces
            [global.display, global.display.connect('notify::focus-window', () => this._queueVolume())],
            [global.display, global.display.connect('window-created', () => this._queueVolume())],
            [global.window_manager, global.window_manager.connect('minimize', () => this._queueVolume())],
            [global.window_manager, global.window_manager.connect('unminimize', () => this._queueVolume())],
            [global.window_manager, global.window_manager.connect('map', () => this._queueVolume())],
            [global.window_manager, global.window_manager.connect('destroy', () => this._queueVolume())],
            [global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', () => this._queueVolume())],
            [Main.overview, Main.overview.connect('showing', () => this._queueVolume())],
            [Main.overview, Main.overview.connect('hidden', () => this._queueVolume())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._fit())],
            [Main.sessionMode, Main.sessionMode.connect('updated', () => {
                this._syncPlaying();
                this._queueVolume();
            })],
        ];
        this._media = new OtherMedia();
        this._media.connect('changed', () => this._queueVolume());
        this._start();
    }

    get audio() {
        return this._settings.get_boolean('desktop-audio-enabled');
    }

    // Background Play: sound on, and on under your windows too
    get _background() {
        return this.audio && this._settings.get_boolean('wallpaper-background-play');
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

    // Is the bare desktop what you're looking at? Unlocked, no overview, and no window
    // showing on this workspace (the wallpaper's own window aside)
    // (asked of the windows themselves, never of the last focused one: GNOME keeps pointing
    // at an app's window after it's minimized or closed)
    _onDesktop() {
        if (Main.sessionMode.isLocked || Main.overview.visible)
            return false;
        const ws = global.workspace_manager.get_active_workspace();
        return !ws.list_windows().some(w =>
            w !== this._player.win && !w.minimized && w.showing_on_its_workspace() &&
            (w.get_window_type() === Meta.WindowType.NORMAL || w.get_window_type() === Meta.WindowType.DIALOG));
    }

    // the slider's volume on the bare desktop; nothing anywhere else, or while another
    // player is playing (with auto-mute on)
    _volume() {
        const level = this._settings.get_double('desktop-audio-volume');
        if (Main.sessionMode.isLocked)
            return 0;
        if (this._background)
            return this._media?.playing ? 0 : level;
        const muted = this._settings.get_boolean('audio-auto-mute-on-other-media') && this._media?.playing;
        return muted || !this._onDesktop() ? 0 : level;
    }

    // (the name stays: it's called on every change that decides whether you're on the desktop;
    // that decides the sound and, now, whether the video runs at all)
    _queueVolume() {
        if (this._volIdle)
            return;
        this._volIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._volIdle = 0;
            // (mid workspace-switch the video is on screen, pinned under the sliding windows: it may
            // start playing at once, but it's never paused or faded out until the slide is over)
            if (Main.wm?._workspaceAnimation?._switchData && this._wantsPause()) {
                this._volIdle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                    this._volIdle = 0;
                    this._queueVolume();
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            }
            this._syncPlaying();                     // (play first, so a fade-in is heard from its start)
            this._syncVolume(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    // FADE: a smooth ramp (300 ms each way, 20 ms steps) rather than a jump (the slider moving)
    _syncVolume(fade = false) {
        if (!this.audio || !this._player.win)
            return;
        const level = this._volume();
        if (!fade) {
            this._player.send(`volume ${level.toFixed(2)}`);
        } else if (level !== this._level) {
            this._player.send(`fade ${level.toFixed(2)} ${level < (this._level ?? 1) ? FADE_OUT : FADE_IN}`);
        }
        this._level = level;
    }

    _place(win) {
        this._playState = null;                      // (a new player: tell it, whatever the last one was told)
        this._sizeWin = win;
        this._sizeId = win.connect('size-changed', () => this._scale());
        this._fit();
        this._cover(win);
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
        this._clone?.set_position(m.x, m.y);
        this._clone?.set_size(m.width, m.height);
    }

    // The picture on screen: a clone of the window, as big as the monitor (physical geometry,
    // not the work area), at the top of the background layer: under every window, the top
    // bar and the dock, down to the bottom edge. The window itself is drawn only through it.
    _cover(win) {
        this._uncover();
        const actor = win.get_compositor_private(), m = Main.layoutManager.primaryMonitor;
        const layer = Main.layoutManager._backgroundGroup;
        if (!actor || !m || !layer)
            return;
        this._clone = new Clutter.Clone({source: actor, reactive: false});
        this._clone.set_position(m.x, m.y);
        this._clone.set_size(m.width, m.height);
        layer.add_child(this._clone);                // (above the still backgrounds)
        // permanent: nothing (focus, a window, a theme) gets to hide or dim it; behind windows it
        // stays as it is, at most paused on its frame
        const keep = () => {
            if (!this._clone.visible)
                this._clone.show();
            if (this._clone.opacity !== 255)
                this._clone.opacity = 255;
        };
        this._clone.connectObject('notify::visible', keep, 'notify::opacity', keep, this);
        actor.opacity = 0;                           // (a clone paints its source at full opacity)
        this._coverActor = actor;
        pinWorkspaces(actor);
        actor.connectObject('destroy', () => this._uncover(), this);
    }

    _uncover() {
        unpinWorkspaces();
        if (this._coverActor) {
            this._coverActor.disconnectObject(this);
            this._coverActor.opacity = 255;
        }
        this._clone?.disconnectObject(this);
        this._clone?.destroy();
        this._clone = this._coverActor = null;
    }

    _scale() {
        const win = this._player.win, m = Main.layoutManager.primaryMonitor;
        const actor = win?.get_compositor_private(), f = win?.get_frame_rect();
        if (!actor || !m || !f || f.width <= 0 || f.height <= 0)
            return;
        actor.set_pivot_point(0, 0);
        actor.set_scale(m.width / f.width, m.height / f.height);
    }

    // Paused only while locked or under a full-screen window. Between your windows and the
    // desktop the video streams on, frame after frame: only its sound ramps (300 ms).
    _hidden() {
        const m = Main.layoutManager.primaryIndex;
        return Main.sessionMode.isLocked || (m >= 0 && global.display.get_monitor_in_fullscreen(m));
    }

    // would the next sync pause it, or bring its sound down?
    _wantsPause() {
        return (this._player.win && this._hidden() && this._playState !== 'pause') ||
            (this.audio && this._volume() < (this._level ?? 0));
    }

    _syncPlaying() {
        if (!this._player.win)
            return;                                  // (no commands before its window)
        const want = this._hidden() ? 'pause' : 'play';
        if (want === this._playState)
            return;
        this._playState = want;
        if (this._pauseTimer) {
            GLib.source_remove(this._pauseTimer);
            this._pauseTimer = 0;
        }
        if (want === 'pause' && this.audio && !Main.sessionMode.isLocked) {
            this._pauseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FADE_OUT, () => {
                this._pauseTimer = 0;
                if (this._playState === 'pause')
                    this._player.send('pause');
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._player.send(want);
        }
    }

    destroy() {
        for (const id of [this._volIdle, this._pauseTimer].filter(Boolean))
            GLib.source_remove(id);
        this._uncover();
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
