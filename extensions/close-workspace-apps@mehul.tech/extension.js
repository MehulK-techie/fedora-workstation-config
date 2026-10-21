import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';

export default class CloseWorkspaceAppsExtension extends Extension {
    enable() {
        this._actionId = global.display.grab_accelerator('<Super><Shift>c', Meta.KeyBindingFlags.NONE);
        if (this._actionId !== Meta.KeyBindingAction.NONE) {
            this._handlerId = global.display.connect('accelerator-activated', (display, action) => {
                if (action === this._actionId) {
                    let ws = global.workspace_manager.get_active_workspace();
                    if (!ws) return;
                    let windows = ws.list_windows();
                    let now = global.get_current_time();
                    for (let win of windows) {
                        if (win && !win.is_skip_taskbar()) {
                            win.delete(now);
                        }
                    }
                }
            });
        }
    }

    disable() {
        if (this._handlerId) {
            global.display.disconnect(this._handlerId);
            this._handlerId = null;
        }
        if (this._actionId && this._actionId !== Meta.KeyBindingAction.NONE) {
            global.display.ungrab_accelerator(this._actionId);
            this._actionId = null;
        }
    }
}