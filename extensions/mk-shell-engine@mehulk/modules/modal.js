// MK Shell Engine: taking the keyboard and pointer for an overlay (the wallpaper grid, the eyedropper,
// snap layouts) without ever being able to freeze the desktop:
//   - any open top-bar menu (the calendar, Quick Settings, any other) is closed first: a modal pushed
//     while a menu holds its own grab can leave neither working
//   - the grab is checked the way GNOME checks its own: if the keyboard wasn't granted, it's let go at
//     once and the overlay is told (onAbort), instead of an overlay that takes nothing
//   - a failsafe: with no input at all for FAILSAFE seconds, the overlay is closed for you (onAbort);
//     every key, click, scroll or movement on it starts the count again
// openModal(actor, onAbort) -> a handle with close(), or null (nothing was taken).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const FAILSAFE = 8;              // s without input

function closeMenus() {
    try {
        Main.panel.menuManager?.activeMenu?.close(BoxPointer.PopupAnimation.NONE);
    } catch {}
    try {
        Main.panel.closeCalendar?.();
        Main.panel.closeQuickSettings?.();
    } catch {}
}

export function openModal(actor, onAbort) {
    closeMenus();
    let grab;
    try {
        grab = Main.pushModal(actor, {actionMode: Shell.ActionMode.POPUP});
    } catch (e) {
        console.warn(`mk-shell-engine: modal: ${e.message}`);
        return null;
    }
    if (grab?.get_seat_state && (grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
        Main.popModal(grab);                         // (not granted: let go at once)
        return null;
    }
    let timer = 0, closed = false;
    const handle = {
        close() {
            if (closed)
                return;
            closed = true;
            if (timer)
                GLib.source_remove(timer);
            timer = 0;
            if (eventId)
                actor.disconnect(eventId);
            try {
                Main.popModal(grab);
            } catch {}
        },
    };
    const arm = () => {
        if (timer)
            GLib.source_remove(timer);
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, FAILSAFE, () => {
            timer = 0;
            console.warn('mk-shell-engine: an overlay sat without input: closed');
            handle.close();
            try {
                onAbort?.();
            } catch {}
            return GLib.SOURCE_REMOVE;
        });
    };
    const eventId = actor.connect('captured-event', () => {
        arm();
        return Clutter.EVENT_PROPAGATE;
    });
    arm();
    return handle;
}
