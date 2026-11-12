// MK Shell Engine: Super+D (GNOME's show-desktop key), kept strictly per workspace.
//
// GNOME's own keeps a "showing the desktop" state on each workspace inside Mutter, and its windows
// come back only when Mutter decides; going Super+D on one workspace, then another, could leave
// windows that didn't take clicks or keys until Alt+Tab. Here instead:
//   Super+D   this workspace's ordinary windows are minimized, and exactly which ones is noted for
//             this workspace alone (a Map by workspace index)
//   again     those same windows come back (still on this workspace, still minimized), and once their
//             animation is over the top one is activated: it takes clicks and keys at once
//   you opening, focusing or restoring a window there yourself ends that workspace's state
// Every window it brings back is made whole and visible again. GNOME's own handler returns when
// the engine stops.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { isWallpaperWindow, restoreActor } from './wallpaperWindow.js';

const RESTORE_SETTLE = 360;          // ms: the unminimize glide (220 ms) and a margin, then focus

export class ShowDesktop {
    constructor() {
        this._state = new Map();      // workspace index -> {windows: Meta.Window[]}
        Main.wm.setCustomKeybindingHandler('show-desktop', Shell.ActionMode.NORMAL, () => this.toggle());
        global.display.connectObject('notify::focus-window', () => this._userTookOver(), this);
        global.window_manager.connectObject('unminimize', (_wm, actor) => this._userTookOver(actor?.meta_window), this);
        global.workspace_manager.connectObject('workspace-removed', () => this._state.clear(), this);
    }

    _index() {
        return global.workspace_manager.get_active_workspace_index();
    }

    _ordinary(ws) {
        return ws.list_windows().filter(w => !w.minimized && !w.skip_taskbar && !isWallpaperWindow(w) &&
            (w.window_type === Meta.WindowType.NORMAL || w.window_type === Meta.WindowType.DIALOG) &&
            w.get_monitor() >= 0);
    }

    toggle() {
        try {
            const index = this._index();
            const state = this._state.get(index);
            if (state)
                this._restore(index, state);
            else
                this._show(index);
        } catch (e) {
            console.error(`mk-shell-engine: show desktop: ${e.message}`);
            this._state.delete(this._index());
        }
    }

    _show(index) {
        const ws = global.workspace_manager.get_active_workspace();
        // top of the stack first, so the restore can bring the one you were in back on top
        const windows = global.display.sort_windows_by_stacking(this._ordinary(ws)).reverse();
        if (!windows.length)
            return;
        this._busy = true;
        this._state.set(index, {windows});
        for (const w of windows)
            w.minimize();
        this._busy = false;
    }

    _restore(index, state) {
        this._state.delete(index);
        const ws = global.workspace_manager.get_active_workspace();
        const back = state.windows.filter(w => {
            try {
                return w.get_workspace() === ws && w.minimized;
            } catch {
                return false;                        // (a window closed meanwhile)
            }
        });
        if (!back.length)
            return;
        this._busy = true;
        for (const w of [...back].reverse())         // (bottom first: the top one ends on top)
            w.unminimize();
        this._busy = false;
        const top = back[0];
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTORE_SETTLE, () => {
            this._settleId = 0;
            for (const w of back) {
                const actor = w.get_compositor_private();
                if (actor && !w.minimized) {
                    restoreActor(actor);
                    actor.reactive = true;
                }
            }
            try {
                if (!top.minimized && top.get_workspace() === global.workspace_manager.get_active_workspace()) {
                    global.stage.set_key_focus(null);    // (nothing of the shell's keeps the keys)
                    top.activate(global.get_current_time());
                }
            } catch {}
            return GLib.SOURCE_REMOVE;
        });
    }

    // You opened, focused or restored a window on a workspace where the desktop was shown: that
    // workspace is back to normal (its remembered windows stay as they are, yours to bring back).
    _userTookOver(win = null) {
        if (this._busy)
            return;
        const index = this._index();
        if (!this._state.has(index))
            return;
        const focus = win ?? global.display.focus_window;
        if (focus && !focus.minimized && (focus.window_type === Meta.WindowType.NORMAL ||
            focus.window_type === Meta.WindowType.DIALOG) && !isWallpaperWindow(focus))
            this._state.delete(index);
    }

    destroy() {
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = 0;
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._state.clear();
        Meta.keybindings_set_custom_handler('show-desktop', null);    // (GNOME's own again)
    }
}
