// MK Shell Engine: Snip & Sketch-style area screenshots. GNOME's screenshot
// tool (Super+Shift+S, Shift+Print) opens on the box you picked last time;
// here it opens with no box at all, the whole screen dimmed under a crosshair.
// Drag any area and it's taken the moment you let go: saved to
// ~/Pictures/Screenshots and copied to the clipboard (GNOME does both), no
// extra click, no editor left open. The tool's other modes (window, whole
// screen, screen recording) and its buttons work as before; with
// snip-auto-capture off, a drag only picks the area and you press Capture.
// The previous box only ever lived in GNOME Shell's memory, so there's no file
// or setting to clear: it's forgotten each time the tool opens.
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Snip {
    constructor(settings) {
        this._settings = settings;
        const ui = Main.screenshotUI, sel = ui?._areaSelector;
        if (!ui || !sel?.stopDrag || !ui._onCaptureButtonClicked)
            throw new Error('GNOME\'s screenshot tool has changed shape: left as it is');
        this._ui = ui;
        this._sel = sel;
        this._saved = {open: ui.open, stopDrag: sel.stopDrag, capture: ui._onCaptureButtonClicked};
        const saved = this._saved, self = this;

        ui.open = function (...args) {
            if (!this.visible && self._settings.get_boolean('fresh-snip'))
                self._blank();
            return saved.open.apply(this, args);
        };

        // nothing picked yet: Capture (or Enter) waits for a drag instead of taking a 1 px shot
        ui._onCaptureButtonClicked = function (...args) {
            if (sel._mkBlank && this._selectionButton.checked && this._shotButton.checked)
                return Promise.resolve();
            return saved.capture.apply(this, args);
        };

        sel.stopDrag = function (...args) {
            const fresh = this._dragButton && this._dragCursor === Clutter.CursorType.CROSSHAIR;
            const moved = this._lastX !== this._startX || this._lastY !== this._startY;
            const result = saved.stopDrag.apply(this, args);
            if (fresh)
                this._mkBlank = false;
            if (fresh && moved && self._settings.get_boolean('snip-auto-capture') &&
                ui._selectionButton.checked && ui._shotButton.checked)
                ui._onCaptureButtonClicked().catch(logError);       // let go, and it's taken
            return result;
        };
    }

    // no box: the selection sits off-screen until you drag one
    _blank() {
        const sel = this._sel;
        sel._startX = sel._startY = sel._lastX = sel._lastY = -1;
        sel._mkBlank = true;
        sel._updateSelectionRect?.();
    }

    destroy() {
        this._ui.open = this._saved.open;
        this._ui._onCaptureButtonClicked = this._saved.capture;
        this._sel.stopDrag = this._saved.stopDrag;
        // (instance copies of the prototype methods: drop them so the class's own apply again)
        for (const [object, name] of [[this._ui, 'open'], [this._ui, '_onCaptureButtonClicked'], [this._sel, 'stopDrag']]) {
            if (Object.getPrototypeOf(object)[name] === object[name])
                delete object[name];
        }
        delete this._sel._mkBlank;
    }
}
