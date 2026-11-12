// MK Shell Engine: switching workspaces (Ctrl+Alt+Arrow, Super+PageUp/PageDown, the top bar's
// dots, a touchpad swipe once you let go) is a depth-parallax glide: 360 ms on EASE_OUT_CUBIC.
//   - the workspace you leave eases back to 0.90x and softens to 160 opacity; the one you arrive
//     at glides in from 0.92x to full
//   - 400 ms after landing, every window on the workspace is made sure of: whole, opaque, shown
//   - the wallpaper drifts the same way and settles back (parallax): it grows 6 % for the moment
//     and moves within that margin (about 3 % of the screen's width), so no edge of it
//     ever shows; a literal 0.35x of the windows' travel would need it blown up by over 70 %
//   - the top bar's workspace dots give one crisp pulse as you land
// While a swipe is under your fingers it follows them exactly. Every part of this is guarded: if
// GNOME's shell differs, its own slide runs as it is.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { isWallpaperWindow, restoreActor } from './wallpaperWindow.js';

const DURATION = 360;
const DEPTH = 0.90;        // how far the workspace you leave eases back
const DEPTH_IN = 0.92;     // and the one you arrive at comes in from
const DIM = 160;           // their opacity at that point
const CURVE = Clutter.AnimationMode.EASE_OUT_CUBIC;
const OVERSCAN = 1.06;     // the background, grown this much while it drifts, so its edges stay off screen
const DRIFT = 0.9;         // how much of the room that overscan gives it the wallpaper drifts

// The wallpaper's drift: out toward the overscan's edge, and back. Always ends exactly where it
// started (cut short, it's put straight back).
function drift(direction) {
    const bg = Main.layoutManager._backgroundGroup, m = Main.layoutManager.primaryMonitor;
    const sign = direction === Meta.MotionDirection.RIGHT ? -1 : direction === Meta.MotionDirection.LEFT ? 1 : 0;
    if (!bg || !m || !sign)
        return;
    const room = m.width * (OVERSCAN - 1) / 2;             // what the overscan hides on each side
    const shift = sign * Math.round(room * DRIFT);
    bg.remove_all_transitions();
    bg.set_pivot_point((m.x + m.width / 2) / Math.max(1, bg.width), (m.y + m.height / 2) / Math.max(1, bg.height));
    const settle = () => bg.ease({translation_x: 0, scale_x: 1, scale_y: 1, duration: Math.round(DURATION * 0.7),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: () => resetBackground()});
    bg.ease({translation_x: shift, scale_x: OVERSCAN, scale_y: OVERSCAN, duration: Math.round(DURATION * 0.45),
        mode: CURVE, onStopped: finished => finished ? settle() : resetBackground()});
}

function resetBackground() {
    const bg = Main.layoutManager._backgroundGroup;
    if (bg && !bg.get_transition('translation-x')) {
        bg.translation_x = 0;
        bg.set_scale(1, 1);
    }
}

// The top bar's workspace dots: a quick swell and a springy return.
function pulseDots() {
    const dots = Main.panel.statusArea?.activities;
    if (!dots)
        return;
    dots.remove_all_transitions();
    dots.set_pivot_point(0.5, 0.5);
    dots.ease({scale_x: 1.12, scale_y: 1.12, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: () => dots.ease({scale_x: 1, scale_y: 1, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onStopped: () => dots.set_scale(1, 1)})});
}

// After a switch: no window on the workspace you landed on is left faded, shrunk or moved (an
// effect cut short mid-slide), unless something is still animating it.
let settleTimer = 0;
function settleSoon() {
    if (settleTimer)
        GLib.source_remove(settleTimer);
    settleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DURATION + 400, () => {
        settleTimer = 0;
        guarded('settle', () => {
            const ws = global.workspace_manager.get_active_workspace();
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (!win || win.minimized || isWallpaperWindow(win) || win.window_type !== Meta.WindowType.NORMAL ||
                    !(win.get_workspace() === ws || win.is_on_all_workspaces()))
                    continue;
                const busy = ['opacity', 'scale-x', 'translation-x', 'translation-y'].some(p => actor.get_transition(p));
                if (!busy && (actor.opacity !== 255 || actor.scale_x !== 1 || actor.scale_y !== 1 ||
                    actor.translation_x !== 0 || actor.translation_y !== 0 || !actor.visible))
                    restoreActor(actor);
            }
        });
        return GLib.SOURCE_REMOVE;
    });
}

function guarded(what, fn) {
    try {
        fn();
    } catch (e) {
        console.warn(`mk-shell-engine: workspace flow (${what}): ${e.message}`);
    }
}

// Blur my Shell's dynamic panel blur re-blurs on every frame whatever moves under the bar. While
// workspaces slide it's rested: its blur layer (never its settings, which would rebuild the
// actors mid-motion) is hidden for those 440 ms, the bar keeping its frosted tint, and shown
// again the moment the slide lands. Only the dynamic kind: a static blur costs nothing.
let restTimer = 0;
function restPanelBlur(rest) {
    if (restTimer) {
        GLib.source_remove(restTimer);
        restTimer = 0;
    }
    if (rest) {                                      // (never left hidden: back after 1.5 s whatever happens)
        restTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            restTimer = 0;
            restPanelBlur(false);
            return GLib.SOURCE_REMOVE;
        });
    }
    try {
        for (const actors of global.blur_my_shell?._panel_blur?.actors_list ?? []) {
            const layer = actors?.widgets?.background_group ?? actors?.widgets?.background;
            if (layer && !actors.static_blur)
                layer.visible = !rest;
        }
    } catch {}                                       // (Blur my Shell changed shape: left alone)
}

export class WorkspaceFlow {
    constructor() {
        const controller = Main.wm?._workspaceAnimation;
        if (!controller?.animateSwitch)
            throw new Error('GNOME\'s workspace animation has changed shape: left as it is');
        this._controller = controller;
        this._saved = controller.animateSwitch;
        this._savedEnd = controller._switchWorkspaceEnd;
        const saved = this._saved, savedEnd = this._savedEnd;
        // a swipe let go: the rest of the way on the same curve and time
        if (savedEnd) {
            controller._switchWorkspaceEnd = function (tracker, duration, endProgress) {
                const result = savedEnd.call(this, tracker, Math.max(duration, DURATION), endProgress);
                try {
                    for (const group of this._switchData?.monitors ?? [])
                        group.get_transition('progress')?.set_progress_mode(CURVE);
                } catch (e) {
                    console.warn(`mk-shell-engine: workspace flow: ${e.message}`);    // (GNOME's curve then)
                }
                guarded('dots', pulseDots);
                settleSoon();
                return result;
            };
        }
        // (the blur rests from the first frame of a slide, keyboard or swipe, to its last)
        this._savedBegin = controller._switchWorkspaceBegin;
        this._savedFinish = controller._finishWorkspaceSwitch;
        const savedBegin = this._savedBegin, savedFinish = this._savedFinish;
        if (savedBegin) {
            controller._switchWorkspaceBegin = function (...args) {
                restPanelBlur(true);
                try {
                    return savedBegin.apply(this, args);
                } catch (e) {
                    restPanelBlur(false);                // (GNOME's own failed: the bar's blur back at once)
                    throw e;
                }
            };
        }
        if (savedFinish) {
            controller._finishWorkspaceSwitch = function (...args) {
                const result = savedFinish.apply(this, args);
                restPanelBlur(false);
                return result;
            };
        }
        controller.animateSwitch = function (from, to, direction, onComplete) {
            restPanelBlur(true);
            const result = saved.call(this, from, to, direction, onComplete);
            try {
                retime(this._switchData, from, to);
            } catch (e) {
                console.warn(`mk-shell-engine: workspace flow: ${e.message}`);    // (GNOME's own glide then)
            }
            guarded('parallax', () => drift(direction));
            guarded('dots', pulseDots);
            settleSoon();
            return result;
        };
    }

    destroy() {
        restPanelBlur(false);
        if (settleTimer)
            GLib.source_remove(settleTimer);
        settleTimer = 0;
        guarded('reset', () => {
            Main.layoutManager._backgroundGroup?.remove_all_transitions();
            resetBackground();
            Main.panel.statusArea?.activities?.remove_all_transitions();
            Main.panel.statusArea?.activities?.set_scale(1, 1);
        });
        for (const [name, saved] of [['_switchWorkspaceBegin', this._savedBegin], ['_finishWorkspaceSwitch', this._savedFinish]]) {
            if (!saved || this._controller[name] === saved)
                continue;
            delete this._controller[name];
            if (this._controller[name] !== saved)
                this._controller[name] = saved;
        }
        if (this._savedEnd && this._controller._switchWorkspaceEnd !== this._savedEnd) {
            delete this._controller._switchWorkspaceEnd;
            if (this._controller._switchWorkspaceEnd !== this._savedEnd)
                this._controller._switchWorkspaceEnd = this._savedEnd;
        }
        if (this._controller.animateSwitch !== this._saved)
            delete this._controller.animateSwitch;       // (the class's own again)
        if (this._controller.animateSwitch !== this._saved)
            this._controller.animateSwitch = this._saved;
    }
}

function retime(switchData, from, to) {
    const wm = global.workspace_manager;
    const fromWs = wm.get_workspace_by_index(from), toWs = wm.get_workspace_by_index(to);
    for (const group of switchData?.monitors ?? []) {
        const glide = group.get_transition('progress');
        if (glide) {
            glide.set_duration(DURATION);
            glide.set_progress_mode(CURVE);
        }
        if (group.index !== Main.layoutManager.primaryIndex)
            continue;
        for (const ws of group._workspaceGroups ?? []) {
            if (ws.workspace !== fromWs && ws.workspace !== toWs)
                continue;
            ws.set_pivot_point(0.5, 0.5);
            const leaving = ws.workspace === fromWs;
            if (!leaving)
                ws.set({scale_x: DEPTH_IN, scale_y: DEPTH_IN, opacity: DIM});
            ws.ease({scale_x: leaving ? DEPTH : 1, scale_y: leaving ? DEPTH : 1, opacity: leaving ? DIM : 255,
                duration: DURATION, mode: CURVE});
        }
    }
}
