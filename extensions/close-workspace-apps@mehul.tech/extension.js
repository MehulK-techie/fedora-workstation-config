import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

export default class CloseWorkspaceAppsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        
        Main.wm.addKeybinding(
            'close-workspace-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => {
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
        );
    }

    disable() {
        Main.wm.removeKeybinding('close-workspace-shortcut');
        this._settings = null;
    }
}