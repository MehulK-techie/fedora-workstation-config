// MK Shell Engine: windows opening and closing, quick and clean.
//   open  (170 ms): the window grows from 0.94x to its size around its
//         centre (ease-out cubic), fading in over the first 100 ms
//   close (130 ms): straight away, no lift: it shrinks to 0.94x, glides
//         12 px down and dissolves (ease-out quad)
// Only scale, position and opacity change (GPU-cheap). Like the minimize
// glide, GNOME's own handlers are set aside while this runs, every window is
// handed back to GNOME exactly once whatever happens, and anything this
// doesn't fit (menus, full-screen-sized windows, animations off) gets GNOME's
// own animation. Stands aside while Burn My Windows is on (it animates the
// same moments).
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BURN_MY_WINDOWS, isActive, watch } from './conflicts.js';

const OPEN = 170, CLOSE = 130, FADE_IN = 100;
const clamp = p => Math.min(1, Math.max(0, p));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = p => 1 - (1 - p) ** 3;
const easeOutQuad = p => 1 - (1 - p) ** 2;

const TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

export class WindowAnimations {
    constructor() {
        this._running = new Map();
        this._hooked = false;
        this._unwatch = watch(() => this._sync());
        this._sync();
    }

    _sync() {
        const want = !isActive(BURN_MY_WINDOWS);
        if (want && !this._hooked)
            this._hook();
        else if (!want && this._hooked)
            this._unhook();
    }

    _hook() {
        const wm = global.window_manager;
        this._blocked = [];
        for (const signal of ['map', 'destroy']) {
            const id = GObject.signal_handler_find(wm, {signalId: signal});
            if (id) {
                GObject.signal_handler_block(wm, id);
                this._blocked.push(id);
            }
        }
        if (this._blocked.length !== 2) {
            this._unblock();
            console.warn('mk-shell-engine: window animations: GNOME\'s handlers not found, staying off');
            return;
        }
        this._ids = [
            wm.connect('map', (shellwm, actor) => this._run(shellwm, actor, true)),
            wm.connect('destroy', (shellwm, actor) => this._run(shellwm, actor, false)),
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
        return win && St.Settings.get().enable_animations && TYPES.includes(win.window_type) &&
            !win.is_monitor_sized() && !Main.overview.visible && actor.width > 0 && actor.height > 0;
    }

    _run(shellwm, actor, opening) {
        const complete = () => opening ? shellwm.completed_map(actor) : shellwm.completed_destroy(actor);
        this._running.get(actor)?.finish();
        if (!this._fits(actor)) {
            // GNOME's own (its method, called directly: its handler is blocked)
            if (opening)
                Main.wm._mapWindow(shellwm, actor);
            else
                Main.wm._destroyWindow(shellwm, actor);
            return;
        }
        let done = false, timeline = null;
        const finish = () => {
            if (done)
                return;
            done = true;
            this._running.delete(actor);
            try {
                timeline?.stop();
                actor.set_scale(1, 1);
                actor.translation_y = 0;
                actor.set_pivot_point(0, 0);
                actor.opacity = 255;
            } catch (e) {
                console.error(`mk-shell-engine: window animation cleanup: ${e.message}`);
            } finally {
                complete();                          // always, exactly once
            }
        };
        this._running.set(actor, {finish});
        try {
            actor.set_pivot_point(0.5, 0.5);         // around its centre
            const frame = opening
                ? p => {
                    const s = lerp(0.94, 1, easeOutCubic(p));
                    actor.set_scale(s, s);
                    actor.opacity = Math.round(255 * easeOutQuad(clamp(p * OPEN / FADE_IN)));
                }
                : p => {
                    const e = easeOutQuad(p);
                    actor.set_scale(lerp(1, 0.94, e), lerp(1, 0.94, e));
                    actor.translation_y = lerp(0, 12, e);
                    actor.opacity = Math.round(255 * (1 - e));
                };
            frame(0);
            if (opening)
                actor.show();
            timeline = new Clutter.Timeline({actor, duration: opening ? OPEN : CLOSE});
            timeline.connect('new-frame', () => frame(timeline.get_progress()));
            timeline.connect('completed', () => finish());
            timeline.start();
        } catch (e) {
            console.error(`mk-shell-engine: window animation: ${e.message}`);
            finish();
        }
    }

    destroy() {
        this._unwatch();
        if (this._hooked)
            this._unhook();
    }
}
