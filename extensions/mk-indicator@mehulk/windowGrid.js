// MK window switcher (Alt+Tab and the 3-finger swipe): a compact card in the
// middle of the screen, not a full-screen overlay. Each window is a small live
// preview with its app icon, title and which desktop it's on; a ring marks
// the selected one. It appears at once (no fade, no delay) and the desktop
// behind stays as it is.
// Hover a card to select it, click to open it; 1-9 sends the selected window
// to that desktop without leaving the switcher.
//
// GNOME's own switcher still runs underneath (keyboard, gestures, screen
// readers, W/F4 to close, Q to quit): this only replaces what you see.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './accent.js';

const GAP = 12, PAD = 4, MARGIN = 16;
const THUMB_W = 200, MAX_COLS = 6;

export class WindowGrid {
    constructor(popup) {
        this._popup = popup;
        this._windows = popup._items.map(item => item.window);
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        this._monitor = monitor;

        this.actor = new St.Widget({
            reactive: false, opacity: 0, style_class: 'mk-switch-panel',
            layout_manager: new Clutter.FixedLayout(),
        });
        // GNOME's switcher holds the input grab, so the pointer is read here,
        // before it's dispatched: hover selects, click opens, a click outside
        // closes. Keys go to GNOME's switcher as always.
        this._eventId = global.stage.connect('captured-event', (_s, event) => this._onEvent(event));
        // Frosted card only: the blur covers the card, not the screen.
        this.actor.add_effect(new Shell.BlurEffect({radius: 24, brightness: 0.8, mode: Shell.BlurMode.BACKGROUND}));
        Main.uiGroup.add_child(this.actor);
        Main.uiGroup.set_child_above_sibling(this.actor, popup);

        this._ring = new St.Widget({style_class: 'mk-switch-ring', reactive: false});
        this._paintRing();
        this.actor.add_child(this._ring);
        this._layout();

        // Follow the popup's own visibility (the swipe shows it a moment later).
        this._opacityId = popup.connect('notify::opacity', () => this._sync());
        this._sync();
        popup.connect('destroy', () => this.destroy());
    }

    _sync() {
        if (this._popup.opacity > 0 && !this._shown) {
            this._shown = true;
            this.actor.opacity = 255;
            this._placeRing();
        }
    }

    // Columns: one row for up to MAX_COLS windows, then more rows. Thumbnails
    // shrink only when even that doesn't fit the screen.
    _layout() {
        const {x: mx, y: my, width: mw, height: mh} = this._monitor;
        const n = Math.max(1, this._windows.length);
        const cols = Math.min(n, MAX_COLS);
        const rows = Math.ceil(n / cols);
        const aspect = mw / mh;
        const cardChrome = 2 * 8, labelH = 26;
        let tw = Math.min(THUMB_W, (mw * 0.9 - 2 * MARGIN - (cols - 1) * GAP) / cols - cardChrome);
        let th = tw / aspect;
        const maxTh = (mh * 0.8 - 2 * MARGIN - (rows - 1) * GAP) / rows - cardChrome - labelH;
        if (th > maxTh) {
            th = maxTh;
            tw = th * aspect;
        }
        tw = Math.round(tw);
        th = Math.round(th);
        const cardW = tw + cardChrome, cardH = th + cardChrome + labelH;
        const lastRow = n - (rows - 1) * cols;
        this._cards = this._windows.map((win, i) => {
            const card = this._card(win, i, tw, th);
            const row = Math.floor(i / cols);
            const shift = row === rows - 1 ? (cols - lastRow) * (cardW + GAP) / 2 : 0;
            card.set_position(MARGIN + (i % cols) * (cardW + GAP) + shift, MARGIN + row * (cardH + GAP));
            card.set_size(cardW, cardH);
            this.actor.add_child(card);
            return card;
        });
        const w = 2 * MARGIN + cols * cardW + (cols - 1) * GAP;
        const h = 2 * MARGIN + rows * cardH + (rows - 1) * GAP;
        this.actor.set_size(w, h);
        this.actor.set_position(mx + Math.round((mw - w) / 2), my + Math.round((mh - h) / 2));
    }

    _card(win, index, tw, th) {
        const card = new St.Bin({style_class: 'mk-switch-card'});
        const box = new St.BoxLayout({vertical: true, style: 'spacing: 6px;'});
        const thumb = new St.Widget({style_class: 'mk-switch-thumb', width: tw, height: th,
            layout_manager: new Clutter.BinLayout(), clip_to_allocation: true});
        const actor = win.get_compositor_private();
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        if (actor && !win.minimized) {
            const [aw, ah] = actor.get_size();
            const scale = Math.min(tw / aw, th / ah, 2.5);  // small windows grow to fill the card
            thumb.add_child(new Clutter.Clone({source: actor, width: aw * scale, height: ah * scale,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        } else if (app) {
            const big = app.create_icon_texture(Math.min(64, th * 0.6));
            big.set_x_align(Clutter.ActorAlign.CENTER);
            big.set_y_align(Clutter.ActorAlign.CENTER);
            big.opacity = 170;
            thumb.add_child(big);
        }
        box.add_child(thumb);
        const row = new St.BoxLayout({style: 'spacing: 8px;', x_expand: true});
        if (app)
            row.add_child(app.create_icon_texture(16));
        const title = new St.Label({text: win.get_title() || app?.get_name() || '', x_expand: true,
            style_class: 'mk-switch-title', y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(title);
        const ws = win.get_workspace();
        card._badge = new St.Label({style_class: 'mk-switch-badge', y_align: Clutter.ActorAlign.CENTER,
            text: ws && !win.is_on_all_workspaces() ? `${ws.index() + 1}` : '∗'});
        row.add_child(card._badge);
        box.add_child(row);
        card.set_child(box);
        return card;
    }

    _cardAt(x, y) {
        return (this._cards ?? []).findIndex(card => {
            const [cx, cy] = card.get_transformed_position();
            const [cw, ch] = card.get_transformed_size();
            return x >= cx && x < cx + cw && y >= cy && y < cy + ch;
        });
    }

    _onEvent(event) {
        if (!this._shown || !this._cards)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type !== Clutter.EventType.MOTION && type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.BUTTON_RELEASE)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const index = this._cardAt(x, y);
        if (type === Clutter.EventType.MOTION) {
            if (index !== this._hover) {
                this._cards[this._hover]?.remove_style_pseudo_class('hover');
                this._cards[index]?.add_style_pseudo_class('hover');
                this._hover = index;
                if (index >= 0 && index !== this._popup._selectedIndex)
                    this._popup._select(index);
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            if (index >= 0) {
                this._popup._select(index);
                this._popup._finish(event.get_time());
            } else {
                this._popup.fadeAndDestroy();
            }
        }
        return Clutter.EVENT_STOP;
    }

    _paintRing() {
        const c = accentRGB().join(',');
        this._ring.style = `border-radius: 16px; border: 2px solid rgba(${c},0.95);
            background-color: rgba(${c},0.10);`;
    }

    // Instant: the ring jumps to the selected card, no glide.
    _placeRing() {
        const card = this._cards?.[this._popup._selectedIndex];
        if (!card)
            return;
        this._ring.set_position(card.x - PAD, card.y - PAD);
        this._ring.set_size(card.width + 2 * PAD, card.height + 2 * PAD);
    }

    select(index) {
        this._cards?.forEach((card, i) => {
            card.opacity = i === index ? 255 : 190;
        });
        this._placeRing();
    }

    // 1-9: send the selected window to that desktop (adding desktops if needed).
    moveSelected(number) {
        const index = this._popup._selectedIndex;
        const win = this._windows[index];
        if (!win)
            return;
        const manager = global.workspace_manager;
        while (manager.n_workspaces < number)
            manager.append_new_workspace(false, global.get_current_time());
        win.change_workspace_by_index(number - 1, false);
        const badge = this._cards[index]._badge;
        badge.text = `${number}`;
        badge.set_pivot_point(0.5, 0.5);
        badge.set_scale(1.3, 1.3);
        badge.ease({scale_x: 1, scale_y: 1, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    destroy() {
        if (!this.actor)
            return;
        if (this._eventId)
            global.stage.disconnect(this._eventId);
        this._eventId = 0;
        if (this._opacityId)
            this._popup.disconnect(this._opacityId);
        const actor = this.actor;
        this.actor = this._cards = null;
        actor.destroy();
    }
}
