// The workspace dots and the volume/brightness pop-up both sit at the bottom
// centre of the screen, so switching workspace while changing the volume drew
// one on top of the other. When both are showing, the dots glide up and sit
// just above the volume pop-up instead.
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OsdWindow from 'resource:///org/gnome/shell/ui/osdWindow.js';
import * as WorkspaceSwitcherPopup from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';

const GAP = 14;
const osdProto = OsdWindow.OsdWindow.prototype;
const wsProto = WorkspaceSwitcherPopup.WorkspaceSwitcherPopup.prototype;

function visibleOsdHeight() {
    for (const osd of Main.osdWindowManager?._osdWindows ?? []) {
        if (osd?.visible && osd._hbox)
            return osd._hbox.height + GAP;
    }
    return 0;
}

function placeWorkspacePopup(animate = true) {
    const popup = Main.wm?._workspaceSwitcherPopup;
    if (!popup)
        return;
    const lift = -visibleOsdHeight();
    if (popup.translation_y === lift)
        return;
    popup.remove_transition('translation-y');
    if (animate) {
        popup.ease({translation_y: lift, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    } else {
        popup.translation_y = lift;
    }
}

export class OsdStack {
    enable() {
        this._osdShow = osdProto.show;
        this._wsDisplay = wsProto.display;
        const osdShow = this._osdShow, wsDisplay = this._wsDisplay;
        osdProto.show = function (...args) {
            osdShow.apply(this, args);
            placeWorkspacePopup(true);
        };
        wsProto.display = function (...args) {
            wsDisplay.apply(this, args);
            placeWorkspacePopup(false);
        };
    }

    disable() {
        if (this._osdShow)
            osdProto.show = this._osdShow;
        if (this._wsDisplay)
            wsProto.display = this._wsDisplay;
        this._osdShow = this._wsDisplay = null;
    }
}
