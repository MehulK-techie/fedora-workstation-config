// MK Shell Engine: the genie. A window being minimized pours into its app's
// icon in the dock (270 ms), and pours back out when you bring it back
// (260 ms). The window is a 24 x 24 mesh: the rows nearest the dock move
// first, each row narrowing and sliding on a smoothstep (Hermite) curve, so
// the window funnels into the icon instead of shrinking as a flat card.
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

const MINIMIZE = 270, UNMINIMIZE = 260;
const TILES = 24;

const smooth = p => p * p * (3 - 2 * p);                  // Hermite smoothstep: 0 to 1, flat at both ends
const clamp = p => Math.min(1, Math.max(0, p));
const lerp = (a, b, t) => a + (b - a) * t;

const LampEffect = GObject.registerClass(
class MKLampEffect extends Clutter.DeformEffect {
    // WINDOW: the actor's rect when it starts; TARGET: the icon's rect, both on screen.
    _init(window, target) {
        super._init();
        this._win = window;
        this._target = target;
        this._below = target.y + target.height / 2 > window.y + window.height / 2;
        this.progress = 0;
        this.set_n_tiles(TILES, TILES);
    }

    vfunc_deform_vertex(w, h, v) {
        const t = this.progress, win = this._win, ico = this._target;
        // how far this row is from the icon: those nearest go first
        const d = this._below ? 1 - v.ty : v.ty;
        const across = smooth(clamp((t * 1.3 - 0.3 * d) / 1.0));       // narrowing, a little ahead
        const down = smooth(clamp((t - 0.3 * d) / 0.7));                 // sliding toward the icon
        const y = lerp(win.y + v.ty * win.height, ico.y + v.ty * ico.height, down);
        const cx = lerp(win.x + win.width / 2, ico.x + ico.width / 2, across);
        const x = cx + (v.tx - 0.5) * lerp(win.width, ico.width, across);
        v.x = (x - win.x) * (w / win.width);
        v.y = (y - win.y) * (h / win.height);
    }

    vfunc_modify_paint_volume() {
        return false;                // (the mesh leaves the window's own box: never cull it)
    }
});

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
        let done = false, timeline = null, effect = null, destroyId = 0;
        const finish = () => {
            if (done)
                return;
            done = true;
            this._running.delete(actor);
            try {
                timeline?.stop();
                if (destroyId)
                    actor.disconnect(destroyId);
                if (effect)
                    actor.remove_effect(effect);
                actor.opacity = 255;
            } catch (e) {
                console.error(`mk-shell-engine: genie cleanup: ${e.message}`);
            } finally {
                complete();                          // always, exactly once
            }
        };
        this._running.set(actor, {finish});
        try {
            const [x, y] = actor.get_position();
            const window = {x, y, width: actor.width, height: actor.height};
            effect = new LampEffect(window, this._target(actor));
            effect.progress = minimizing ? 0 : 1;
            actor.add_effect_with_name('mk-lamp', effect);
            if (!minimizing)
                actor.show();
            destroyId = actor.connect('destroy', () => {
                destroyId = 0;
                finish();
            });
            timeline = new Clutter.Timeline({actor, duration: minimizing ? MINIMIZE : UNMINIMIZE});
            timeline.connect('new-frame', () => {
                const p = timeline.get_progress();
                const t = minimizing ? p : 1 - p;
                effect.progress = t;
                actor.opacity = Math.round(255 * (1 - smooth(clamp((t - 0.7) / 0.3))));   // fades in the icon's mouth
                effect.invalidate();
            });
            timeline.connect('completed', () => finish());
            timeline.start();
        } catch (e) {
            console.error(`mk-shell-engine: genie: ${e.message}`);
            finish();
        }
    }

    destroy() {
        this._unwatch();
        if (this._hooked)
            this._unhook();
    }
}
