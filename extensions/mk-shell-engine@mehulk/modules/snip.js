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
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Snip {
    constructor(settings) {
        this._settings = settings;
        const ui = Main.screenshotUI, sel = ui?._areaSelector;
        if (!ui || !sel?.stopDrag || !ui._onCaptureButtonClicked)
            throw new Error('GNOME\'s screenshot tool has changed shape: left as it is');
        this._ui = ui;
        this._sel = sel;
        this._saved = {open: ui.open, stopDrag: sel.stopDrag, capture: ui._onCaptureButtonClicked,
            panBegin: sel._onPanBegin};
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

        // the box's handles come back as soon as a drag starts
        if (saved.panBegin) {
            sel._onPanBegin = function (...args) {
                self._handles(true);
                return saved.panBegin.apply(this, args);
            };
        }

        // A drag that drew a new box ends here. (GNOME 51 drags with a pan gesture: the
        // _dragButton this used to check is gone, so no drag ever counted, nothing was
        // taken on release and Capture stayed blocked: area shots failed altogether.)
        sel.stopDrag = function (...args) {
            // (a drag is under way only while it holds the pointer: GNOME's own reset() calls
            // stopDrag() as the tool opens, with no drag at all)
            const fresh = this._dragCursor === Clutter.CursorType.CROSSHAIR && !!(this._dragGrab || this._dragButton);
            const moved = this._lastX !== this._startX || this._lastY !== this._startY;
            const result = saved.stopDrag.apply(this, args);
            if (fresh)
                this._mkBlank = false;            // a box exists now (a click makes a small one)
            // let go, and it's taken: once the release has finished (the drag's grab let go, the
            // selection drawn) rather than inside it, so a big area never holds up the pointer and
            // the tool's overlay closes straight away (GNOME encodes and saves off the main loop)
            if (fresh && moved && self._settings.get_boolean('snip-auto-capture') &&
                ui._selectionButton.checked && ui._shotButton.checked) {
                if (self._captureId)
                    GLib.source_remove(self._captureId);
                self._captureId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    self._captureId = 0;
                    if (ui.visible)
                        ui._onCaptureButtonClicked().catch(logError);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return result;
        };
    }

    // No box: a 1 x 1 selection in the screen's top-left corner, its handles hidden, until
    // you drag one. (It used to sit off-screen at -1, -1: with fractional scaling, 125 % on
    // a laptop, that broke the tool's sizing, and the box you dragged landed at the top edge.)
    _blank() {
        const sel = this._sel;
        sel._startX = sel._startY = sel._lastX = sel._lastY = 0;
        sel._mkBlank = true;
        sel._updateSelectionRect?.();
        this._handles(false);
    }

    _handles(show) {
        const sel = this._sel;
        for (const handle of [sel._topLeftHandle, sel._topRightHandle, sel._bottomLeftHandle, sel._bottomRightHandle])
            handle?.set_opacity(show ? 255 : 0);
    }

    destroy() {
        if (this._captureId)
            GLib.source_remove(this._captureId);
        this._captureId = 0;
        this._ui.open = this._saved.open;
        this._ui._onCaptureButtonClicked = this._saved.capture;
        this._sel.stopDrag = this._saved.stopDrag;
        if (this._saved.panBegin)
            this._sel._onPanBegin = this._saved.panBegin;
        // (instance copies of the prototype methods: drop them so the class's own apply again)
        for (const [object, name] of [[this._ui, 'open'], [this._ui, '_onCaptureButtonClicked'], [this._sel, 'stopDrag'],
            [this._sel, '_onPanBegin']]) {
            if (Object.getPrototypeOf(object)[name] === object[name])
                delete object[name];
        }
        delete this._sel._mkBlank;
        this._handles(true);
    }
}
