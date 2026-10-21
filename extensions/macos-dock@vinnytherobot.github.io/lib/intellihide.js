import Shell from "gi://Shell";
import { SignalManager } from "./signalManager.js";
export class Intellihide {
    _signals;
    _status = false;
    _onStatusChanged = null;
    _dockRect = null;
    constructor() {
        this._signals = new SignalManager();
    }
    start(callback) {
        this._onStatusChanged = callback;
        this._signals.connect(global.display, "restacked", () => this._checkOverlap());
        this._signals.connect(global.display, "window-created", () => this._checkOverlap());
        const tracker = Shell.WindowTracker.get_default();
        this._signals.connect(tracker, "notify::focus-app", () => this._checkOverlap());
        this._checkOverlap();
    }
    setDockRect(x, y, width, height) {
        this._dockRect = { x, y, width, height };
        this._checkOverlap();
    }
    stop() {
        this._signals.disconnectAll();
        this._onStatusChanged = null;
    }
    _checkOverlap() {
        if (!this._dockRect || !this._onStatusChanged)
            return;
        const dockX1 = this._dockRect.x;
        const dockY1 = this._dockRect.y;
        const dockX2 = this._dockRect.x + this._dockRect.width;
        const dockY2 = this._dockRect.y + this._dockRect.height;
        let overlaps = false;
        const windowActors = global.get_window_actors();
        for (const wa of windowActors) {
            const metaWin = wa.get_meta_window();
            if (!metaWin)
                continue;
            if (!metaWin.showing_on_its_workspace())
                continue;
            const workspace = metaWin.get_workspace();
            if (!workspace)
                continue;
            if (workspace !== global.workspace_manager.get_active_workspace())
                continue;
            if (!metaWin.maximized_vertically && !metaWin.fullscreen)
                continue;
            const rect = metaWin.get_frame_rect();
            const winX1 = rect.x;
            const winY1 = rect.y;
            const winX2 = rect.x + rect.width;
            const winY2 = rect.y + rect.height;
            if (winX1 < dockX2 && winX2 > dockX1 && winY1 < dockY2 && winY2 > dockY1) {
                overlaps = true;
                break;
            }
        }
        if (this._status !== overlaps) {
            this._status = overlaps;
            this._onStatusChanged(this._status);
        }
    }
}
