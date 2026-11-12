// MK Shell Engine: the wallpaper shuffle and its contour-trace transition.
//
// Super+W (`wallpaper-shuffle`) opens the 3 x 3 grid to pick one (wallpaperGrid.js); every N minutes
// (`wallpaper-shuffle-minutes`, 0 = never) shows the next picture from ~/Pictures/Wallpapers and MK's own three. bin/mk-wallpaper
// prepares it in a process of its own (the shell never decodes or analyses a full-size picture):
// a downscaled copy, and its contour trace (the picture's contour lines and edges, glowing in its
// own accent colour over an obsidian blueprint grid). Then, in the background layer, behind every
// window:
//   stage 1, 0-300 ms    the contour trace draws in over obsidian, settling from 1.02x
//   stage 2, 300-680 ms  the full-colour picture floods in from the centre in a growing circle (a
//                        radial reveal) as the lines fade away
// and GNOME's own wallpaper is switched to it underneath, the overlay dissolving once that's in.
// Two plain cross-fades of two pictures: nothing a slow or software-rendered GPU can't draw, no
// shader that could fail to compile. With animations off it just switches. While a live video
// wallpaper plays (it covers the still one) the shuffle says so and leaves it be.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { WallpaperGrid } from './wallpaperGrid.js';

const HELPER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-wallpaper']);
const STAGE1 = 300, STAGE2 = 380, HOLD = 700, OUT = 300;
const LIVE_CLONE = 'mk-live-wallpaper';           // WACK's desktop.js names its live wallpaper this

// the top bar's wallpaper button: opens the grid once its click is over (as the eyedropper)
const WallpaperButton = GObject.registerClass(class MkWallpaperButton extends PanelMenu.Button {
    constructor(onClick) {
        super(0.5, 'Wallpapers', true);
        this.add_child(new St.Icon({icon_name: 'preferences-desktop-wallpaper-symbolic', style_class: 'system-status-icon'}));
        this.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.connect('button-release-event', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                onClick();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_STOP;
        });
    }
});

export class WallpaperEngine {
    constructor(settings) {
        this._settings = settings;
        this._frames = [];
        this._timers = new Set();
        // Super+W: the grid, to pick one (the timer and Shuffle take one without asking)
        this._carousel = new WallpaperGrid(settings, path => this.show(path), () => this.random());
        // (registered once; only a binding that took is removed again: removing one that never took
        // logged "Trying to remove non-existent keybinding")
        this._hasWallpaperBinding = false;
        try {
            const action = Main.wm.addKeybinding('wallpaper-shuffle', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._openCarousel());
            this._hasWallpaperBinding = action !== Meta.KeyBindingAction.NONE;
            if (!this._hasWallpaperBinding)
                console.warn('mk-shell-engine: Super+W (wallpaper-shuffle) could not be registered: the top-bar button still opens the grid');
        } catch (e) {
            console.warn(`mk-shell-engine: wallpaper key: ${e.message}`);
        }
        // the same grid, one click away: a button in the top bar beside the eyedropper
        try {
            this._button = new WallpaperButton(() => this._openCarousel());
            Main.panel.statusArea['mk-wallpaper-grid']?.destroy();   // (one left by a run that didn't stop)
            Main.panel.addToStatusArea('mk-wallpaper-grid', this._button, 0, 'right');
        } catch (e) {
            console.warn(`mk-shell-engine: wallpaper button: ${e.message}`);
        }
        settings.connectObject('changed::wallpaper-shuffle-minutes', () => this._schedule(), this);
        this._schedule();
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }

    _schedule() {
        if (this._intervalId)
            GLib.source_remove(this._intervalId);
        this._intervalId = 0;
        const minutes = this._settings.get_int('wallpaper-shuffle-minutes');
        if (minutes > 0) {
            this._intervalId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, minutes * 60, () => {
                if (!Main.sessionMode.isLocked)
                    this.shuffle();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _notice(text, icon = 'preferences-desktop-wallpaper-symbolic') {
        Main.panel._mkIsland?.show({icon, text});
    }

    _openCarousel() {
        if (this._busy)
            return;
        if (Main.layoutManager._backgroundGroup?.get_children().some(c => c.name === LIVE_CLONE)) {
            this._notice('A live wallpaper is playing: switch it off to change pictures');
            return;
        }
        this._carousel.open();
    }

    // Shuffle: any one of them
    random() {
        this._run(['random', '--json']);
    }

    // the timer's: the next picture, no questions
    shuffle() {
        this._run(['next', '--json']);
    }

    // the carousel's pick
    show(path) {
        this._run(['prepare', path, '--json']);
    }

    _run(args) {
        if (this._busy)
            return;
        if (Main.layoutManager._backgroundGroup?.get_children().some(c => c.name === LIVE_CLONE)) {
            this._notice('A live wallpaper is playing: switch it off to shuffle pictures');
            return;
        }
        if (!GLib.file_test(HELPER, GLib.FileTest.IS_EXECUTABLE)) {
            this._notice('mk-wallpaper is missing: run mk sync');
            return;
        }
        this._busy = true;
        this._cancel = new Gio.Cancellable();
        let proc;
        try {
            proc = Gio.Subprocess.new([HELPER, ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._busy = false;
            console.warn(`mk-shell-engine: wallpaper: ${e.message}`);
            return;
        }
        proc.communicate_utf8_async(null, this._cancel, (p, res) => {
            let info = null;
            try {
                const [, out] = p.communicate_utf8_finish(res);
                info = JSON.parse(out);
            } catch {}
            if (!info?.path) {
                this._busy = false;
                if (!this._cancel?.is_cancelled())
                    this._notice(info?.error ? 'No pictures: add some to Pictures/Wallpapers' : 'The next wallpaper didn\'t load');
                return;
            }
            try {
                this._transition(info);
            } catch (e) {                            // (whatever happens, the wallpaper changes)
                console.warn(`mk-shell-engine: wallpaper transition: ${e.message}`);
                this._clear();
                this._apply(info.path);
                this._busy = false;
            }
        });
    }

    _apply(path) {
        const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        const uri = Gio.File.new_for_path(path).get_uri();
        bg.set_string('picture-uri', uri);
        bg.set_string('picture-uri-dark', uri);
        bg.set_string('picture-options', 'zoom');
    }

    _picture(file) {
        return new St.Widget({reactive: false, opacity: 0, x_expand: true, y_expand: true,
            style: `background-image: url("${Gio.File.new_for_path(file).get_uri()}"); background-size: cover;` +
                'background-position: center;'});
    }

    _transition(info) {
        const layer = Main.layoutManager._backgroundGroup;
        if (!St.Settings.get().enable_animations || !layer) {
            this._apply(info.path);
            this._busy = false;
            this._notice(info.name);
            return;
        }
        const arts = [], lines = [];
        for (const m of Main.layoutManager.monitors) {
            const frame = new St.Widget({reactive: false, clip_to_allocation: true, x: m.x, y: m.y,
                width: m.width, height: m.height});
            // the obsidian blueprint ground, then the trace on it, then the picture
            const ground = new St.Widget({reactive: false, opacity: 0, width: m.width, height: m.height,
                style: 'background-color: #0b0e14;'});
            // (no trace when OpenCV isn't installed: an empty layer, so it's a plain cross-fade)
            const contour = info.contour ? this._picture(info.contour) : new St.Widget({opacity: 0});
            contour.set_size(m.width, m.height);
            // the picture, in a circle that grows from the centre (St clips a background image to
            // its corner radius): the picture itself stays put, cover-fitted to the monitor
            const scale = info.w && info.h ? Math.max(m.width / info.w, m.height / info.h) : 1;
            const [bw, bh] = info.w && info.h ? [Math.ceil(info.w * scale), Math.ceil(info.h * scale)] : [m.width, m.height];
            const d = Math.ceil(Math.hypot(m.width, m.height));
            const art = new St.Widget({reactive: false, opacity: 255, width: 2, height: 2,
                x: Math.round(m.width / 2) - 1, y: Math.round(m.height / 2) - 1,
                style: `background-image: url("${Gio.File.new_for_path(info.art).get_uri()}");` +
                    `background-size: ${bw}px ${bh}px; background-position: center; border-radius: ${Math.ceil(d / 2)}px;`});
            art._mkReveal = {d, m};
            frame.add_child(ground);
            contour.set_pivot_point(0.5, 0.5);
            contour.set_scale(1.02, 1.02);
            frame.add_child(contour);
            frame.add_child(art);
            layer.add_child(frame);                  // (the top of the background layer: under every window)
            this._frames.push(frame);
            ground.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            arts.push(art);
            lines.push(contour);
        }
        // stage 1: the contour trace draws in
        for (const contour of lines) {
            contour.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: STAGE1,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        // stage 2: the picture floods in, the lines go
        this._later(STAGE1, () => {
            lines.forEach(c => c.ease({opacity: 0, duration: STAGE2, mode: Clutter.AnimationMode.EASE_IN_QUAD}));
            // the radial reveal: the circle grows out from the centre to past the corners
            arts.forEach(a => {
                const {d, m} = a._mkReveal;
                a.ease({width: d, height: d, x: Math.round((m.width - d) / 2), y: Math.round((m.height - d) / 2),
                    duration: STAGE2, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
            });
        });
        // GNOME's own wallpaper switched underneath, then the overlay dissolves into it
        this._later(STAGE1 + STAGE2, () => {
            this._apply(info.path);
            this._notice(info.name);
            this._later(HOLD, () => {
                for (const frame of this._frames)
                    frame.ease({opacity: 0, duration: OUT, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                this._later(OUT + 50, () => {
                    this._clear();
                    this._busy = false;
                });
            });
        });
    }

    _clear() {
        this._frames.forEach(f => f.destroy());
        this._frames = [];
    }

    destroy() {
        try {
            this._button?.destroy();
        } catch {}
        this._button = null;
        this._carousel?.destroy();
        this._cancel?.cancel();
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        if (this._intervalId)
            GLib.source_remove(this._intervalId);
        this._intervalId = 0;
        this._clear();
        this._busy = false;
        if (this._hasWallpaperBinding)
            Main.wm.removeKeybinding('wallpaper-shuffle');
        this._hasWallpaperBinding = false;
        this._settings.disconnectObject(this);
    }
}
