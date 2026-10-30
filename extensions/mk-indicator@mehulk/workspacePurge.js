// Smart Workspace Purge (Super+Shift+Q): close every ordinary window on
// the workspace you're on, with five seconds to change your mind.
//
// The windows are minimized at once and only asked to close (gracefully,
// as their own close button does) after the grace period; Undo in the
// notification brings them all back untouched. Left alone: windows on every
// workspace (pinned), always-on-top windows, dialogs, windows that hide
// from the taskbar (desktop widgets, helpers) and anything that can't be
// closed. A window that refuses to close (unsaved work) is shown again.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const GRACE_S = 5;

function closable(win, workspace) {
    return win.get_window_type() === Meta.WindowType.NORMAL &&
        !win.get_transient_for() &&
        !win.is_on_all_workspaces() &&
        !win.is_above() &&
        !win.is_skip_taskbar() &&
        win.can_close() &&
        win.get_workspace() === workspace;
}

export class WorkspacePurge {
    constructor() {
        this._pending = null; // {windows, timer, notification}
    }

    purge() {
        if (this._pending)
            this._closeNow(); // a second press: don't wait for the first
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows().filter(w => closable(w, workspace));
        if (!windows.length)
            return;
        windows.forEach(w => w.minimize());
        const pending = {windows, timer: 0, notification: null};
        pending.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, GRACE_S, () => {
            pending.timer = 0;
            this._closeNow();
            return GLib.SOURCE_REMOVE;
        });
        this._pending = pending;

        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: `Closing ${windows.length} window${windows.length === 1 ? '' : 's'}`,
            body: `On this workspace, in ${GRACE_S} seconds`,
            isTransient: true,
        });
        notification.addAction('Undo', () => this._undo(pending));
        pending.notification = notification;
        source.addNotification(notification);
    }

    _undo(pending) {
        if (this._pending !== pending)
            return;
        if (pending.timer)
            GLib.source_remove(pending.timer);
        this._pending = null;
        pending.windows.forEach(w => {
            try {
                w.unminimize();
            } catch {} // closed meanwhile
        });
        pending.windows.at(-1)?.activate?.(global.get_current_time());
    }

    _closeNow() {
        const pending = this._pending;
        if (!pending)
            return;
        this._pending = null;
        if (pending.timer)
            GLib.source_remove(pending.timer);
        pending.notification?.destroy?.();
        const time = global.get_current_time();
        for (const w of pending.windows) {
            try {
                w.delete(time);
            } catch {} // already gone
        }
        // still there a moment later: it asked a question (unsaved work); show it
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            for (const w of pending.windows) {
                try {
                    if (w.get_compositor_private())
                        w.unminimize();
                } catch {}
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._pending)
            this._undo(this._pending);
    }
}

export function bindWorkspacePurge(extension, purge) {
    Main.wm.addKeybinding('workspace-purge', extension.getSettings(), Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => purge.purge());
}

export function unbindWorkspacePurge() {
    Main.wm.removeKeybinding('workspace-purge');
}
