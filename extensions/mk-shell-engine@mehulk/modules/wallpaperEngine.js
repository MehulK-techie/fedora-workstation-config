// MK Shell Engine: the wallpaper shuffle and its contour-trace transition.
//
// Super+W (`wallpaper-shuffle`), or every N minutes (`wallpaper-shuffle-minutes`, 0 = only when
// asked), shows the next picture from ~/Pictures/Wallpapers and MK's own three. bin/mk-wallpaper
// prepares it in a process of its own (the shell never decodes or analyses a full-size picture):
// a downscaled copy, and its contour trace (the picture's contour lines and edges, glowing in its
// own accent colour over an obsidian blueprint grid). Then, in the background layer, behind every
// window:
//   stage 1, 0-380 ms    the contour trace draws in over obsidian, settling from 1.02x
//   stage 2, 380-820 ms  the full-colour picture floods in as the lines fade away
// and GNOME's own wallpaper is switched to it underneath, the overlay dissolving once that's in.
// Two plain cross-fades of two pictures: nothing a slow or software-rendered GPU can't draw, no
// shader that could fail to compile. With animations off it just switches. While a live video
// wallpaper plays (it covers the still one) the shuffle says so and leaves it be.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const HELPER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-wallpaper']);
const STAGE1 = 380, STAGE2 = 440, HOLD = 700, OUT = 300;
const LIVE_CLONE = 'mk-live-wallpaper';           // WACK's desktop.js names its live wallpaper this

export class WallpaperEngine {
    constructor(settings) {
        this._settings = settings;
        this._frames = [];
        this._timers = new Set();
        Main.wm.addKeybinding('wallpaper-shuffle', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.shuffle());
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

    shuffle() {
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
            proc = Gio.Subprocess.new([HELPER, 'next', '--json'],
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
                width: m.width, height: m.height, layout_manager: new Clutter.BinLayout()});
            // the obsidian blueprint ground, then the trace on it, then the picture
            const ground = new St.Widget({reactive: false, opacity: 0, x_expand: true, y_expand: true,
                style: 'background-color: #0b0e14;'});
            // (no trace when OpenCV isn't installed: an empty layer, so it's a plain cross-fade)
            const contour = info.contour ? this._picture(info.contour) : new St.Widget({opacity: 0});
            const art = this._picture(info.art);
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
            arts.forEach(a => a.ease({opacity: 255, duration: STAGE2, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD}));
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
        this._cancel?.cancel();
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        if (this._intervalId)
            GLib.source_remove(this._intervalId);
        this._intervalId = 0;
        this._clear();
        this._busy = false;
        Main.wm.removeKeybinding('wallpaper-shuffle');
        this._settings.disconnectObject(this);
    }
}
