// MK Shell Engine: the MK dock. A floating glass shelf at the bottom of the
// primary monitor: your favourite apps, then running ones, then Show Apps.
//   - icons grow under the pointer (1.22x, neighbours 1.10x), smoothly
//   - a bar under each running app: 8 px for one window, two segments for
//     more, 22 px in the accent colour for the app you're using
//   - click: open, focus, or (the app you're in) minimize; middle-click: a new
//     window; scroll: cycle the app's windows; right-click: New Window,
//     Pin / Unpin, Quit
//   - it steps down out of the way when a window covers its spot, and comes
//     back when the pointer touches the bottom edge
// Everything follows GNOME's signals (apps starting and stopping, favourites,
// focus, windows moving): nothing polls. Stands aside while Dash to Dock is on.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { DASH_TO_DOCK, isActive, watch } from './conflicts.js';
import { DOCK_GLASS, addGlass, blurAllowed } from './blur.js';
import { accentRGB } from './colour.js';

const MARGIN = 4;              // the dock's gap above the screen's bottom edge
const HIDE = 480, REVEAL = 360;          // fading away and back, ms: slow and soft, never a jump
const SINK = 14;               // how far it sinks while it fades (px): a fade with a hint of movement
const OVERVIEW_OUT = 260, OVERVIEW_IN = 360;
const EDGE_DELAY = 150;        // the pointer rests on the bottom edge this long before the dock comes back
const FOCUSED = 'rgb(99, 102, 241)';     // electric indigo: the app you're using

// The parabola: HOVER at the pointer, falling to 1 a little over one icon
// away; the neighbour one icon away lands on HOVER minus 56 % of the growth
// (1.18 -> 1.08, as the default).
const NEIGHBOUR_SHARE = 0.08 / 0.18;
const SPREAD = 1 / Math.sqrt(1 - NEIGHBOUR_SHARE);
const grow = (distance, hover) => 1 + (hover - 1) * Math.max(0, 1 - (distance / SPREAD) ** 2);

export class Dock {
    constructor(settings) {
        this._settings = settings;
        this._actor = null;
        this._unwatch = watch(() => this._sync());
        this._settingsIds = ['changed::dock', 'changed::dock-icon-size', 'changed::dock-hover-scale', 'changed::blur'].map(
            signal => settings.connect(signal, () => this._sync(true)));
        this._sync();
    }

    get actor() {
        return this._actor;
    }

    _wanted() {
        return this._settings.get_boolean('dock') && !isActive(DASH_TO_DOCK);
    }

    _sync(rebuild = false) {
        const want = this._wanted();
        if (this._actor && (!want || rebuild))
            this._teardown();
        if (want && !this._actor) {
            try {
                this._build();
            } catch (e) {
                console.error(`mk-shell-engine: dock: ${e.message}\n${e.stack}`);
                try {
                    this._teardown();
                } catch {}
            }
        }
    }

    // ----- building -----

    _build() {
        this._size = this._settings.get_int('dock-icon-size');
        this._hover = this._settings.get_double('dock-hover-scale');
        this._ids = [];
        this._appIds = [];
        this._hidden = false;
        this._actor = new St.BoxLayout({style_class: 'mk-dock', reactive: true, track_hover: true,
            y_align: Clutter.ActorAlign.END});
        this._actor.set_pivot_point(0.5, 1);
        this._actor.connect('destroy', () => (this._gone = true));     // (GNOME Shell quitting takes it down first)
        this._gone = false;
        // GNOME shows and hides the chrome it tracks by itself (full screen, and
        // whenever it re-checks), which would undo hiding the dock for the
        // overview; so it tracks this holder, and the dock inside it is ours.
        this._chrome = new Clutter.Actor({layout_manager: new Clutter.BinLayout()});
        this._chrome.add_child(this._actor);
        Main.layoutManager.addChrome(this._chrome, {trackFullscreen: true});
        // the bottom edge: resting on it brings the dock back while it's hidden
        this._edge = new St.Widget({reactive: true, height: 2, opacity: 0, visible: false});
        Main.uiGroup.add_child(this._edge);
        this._edge.connect('enter-event', () => {
            if (this._fullscreen())
                return;                  // never during a full-screen video or game
            this._edgeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, EDGE_DELAY, () => {
                this._edgeId = 0;
                if (!this._fullscreen())
                    this._reveal();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._edge.connect('leave-event', () => {
            if (this._edgeId)
                GLib.source_remove(this._edgeId);
            this._edgeId = 0;
        });

        this._actor.connect('motion-event', (_a, event) => this._magnify(event.get_coords()[0]));
        this._actor.connect('leave-event', () => {
            this._settle();
            this._queueDodge(600);
        });
        if (blurAllowed(this._settings))
            this._unblur = addGlass(this._actor, DOCK_GLASS, 20);
        this._menus = new PopupMenu.PopupMenuManager(this._actor);

        const appSystem = Shell.AppSystem.get_default();
        const tracker = Shell.WindowTracker.get_default();
        this._connect(appSystem, 'app-state-changed', () => this._queueFill());
        this._connect(appSystem, 'installed-changed', () => this._queueFill());
        this._connect(AppFavorites.getAppFavorites(), 'changed', () => this._queueFill());
        this._connect(tracker, 'notify::focus-app', () => this._paintBars());
        this._connect(global.display, 'notify::focus-window', () => this._followFocus());
        this._connect(global.workspace_manager, 'active-workspace-changed', () => {
            this._queueFill();
            this._queueDodge();
        });
        this._connect(global.window_manager, 'minimize', () => this._queueDodge());
        this._connect(global.window_manager, 'unminimize', () => this._queueDodge());
        this._connect(global.window_manager, 'map', () => this._queueDodge());
        this._connect(global.window_manager, 'destroy', () => this._queueDodge());
        this._connect(global.display, 'in-fullscreen-changed', () => {
            if (this._fullscreen()) {             // straight away, and the edge stops listening
                this._edge.visible = false;
                this._slide(true);
            }
            this._queueDodge();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        // Super / the overview: the dock fades away (the overview has its own dash) and comes back after
        this._connect(Main.overview, 'showing', () => this._overview(true));
        this._connect(Main.overview, 'hiding', () => this._overview(false));
        if (Main.overview.visible)
            this._overview(true);
        this._hideOverviewDash(true);
        this._connect(this._actor, 'notify::width', () => this._place());
        this._fill();
        this._followFocus();
    }

    _connect(object, signal, callback) {
        this._ids.push([object, object.connect(signal, callback)]);
    }

    // the apps, in order: favourites, then running apps that aren't favourites
    _apps() {
        const favourites = AppFavorites.getAppFavorites().getFavorites();
        const ids = new Set(favourites.map(a => a.get_id()));
        const running = Shell.AppSystem.get_default().get_running().filter(a => !ids.has(a.get_id()));
        return [favourites, running];
    }

    _queueFill() {
        if (this._fillId)
            return;
        this._fillId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._fillId = 0;
            this._fill();
            return GLib.SOURCE_REMOVE;
        });
    }

    _fill() {
        if (!this._actor || this._gone)
            return;
        const [favourites, running] = this._apps();
        const ids = [...favourites, null, ...running].map(a => a?.get_id() ?? '|');
        if (ids.join() === this._appIds.join()) {       // same apps: only the bars can have changed
            this._paintBars();
            return;
        }
        this._appIds = ids;
        for (const item of this._items ?? [])
            item.app && item.windowsId && item.app.disconnect(item.windowsId);
        this._menus.removeAll?.();
        this._actor.destroy_all_children();
        this._items = [];
        for (const app of favourites)
            this._addApp(app, true);
        if (running.length)
            this._actor.add_child(new St.Widget({style_class: 'mk-dock-separator', y_align: Clutter.ActorAlign.CENTER}));
        for (const app of running)
            this._addApp(app, false);
        this._actor.add_child(new St.Widget({style_class: 'mk-dock-separator', y_align: Clutter.ActorAlign.CENTER}));
        this._addShowApps();
        this._paintBars();
    }

    _addApp(app, favourite) {
        const icon = app.create_icon_texture(this._size);
        icon.style = '-st-icon-style: requested;';      // the app's own colours, never a grey symbolic
        const item = this._item(icon, app.get_name());
        Object.assign(item, {app, favourite});
        item.button.connect('clicked', () => this._activate(app));
        item.button.connect('button-press-event', (_b, event) => {
            if (event.get_button() === Clutter.BUTTON_MIDDLE) {
                app.open_new_window(-1);
                return Clutter.EVENT_STOP;
            }
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this._menu(item).toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        item.button.connect('scroll-event', (_b, event) => this._cycle(app, event));
        item.windowsId = app.connect('windows-changed', () => this._paintBars());
    }

    _addShowApps() {
        const icon = new St.Icon({icon_name: 'view-app-grid-symbolic', icon_size: Math.round(this._size * 0.55),
            style_class: 'mk-dock-grid'});
        const holder = new St.Bin({width: this._size, height: this._size, child: icon});
        const item = this._item(holder, 'Show Apps');
        item.button.connect('clicked', () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else
                Main.overview.showApps();
        });
    }

    // One dock entry: the icon (which grows), and a bar under it.
    _item(icon, name) {
        const box = new St.BoxLayout({vertical: true});
        icon.set_pivot_point(0.5, 1);
        box.add_child(icon);
        const bars = new St.BoxLayout({style_class: 'mk-dock-bars', x_align: Clutter.ActorAlign.CENTER});
        box.add_child(bars);
        const button = new St.Button({style_class: 'mk-dock-item', child: box, reactive: true, track_hover: true,
            can_focus: true, button_mask: St.ButtonMask.ONE, accessible_name: name});
        button.connect('notify::hover', () => this._tooltip(button.hover ? item : null));
        this._actor.add_child(button);
        const item = {button, icon, bars, name};
        this._items.push(item);
        return item;
    }

    // ----- what the icons do -----

    _windowsOf(app) {
        const ws = global.workspace_manager.get_active_workspace();
        return app.get_windows().filter(w => !w.skip_taskbar && (w.get_workspace() === ws || w.is_on_all_workspaces()));
    }

    _activate(app) {
        const windows = this._windowsOf(app);
        if (!windows.length) {
            if (app.get_n_windows() > 0)
                Main.activateWindow(app.get_windows()[0]);     // it's open on another desktop: go there
            else
                app.activate();
            return;
        }
        const focus = global.display.focus_window;
        if (focus && windows.includes(focus) && !focus.minimized) {
            for (const w of windows)
                w.minimize();
        } else {
            Main.activateWindow(windows[0]);
        }
    }

    _cycle(app, event) {
        const windows = this._windowsOf(app).sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        if (!windows.length)
            return Clutter.EVENT_PROPAGATE;
        const dir = event.get_scroll_direction();
        let step = 0;
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
            step = -1;
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
            step = 1;
        else if (dir === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            this._scrollAcc = (this._scrollAcc ?? 0) + dy + dx;
            if (Math.abs(this._scrollAcc) < 1)
                return Clutter.EVENT_STOP;
            step = Math.sign(this._scrollAcc);
            this._scrollAcc = 0;
        }
        const now = windows.indexOf(global.display.focus_window);
        const next = windows[(now + step + windows.length) % windows.length] ?? windows[0];
        Main.activateWindow(next);
        return Clutter.EVENT_STOP;
    }

    _menu(item) {
        if (item.menu)
            return item.menu;
        const menu = new PopupMenu.PopupMenu(item.button, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._menus.addMenu(menu);
        menu.connect('open-state-changed', (_m, open) => {
            if (!open)
                return;
            menu.removeAll();
            const {app} = item;
            menu.addAction('New Window', () => app.open_new_window(-1));
            const favourites = AppFavorites.getAppFavorites();
            if (favourites.isFavorite(app.get_id()))
                menu.addAction('Unpin from Dock', () => favourites.removeFavorite(app.get_id()));
            else
                menu.addAction('Pin to Dock', () => favourites.addFavorite(app.get_id()));
            if (app.get_n_windows() > 0) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                menu.addAction('Quit', () => app.request_quit());
            }
        });
        item.menu = menu;
        item.button.connect('destroy', () => menu.destroy());
        return menu;
    }

    // Where APP's icon is on screen, for the genie to aim at (null if it isn't in the dock or the dock is away).
    iconRect(app) {
        if (!this._actor || this._gone || this._inOverview)
            return null;
        const item = this._items?.find(i => i.app === app);
        if (!item)
            return null;
        const [x, y] = item.icon.get_transformed_position();
        const [w, h] = item.icon.get_transformed_size();
        // (while the dock is stepped down, aim where the icon sits when it's up)
        return {x, y: y - this._actor.translation_y, width: w, height: h};
    }

    // ----- the bars under the icons -----

    _paintBars() {
        if (!this._items || this._gone)
            return;
        const focusApp = Shell.WindowTracker.get_default().focus_app;
        const [r, g, b] = accentRGB();
        for (const item of this._items) {
            if (!item.app)
                continue;
            const n = this._windowsOf(item.app).length;
            const state = n === 0 ? 'none' : item.app === focusApp ? 'focus' : n > 1 ? 'many' : 'one';
            if (item.state === state)
                continue;
            item.state = state;
            item.bars.destroy_all_children();
            const bar = (width, colour) => {
                const w = new St.Widget({style_class: 'mk-dock-bar', width: 0, style: `background-color: ${colour};`});
                item.bars.add_child(w);
                w.ease({width, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});    // the bar morphs into shape
            };
            if (state === 'one')
                bar(8, 'rgba(255,255,255,0.75)');
            else if (state === 'many') {
                bar(7, 'rgba(255,255,255,0.75)');
                bar(7, `rgba(${r},${g},${b},0.9)`);
            } else if (state === 'focus')
                bar(22, FOCUSED);
        }
    }

    // ----- growing under the pointer -----

    _magnify(pointerX) {
        const step = this._size + 8;         // an icon and its padding
        for (const item of this._items ?? []) {
            const [x] = item.button.get_transformed_position();
            const centre = x + item.button.width / 2;
            const s = grow(Math.abs(pointerX - centre) / step, this._hover);
            item.icon.remove_transition('scale-x');
            item.icon.remove_transition('scale-y');
            item.icon.set_scale(s, s);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _settle() {
        for (const item of this._items ?? [])
            item.icon.ease({scale_x: 1, scale_y: 1, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._tooltip(null);
    }

    _tooltip(item) {
        if (!item) {
            this._tip?.destroy();
            this._tip = null;
            return;
        }
        if (!this._tip) {
            this._tip = new St.Label({style_class: 'mk-dock-tooltip'});
            Main.uiGroup.add_child(this._tip);
        }
        this._tip.text = item.name;
        const [x, y] = item.button.get_transformed_position();
        const [tw] = this._tip.get_preferred_width(-1);
        this._tip.set_position(Math.round(x + item.button.width / 2 - tw / 2),
            Math.round(y - this._size * (this._hover - 1) - 36));
    }

    // ----- where it sits, and stepping out of the way -----

    _place() {
        if (!this._actor)
            return;
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const [, w] = this._actor.get_preferred_width(-1);
        const [, h] = this._actor.get_preferred_height(w);
        this._rect = {x: Math.round(m.x + (m.width - w) / 2), y: m.y + m.height - h - MARGIN, width: w, height: h};
        this._chrome.set_position(this._rect.x, this._rect.y);
        this._edge.set_position(m.x, m.y + m.height - 2);
        this._edge.width = m.width;
        this._queueDodge();
    }

    _followFocus() {
        for (const [object, id] of this._focusIds ?? [])
            object.disconnect(id);
        this._focusIds = [];
        const win = global.display.focus_window;
        if (win) {
            for (const signal of ['position-changed', 'size-changed'])
                this._focusIds.push([win, win.connect(signal, () => this._queueDodge())]);
        }
        this._paintBars();
        this._queueDodge();
    }

    _queueDodge(delay = 0) {
        if (this._dodgeId)
            GLib.source_remove(this._dodgeId);
        this._dodgeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay || 60, () => {
            this._dodgeId = 0;
            this._dodge();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Is any window on this desktop over the dock's spot?
    _covered() {
        if (!this._rect)
            return false;
        const ws = global.workspace_manager.get_active_workspace();
        const primary = Main.layoutManager.primaryIndex;
        const {x, y, width, height} = this._rect;
        return ws.list_windows().some(w => {
            if (w.minimized || w.get_monitor() !== primary || w.skip_taskbar ||
                w.window_type !== Meta.WindowType.NORMAL && w.window_type !== Meta.WindowType.DIALOG)
                return false;
            const f = w.get_frame_rect();
            return f.x < x + width && f.x + f.width > x && f.y < y + height && f.y + f.height > y;
        });
    }

    _dodge() {
        if (!this._actor || this._gone || this._inOverview)
            return;
        if (this._actor.hover || this._menus.activeMenu)
            return;                                         // never away from under the pointer
        this._slide(this._covered());
    }

    // Is the dock's monitor showing a full-screen window (or is the focused window full screen)?
    _fullscreen() {
        return global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex) ||
            !!global.display.focus_window?.is_fullscreen();
    }

    _reveal() {
        this._slide(false);
        this._queueDodge(1500);            // and away again if the pointer doesn't come onto it
    }

    _slide(hide) {
        if (hide === this._hidden)
            return;
        this._hidden = hide;
        this._edge.visible = hide && !this._fullscreen() && !this._inOverview;
        // (ease() retargets a slide already under way from where it is, so a quick hide-then-show never jumps)
        this._actor.ease({translation_y: hide ? this._hiddenY() : 0, opacity: hide ? 0 : 255,
            duration: hide ? HIDE : REVEAL,
            mode: hide ? Clutter.AnimationMode.EASE_IN_OUT_QUAD : Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._actor.reactive = !hide;
    }

    _hiddenY() {
        return this._hidden ? SINK : 0;
    }

    // GNOME's overview has a dash of its own along the bottom (Dash to Dock used
    // to take its place): with the engine's dock it would be a second dock, so
    // it's folded away (no height, so the desktops get the room) while this runs.
    _hideOverviewDash(hide) {
        const dash = Main.overview.dash;
        if (!dash)
            return;
        if (hide) {
            dash.hide();
            dash.set_height(0);
        } else {
            dash.set_height(-1);
            dash.show();
        }
    }

    _overview(showing) {
        this._inOverview = showing;
        this._actor.remove_transition('opacity');
        if (showing) {
            this._tooltip(null);
            this._edge.visible = false;
            this._actor.reactive = false;
            // down and out of the way: the overview's own dash and the desktops are all yours
            this._actor.ease({opacity: 0, translation_y: SINK * 2, duration: OVERVIEW_OUT,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: done => done && this._inOverview && this._actor?.hide()});
        } else {
            this._actor.show();
            if (!this._hidden) {
                this._actor.reactive = true;
                this._actor.ease({opacity: 255, translation_y: 0, duration: OVERVIEW_IN, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            } else {
                this._actor.translation_y = this._hiddenY();
                this._edge.visible = !this._fullscreen();
            }
            this._queueDodge(250);
        }
    }

    // ----- taking it down -----

    _teardown() {
        for (const id of [this._fillId, this._dodgeId, this._edgeId])
            id && GLib.source_remove(id);
        this._fillId = this._dodgeId = this._edgeId = 0;
        for (const [object, id] of [...this._ids ?? [], ...this._focusIds ?? []])
            object.disconnect(id);
        this._ids = this._focusIds = [];
        for (const item of this._items ?? [])
            item.app && item.windowsId && item.app.disconnect(item.windowsId);
        this._items = null;
        this._tooltip(null);
        this._hideOverviewDash(false);
        this._unblur?.();
        this._unblur = null;
        this._menus = null;
        if (!this._gone) {
            this._edge?.destroy();
            if (this._chrome?.get_parent())
                Main.layoutManager.removeChrome(this._chrome);
            this._chrome?.destroy();        // (and the dock in it)
        }
        this._chrome = null;
        this._actor = this._edge = null;
        this._appIds = [];
    }

    destroy() {
        this._unwatch();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        if (this._actor)
            this._teardown();
    }
}
