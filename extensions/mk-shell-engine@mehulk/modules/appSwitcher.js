// MK Shell Engine: the Super+Tab app switcher. A frosted card of your apps,
// each with its 56 px full-colour icon, its name, the desktop it's on, and a
// small live picture of its window. One highlight glides between the cards.
//
// Why it no longer stutters when Tab is held: GNOME's strip builds and tears
// down a row of window thumbnails as the selection moves, and the old ring
// ran its own animation every frame. Here a selection change only updates an
// index and retargets one ease() on the highlight (110 ms): a move already
// under way carries on from where it is toward the new card, so key repeat
// never restarts anything. Nothing is created or destroyed while you cycle.
//
// While Super is held: Tab / Shift+Tab or the arrows pick an app, ` (the key
// above Tab) cycles the picked app's windows, Q closes the picked window and
// M minimizes it (both without leaving the switcher), Esc cancels. Hover
// picks, a click switches. GNOME's switcher still runs underneath, so screen
// readers and every other key work as before.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { AppSwitcherPopup } from 'resource:///org/gnome/shell/ui/altTab.js';
import { addGlass } from './blur.js';
import { accentRGB } from './colour.js';

const ICON = 56, CARD_W = 176, THUMB_W = 152, THUMB_H = 92, GAP = 10, MARGIN = 16, MAX_COLS = 7;
const GLIDE = 110, PAD = 4;
const SWITCHER_GLASS = {sigma: 28, brightness: 0.65};

const proto = AppSwitcherPopup.prototype;

function workspaceTag(win) {
    if (!win)
        return '';
    if (win.is_on_all_workspaces())
        return 'All desktops';
    const ws = win.get_workspace();
    if (!ws)
        return '';
    const n = ws.index();
    let name = '';
    try {
        name = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'}).get_strv('workspace-names')[n] ?? '';
    } catch {}
    return name ? `WS ${n + 1}: ${name}` : `WS ${n + 1}`;
}

class AppGrid {
    constructor(popup) {
        this._popup = popup;
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        this.actor = new St.Widget({style_class: 'mk-appsw-panel', reactive: false,
            layout_manager: new Clutter.FixedLayout()});
        this._unblur = addGlass(this.actor, SWITCHER_GLASS, 24);
        const [r, g, b] = accentRGB();
        this._ring = new St.Widget({reactive: false, style: `border-radius: ${16 + PAD}px;
            border: 2px solid rgba(${r},${g},${b},0.95); background-color: rgba(${r},${g},${b},0.14);`});
        this.actor.add_child(this._ring);

        const n = popup._items.length;
        const cols = Math.min(n, MAX_COLS), rows = Math.ceil(n / cols);
        // on stage first: a card only knows its height once its style is loaded
        Main.uiGroup.add_child(this.actor);
        Main.uiGroup.set_child_above_sibling(this.actor, popup);
        this._cards = popup._items.map(item => {
            const card = this._card(item);
            this.actor.add_child(card);
            return card;
        });
        const cardH = Math.max(...this._cards.map(card => card.get_preferred_height(CARD_W)[1]));
        this._cards.forEach((card, i) => {
            card._h = cardH;
            card.height = cardH;
            const row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
            const shift = (cols - inRow) * (CARD_W + GAP) / 2;
            card.set_position(MARGIN + shift + (i % cols) * (CARD_W + GAP), MARGIN + row * (cardH + GAP));
        });
        const w = 2 * MARGIN + cols * CARD_W + (cols - 1) * GAP, h = 2 * MARGIN + rows * cardH + (rows - 1) * GAP;
        this.actor.set_size(w, h);
        this.actor.set_position(monitor.x + Math.round((monitor.width - w) / 2), monitor.y + Math.round((monitor.height - h) / 2));

        this._eventId = global.stage.connect('captured-event', (_s, event) => this._onEvent(event));
        popup.connect('destroy', () => this.destroy());
        this.select(popup._selectedIndex, popup._currentWindow, true);
    }

    _card(item) {
        const card = new St.BoxLayout({vertical: true, style_class: 'mk-appsw-card', width: CARD_W});
        card._item = item;
        const icon = item.app.create_icon_texture(ICON);
        icon.style = '-st-icon-style: requested;';        // the app's own colours
        icon.x_align = Clutter.ActorAlign.CENTER;
        card.add_child(icon);
        const title = new St.Label({text: item.app.get_name(), style_class: 'mk-appsw-title', x_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        card.add_child(title);
        card._tag = new St.Label({style_class: 'mk-appsw-tag', x_align: Clutter.ActorAlign.CENTER});
        card.add_child(card._tag);
        card._thumb = new St.Widget({style_class: 'mk-appsw-thumb', width: THUMB_W, height: THUMB_H,
            x_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout(), clip_to_allocation: true});
        card.add_child(card._thumb);
        card._shown = undefined;
        this._showWindow(card, 0);
        return card;
    }

    // Show window INDEX of the card's app in its thumbnail (only when it changes).
    _showWindow(card, index) {
        const windows = card._item.cachedWindows;
        const win = windows[Math.max(0, index)] ?? null;
        if (card._shown === win)
            return;
        card._shown = win;
        card._thumb.destroy_all_children();
        const count = windows.length > 1 ? `  ·  ${Math.max(0, index) + 1} of ${windows.length}` : '';
        card._tag.text = workspaceTag(win) + count;
        const actor = win?.get_compositor_private();
        if (actor && !win.minimized) {
            const [aw, ah] = actor.get_size();
            const s = Math.min(THUMB_W / aw, THUMB_H / ah);
            card._thumb.add_child(new Clutter.Clone({source: actor, width: aw * s, height: ah * s,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        } else {
            card._thumb.add_child(new St.Label({text: win ? 'Minimized' : 'No window', style_class: 'mk-appsw-tag',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        }
    }

    // Move the highlight to card INDEX (and show its window WINDOW): an index
    // and one retargeted ease, nothing rebuilt.
    select(index, window, instant = false) {
        const card = this._cards?.[index];
        if (!card)
            return;
        this._showWindow(card, window ?? -1);
        const target = {x: card.x - PAD, y: card.y - PAD, width: CARD_W + 2 * PAD, height: card._h + 2 * PAD};
        if (instant || !this._placed) {
            this._placed = true;
            this._ring.remove_all_transitions();
            this._ring.set_position(target.x, target.y);
            this._ring.set_size(target.width, target.height);
            return;
        }
        this._ring.ease({...target, duration: GLIDE, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    refresh(index) {
        const card = this._cards?.[index];
        if (card) {
            card._shown = undefined;
            this._showWindow(card, this._popup._currentWindow);
        }
    }

    _cardAt(x, y) {
        return (this._cards ?? []).findIndex(card => {
            const [cx, cy] = card.get_transformed_position();
            return x >= cx && x < cx + CARD_W && y >= cy && y < cy + card._h;
        });
    }

    _onEvent(event) {
        const type = event.type();
        if (!this._cards || (type !== Clutter.EventType.MOTION && type !== Clutter.EventType.BUTTON_RELEASE &&
            type !== Clutter.EventType.BUTTON_PRESS))
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const index = this._cardAt(x, y);
        if (type === Clutter.EventType.MOTION) {
            if (index >= 0 && index !== this._popup._selectedIndex)
                this._popup._select(index);
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

    destroy() {
        if (!this.actor)
            return;
        global.stage.disconnect(this._eventId);
        this._unblur();
        const actor = this.actor;
        this.actor = this._cards = null;
        actor.destroy();
    }
}

// The picked window of the picked app (the one cycled to, or its first).
function pickedWindow(popup) {
    const item = popup._items[popup._selectedIndex];
    return item?.cachedWindows[Math.max(0, popup._currentWindow)] ?? null;
}

// A window that closes leaves the switcher's lists, so nothing activates a window that's gone.
function forget(popup, win) {
    popup._items.forEach((item, i) => {
        const at = item.cachedWindows.indexOf(win);
        if (at < 0)
            return;
        item.cachedWindows.splice(at, 1);
        if (i === popup._selectedIndex)
            popup._currentWindow = Math.min(popup._currentWindow, item.cachedWindows.length - 1);
        popup._mkAppGrid?.refresh(i);
    });
}

export class AppSwitcher {
    constructor() {
        this._saved = {};
        for (const name of ['show', '_select', '_keyPressHandler', '_timeoutPopupThumbnails'])
            this._saved[name] = Object.prototype.hasOwnProperty.call(proto, name) ? proto[name] : undefined;
        const base = {
            show: proto.show, select: proto._select, keys: proto._keyPressHandler, thumbs: proto._timeoutPopupThumbnails,
        };

        proto.show = function (...args) {
            this._mkEngineOwned = true;             // (mk-indicator's switcher styling leaves this one to us)
            const shown = base.show.apply(this, args);
            if (!shown || !this._items?.length)
                return shown;
            try {
                this._switcherList.opacity = 0;
                this._switcherList._mkGrid = {select() {}};
                this._mkAppGrid = new AppGrid(this);
                this._showImmediately?.();          // up at once, no 150 ms wait
            } catch (e) {
                console.error(`mk-shell-engine: app switcher: ${e.message}`);
                this._switcherList.opacity = 255;       // GNOME's own strip, then
                this._mkEngineOwned = false;
            }
            return shown;
        };

        // No thumbnail strip: the card shows the window itself.
        proto._timeoutPopupThumbnails = function () {
            if (!this._mkEngineOwned)
                return base.thumbs.call(this);
            this._thumbnailTimeoutId = 0;
            return undefined;
        };

        proto._select = function (app, window, forceAppFocus) {
            if (!this._mkEngineOwned)
                return base.select.call(this, app, window, forceAppFocus);
            this._selectedIndex = app;
            this._currentWindow = window ?? -1;
            this._switcherList.highlight(app, false);       // (keeps screen readers and scrolling in step)
            this._mkAppGrid?.select(app, this._currentWindow);
            return undefined;
        };

        proto._keyPressHandler = function (keysym, action) {
            if (!this._mkEngineOwned || !this._mkAppGrid)
                return base.keys.call(this, keysym, action);
            const item = this._items[this._selectedIndex];
            if (action === Meta.KeyBindingAction.SWITCH_GROUP || action === Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD ||
                keysym === Clutter.KEY_grave || keysym === Clutter.KEY_asciitilde) {
                const n = item?.cachedWindows.length ?? 0;
                if (n) {
                    const back = action === Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD;
                    const now = Math.max(0, this._currentWindow);
                    this._select(this._selectedIndex, (now + (back ? n - 1 : 1)) % n);
                }
                return Clutter.EVENT_STOP;
            }
            if (keysym === Clutter.KEY_q || keysym === Clutter.KEY_Q) {
                const win = pickedWindow(this);
                if (win) {
                    win.connect('unmanaged', () => this._items && forget(this, win));
                    win.delete(global.get_current_time());
                }
                return Clutter.EVENT_STOP;
            }
            if (keysym === Clutter.KEY_m || keysym === Clutter.KEY_M) {
                const win = pickedWindow(this);
                if (win?.can_minimize()) {
                    win.minimize();
                    this._mkAppGrid.refresh(this._selectedIndex);
                }
                return Clutter.EVENT_STOP;
            }
            return base.keys.call(this, keysym, action);
        };
    }

    destroy() {
        for (const [name, value] of Object.entries(this._saved)) {
            if (value === undefined)
                delete proto[name];          // it was inherited: inherit again
            else
                proto[name] = value;
        }
    }
}
