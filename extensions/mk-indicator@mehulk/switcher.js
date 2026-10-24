// Alt+Tab and Super+Tab, MK style, for the keyboard and the touchpad alike:
//  - the switcher grows in from 94% and fades in when it becomes visible
//    (watching opacity covers both the keyboard path and the 3-finger swipe,
//    which shows the popup its own way);
//  - the selected window stands out while the others recede a little, eased;
//  - one glowing ring follows the selection on a spring, every frame, instead
//    of each window's border switching on and off. A fast 3-finger swipe that
//    skips several windows becomes one fluid glide, and the ring settles on
//    the window you stop on.
// GNOME's own behaviour stays: W or F4 closes the selected window, Q quits the
// app, arrow keys and screen readers work as before. With animations turned
// off in Settings, Clutter's ease() makes every step instant.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SwitcherPopup from 'resource:///org/gnome/shell/ui/switcherPopup.js';
import { WindowSwitcherPopup } from 'resource:///org/gnome/shell/ui/altTab.js';
import { accentRGB } from './accent.js';
import { WindowGrid } from './windowGrid.js';

const popupProto = SwitcherPopup.SwitcherPopup.prototype;
const listProto = SwitcherPopup.SwitcherList.prototype;
// The selected item keeps full size (scaling it up would be clipped by the
// strip); the others shrink and dim, so the selection reads as lifted.
const LIFT = 1.0, REST = 0.92, REST_OPACITY = 190, MS = 90;

// Touchpad Gesture Customization marks its switcher with this class.
const isGesture = popup => popup._switcherList?.has_style_class_name('gie-alttab-quick-transition');

function popIn(popup) {
    const list = popup._switcherList;
    if (!list || popup._mkPopped)
        return;
    popup._mkPopped = true;
    // A swipe is already moving: appear at once, no entrance to wait for.
    if (isGesture(popup))
        return;
    list.set_pivot_point(0.5, 0.5);
    list.opacity = 0;
    list.set_scale(0.94, 0.94);
    list.ease({
        opacity: 255, scale_x: 1, scale_y: 1, duration: 160,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function settle(list, index) {
    // Only the window that lost the selection and the one that got it change;
    // the first time, set every item up.
    const previous = list._mkSelected;
    list._mkSelected = index;
    list._items.forEach((item, i) => {
        if (previous !== undefined && i !== index && i !== previous)
            return;
        const selected = i === index;
        item.set_pivot_point(0.5, 0.5);
        if (previous === undefined) {
            // first look: no animations to start, just the resting state
            item.set_scale(selected ? LIFT : REST, selected ? LIFT : REST);
            item.opacity = selected ? 255 : REST_OPACITY;
            return;
        }
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

// How quickly the ring catches up: higher is snappier. 45/s settles in
// about 65 ms: it stays glued to your fingers but never teleports.
const FOLLOW = 45, PAD = 3;

// The sliding ring, added above the popup and placed in stage coordinates,
// so it can move freely across the strip (and while the strip scrolls).
function addGlide(popup) {
    const list = popup._switcherList;
    if (!list || popup._mkGlide)
        return;
    const c = accentRGB().join(',');
    const ring = new St.Widget({
        reactive: false, opacity: 0,
        style: `border-radius: ${20 + PAD}px; border: 2px solid rgba(${c},0.95);
            background-color: rgba(${c},0.12); box-shadow: 0 0 16px 0 rgba(${c},0.28);`,
    });
    Main.uiGroup.add_child(ring);
    Main.uiGroup.set_child_above_sibling(ring, popup);
    popup._mkGlide = ring;

    let pos = null, last = GLib.get_monotonic_time();
    const timeline = new Clutter.Timeline({actor: ring, duration: 1000, repeat_count: -1});
    timeline.connect('new-frame', () => {
        const now = GLib.get_monotonic_time();
        const dt = Math.min(0.05, (now - last) / 1e6);
        last = now;
        const item = list._items?.[popup._selectedIndex];
        if (!item || !item.get_stage()) {
            ring.opacity = 0;
            return;
        }
        const [x, y] = item.get_transformed_position();
        const [w, h] = item.get_transformed_size();
        const target = [x - PAD, y - PAD, w + 2 * PAD, h + 2 * PAD];
        if (!pos) {
            pos = target;
        } else {
            const k = 1 - Math.exp(-FOLLOW * dt);
            pos = pos.map((v, i) => v + (target[i] - v) * k);
        }
        ring.set_position(Math.round(pos[0]), Math.round(pos[1]));
        // Resizing re-renders the glow: only when the size really changes.
        if (Math.abs(ring.width - pos[2]) > 0.75 || Math.abs(ring.height - pos[3]) > 0.75)
            ring.set_size(Math.round(pos[2]), Math.round(pos[3]));
        ring.opacity = Math.round(popup.opacity * list.opacity / 255);
    });
    timeline.start();
    popup.connect('destroy', () => {
        timeline.stop();
        ring.destroy();
    });
}

const windowProto = WindowSwitcherPopup.prototype;

export class SwitcherAnimation {
    enable() {
        this._show = popupProto.show;
        this._highlight = listProto.highlight;
        this._keys = windowProto._keyPressHandler;
        const show = this._show, highlight = this._highlight, keys = this._keys;

        popupProto.show = function (...args) {
            const shown = show.apply(this, args);
            // Window switching (Alt+Tab, 3-finger swipe): the MK grid instead
            // of GNOME's strip. Super+Tab (apps) keeps the strip, restyled.
            if (shown && this instanceof WindowSwitcherPopup && this._items?.length) {
                this._switcherList.opacity = 0;
                this._mkGrid = new WindowGrid(this);
                this._switcherList._mkGrid = this._mkGrid;
                this._mkGrid.select(this._selectedIndex);
                // Instant: skip GNOME's 150 ms wait before the switcher shows.
                // (The 3-finger swipe shows it itself, when the swipe starts.)
                if (!this._switcherList.has_style_class_name('gie-alttab-quick-transition'))
                    this._showImmediately?.();
                return shown;
            }
            // The ring isn't needed for the very first frame: build it right
            // after, so the switcher appears as fast as GNOME's own.
            if (shown) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._switcherList?.get_stage())
                        addGlide(this);
                    return GLib.SOURCE_REMOVE;
                });
            }
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
            if (this._mkGrid)
                this._mkGrid.select(index);
            else
                settle(this, index);
        };

        windowProto._keyPressHandler = function (keysym, action) {
            const digit = keysym >= Clutter.KEY_1 && keysym <= Clutter.KEY_9 ? keysym - Clutter.KEY_1 + 1 : 0;
            if (digit && this._mkGrid) {
                this._mkGrid.moveSelected(digit);
                return Clutter.EVENT_STOP;
            }
            return keys.call(this, keysym, action);
        };
    }

    disable() {
        if (this._show)
            popupProto.show = this._show;
        if (this._highlight)
            listProto.highlight = this._highlight;
        if (this._keys)
            windowProto._keyPressHandler = this._keys;
        this._show = this._highlight = this._keys = null;
    }
}
