// Where the user is typing: the caret rectangle the focused app reported to
// the input method (GTK, Qt, Firefox and Chromium do), in screen
// coordinates. Read it before a dialog takes the keyboard focus.
import Clutter from 'gi://Clutter';
import Mtk from 'gi://Mtk';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function caretRect() {
    const im = Main.inputMethod;
    const r = im?.currentFocus ? im._cursorRect : null;
    return r && (r.x || r.y) ? {...r} : null;
}

// Move a ModalDialog next to CARET: below it, or above when there's no room,
// kept inside the caret's monitor. Without a caret it stays centred.
export function anchorDialog(dialog, caret) {
    if (!caret)
        return;
    const stack = dialog.backgroundStack;
    const rect = new Mtk.Rectangle({x: caret.x, y: caret.y,
        width: Math.max(1, caret.width), height: Math.max(1, caret.height)});
    const monitor = Main.layoutManager.monitors[global.display.get_monitor_index_for_rect(rect)]
        ?? Main.layoutManager.primaryMonitor;
    stack.x_align = Clutter.ActorAlign.START;
    stack.y_align = Clutter.ActorAlign.START;
    const [, w] = stack.get_preferred_width(-1);
    const [, h] = stack.get_preferred_height(w);
    const gap = 8;
    const x = caret.x - monitor.x;
    let y = caret.y + caret.height + gap - monitor.y;
    if (y + h > monitor.height)
        y = caret.y - h - gap - monitor.y;
    stack.translation_x = Math.max(gap, Math.min(x, monitor.width - w - gap));
    stack.translation_y = Math.max(gap, Math.min(y, monitor.height - h - gap));
}
