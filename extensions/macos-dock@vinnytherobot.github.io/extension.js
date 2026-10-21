import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { DockManager } from "./lib/dockManager.js";
export default class MacosDockExtension extends Extension {
    _dockManager = null;
    enable() {
        this._dockManager = new DockManager();
        this._dockManager.enable(this.getSettings());
    }
    disable() {
        if (this._dockManager) {
            this._dockManager.disable();
            this._dockManager = null;
        }
    }
}
