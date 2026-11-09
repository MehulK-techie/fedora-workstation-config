// MK: what goes with the lock screen's clock, kept with the clock itself.
// WACK takes the time and date out of GNOME's clock box into a wrapper of its own
// (placed by hand, 9 % down the screen) and leaves the box behind, empty, at the
// screen's top-left corner: anything added to that box showed up there, small and
// cramped. Here the tagline, the battery and weather row and Now Playing go into a
// column inside WACK's wrapper, right under the time, and the glass card is a pane
// behind the whole block (date, time and that column), sized to it.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

const GAP = 6;                         // between the time and the column under it
const PAD_X = 48, PAD_Y = 24;          // the card's padding around the block

// WACK's wrapper, when the time is in one (null: still in GNOME's own clock box)
function wrapperOf(time) {
    const parent = time?.get_parent();
    return parent && !parent.has_style_class_name?.('unlock-dialog-clock') ? parent : null;
}

function place(wrapper) {
    const {time, under, card} = wrapper._mk;
    if (!time.get_parent() || !under.get_parent())
        return;
    // centred under the time, or (the left and corner layouts) from the time's left edge
    const x = wrapper._mk.left ? Math.round(time.x) : 0;
    under.set_position(x, Math.round(time.y + time.height + GAP));
    under.width = wrapper.width - x;
    if (!card.visible)
        return;
    // the block's bounds: the date, the time and what shows in the column under it
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const take = (x, y, w, h) => {
        if (w <= 0 || h <= 0)
            return;
        x1 = Math.min(x1, x);
        y1 = Math.min(y1, y);
        x2 = Math.max(x2, x + w);
        y2 = Math.max(y2, y + h);
    };
    // (measured from natural sizes, not allocations, which can still be a layout behind when
    // this runs: the card never sits off-centre for a frame or for good)
    const left = wrapper._mk.left;
    const across = (nat, at) => (left ? at : (wrapper.width - nat) / 2);
    for (const child of wrapper.get_children()) {
        if (child === card || child === under || !child.visible)
            continue;
        const [, nat] = child.get_preferred_width(-1);
        const [, natH] = child.get_preferred_height(nat);
        take(across(nat, child.x), child.y, nat, Math.max(child.height, natH));
    }
    let widest = 0;
    for (const child of under.get_children()) {
        if (child.visible)
            widest = Math.max(widest, child.get_preferred_width(-1)[1]);
    }
    const [, columnH] = under.get_preferred_height(under.width);
    if (widest > 0)
        take(left ? under.x : (wrapper.width - widest) / 2, under.y, widest, columnH);
    if (x1 === Infinity)
        return;
    card.set_position(Math.round(x1 - PAD_X), Math.round(y1 - PAD_Y));
    card.set_size(Math.round(x2 - x1 + 2 * PAD_X), Math.round(y2 - y1 + 2 * PAD_Y));
}

function parts(time) {
    const wrapper = wrapperOf(time);
    if (!wrapper)
        return null;
    if (wrapper._mk && wrapper._mk.under.get_parent() === wrapper)
        return wrapper._mk;
    const under = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'wack-under-clock'});
    const card = new St.Widget({style_class: 'wack-glass-card', visible: false, reactive: false});
    wrapper.insert_child_at_index(card, 0);            // (behind the date and the time)
    wrapper.add_child(under);
    wrapper._mk = {time, under, card};
    const queue = () => place(wrapper);
    time.connectObject('notify::allocation', queue, under);
    wrapper.connectObject('notify::width', queue, under);
    under.connectObject('notify::allocation', queue, under);
    // (whatever joins the column later lines up with the time too)
    under.connect('child-added', (_u, child) => {
        child.x_align = wrapper._mk?.left ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
    });
    under.connect('destroy', () => {
        time.disconnectObject?.(under);
        wrapper.disconnectObject?.(under);
        if (wrapper._mk?.under === under)
            wrapper._mk = null;
    });
    place(wrapper);
    return wrapper._mk;
}

// the column right under the time (GNOME's own clock box when WACK hasn't moved the time)
export function underClock(time) {
    return parts(time)?.under ?? time?.get_parent() ?? null;
}

// the actor that holds the whole clock: WACK's wrapper, or GNOME's clock box
export function clockBlock(time) {
    return time?.get_parent() ?? null;
}

// the left and corner layouts: the column starts where the time does
export function clockAlign(time, left) {
    const p = parts(time);
    if (!p)
        return;
    p.left = left;
    for (const child of p.under.get_children())
        child.x_align = left ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
    place(time.get_parent());
}

// the glass card behind the clock block: on or off, with its tint (style: background-color)
export function clockCard(time, on, style = null) {
    const p = parts(time);
    if (!p)
        return false;
    p.card.visible = on;
    p.card.set_style(on ? style : null);
    place(time.get_parent());
    return true;
}
