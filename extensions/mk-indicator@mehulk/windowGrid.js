// MK window switcher (Alt+Tab and the 3-finger swipe): the screen dims and
// every window appears as a live preview in a grid, with its app icon, title
// and which desktop it's on; one glowing ring glides to the selected window.
// Hover a card to select it, click to open it; 1-9 sends the selected window
// to that desktop without leaving the switcher.
//
// GNOME's own switcher still runs underneath (keyboard, gestures, screen
// readers, W/F4 to close, Q to quit): this only replaces what you see.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './accent.js';

const GAP = 22, PAD = 6;
const FOLLOW = 45; // ring spring: settles in ~65 ms

export class WindowGrid {
    constructor(popup) {
        this._popup = popup;
        this._windows = popup._items.map(item => item.window);
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        this._monitor = monitor;

        this.actor = new St.Widget({
            reactive: false, opacity: 0, x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            style_class: 'mk-switch-backdrop', layout_manager: new Clutter.FixedLayout(),
        });
        // GNOME's switcher holds the input grab, so the pointer is read here,
        // before it's dispatched: hover selects, click opens, a click outside
        // closes. Keys go to GNOME's switcher as always.
        this._eventId = global.stage.connect('captured-event', (_s, event) => this._onEvent(event));
        // Frosted: what's behind is blurred and dimmed, so the cards stand out.
        this.actor.add_effect(new Shell.BlurEffect({radius: 36, brightness: 0.55, mode: Shell.BlurMode.BACKGROUND}));
        Main.uiGroup.add_child(this.actor);
        Main.uiGroup.set_child_above_sibling(this.actor, popup);

        this._layout();
        this._ring = new St.Widget({style_class: 'mk-switch-ring', reactive: false});
        this._paintRing();
        this.actor.add_child(this._ring);
        this._hint = new St.Label({style_class: 'mk-switch-hint',
            text: 'Enter open  ·  W close  ·  1–9 move to desktop  ·  Esc cancel'});
        this.actor.add_child(this._hint);
        this._hint.set_position(Math.round((monitor.width - this._hint.get_preferred_width(-1)[1]) / 2),
            monitor.height - 64);

        this._pos = null;
        let last = GLib.get_monotonic_time();
        this._timeline = new Clutter.Timeline({actor: this.actor, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => {
            const now = GLib.get_monotonic_time();
            this._follow(Math.min(0.05, (now - last) / 1e6));
            last = now;
        });
        this._timeline.start();

        // Follow the popup's own visibility (the swipe shows it a moment later).
        this._opacityId = popup.connect('notify::opacity', () => this._sync());
        this._sync();
        popup.connect('destroy', () => this.destroy());
    }

    _sync() {
        const visible = this._popup.opacity > 0;
        if (visible && !this._shown) {
            this._shown = true;
            const gesture = this._popup._switcherList?.has_style_class_name('gie-alttab-quick-transition');
            this.actor.remove_all_transitions();
            this.actor.ease({opacity: 255, duration: gesture ? 90 : 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._grid.set_pivot_point(0.5, 0.5);
            this._grid.set_scale(gesture ? 1 : 0.97, gesture ? 1 : 0.97);
            this._grid.ease({scale_x: 1, scale_y: 1, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Card size from how many windows there are: big for a few, smaller for many.
    _layout() {
        const {width: mw, height: mh} = this._monitor;
        const n = Math.max(1, this._windows.length);
        const aspect = mw / mh;
        let cols = 1, tw = 0, th = 0;
        for (let c = 1; c <= n; c++) {
            const rows = Math.ceil(n / c);
            const w = Math.min(380, (mw * 0.86 - (c - 1) * GAP) / c - 2 * PAD - 16);
            const h = Math.min(w / aspect, (mh * 0.72 - (rows - 1) * GAP) / rows - 2 * PAD - 48);
            const cw = h * aspect;
            if (Math.min(w, cw) > tw) {
                tw = Math.min(w, cw);
                th = tw / aspect;
                cols = c;
            }
        }
        tw = Math.max(150, Math.round(tw));
        th = Math.max(90, Math.round(th));
        const cardW = tw + 2 * 10, cardH = th + 2 * 10 + 30;
        const rows = Math.ceil(n / cols);
        const gridW = cols * cardW + (cols - 1) * GAP, gridH = rows * cardH + (rows - 1) * GAP;
        this._grid = new St.Widget({layout_manager: new Clutter.FixedLayout(), width: gridW, height: gridH,
            x: Math.round((mw - gridW) / 2), y: Math.round((mh - gridH) / 2 - 20)});
        this.actor.add_child(this._grid);
        this._cards = this._windows.map((win, i) => {
            const card = this._card(win, i, tw, th);
            card.set_position((i % cols) * (cardW + GAP) + (i >= (rows - 1) * cols ? (cols - (n - (rows - 1) * cols)) * (cardW + GAP) / 2 : 0),
                Math.floor(i / cols) * (cardH + GAP));
            card.set_size(cardW, cardH);
            this._grid.add_child(card);
            return card;
        });
    }

    _card(win, index, tw, th) {
        const card = new St.Bin({style_class: 'mk-switch-card'});
        const box = new St.BoxLayout({vertical: true, style: 'spacing: 8px;'});
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
            const big = app.create_icon_texture(Math.min(96, th * 0.6));
            big.set_x_align(Clutter.ActorAlign.CENTER);
            big.set_y_align(Clutter.ActorAlign.CENTER);
            big.opacity = 170;
            thumb.add_child(big);
        }
        box.add_child(thumb);
        const row = new St.BoxLayout({style: 'spacing: 8px;', x_expand: true});
        if (app)
            row.add_child(app.create_icon_texture(18));
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
        this._ring.style = `border-radius: 22px; border: 2px solid rgba(${c},0.95);
            background-color: rgba(${c},0.10); box-shadow: 0 0 22px 0 rgba(${c},0.35);`;
    }

    select(index) {
        this._cards?.forEach((card, i) => {
            const on = i === index;
            card.remove_transition('opacity');
            card.ease({opacity: on ? 255 : 205, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        });
    }

    _follow(dt) {
        const card = this._cards?.[this._popup._selectedIndex];
        if (!card)
            return;
        const [gx, gy] = this._grid.get_position();
        const target = [gx + card.x - PAD, gy + card.y - PAD, card.width + 2 * PAD, card.height + 2 * PAD];
        if (!this._pos) {
            this._pos = target;
        } else {
            const k = 1 - Math.exp(-FOLLOW * dt);
            this._pos = this._pos.map((v, i) => v + (target[i] - v) * k);
        }
        this._ring.set_position(Math.round(this._pos[0]), Math.round(this._pos[1]));
        if (Math.abs(this._ring.width - this._pos[2]) > 0.75 || Math.abs(this._ring.height - this._pos[3]) > 0.75)
            this._ring.set_size(Math.round(this._pos[2]), Math.round(this._pos[3]));
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
        badge.set_scale(1.5, 1.5);
        badge.ease({scale_x: 1, scale_y: 1, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    destroy() {
        if (!this.actor)
            return;
        this._timeline?.stop();
        if (this._eventId)
            global.stage.disconnect(this._eventId);
        this._eventId = 0;
        if (this._opacityId)
            this._popup.disconnect(this._opacityId);
        const actor = this.actor;
        this.actor = this._cards = null;
        actor.ease({opacity: 0, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => actor.destroy()});
    }
}
