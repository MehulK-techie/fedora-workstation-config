// MK Shell Engine: switching workspaces (Super+PageUp/PageDown, the top bar's dots, a touchpad
// swipe once you let go) glides over 440 ms on EASE_OUT_QUINT (a quick start, a long cushioned
// landing) instead of GNOME's 250 ms EASE_OUT_CUBIC, with a little depth: the workspace you leave
// eases back to 0.97x and dims a touch, the one you arrive at comes forward from 0.97x. The live
// wallpaper stays pinned behind it all (WACK Sonoma Live Lockscreen's desktop.js). While a swipe
// is under your fingers it follows them exactly.
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DURATION = 440;
const DEPTH = 0.97;        // how far a workspace eases back as it leaves / comes in
const DIM = 225;           // and its opacity at that point
const CURVE = Clutter.AnimationMode.EASE_OUT_QUINT;

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
        controller.animateSwitch = function (from, to, direction, onComplete) {
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
