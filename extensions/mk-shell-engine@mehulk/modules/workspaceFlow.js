// MK Shell Engine: switching workspaces (Super+PageUp/PageDown, the top bar's dots, a touchpad
// swipe once you let go) glides over 440 ms on EASE_OUT_QUINT (a quick start, a long cushioned
// landing) instead of GNOME's 250 ms EASE_OUT_CUBIC, with a little depth: the workspace you leave
// eases back to 0.97x and dims a touch, the one you arrive at comes forward from 0.97x. The live
// wallpaper stays pinned behind it all (WACK Sonoma Live Lockscreen's desktop.js). While a swipe
// is under your fingers it follows them exactly.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DURATION = 440;
const DEPTH = 0.97;        // how far a workspace eases back as it leaves / comes in
const DIM = 225;           // and its opacity at that point
const CURVE = Clutter.AnimationMode.EASE_OUT_QUINT;

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
                for (const group of this._switchData?.monitors ?? [])
                    group.get_transition('progress')?.set_progress_mode(CURVE);
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
                return savedBegin.apply(this, args);
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
            return result;
        };
    }

    destroy() {
        restPanelBlur(false);
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
                ws.set({scale_x: DEPTH, scale_y: DEPTH, opacity: DIM});
            ws.ease({scale_x: leaving ? DEPTH : 1, scale_y: leaving ? DEPTH : 1, opacity: leaving ? DIM : 255,
                duration: DURATION, mode: CURVE});
        }
    }
}
