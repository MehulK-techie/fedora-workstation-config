// MK Shell Engine: the MK dock. A floating glass shelf at the bottom of the
// primary monitor: your favourite apps, then running ones, then Show Apps.
//   - only the icon right under the pointer grows (dock-hover-scale, 1.32x by
//     default, and a 12 px lift, a quick 120 ms spring), so the dock never
//     shifts; the app you're in sits raised (1.12x, 5 px up) while you work in
//     it (dock-focused-raise); Show Apps never grows
//   - an indicator under each running app (two for several windows): a glowing
//     dot, a short dash or an underline (dock-indicator-style), in your accent
//     colour for the app you're using
//   - looks (dock-style): Obsidian Frosted Glass, Crystal Clear, Tahoe Pill,
//     Cyberpunk Neon Edge, Minimal Floating Icons (and three older ones), with
//     dock-opacity and dock-corner-radius
//   - click: open, focus, or (the app you're in) minimize; middle-click: a new
//     window; scroll: cycle the app's windows; right-click: New Window,
//     Keep in Dock, Quit, Force Quit
//   - it always stays where it is, fully shown: no auto-hide, no edge to wake it (it only
//     makes way for the overview, and GNOME hides it under a full-screen window)
// Everything follows GNOME's signals (apps starting and stopping, favourites,
// focus, windows moving): nothing polls. Stands aside while Dash to Dock is on.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { DASH_TO_DOCK, isActive, watch } from './conflicts.js';
import { DOCK_GLASS, addWallpaperGlass, blurAllowed } from './blur.js';
import { accentRGB, onAccentChanged } from './colour.js';
import * as Actions from './appActions.js';

const MARGIN = 4;              // the dock's gap above the screen's bottom edge
const SINK = 14;               // how far it sinks as it fades for the overview (px, doubled)
const OVERVIEW_OUT = 260, OVERVIEW_IN = 360;

// The parabola: HOVER at the pointer, falling to 1 a little over one icon
// away; the neighbour one icon away lands on HOVER minus 56 % of the growth
// (1.18 -> 1.08, as the default).
// Magnification, focused: the icon under the pointer grows to
// dock-hover-scale (1.32x) and lifts 12 px; the icon on each side of it grows
// a little (1.08x); every other icon stays as it is. Each icon glides to its
// size in 120 ms (ease-out cubic) as the pointer sweeps across, and only
// when its own size changes, so a sweep never restarts anyone else's glide.
const LIFT = 12, GLIDE = 120;     // the hovered icon lifts 12 px, in 120 ms

export class Dock {
    constructor(settings) {
        this._settings = settings;
        this._actor = null;
        this._unwatch = watch(() => this._sync());
        this._settingsIds = ['changed::dock', 'changed::dock-icon-size', 'changed::dock-hover-scale', 'changed::blur', 'changed::dock-style', 'changed::dock-opacity',
            'changed::dock-corner-radius', 'changed::dock-indicator-style', 'changed::dock-glow-color',
            'changed::dock-icon-glass'].map(
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
        this._pointerable = true;
        // its look (dock-style): obsidian-glass, cupertino-frost, spider-glow or minimal-flat
        const style = this._settings.get_string('dock-style');
        this._actor = new St.BoxLayout({style_class: `mk-dock mk-dock-${style}`, reactive: true, track_hover: true,
            y_align: Clutter.ActorAlign.END});
        // frosted glass behind each icon (dock-icon-glass)
        if (this._settings.get_boolean('dock-icon-glass'))
            this._actor.add_style_class_name('mk-dock-glass-icons');
        this._actor.set_pivot_point(0.5, 1);
        // the glass styles' tint follows dock-opacity; the corners dock-corner-radius (Tahoe: round ends)
        const op = this._settings.get_double('dock-opacity');
        this._radius = style === 'tahoe-pill' ? 32 : this._settings.get_int('dock-corner-radius');
        const tint = {'obsidian-glass': `rgba(18, 20, 30, ${op.toFixed(2)})`,
            'crystal-clear': `rgba(255, 255, 255, ${(op * 0.36).toFixed(2)})`,
            'tahoe-pill': `rgba(28, 30, 40, ${op.toFixed(2)})`,
            'cyber-neon': `rgba(8, 10, 22, ${Math.max(op, 0.5).toFixed(2)})`}[style];
        // the glow colour (a #rrggbb only: it goes into the style as it is)
        const glow = this._settings.get_string('dock-glow-color');
        this._glow = /^#[0-9a-f]{6}$/i.test(glow) ? glow : '#ef4444';
        const edge = ['spider-glow', 'cyber-neon'].includes(style)
            ? `border: 1px solid ${this._glow}; box-shadow: 0 0 20px 1px ${this._glow}80; ` : '';
        this._actor.style = `${tint ? `background-color: ${tint}; ` : ''}${edge}border-radius: ${this._radius}px;`;
        this._indicator = this._settings.get_string('dock-indicator-style');
        this._connect(this._settings, 'changed::dock-focused-raise', () => this._settle());
        // the icons only take the pointer once the dock is (nearly) back in place: a hidden
        // dock never shows a name or grows an icon (it used to, from just under the screen's edge)
        this._actor.connect('notify::translation-y', () => {
            if (!this._inOverview && this._actor.translation_y < 10)
                this._setPointerable(true);
        });
        this._actor.connect('destroy', () => (this._gone = true));     // (GNOME Shell quitting takes it down first)
        this._gone = false;
        // GNOME shows and hides the chrome it tracks by itself (full screen, and
        // whenever it re-checks), which would undo hiding the dock for the
        // overview; so it tracks this holder, and the dock inside it is ours.
        this._chrome = new Clutter.Actor({layout_manager: new Clutter.BinLayout()});
        this._chrome.add_child(this._actor);
        Main.layoutManager.addChrome(this._chrome, {trackFullscreen: true});

        this._actor.connect('motion-event', (_a, event) => this._magnify(event.get_coords()[0]));
        this._actor.connect('leave-event', () => this._settle());
        // (flat: solid, floating icons: no shelf at all; nothing to see through either way)
        if (blurAllowed(this._settings) && style !== 'minimal-flat' && style !== 'floating-icons')
            this._unblur = addWallpaperGlass(this._actor, this._chrome, DOCK_GLASS, this._radius);
        this._menus = new PopupMenu.PopupMenuManager(this._actor);

        const appSystem = Shell.AppSystem.get_default();
        const tracker = Shell.WindowTracker.get_default();
        this._connect(appSystem, 'app-state-changed', () => this._queueFill());
        this._connect(appSystem, 'installed-changed', () => this._queueFill());
        this._connect(AppFavorites.getAppFavorites(), 'changed', () => this._queueFill());
        this._connect(tracker, 'notify::focus-app', () => {
            this._paintBars();
            if (!this._actor.hover)
                this._settle();          // the focused app's icon rises, the last one settles
        });
        this._connect(global.display, 'notify::focus-window', () => this._followFocus());
        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._queueFill());
        // a window asking for you (a finished download, a message): its app hops twice
        for (const signal of ['window-demands-attention', 'window-marks-urgent']) {
            if (!GObject.signal_lookup(signal, global.display.constructor))
                continue;               // (GNOME 51 has only the first)
            this._connect(global.display, signal, (_d, win) => {
                const app = Shell.WindowTracker.get_default().get_window_app(win);
                if (app && win !== global.display.focus_window)
                    this._bounce(app, 2, false);
            });
        }
        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        // Super / the overview: the dock fades away (the overview has its own dash) and comes back after
        this._connect(Main.overview, 'showing', () => this._overview(true));
        this._connect(Main.overview, 'hiding', () => this._overview(false));
        if (Main.overview.visible)
            this._overview(true);
        this._hideOverviewDash(true);
        this._connect(this._actor, 'notify::width', () => this._place());
        // a new accent in Settings: the running-app bars take it at once
        const stopAccent = onAccentChanged(() => {
            for (const item of this._items ?? [])
                item.state = null;
            this._paintBars();
        });
        this._ids.push([{disconnect: () => stopAccent()}, 0]);
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
                const menu = this._menu(item);
                if (!menu.isOpen)
                    menu._mkFill();
                menu.toggle();
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
        item.isAppGrid = true;          // never magnifies or lifts (_magnify)
        item.button.connect('clicked', () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else
                Main.overview.showApps();
        });
    }

    // One dock entry: the icon (which grows), and a bar under it.
    _item(icon, name) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        icon.set_pivot_point(0.5, 1);
        box.add_child(icon);
        const bars = new St.BoxLayout({style_class: 'mk-dock-bars', x_align: Clutter.ActorAlign.CENTER});
        box.add_child(bars);
        // (an icon added while the dock is away takes the pointer only once it's back)
        const live = this._pointerable !== false;
        const button = new St.Button({style_class: 'mk-dock-item', child: box, reactive: live, track_hover: live,
            can_focus: true, button_mask: (St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE), accessible_name: name});
        button.connect('notify::hover', () => this._tooltip(button.hover && this._showing() ? item : null));
        this._actor.add_child(button);
        const item = {button, box, icon, bars, name};
        button.connect('destroy', () => (item.gone = true));   // (a refill or shutdown took it away)
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
            else {
                app.activate();
                this._bounce(app, 6, true);        // hops while it starts, stops when its window opens
            }
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
        // (filled before it opens: GNOME won't open an empty menu, so filling it on
        // open-state-changed meant it never opened at all)
        menu._mkFill = () => {
            menu.removeAll();
            const {app} = item;
            menu.addAction('New Window', () => app.open_new_window(-1));
            const favourites = AppFavorites.getAppFavorites();
            if (favourites.isFavorite(app.get_id()))
                menu.addAction('Remove from Dock', () => favourites.removeFavorite(app.get_id()));
            else
                menu.addAction('Keep in Dock', () => favourites.addFavorite(app.get_id()));
            if (app.get_n_windows() > 0) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                menu.addAction('Quit', () => app.request_quit());
                // for an app that has stopped answering: asks first, then ends it at once
                if (Actions.canForceQuit(app))
                    menu.addAction('Force Quit…', () => Actions.forceQuit(app)).add_style_class_name('mk-danger');
            }
        };
        item.menu = menu;
        item.button.connect('destroy', () => menu.destroy());
        return menu;
    }

    // The dock's liveliness: APP's icon hops (up 16 px, a little bounce on
    // landing) up to TIMES times; LAUNCH: stop once the app has a window.
    _bounce(app, times, launch) {
        const item = this._items?.find(i => i.app === app);
        if (!item || item.bouncing || !St.Settings.get().enable_animations)
            return;
        item.bouncing = true;
        let left = times;
        const hop = () => {
            if (!this._actor || this._gone || !item.box.get_stage() || !left-- || (launch && app.get_n_windows() > 0)) {
                item.bouncing = false;
                if (item.box.get_stage())
                    item.box.ease({translation_y: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                return;
            }
            item.box.ease({translation_y: -16, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => item.box?.ease({translation_y: 0, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                    onComplete: hop})});
        };
        hop();
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

    // ----- the dots under the icons (running apps) -----

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
            // a small glowing dot pops in under each running app (two for several windows);
            // the app you're using gets its dot in your accent colour
            const dot = colour => {
                const w = new St.Widget({style_class: `mk-dock-bar mk-dock-bar-${this._indicator ?? 'glowing-dot'}`,
                    style: `background-color: ${colour}; box-shadow: 0 0 ${state === 'focus' ? 8 : 6}px ${colour};`,
                    pivot_point: new Graphene.Point({x: 0.5, y: 0.5}), scale_x: 0, scale_y: 0, opacity: 0});
                item.bars.add_child(w);
                w.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK});
            };
            // the dots in the glow colour; the focused app's glow brighter and wider (its under-glow)
            const white = this._glow ?? '#ef4444', accent = this._glow ?? `rgb(${r},${g},${b})`;
            if (state === 'one')
                dot(white);
            else if (state === 'many') {
                dot(white);
                dot(white);
            } else if (state === 'focus') {
                dot(accent);
                if (n > 1)
                    dot(accent);
            }
        }
    }

    // ----- growing under the pointer -----

    _magnify(pointerX) {
        const items = this._items ?? [];
        // only the icon right under the pointer grows (a quick spring, 120 ms); the rest keep
        // their resting state, so nothing moves sideways (scaling never changes the layout)
        const [dockX] = this._actor.get_transformed_position();
        const under = items.find(it => !it.isAppGrid && pointerX >= dockX + it.button.x &&
            pointerX < dockX + it.button.x + it.button.width);
        items.forEach(it => {
            if (it.gone)
                return;
            const [scale, lift] = it === under && this._hover > 1.001 ? [this._hover, LIFT] : this._rest(it);
            const key = `${scale}/${lift}`;
            if (it.target === key)
                return;
            it.target = key;
            it.icon.ease({scale_x: scale, scale_y: scale, translation_y: -lift,
                duration: GLIDE, mode: it === under ? Clutter.AnimationMode.EASE_OUT_BACK : Clutter.AnimationMode.EASE_OUT_CUBIC});
        });
        return Clutter.EVENT_PROPAGATE;
    }

    // an icon at rest: the focused app's raised (1.15x, 9 px up, on a soft glow), every other at 1x
    _focused(item) {
        return this._settings.get_boolean('dock-focused-raise') && item.app &&
            item.app === Shell.WindowTracker.get_default().focus_app;
    }

    _rest(item) {
        return this._focused(item) ? [1.15, 9] : [1, 0];
    }

    // the glow colour as "R, G, B"
    _rgb() {
        const hex = this._glow ?? '#ef4444';
        return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ');
    }

    _settle() {
        const ease = {duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD};
        const rgb = this._rgb();
        if (this._gone)
            return;
        for (const item of this._items ?? []) {
            if (item.gone)
                continue;
            const [scale, lift] = this._rest(item);
            item.target = `${scale}/${lift}`;
            item.icon.ease({scale_x: scale, scale_y: scale, translation_y: -lift, ...ease});
            // the app you're in sits on a soft tile of the glow colour
            item.button.style = this._focused(item)
                ? `background-color: rgba(${rgb}, 0.22); border: 1px solid rgba(${rgb}, 0.70); border-radius: 16px; ` +
                  `box-shadow: 0 4px 16px rgba(${rgb}, 0.60);`
                : null;
        }
        this._tooltip(null);
    }

    // Is the dock really there (not hidden, not in the overview, not fading)?
    _showing() {
        return !this._inOverview && this._actor?.visible && this._actor.opacity >= 200;
    }

    // every icon taking the pointer, or none (a hidden dock: no hover, no names, no hit-testing)
    _setPointerable(on) {
        if (this._pointerable === on || !this._actor || this._gone)
            return;
        this._pointerable = on;
        for (const child of this._actor.get_children()) {
            child.reactive = on;
            child.track_hover = on;
            if (!on)
                child.sync_hover?.();
        }
        if (!on)
            this._tooltip(null);
    }

    _tooltip(item) {
        if (item && !this._showing())
            item = null;
        if (!item) {
            this._tip?.destroy();
            this._tip = null;
            return;
        }
        if (!this._tip) {
            this._tip = new St.Label({style_class: 'mk-dock-tooltip', opacity: 0});
            Main.uiGroup.add_child(this._tip);
            this._tip.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        this._tip.text = item.name;
        const [x, y] = item.button.get_transformed_position();
        const [tw] = this._tip.get_preferred_width(-1);
        this._tip.set_position(Math.round(x + item.button.width / 2 - tw / 2),
            Math.round(y - this._size * (this._hover - 1) - LIFT - 36));
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
    }

    _followFocus() {
        for (const [object, id] of this._focusIds ?? [])
            object.disconnect(id);
        this._focusIds = [];
        this._paintBars();
    }

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
            this._setPointerable(false);
            this._actor.reactive = false;
            // down and out of the way: the overview's own dash and the desktops are all yours
            this._actor.ease({opacity: 0, translation_y: SINK * 2, duration: OVERVIEW_OUT,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: done => done && this._inOverview && this._actor?.hide()});
        } else {
            this._actor.show();
            this._actor.reactive = true;
            this._actor.ease({opacity: 255, translation_y: 0, duration: OVERVIEW_IN, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    // ----- taking it down -----

    _teardown() {
        if (this._fillId)
            GLib.source_remove(this._fillId);
        this._fillId = 0;
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
            if (this._chrome?.get_parent())
                Main.layoutManager.removeChrome(this._chrome);
            this._chrome?.destroy();        // (and the dock in it)
        }
        this._chrome = null;
        this._actor = null;
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
