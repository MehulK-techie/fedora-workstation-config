// Alt+Tab and Super+Tab, MK style, for the keyboard and the touchpad alike:
//  - the switcher grows in from 94% and fades in when it becomes visible
//    (watching opacity covers both the keyboard path and the 3-finger swipe,
//    which shows the popup its own way);
//  - the selected window stands out while the others recede a little, eased,
//    so scrubbing through windows with a swipe glides instead of jumping.
// GNOME's own behaviour stays: W or F4 closes the selected window, Q quits the
// app, arrow keys and screen readers work as before. With animations turned
// off in Settings, Clutter's ease() makes every step instant.
import Clutter from 'gi://Clutter';
import * as SwitcherPopup from 'resource:///org/gnome/shell/ui/switcherPopup.js';

const popupProto = SwitcherPopup.SwitcherPopup.prototype;
const listProto = SwitcherPopup.SwitcherList.prototype;
// The selected item keeps full size (scaling it up would be clipped by the
// strip); the others shrink and dim, so the selection reads as lifted.
const LIFT = 1.0, REST = 0.92, REST_OPACITY = 190, MS = 150;

function popIn(popup) {
    const list = popup._switcherList;
    if (!list || popup._mkPopped)
        return;
    popup._mkPopped = true;
    list.set_pivot_point(0.5, 0.5);
    list.opacity = 0;
    list.set_scale(0.94, 0.94);
    list.ease({
        opacity: 255, scale_x: 1, scale_y: 1, duration: 160,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function settle(list, index) {
    list._items.forEach((item, i) => {
        const selected = i === index;
        item.set_pivot_point(0.5, 0.5);
        item.remove_transition('scale-x');
        item.remove_transition('scale-y');
        item.remove_transition('opacity');
        item.ease({
            scale_x: selected ? LIFT : REST,
            scale_y: selected ? LIFT : REST,
            opacity: selected ? 255 : REST_OPACITY,
            duration: MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    });
}

export class SwitcherAnimation {
    enable() {
        this._show = popupProto.show;
        this._highlight = listProto.highlight;
        const show = this._show, highlight = this._highlight;

        popupProto.show = function (...args) {
            const shown = show.apply(this, args);
            if (this.opacity > 0) {
                popIn(this);
            } else {
                const id = this.connect('notify::opacity', () => {
                    if (this.opacity > 0) {
                        this.disconnect(id);
                        popIn(this);
                    }
                });
            }
            return shown;
        };

        listProto.highlight = function (index, justOutline) {
            highlight.call(this, index, justOutline);
            settle(this, index);
        };
    }

    disable() {
        if (this._show)
            popupProto.show = this._show;
        if (this._highlight)
            listProto.highlight = this._highlight;
        this._show = this._highlight = null;
    }
}
