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
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BURN_MY_WINDOWS, isActive, watch } from './conflicts.js';
import { isWallpaperWindow, restoreActor } from './wallpaperWindow.js';

const OPEN = 220, CLOSE = 130, FADE_IN = 100;   // ms: opening eases out (cubic) over 220
const SAFETY = 400;                             // ms after a window opens: it must be whole and visible
const clamp = p => Math.min(1, Math.max(0, p));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = p => 1 - (1 - p) ** 3;
const easeOutQuad = p => 1 - (1 - p) ** 2;

const TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

export class WindowAnimations {
    constructor() {
        this._running = new Map();
        this._safety = new Map();                // actor -> its 400 ms check
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

    // 400 ms after an ordinary window opens (whichever animation it got, ours or GNOME's), it's
    // made sure of: no effect left running on it, so it's put whole and in place, fully opaque,
    // shown. Whatever went wrong on a fresh machine, a window never stays invisible.
    _checkLater(actor) {
        const old = this._safety.get(actor);
        if (old)
            GLib.source_remove(old);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAFETY, () => {
            this._safety.delete(actor);
            try {
                const win = actor.meta_window;
                if (!win || win.minimized || win.window_type !== Meta.WindowType.NORMAL ||
                    isWallpaperWindow(win) || this._running.has(actor))
                    return GLib.SOURCE_REMOVE;
                const busy = ['opacity', 'scale-x', 'scale-y', 'translation-x', 'translation-y']
                    .some(p => actor.get_transition(p));
                // (hidden is only wrong for a window on this workspace: elsewhere it's meant to be)
                const here = !Main.overview.visible && (win.is_on_all_workspaces() ||
                    win.get_workspace() === global.workspace_manager.get_active_workspace());
                const off = actor.opacity !== 255 || actor.scale_x !== 1 || actor.scale_y !== 1 ||
                    actor.translation_x !== 0 || actor.translation_y !== 0 || (here && !actor.visible);
                if (off && !busy) {
                    console.warn('mk-shell-engine: a window was left faded, shrunk or hidden after opening: put right');
                    const wasVisible = actor.visible;
                    restoreActor(actor);
                    if (!here && !wasVisible)
                        actor.hide();
                }
            } catch {}                                // (the window went away meanwhile)
            return GLib.SOURCE_REMOVE;
        });
        this._safety.set(actor, id);
        actor.connectObject('destroy', () => {
            const pending = this._safety.get(actor);
            if (pending)
                GLib.source_remove(pending);
            this._safety.delete(actor);
        }, this);
    }

    _run(shellwm, actor, opening) {
        try {
            if (opening)
                this._checkLater(actor);
        } catch {}
        const complete = () => opening ? shellwm.completed_map(actor) : shellwm.completed_destroy(actor);
        this._running.get(actor)?.finish();
        // a live wallpaper's player: no effect at all (it's being made the desktop, kept unseen)
        if (isWallpaperWindow(actor.meta_window)) {
            complete();
            return;
        }
        let fits = false;
        try {
            fits = this._fits(actor);
        } catch (e) {
            console.error(`mk-shell-engine: window animation check: ${e.message}`);
        }
        if (!fits) {
            // GNOME's own (its method, called directly: its handler is blocked); if that throws,
            // the window is put back whole and handed over, never left unseen
            try {
                if (opening)
                    Main.wm._mapWindow(shellwm, actor);
                else
                    Main.wm._destroyWindow(shellwm, actor);
            } catch (e) {
                console.error(`mk-shell-engine: GNOME's window animation: ${e.message}`);
                if (opening)
                    restoreActor(actor);
                complete();
            }
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
                restoreActor(actor);
                if (!opening)
                    actor.opacity = 0;                   // (a closing window stays gone while GNOME removes it)
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
        for (const [actor, id] of this._safety) {
            GLib.source_remove(id);
            actor.disconnectObject(this);
        }
        this._safety.clear();
        this._unwatch();
        if (this._hooked)
            this._unhook();
    }
}
