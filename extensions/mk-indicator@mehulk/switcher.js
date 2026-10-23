// Alt+Tab and Super+Tab: instead of popping up at once, the switcher grows in
// from 94% and fades in (140 ms), like macOS. Everything else stays GNOME's,
// including its keys: W or F4 closes the selected window, Q quits the app.
import Clutter from 'gi://Clutter';
import * as SwitcherPopup from 'resource:///org/gnome/shell/ui/switcherPopup.js';

const proto = SwitcherPopup.SwitcherPopup.prototype;

export class SwitcherAnimation {
    enable() {
        this._original = proto._showImmediately;
        const original = this._original;
        proto._showImmediately = function (...args) {
            const wasHidden = this._initialDelayTimeoutId !== 0;
            original.apply(this, args);
            const list = this._switcherList;
            if (!wasHidden || !list)
                return;
            list.set_pivot_point(0.5, 0.5);
            list.opacity = 0;
            list.set_scale(0.94, 0.94);
            list.ease({
                opacity: 255, scale_x: 1, scale_y: 1, duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        };
    }

    disable() {
        if (this._original)
            proto._showImmediately = this._original;
        this._original = null;
    }
}
