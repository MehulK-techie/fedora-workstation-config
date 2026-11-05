// MK Shell Engine: minimize and restore as a glide. A window being
// minimized slides and shrinks along an eased curve into its app's icon in
// the dock (240 ms), dissolving over the last 60 ms; restoring launches it
// back out of the icon to its place (220 ms), with a 2 % overshoot that
// settles. Only the window's position, scale and opacity change (no mesh
// bending), so it stays smooth on any GPU.
//
// Safety first: whatever happens (an error, the window closing mid-way,
// GNOME cancelling window effects, the extension switching off) the window
// is always handed back to GNOME, exactly once, so a minimize can never hang
// or leave a black window behind. Without a dock icon to aim at it aims at the
// bottom centre of the screen. Full-screen-sized windows and setups with
// animations off get GNOME's own animation. Stands aside while the Magic Lamp
// extension is on.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { MAGIC_LAMP, isActive, watch } from './conflicts.js';

const MINIMIZE = 240, UNMINIMIZE = 220, DISSOLVE = 60;

const clamp = p => Math.min(1, Math.max(0, p));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = p => 1 - (1 - p) ** 3;
// ease-out with a small overshoot: peaks about 1.8 % past the end, then settles
const easeOutBack = (p, c = 0.75) => 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;

export class MagicLamp {
    // DOCK: a function returning the dock (or null), for the icon to aim at.
    constructor(dock) {
        this._dock = dock;
        this._running = new Map();       // actor -> {finish}
        this._hooked = false;
        this._unwatch = watch(() => this._sync());
        this._sync();
    }

    _sync() {
        const want = !isActive(MAGIC_LAMP);
        if (want && !this._hooked)
            this._hook();
        else if (!want && this._hooked)
            this._unhook();
    }

    // GNOME's own minimize handlers are set aside (blocked) while ours run; ours
    // hands a window back to them whenever the genie doesn't fit.
    _hook() {
        const wm = global.window_manager;
        this._blocked = [];
        for (const signal of ['minimize', 'unminimize']) {
            const id = GObject.signal_handler_find(wm, {signalId: signal});
            if (id) {
                GObject.signal_handler_block(wm, id);
                this._blocked.push(id);
            }
        }
        if (this._blocked.length !== 2) {         // couldn't find GNOME's: leave everything as it was
            this._unblock();
            console.warn('mk-shell-engine: genie: GNOME\'s minimize handlers not found, staying off');
            return;
        }
        this._ids = [
            wm.connect('minimize', (shellwm, actor) => this._run(shellwm, actor, true)),
            wm.connect('unminimize', (shellwm, actor) => this._run(shellwm, actor, false)),
            wm.connect('kill-window-effects', (_shellwm, actor) => this._running.get(actor)?.finish()),
        ];
        this._hooked = true;
    }

    _unblock() {
        for (const id of this._blocked ?? [])
            GObject.signal_handler_unblock(global.window_manager, id);
        this._blocked = [];
    }

    _unhook() {
        for (const {finish} of [...this._running.values()])
            finish();
        for (const id of this._ids ?? [])
            global.window_manager.disconnect(id);
        this._ids = [];
        this._unblock();
        this._hooked = false;
    }

    _fits(actor) {
        const win = actor.meta_window;
        return win && St.Settings.get().enable_animations && actor.get_texture?.() && !win.is_monitor_sized() &&
            [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG].includes(win.window_type) &&
            actor.width > 0 && actor.height > 0;
    }

    // Where the window goes: its app's dock icon, GNOME's icon geometry, or the bottom centre.
    _target(actor) {
        const win = actor.meta_window;
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        const fromDock = app && this._dock()?.iconRect(app);
        if (fromDock)
            return fromDock;
        const [ok, geom] = win.get_icon_geometry();
        if (ok && geom.width > 0)
            return {x: geom.x, y: geom.y, width: geom.width, height: geom.height};
        const m = Main.layoutManager.monitors[win.get_monitor()] ?? Main.layoutManager.primaryMonitor;
        return {x: m.x + m.width / 2 - 24, y: m.y + m.height - 48, width: 48, height: 48};
    }

    _run(shellwm, actor, minimizing) {
        const complete = () => minimizing ? shellwm.completed_minimize(actor) : shellwm.completed_unminimize(actor);
        this._running.get(actor)?.finish();          // a minimize cut short by an unminimize (or the reverse)
        if (!this._fits(actor)) {
            // GNOME's own animation (its method, called directly: its handler is blocked)
            if (minimizing)
                Main.wm._minimizeWindow(shellwm, actor);
            else
                Main.wm._unminimizeWindow(shellwm, actor);
            return;
        }
        let done = false, timeline = null, destroyId = 0;
        const reset = () => {
            actor.set_scale(1, 1);
            actor.set_translation(0, 0, 0);
            actor.set_pivot_point(0, 0);
            actor.opacity = 255;
        };
        const finish = () => {
            if (done)
                return;
            done = true;
            this._running.delete(actor);
            try {
                timeline?.stop();
                if (destroyId)
                    actor.disconnect(destroyId);
                reset();
            } catch (e) {
                console.error(`mk-shell-engine: minimize glide cleanup: ${e.message}`);
            } finally {
                complete();                          // always, exactly once
            }
        };
        this._running.set(actor, {finish});
        try {
            const [x, y] = actor.get_position();
            const w = actor.width, h = actor.height, icon = this._target(actor);
            // the window at its smallest: the icon's size, centred on the icon
            const scale = Math.max(0.02, Math.min(icon.width / w, icon.height / h));
            const tx = icon.x + icon.width / 2 - w * scale / 2 - x, ty = icon.y + icon.height / 2 - h * scale / 2 - y;
            actor.set_pivot_point(0, 0);
            const frame = t => {           // t: 0 = in its place, 1 = in the icon
                const s = lerp(1, scale, t);
                actor.set_scale(s, s);
                actor.set_translation(tx * t, ty * t, 0);
            };
            if (!minimizing) {
                frame(1);
                actor.opacity = 0;
                actor.show();
            }
            destroyId = actor.connect('destroy', () => {
                destroyId = 0;
                finish();
            });
            const duration = minimizing ? MINIMIZE : UNMINIMIZE;
            timeline = new Clutter.Timeline({actor, duration});
            timeline.connect('new-frame', () => {
                const p = timeline.get_progress(), ms = p * duration;
                if (minimizing) {
                    frame(easeOutCubic(p));
                    actor.opacity = Math.round(255 * clamp((duration - ms) / DISSOLVE));   // dissolves into the icon
                } else {
                    frame(1 - easeOutBack(p));
                    actor.opacity = Math.round(255 * clamp(ms / DISSOLVE));
                }
            });
            timeline.connect('completed', () => finish());
            timeline.start();
        } catch (e) {
            console.error(`mk-shell-engine: minimize glide: ${e.message}`);
            finish();
        }
    }

    destroy() {
        this._unwatch();
        if (this._hooked)
            this._unhook();
    }
}
