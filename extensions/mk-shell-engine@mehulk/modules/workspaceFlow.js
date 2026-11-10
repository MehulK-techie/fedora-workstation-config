// MK Shell Engine: switching workspaces (Super+PageUp/PageDown, the top bar's dots, any switch
// GNOME animates on its own) glides on a 260 ms EASE_OUT_EXPO curve instead of GNOME's 250 ms
// EASE_OUT_CUBIC, with a little depth: the workspace you leave eases back to 0.96x and dims a
// touch as it goes, the one you arrive at comes forward from 0.96x. The live wallpaper stays
// pinned behind it all (WACK Sonoma Live Lockscreen's desktop.js). A touchpad swipe follows your
// fingers and keeps GNOME's own timing.
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DURATION = 260;
const DEPTH = 0.96;        // how far a workspace eases back as it leaves / comes in
const DIM = 215;           // and its opacity at that point

export class WorkspaceFlow {
    constructor() {
        const controller = Main.wm?._workspaceAnimation;
        if (!controller?.animateSwitch)
            throw new Error('GNOME\'s workspace animation has changed shape: left as it is');
        this._controller = controller;
        this._saved = controller.animateSwitch;
        const saved = this._saved;
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
            glide.set_progress_mode(Clutter.AnimationMode.EASE_OUT_EXPO);
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
                duration: DURATION, mode: Clutter.AnimationMode.EASE_OUT_EXPO});
        }
    }
}
