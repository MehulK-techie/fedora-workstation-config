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
// Quick Settings' Wallpaper Bg Play (wallpaper-background-play) decides:
//   off (the default): video and sound only on the clean desktop. An app window covering it
//     fades the sound out (350 ms) and then pauses the decoding altogether (no CPU, no GPU:
//     the last frame stays up); back on the bare desktop it plays on and fades in (300 ms).
//     Mute While Other Media Plays silences it there too while another app plays.
//   on: it plays on under your apps, sound and all, and fades out and pauses only while another
//     app plays media (an MPRIS player playing AND its sound stream open: otherMedia.js, which
//     never counts the wallpaper itself or a sound filter), 600 ms after which it comes back.
// Locked, or under a full-screen window: paused. Top-bar menus never pause it.
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
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import { OtherMedia } from './otherMedia.js';

const PLAYER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-live-wallpaper']);
const LOG = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-live-wallpaper.log']);
const KEYS = ['desktop-wallpaper-path', 'desktop-hwaccel', 'desktop-audio-enabled'];
const FADE_OUT = 350, FADE_IN = 300;          // ms: the sound's ramps, out and in
const CLONE_NAME = 'mk-live-wallpaper';       // the one live wallpaper in the background layer
const BLEND = 52;                              // px: the bottom blend into black, behind the dock

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

// what the player reports about the video it plays (bin/mk-live-wallpaper writes it)
const RUNTIME_STATE = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'mk-live-wallpaper.json']);
function forgetRuntimeState() {
    Gio.File.new_for_path(RUNTIME_STATE).delete_async(GLib.PRIORITY_DEFAULT, null, (file, res) => {
        try {
            file.delete_finish(res);
        } catch {}                                   // (nothing there: fine)
    });
}

// ~/.config/mk/wallpaper.json, shared with bin/mk-live-wallpaper and MK Command Centre
const NOTE = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk', 'wallpaper.json']);
function readNote() {
    try {
        return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(NOTE)[1])) ?? {};
    } catch {
        return {};
    }
}
function writeNote(note) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(NOTE), 0o755);
        GLib.file_set_contents(NOTE, JSON.stringify(note, null, 2));
    } catch (e) {
        console.warn(`wack-sonoma-lockscreen: ${NOTE}: ${e.message}`);
    }
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
        const proc = this._proc, began = GLib.get_monotonic_time();
        proc.wait_async(null, () => {
            if (proc !== this._proc)
                return;                             // (stopped on purpose)
            this._proc = this.win = null;
            // one that played a good while and then stopped (a GPU reset, a driver hiccup) gets a
            // fresh set of restarts: only a player that keeps failing straight away is given up on
            if (GLib.get_monotonic_time() - began > 60e6)
                this._restarts = 0;
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
            settings.connect('changed::desktop-wallpaper-path', () => this._guardPath()),
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
        this._guardPath();
        this._start();
    }

    // Your desktop video, kept: the chosen file is also noted in ~/.config/mk/wallpaper.json, and
    // MK's own ways of clearing it (Command Centre's and the settings window's Clear buttons,
    // `mk-live-wallpaper off`) clear that note first. So if the setting turns up empty while the
    // note still names a file that's there, it wasn't you: it's put back, and the journal says so.
    _guardPath() {
        const path = this._settings.get_string('desktop-wallpaper-path');
        const note = readNote();
        if (path) {
            if (note.desktop !== path)
                writeNote({...note, desktop: path});
            return;
        }
        if (note.desktop && usable(note.desktop)) {
            console.warn(`wack-sonoma-lockscreen: desktop-wallpaper-path was emptied by something other than MK's ` +
                `Clear buttons or mk-live-wallpaper off; restoring ${note.desktop}`);
            this._settings.set_string('desktop-wallpaper-path', note.desktop);
        }
    }

    get audio() {
        return this._settings.get_boolean('desktop-audio-enabled');
    }


    _start() {
        const path = this._settings.get_string('desktop-wallpaper-path').replace(/^~(?=\/)/, GLib.get_home_dir());
        // the runtime state ($XDG_RUNTIME_DIR/mk-live-wallpaper.json) only ever describes what's
        // playing now: cleared as a player stops or is replaced, written by the new one once it runs
        forgetRuntimeState();
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
    // Command Centre's Desktop Video Sound (desktop-audio-enabled), Desktop Volume
    // (desktop-audio-volume) and Mute While Other Media Plays (audio-auto-mute-on-other-media):
    // with the sound on it's heard at that volume all the time you're logged in, windows open
    // or not; silent only while locked, or while another app plays media (with that switch, or
    // Quick Settings' Wallpaper Bg Play, on).
    _volume() {
        if (Main.sessionMode.isLocked)
            return 0;
        const level = this._settings.get_double('desktop-audio-volume');
        if (this._bgPlay)                            // under your apps too; never over other media
            return this._media?.playing ? 0 : level;
        if (!this._onDesktop())                      // Bg Play off: the clean desktop only
            return 0;
        return this._settings.get_boolean('audio-auto-mute-on-other-media') && this._media?.playing ? 0 : level;
    }

    // Quick Settings' Wallpaper Bg Play (wallpaper-background-play)
    get _bgPlay() {
        return this._settings.get_boolean('wallpaper-background-play');
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

    // FADE: a smooth ramp (350 ms each way, 20 ms steps) rather than a jump (the slider moving)
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
        this._sizeId = win.connect('size-changed', () => {
            this._scale();
            this._unbar();
        });
        this._posId = win.connect('position-changed', () => this._unbar());
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
        this._frame?.set_position(m.x, m.y);
        this._frame?.set_size(m.width, m.height);
        this._dim?.set_size(m.width, m.height);
        this._blend?.set({y: m.height - BLEND, width: m.width});
        this._clone?.set_size(m.width, m.height);
        this._unbar();
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
        // one live wallpaper, ever: a copy left by an earlier player (or extension run) goes first
        for (const old of layer.get_children().filter(c => c.name === CLONE_NAME))
            old.destroy();
        // a frame the size of the physical monitor that clips, holding the copy of the video (which
        // fills it, COVER, and is zoomed past any black bars encoded in the video: _unbar)
        this._frame = new Clutter.Actor({name: CLONE_NAME, reactive: false, clip_to_allocation: true,
            x: m.x, y: m.y, width: m.width, height: m.height});
        this._clone = new Clutter.Clone({source: actor, reactive: false, width: m.width, height: m.height});
        this._frame.add_child(this._clone);
        // over the video: a faint ambient dim (as on the lock screen, so windows, the top bar and
        // the dock sit on it with contrast), and a soft blend into black along the bottom 52 px,
        // behind the dock: the video's lower edge never ends on a hard line
        this._dim = new St.Widget({style_class: 'mk-wallpaper-dim', reactive: false, width: m.width, height: m.height});
        this._blend = new St.Widget({style_class: 'mk-wallpaper-bottom-blend', reactive: false,
            x: 0, y: m.height - BLEND, width: m.width, height: BLEND});
        this._frame.add_child(this._dim);
        this._frame.add_child(this._blend);
        layer.insert_child_at_index(this._frame, 0);
        this._watchState();
        // GNOME's still wallpaper on that monitor turns fully transparent while the video shows,
        // so nothing of it can show through anywhere (under the dock, at an edge, between frames);
        // a new one (the still wallpaper changed) is caught as it's added. Back when it stops.
        this._stills = new Set();
        const still = child => {
            if (child === this._frame || !(child instanceof Meta.BackgroundActor))
                return;
            if (child.monitor !== undefined && child.monitor !== Main.layoutManager.primaryIndex)
                return;
            child.opacity = 0;
            this._stills.add(child);
        };
        layer.get_children().forEach(still);
        layer.connectObject('child-added', (_l, child) => still(child), this);
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

    // Black letterbox bands encoded in the video (the player measures them: bars [top, bottom] in
    // $XDG_RUNTIME_DIR/mk-live-wallpaper.json): the picture is zoomed and centred just enough
    // that they fall outside the monitor, so no black bar ever shows (at most 1.4x).
    _watchState() {
        const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_runtime_dir(), 'mk-live-wallpaper.json']));
        this._stateFile = file;
        this._stateMonitor = file.get_parent().monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._stateMonitor.connect('changed', (_m, f) => f.equal(file) && this._unbar());
        this._unbar();
    }

    _unbar() {
        const clone = this._clone, m = Main.layoutManager.primaryMonitor;
        if (!clone || !m)
            return;
        let top = 0, bottom = 0;
        try {
            const info = JSON.parse(new TextDecoder().decode(this._stateFile.load_contents(null)[1]));
            const want = this._settings.get_string('desktop-wallpaper-path').replace(/^~(?=\/)/, GLib.get_home_dir());
            if (info.path === want && Array.isArray(info.bars))
                [top, bottom] = info.bars.map(v => Math.min(0.3, Math.max(0, Number(v) || 0)));
        } catch {}
        if (top + bottom < 0.01)
            top = bottom = 0;                        // (a hair of dark edge: left as it is)
        // The window's visible frame (not its whole buffer, which can carry invisible margins: a
        // client-side shadow area) is what fills the monitor; any margin lands outside the clipping
        // frame, so no strip of what's underneath (black, or GNOME's still wallpaper) ever shows.
        const win = this._player.win, f = win?.get_frame_rect(), b = win?.get_buffer_rect();
        let x = 0, y = 0, w = m.width, h = m.height;
        if (f && b && f.width > 0 && f.height > 0 && b.width > 0 && b.height > 0) {
            const kx = m.width / f.width, ky = m.height / f.height;
            x = -(f.x - b.x) * kx;
            y = -(f.y - b.y) * ky;
            w = b.width * kx;
            h = b.height * ky;
        }
        clone.set_position(Math.round(x), Math.round(y));
        clone.set_size(Math.round(w), Math.round(h));
        // then zoomed past any black bands in the video, about the picture's middle
        const zoom = Math.min(1.4, 1 / Math.max(0.5, 1 - top - bottom));
        const centre = top + (1 - top - bottom) / 2;  // the picture's middle, as a fraction of the height
        clone.set_pivot_point((m.width / 2 - x) / w, (centre * m.height - y) / h);
        clone.set_scale(zoom, zoom);
        clone.translation_y = Math.round((0.5 - centre) * m.height);
    }

    _uncover() {
        unpinWorkspaces();
        Main.layoutManager._backgroundGroup?.disconnectObject(this);
        for (const child of this._stills ?? []) {
            try {
                child.opacity = 255;
            } catch {}                               // (replaced and gone already)
        }
        this._stills = null;
        if (this._coverActor) {
            this._coverActor.disconnectObject(this);
            this._coverActor.opacity = 255;
        }
        this._stateMonitor?.cancel();
        this._stateMonitor = null;
        this._clone?.disconnectObject(this);
        this._frame?.destroy();                      // (and the copy in it)
        this._frame = this._clone = this._coverActor = this._dim = this._blend = null;
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
    // desktop the video streams on, frame after frame: only its sound ramps (350 ms).
    // Paused (decoding stopped: no CPU, no GPU; the last frame held, so the picture stays) while
    // locked or under a full-screen window, and: with Bg Play off, whenever an app window covers
    // the desktop (it plays again the moment you're back on the bare desktop, or in the
    // overview); with Bg Play on, only while other media plays. A pause waits for the sound's fade.
    _hidden() {
        const m = Main.layoutManager.primaryIndex;
        if (Main.sessionMode.isLocked || (m >= 0 && global.display.get_monitor_in_fullscreen(m)))
            return true;
        if (this._bgPlay)
            return Boolean(this._media?.playing);
        return !Main.overview.visible && !this._onDesktop();
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
        for (const id of [this._sizeId, this._posId].filter(Boolean)) {
            try {
                this._sizeWin?.disconnect(id);
            } catch {}
        }
        this._player.destroy();
    }
}
