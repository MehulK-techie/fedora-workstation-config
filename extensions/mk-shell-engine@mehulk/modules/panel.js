// MK Shell Engine: the top bar as three floating glass islands. GNOME's bar
// keeps its three groups (left, centre, right) and everything in them; the
// engine only turns the bar itself clear and gives each group its own
// rounded, blurred island. Plus two things GNOME's bar doesn't have:
//   - the app you're using, in its own colours (never a grey symbolic icon),
//     with its name; a click opens New Window, Snap Left / Right, Keep on Top,
//     Quit. The pill fits the name; the name crossfades (120 ms), nothing tweens its width.
//   - the battery tinted by its state (charging, high, mid, low).
//   - the workspace dots in a fixed 58 px anchor, so they never push the bar about.
//   - a typographic clock in the centre: "Thu Nov 5 · 2:25 PM" (24-hour if
//     GNOME is set to it).
// top-bar-style: 'islands' or 'edge' (one seamless glass bar); show-active-app
// switches the app button off; autohide-top-bar slides the bar away while a
// window has focus. Everything else stays GNOME's own.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GnomeDesktop from 'gi://GnomeDesktop';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PANEL_GLASS, addWallpaperGlass, blurAllowed, desktopCopy } from './blur.js';
import { partRect, place } from './tiling.js';
import * as Actions from './appActions.js';
import { BLUR_MY_SHELL, UNIFIED, isActive, watch } from './conflicts.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

const ICONS = GLib.build_filenamev([GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0])),
    'icons']);
const LOGO_KEYS = ['finder-logo-mode', 'finder-custom-logo-path', 'finder-icon-size', 'finder-show-label',
    'finder-label-text', 'finder-logo-circular'];

// A picture as a round avatar (St crops a background image to its rounded corners),
// filling the circle; the escaped path keeps quotes in a file name from breaking the CSS
export function roundPicture(path, size) {
    const uri = Gio.File.new_for_path(path).get_uri().replace(/["\\]/g, c => `\\${c}`);
    return new St.Bin({style_class: 'mk-logo-round', width: size, height: size, y_align: Clutter.ActorAlign.CENTER,
        style: `background-image: url("${uri}"); background-size: cover; background-position: center; ` +
            `border-radius: ${size / 2}px;`});
}

const ISLAND_RADIUS = 12;            // (the islands' CSS corners; the glass is cut to match)

// The focused app: icon (its own colours), name, and a menu of what you can do
// with its window. Switching crossfades (150 ms); with nothing focused it's
// gone, so an empty desktop shows only the workspace dots.
class ActiveApp {
    constructor() {
        this.button = new PanelMenu.Button(0.0, 'Active app', false);
        this.button.add_style_class_name('mk-active-app');
        this._box = new St.BoxLayout({style_class: 'mk-active-app-box', y_align: Clutter.ActorAlign.CENTER});
        this._iconBin = new St.Bin({y_align: Clutter.ActorAlign.CENTER, width: 18});   // (the same for an app icon and the dot)
        // its natural width (up to 240 px, then cut short by "…"): the pill fits the name,
        // and the glass behind the island follows the island's size (no width animation)
        this._label = new St.Label({style_class: 'mk-active-app-name', y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER});
        this._label.clutter_text.ellipsize = 3;     // Pango.EllipsizeMode.END
        this._box.add_child(this._iconBin);
        this._box.add_child(this._label);
        this.button.add_child(this._box);
        this._tracker = Shell.WindowTracker.get_default();
        this._ids = [
            [this._tracker, this._tracker.connect('notify::focus-app', () => this._sync(true))],
            [global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', () => this._sync(true))],
            [Main.overview, Main.overview.connect('showing', () => this._sync(false))],
            [Main.overview, Main.overview.connect('hidden', () => this._sync(false))],
        ];
        this.button.menu.connect('open-state-changed', (_m, open) => open && this._fillMenu());
        this._key = null;
        this.button.connect('destroy', () => (this._gone = true));    // (GNOME tears the bar down first at shutdown)
        this._sync(false);
    }

    _sync(animate) {
        if (this._gone)
            return;
        const app = this._tracker.focus_app;
        // no app focused: no button at all (never "WS 1" in its place)
        this.button.visible = !Main.overview.visible && Boolean(app);
        this.onVisible?.(this.button.visible);
        const ws = global.workspace_manager.get_active_workspace_index() + 1;
        const key = app ? `app:${app.get_id()}` : `desk:${ws}`;
        if (key === this._key)
            return;
        this._key = key;
        this._app = app;
        let icon;
        if (app) {
            icon = app.create_icon_texture(18);
            icon.style = '-st-icon-style: requested;';           // the app's real colours
        } else {
            icon = new St.Icon({icon_name: 'user-desktop-symbolic', icon_size: 14});   // a desktop glyph
        }
        this._iconBin.set_child(icon);
        this._label.text = app ? app.get_name() : `WS ${ws}`;
        if (animate && St.Settings.get().enable_animations) {
            // only the name and icon crossfade: the capsule (glass behind it) never changes size
            this._box.remove_transition('opacity');
            this._box.opacity = 0;
            this._box.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    _window() {
        const win = global.display.focus_window;
        return win && this._app?.get_windows().includes(win) ? win : this._app?.get_windows()[0] ?? null;
    }

    _fillMenu() {
        const menu = this.button.menu, app = this._app;
        menu.removeAll();
        if (!app) {
            menu.addAction('Open Files', () => Gio.AppInfo.launch_default_for_uri(`file://${GLib.get_home_dir()}`, null));
            menu.addAction('Show Apps', () => Main.overview.showApps());
            return;
        }
        const win = this._window();
        // the app's menu, as on a Mac: About, New Window, Preferences, Hide, Force Quit
        menu.addAction(`About ${app.get_name()}`, () => Actions.about(app));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('New Window', () => app.open_new_window(-1));
        menu.addAction('Preferences', () => Actions.preferences(app));
        if (win) {
            // its window: halves, centre, on top
            const windowMenu = new PopupMenu.PopupSubMenuMenuItem('Window');
            const to = part => place(win, partRect(win.get_work_area_current_monitor(), part));
            windowMenu.menu.addAction('Split Left', () => to([0, 0, 0.5, 1]));
            windowMenu.menu.addAction('Split Right', () => to([0.5, 0, 0.5, 1]));
            windowMenu.menu.addAction('Center Stage', () => to([0.1, 0.05, 0.8, 0.9]));
            const onTop = new PopupMenu.PopupSwitchMenuItem('Pin on Top', win.is_above());
            onTop.connect('toggled', (_i, state) => state ? win.make_above() : win.unmake_above());
            windowMenu.menu.addMenuItem(onTop);
            menu.addMenuItem(windowMenu);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(`Hide ${app.get_name()}`, () => Actions.hide(app));
        menu.addAction(`Quit ${app.get_name()}`, () => app.request_quit());
        if (Actions.canForceQuit(app)) {
            const force = menu.addAction('Force Quit…', () => Actions.forceQuit(app));
            force.add_style_class_name('mk-danger');
        }
    }

    destroy() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this.button.destroy();
    }
}

// The Finder button at the far left: the system menu, as on a Mac. Fedora's own
// emblem by default (its fedora-logo-icon, shown in monochrome), or the MK
// emblem, an apple, the distribution's os-release logo, an image of your own,
// or none; its size; then a label (Finder by default). The finder-* settings
// apply as you change them.
class LogoButton {
    constructor(settings) {
        this._settings = settings;
        this.button = new PanelMenu.Button(0.5, 'System menu', false);   // (centred under it, 6 px from the edge)
        this.button.add_style_class_name('mk-logo-button');
        const box = new St.BoxLayout({style_class: 'mk-logo-box', y_align: Clutter.ActorAlign.CENTER});
        // (the files are symbolic, drawn in the bar's text colour)
        this._iconBin = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'mk-logo-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._iconBin);
        box.add_child(this._label);
        this.button.add_child(box);
        this._ids = LOGO_KEYS.map(k => settings.connect(`changed::${k}`, () => this._sync()));
        this._fillMenu();
        this._sync();
    }

    _logo() {
        const kind = this._settings.get_string('finder-logo-mode');
        const size = this._settings.get_int('finder-icon-size');
        const themed = name => new St.Icon({icon_name: name, icon_size: size, style_class: 'mk-logo-icon'});
        const file = path => new St.Icon({gicon: Gio.FileIcon.new(Gio.File.new_for_path(path)), icon_size: size,
            style_class: 'mk-logo-icon'});
        const mono = icon => {
            // a colour logo as a white glyph: no colour, then lifted toward the bar's text
            icon.add_effect(new Clutter.DesaturateEffect({factor: 1.0}));
            const lift = new Clutter.BrightnessContrastEffect();
            lift.set_brightness(0.45);
            icon.add_effect(lift);
            return icon;
        };
        if (kind === 'none')
            return null;
        if (kind === 'apple')
            return file(GLib.build_filenamev([ICONS, 'mk-apple-symbolic.svg']));
        if (kind === 'mk')
            return file(GLib.build_filenamev([ICONS, 'mk-emblem-symbolic.svg']));
        if (kind === 'custom') {
            const path = this._settings.get_string('finder-custom-logo-path').replace(/^~(?=\/)/, GLib.get_home_dir());
            if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS))
                return themed('image-missing-symbolic');
            // a photo or picture: round by default (an SVG glyph stays as drawn)
            return this._settings.get_boolean('finder-logo-circular') && !/\.svg$/i.test(path)
                ? roundPicture(path, size) : file(path);
        }
        if (kind === 'distro')
            return mono(themed(GLib.get_os_info('LOGO') || 'start-here-symbolic'));
        return mono(themed('fedora-logo-icon'));
    }

    _sync() {
        this._iconBin.set_child(this._logo());
        const text = this._settings.get_string('finder-label-text');
        this._label.text = text;
        this._label.visible = this._settings.get_boolean('finder-show-label') && text !== '';
        this.button.accessible_name = text || 'System menu';
    }

    _fillMenu() {
        const menu = this.button.menu;
        const actions = SystemActions.getDefault();
        const app = (...ids) => {
            const found = ids.map(id => Shell.AppSystem.get_default().lookup_app(id)).find(Boolean);
            return () => found?.activate();
        };
        const run = argv => () => {
            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            } catch (e) {
                Main.notify('System menu', e.message);
            }
        };
        menu.addAction('About This System', run(['gnome-control-center', 'system']));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('System Settings…', app('org.gnome.Settings.desktop'));
        menu.addAction('App Store…', app('org.gnome.Software.desktop'));
        menu.addAction('Extensions…', app('com.mattjakeman.ExtensionManager.desktop', 'org.gnome.Extensions.desktop'));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Sleep', () => actions.activateSuspend());
        menu.addAction('Restart…', () => actions.activateRestart());
        menu.addAction('Shut Down…', () => actions.activatePowerOff());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Lock Screen', () => actions.activateLockScreen());
        menu.addAction('Log Out…', () => actions.activateLogout());
    }

    destroy() {
        this._ids.forEach(id => this._settings.disconnect(id));
        this.button.destroy();
    }
}

// The left of the bar: one frosted glass pill holding the Finder logo, a divider, Places
// and the workspace dots, and 8 px on, the app you're in (the suite's app pill is a capsule
// of its own that fades away on an empty desktop; the engine's app button gets a pill here).
// Each is a frosted backdrop behind the left box, as wide as its buttons, following them
// as they move, come and go (the left box itself paints nothing).
const ISLAND_GROUPS = [
    ['wack-finder', 'mk-logo', 'wack-logo-menu', '@divider', 'wack-places', 'places-menu', 'wack-workspace-button',
        'activities'],
    ['mk-active-app'],
];
const BLOCK_RADIUS = 13;          // (a pill: half the block's 26 px height)

class LeftIslands {
    constructor(settings, divider) {
        this._divider = divider;
        this._backdrops = ISLAND_GROUPS.map(() => {
            const b = new St.Widget({style_class: 'mk-left-island', reactive: false, visible: false});
            Main.layoutManager.uiGroup.insert_child_below(b, Main.layoutManager.panelBox);
            return b;
        });
        this._unglass = blurAllowed(settings)
            ? this._backdrops.map(b => addWallpaperGlass(b, b, PANEL_GLASS, BLOCK_RADIUS)) : [];
        const box = Main.layoutManager.panelBox;
        this._ids = [
            [Main.panel._leftBox, Main.panel._leftBox.connect('notify::allocation', () => this.queue())],
            [Main.panel, Main.panel.connect('notify::visible', () => this.queue())],
            [box, box.connect('notify::translation-y', () => this.queue())],
            [box, box.connect('notify::opacity', () => this.queue())],
            [box, box.connect('notify::visible', () => this.queue())],
        ];
        this._watched = new Map();      // each button followed: actor -> its signal ids
        this.queue();
    }

    // a button's own moves move its island too; a button that goes is simply forgotten
    _watch(actor) {
        if (this._watched.has(actor))
            return;
        this._watched.set(actor, [actor.connect('notify::allocation', () => this.queue()),
            actor.connect('destroy', () => this._watched.delete(actor))]);
    }

    queue() {
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _actors(group) {
        const area = Main.panel.statusArea, left = Main.panel._leftBox;
        return group.map(name => (name === '@divider' ? this._divider : area[name]?.container))
            .filter(a => a && a.get_parent() === left && a.visible);
    }

    _sync() {
        const shown = Main.panel.visible && Main.layoutManager.panelBox.visible;
        ISLAND_GROUPS.forEach((group, i) => {
            const b = this._backdrops[i];
            const actors = this._actors(group).filter(a => a !== this._divider);
            for (const a of this._actors(group))
                this._watch(a);
            if (!shown || !actors.length) {
                b.hide();
                return;
            }
            let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
            for (const a of this._actors(group)) {
                const e = a.get_transformed_extents();
                if (![e.origin.x, e.size.width].every(Number.isFinite) || e.size.width <= 0)
                    continue;
                x1 = Math.min(x1, e.origin.x);
                x2 = Math.max(x2, e.origin.x + e.size.width);
                y1 = Math.min(y1, e.origin.y);
                y2 = Math.max(y2, e.origin.y + e.size.height);
            }
            if (!Number.isFinite(x1)) {
                b.hide();
                return;
            }
            b.set_position(Math.round(x1), Math.round(y1) + 3);
            b.set_size(Math.round(x2 - x1), Math.max(1, Math.round(y2 - y1) - 6));
            b.opacity = Main.layoutManager.panelBox.get_paint_opacity();
            b.show();
        });
    }

    destroy() {
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        for (const [a, id] of this._ids)
            a.disconnect(id);
        for (const [a, ids] of this._watched)
            ids.forEach(id => a.disconnect(id));
        this._watched.clear();
        this._unglass.forEach(off => off());
        this._backdrops.forEach(b => b.destroy());
    }
}

// The top bar's menus as floating glass (Finder, Places, the app's menu, and what
// other extensions add): 8 px below the bar, at least 6 px from the screen's edge,
// centred under their button where there's room, frosted over what's behind while
// open, rounded items with a faint hover (stylesheet: .mk-glass-menu). Quick
// Settings, the calendar and the media tile have glass of their own.
const MENU_GLASS = {sigma: 48, brightness: 0.6};
const OWN_GLASS = new Set(['quickSettings', 'dateMenu', 'mk-media']);

class GlassMenus {
    constructor() {
        this._done = new Map();          // menu -> its open-state id
        this._ids = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox].map(box =>
            [box, box.connect('child-added', () => this._queue())]);
        this._apply();
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    _apply() {
        for (const [name, item] of Object.entries(Main.panel.statusArea)) {
            const menu = item?.menu;
            if (OWN_GLASS.has(name) || !menu?.box || !menu.actor || this._done.has(menu))
                continue;
            menu.box.add_style_class_name('mk-glass-menu');
            menu.actor.add_style_class_name('mk-glass-pointer');
            if (['places-menu', 'mk-logo', 'wack-finder', 'wack-places'].includes(name))
                menu._arrowAlignment = 0.5;
            const id = menu.connect('open-state-changed', (_m, open) => {
                menu._mkUnglass?.();
                menu._mkUnglass = open ? addWallpaperGlass(menu.box, menu.actor, MENU_GLASS, 16, desktopCopy) : null;
            });
            // a button that goes first (its extension switched off, or GNOME locking the screen)
            // takes its menu along: forgotten here, never touched again
            menu.connect('destroy', () => {
                menu._mkUnglass?.();
                this._done.delete(menu);
            });
            this._done.set(menu, id);
        }
    }

    destroy() {
        if (this._idle)
            GLib.source_remove(this._idle);
        for (const [box, id] of this._ids)
            box.disconnect(id);
        for (const [menu, id] of this._done) {
            try {
                menu.disconnect(id);
                menu._mkUnglass?.();
                delete menu._mkUnglass;
                menu.box.remove_style_class_name('mk-glass-menu');
                menu.actor.remove_style_class_name('mk-glass-pointer');
            } catch {}                   // (its button is already gone)
        }
        this._done.clear();
    }
}

// The right island's chevron: tray icons that apps leave there (the
// AppIndicator ones) fold away behind it, like Bartender; a click shows them.
class TrayFold {
    constructor(settings) {
        this._settings = settings;
        this._icon = new St.Icon({icon_name: 'pan-start-symbolic', icon_size: 14});
        this.button = new St.Button({style_class: 'panel-button mk-tray-fold', can_focus: true, accessible_name: 'Tray icons'});
        this.button.set_child(this._icon);
        this.button.connect('destroy', () => (this._gone = true));     // (GNOME Shell quitting takes the bar down first)
        this.button.connect('clicked', () => {
            this._settings.set_boolean('tray-collapsed', !this._settings.get_boolean('tray-collapsed'));
        });
        Main.panel._rightBox.insert_child_at_index(this.button, 0);
        this._ids = [
            [settings, settings.connect('changed::tray-collapsed', () => this._sync())],
            [Main.panel._rightBox, Main.panel._rightBox.connect('child-added', () => this._queue())],
            [Main.panel._rightBox, Main.panel._rightBox.connect('child-removed', () => this._queue())],
        ];
        this._sync();
    }

    _tray() {
        return Object.entries(Main.panel.statusArea)
            .filter(([role, item]) => item && /^appindicator-|ayatana|statusnotifier|tray/i.test(role))
            .map(([, item]) => item.container ?? item);
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        if (this._gone)
            return;
        const tray = this._tray(), folded = this._settings.get_boolean('tray-collapsed');
        this.button.visible = tray.length > 0;
        this._icon.icon_name = folded ? 'pan-start-symbolic' : 'pan-end-symbolic';
        for (const actor of tray)
            actor.visible = !folded;
    }

    destroy() {
        this._gone = true;
        if (this._idle)
            GLib.source_remove(this._idle);
        for (const [object, id] of this._ids)
            object.disconnect(id);
        for (const actor of this._tray())
            actor.visible = true;
        this.button.destroy();
    }
}

// "Thu Nov 5 · 2:25 PM", in place of GNOME's clock text (GNOME's menu, calendar and all stay).
class Clock {
    constructor() {
        this._display = Main.panel.statusArea.dateMenu?._clockDisplay;
        if (!this._display)
            throw new Error('no clock in the top bar');
        this._label = new St.Label({style_class: 'mk-clock', y_align: Clutter.ActorAlign.CENTER});
        this._display.get_parent().insert_child_above(this._label, this._display);
        this._display.hide();
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._wall = new GnomeDesktop.WallClock();
        this._ids = [this._wall.connect('notify::clock', () => this._sync()),
            this._iface.connect('changed::clock-format', () => this._sync())];
        this._sync();
    }

    _sync() {
        const h24 = this._iface.get_string('clock-format') === '24h';
        this._label.text = GLib.DateTime.new_now_local().format(h24 ? '%a %b %-e  ·  %H:%M' : '%a %b %-e  ·  %-l:%M %p');
    }

    destroy() {
        this._wall.disconnect(this._ids[0]);
        this._iface.disconnect(this._ids[1]);
        this._wall.run_dispose?.();
        this._label.destroy();
        this._display.show();
    }
}

// autohide-top-bar: while a window has focus the bar glides up and out
// (220 ms); resting the pointer on the top edge brings it back (180 ms), and
// so do an empty desktop, the overview and an open menu. While it's on, the
// bar's strip is handed to windows (GNOME otherwise keeps that space for the
// bar even while it's away), and handed back when it's switched off.
class AutoHide {
    constructor() {
        this._box = Main.layoutManager.panelBox;
        this._retrack(false);
        this._hidden = false;
        this._edge = new St.Widget({reactive: true, height: 2, opacity: 0, visible: false});
        Main.uiGroup.add_child(this._edge);
        this._edge.connect('enter-event', () => this._show());
        this._hoverWas = Main.panel.track_hover;
        Main.panel.track_hover = true;
        this._ids = [
            [global.display, global.display.connect('notify::focus-window', () => this._queue(300))],
            [Main.panel, Main.panel.connect('notify::hover', () => this._queue(Main.panel.hover ? 0 : 700))],
            [Main.overview, Main.overview.connect('showing', () => this._show())],
            [Main.overview, Main.overview.connect('hidden', () => this._queue(400))],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._placeEdge())],
        ];
        this._placeEdge();
        this._queue(500);
    }

    // GNOME keeps a strip of the screen for the bar (its "strut"); off while hiding
    _retrack(reserve) {
        try {
            Main.layoutManager._untrackActor(this._box);
            Main.layoutManager._trackActor(this._box, {affectsStruts: reserve, trackFullscreen: true});
        } catch (e) {
            console.warn(`mk-shell-engine: top bar autohide: ${e.message}`);
        }
    }

    _placeEdge() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        this._edge.set_position(m.x, m.y);
        this._edge.width = m.width;
    }

    _queue(delay) {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, delay), () => {
            this._timer = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const win = global.display.focus_window;
        const focused = win && !win.minimized && win.get_monitor() === Main.layoutManager.primaryIndex &&
            win.window_type === Meta.WindowType.NORMAL;
        if (Main.panel.menuManager.activeMenu) {
            this._queue(800);                // a menu is open: look again once it closes
            return;
        }
        if (focused && !Main.overview.visible && !Main.panel.hover)
            this._hide();
        else if (!focused)
            this._show();
    }

    _hide() {
        if (this._hidden)
            return;
        this._hidden = true;
        this._edge.visible = true;
        this._box.ease({translation_y: -this._box.height, opacity: 0, duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _show() {
        this._edge.visible = false;
        if (!this._hidden)
            return;
        this._hidden = false;
        this._box.ease({translation_y: 0, opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._queue(2000);                   // and away again if the pointer doesn't stay on it
    }

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        for (const [object, id] of this._ids)
            object.disconnect(id);
        Main.panel.track_hover = this._hoverWas;
        this._edge.destroy();
        this._box.remove_all_transitions();
        this._box.translation_y = 0;
        this._box.opacity = 255;
        this._retrack(true);
    }
}

const TIERS = ['charging', 'high', 'mid', 'low'];

// The battery in the bar, tinted by its state: green while charging, soft
// white above 50 %, amber from 20 to 50 %, red under 20 % with a pulsing border. GNOME's own indicator, read from its
// own UPower proxy (no polling). GNOME builds that indicator a moment after
// startup, so this waits for it (up to 15 s; a desktop has none).
class BatteryTint {
    constructor() {
        let tries = 30;
        this._wait = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (!this._attach() && --tries > 0)
                return GLib.SOURCE_CONTINUE;
            this._wait = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _attach() {
        const system = Main.panel.statusArea.quickSettings?._system;
        const proxy = system?._systemItem?._powerToggle?._proxy;
        if (!system || !proxy?.IsPresent)
            return false;
        this._system = system;
        this._proxy = proxy;
        this._id = proxy.connect('g-properties-changed', () => this._sync());
        this._sync();
        return true;
    }

    _sync() {
        const state = this._proxy.State, pct = this._proxy.Percentage ?? 100;
        const charging = state === 1 || state === 5;          // charging, or plugged in and waiting
        // four tiers: charging, above 50 %, 20-50 %, under 20 % (which pulses its border)
        const tier = charging ? 'charging' : pct > 50 ? 'high' : pct >= 20 ? 'mid' : 'low';
        for (const name of TIERS)
            this._system.remove_style_class_name(`mk-batt-${name}`);
        this._system.add_style_class_name(`mk-batt-${tier}`);
        this._pulse(tier === 'low');
    }

    // under 20 %: the border breathes (CSS transition between two classes, 900 ms each way)
    _pulse(on) {
        if (on === !!this._pulseId)
            return;
        if (!on) {
            GLib.source_remove(this._pulseId);
            this._pulseId = 0;
            this._system.remove_style_class_name('mk-batt-dim');
            return;
        }
        this._pulseId = GLib.timeout_add(GLib.PRIORITY_LOW, 900, () => {
            if (this._system.has_style_class_name('mk-batt-dim'))
                this._system.remove_style_class_name('mk-batt-dim');
            else
                this._system.add_style_class_name('mk-batt-dim');
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._wait)
            GLib.source_remove(this._wait);
        if (!this._proxy)
            return;
        this._proxy.disconnect(this._id);
        if (this._pulseId)
            GLib.source_remove(this._pulseId);
        for (const name of [...TIERS, 'dim'])
            this._system.remove_style_class_name(`mk-batt-${name}`);
    }
}

// Status icons that only say a setting is on (Night Light, the power mode)
// stay out of the bar; the toggles in Quick Settings show them. Wi-Fi, Do
// Not Disturb, volume and battery stay.
class QuietIndicators {
    constructor() {
        this._qs = Main.panel.statusArea.quickSettings;
        this._held = [];
        // (GNOME makes some of its indicators a moment after startup: look again as they arrive)
        this._addedId = this._qs?._indicators?.connect('child-added', () => this._hold()) ?? 0;
        this._hold();
    }

    _hold() {
        for (const ind of [this._qs?._nightLight, this._qs?._powerProfiles]) {
            if (!ind || this._held.some(([held]) => held === ind))
                continue;
            ind.visible = false;
            this._held.push([ind, ind.connect('notify::visible', () => ind.visible && (ind.visible = false))]);
        }
    }

    destroy() {
        if (this._addedId)
            this._qs._indicators.disconnect(this._addedId);
        for (const [ind, id] of this._held) {
            ind.disconnect(id);
            ind._syncIndicatorsVisible?.();     // (GNOME's own rule for when it shows)
        }
    }
}

export class Panel {
    constructor(settings) {
        this._settings = settings;
        this._parts = [];
        this._ids = ['changed::top-bar-style', 'changed::show-active-app', 'changed::blur', 'changed::autohide-top-bar',
            'changed::finder-show-button'].map(
            signal => settings.connect(signal, () => this._rebuild()));
        this._unwatch = watch(() => this._rebuild());        // Blur my Shell on or off
        this._build();
    }

    _build() {
        const panel = Main.panel;
        const style = this._settings.get_string('top-bar-style');
        panel.add_style_class_name(style === 'edge' ? 'mk-edge' : 'mk-islands');
        if (!isActive(BLUR_MY_SHELL))
            panel.add_style_class_name('mk-clear');     // (Blur my Shell's panel blur shows through otherwise)
        if (blurAllowed(this._settings)) {
            const glass = style === 'edge' ? [panel] : [panel._centerBox, panel._rightBox];  // (the left: LeftIslands)
            this._unblur = glass.map(actor => addWallpaperGlass(actor, Main.layoutManager.panelBox, PANEL_GLASS,
                style === 'edge' ? 0 : ISLAND_RADIUS));
        }
        if (this._settings.get_boolean('finder-show-button')) {
            try {
                this._logo = new LogoButton(this._settings);
                panel.addToStatusArea('mk-logo', this._logo.button, 0, 'left');
            } catch (e) {
                console.error(`mk-shell-engine: logo button: ${e.message}`);
            }
        }
        if (this._settings.get_boolean('show-active-app')) {
            try {
                this._app = new ActiveApp();
                panel.addToStatusArea('mk-active-app', this._app.button, -1, 'left');
            } catch (e) {
                console.error(`mk-shell-engine: active app: ${e.message}`);
            }
        }
        try {
            this._tray = new TrayFold(this._settings);
        } catch (e) {
            console.error(`mk-shell-engine: tray fold: ${e.message}`);
        }
        this._orderLeft();
        if (style !== 'edge') {
            try {
                this._islands = new LeftIslands(this._settings, this._divider);
            } catch (e) {
                console.error(`mk-shell-engine: left islands: ${e.message}`);
            }
        }
        // something added to the left later (WACK Shell's logo button after a settings change,
        // Places switched on): put the island back in order
        this._leftId = Main.panel._leftBox.connect('child-added', () => this._queueOrder());
        this._leftGoneId = Main.panel._leftBox.connect('child-removed', () => this._queueOrder());
        // (GNOME destroys the whole bar as it shuts down, then runs what's still queued)
        this._leftDeadId = Main.panel._leftBox.connect('destroy', () => {
            this._barGone = true;
            this._dots = this._dotsBox = this._divider = null;
        });
        this._quiet = new QuietIndicators();
        this._glassMenus = new GlassMenus();
        this._battery = new BatteryTint();
        if (this._settings.get_boolean('autohide-top-bar')) {
            try {
                this._autohide = new AutoHide();
            } catch (e) {
                console.error(`mk-shell-engine: top bar autohide: ${e.message}`);
            }
        }
        try {
            this._clock = new Clock();
        } catch (e) {
            console.error(`mk-shell-engine: clock: ${e.message}`);
        }
    }

    // The left island, near the corner (Fitts's law: the pointer stops at the
    // screen's edge by itself): the emblem (WACK Shell's menu, when on), a divider,
    // the app you're in (or "WS 1" on an empty desktop), the workspace dots, Places.
    // GNOME's own dots (WorkspaceIndicators of WorkspaceDots), dressed after each of
    // GNOME's own updates: up to 4 desktops 6 px dots 5 px apart and an 18 px pill for the
    // current one, from 5 on 5 px / 4 px / 16 px; the others at full size, faint (45 %);
    // the current one in the accent (stylesheet: .mk-ws-active). The pill glides between
    // dots as GNOME's own expansion follows your swipe. The slot fits the dots, eased
    // (120 ms) only when desktops come or go: switching never moves the bar.
    _tintDots(dots) {
        const find = actor => actor.constructor.name === 'WorkspaceIndicators' ? actor
            : actor.get_children().map(find).find(Boolean);
        const box = find(dots);
        if (!box)
            return;                          // (WACK's workspace button draws its own)
        const self = this;
        const update = box._updateExpansion;
        box._updateExpansion = function (...args) {
            const result = update.apply(this, args);
            self._dressDots(box, dots);
            return result;
        };
        this._dotsBox = box;
        this._dressN = -1;
        this._dressDots(box, dots);
    }

    _dressDots(box, slot) {
        const live = box.get_children().filter(d => !d.destroying);
        const n = live.length, few = n <= 4;
        const size = few ? 6 : 5, gap = few ? 5 : 4, pill = few ? 18 : 16;
        for (const dot of box.get_children()) {
            if (!dot._dot)
                continue;
            if (!dot._mkVisuals) {
                // full-size dots, faint when not current (GNOME shrinks them to 0.75 and 50 %)
                dot._mkVisuals = true;
                dot._updateVisuals = function () {
                    this._dot.set({opacity: Math.round((0.45 + 0.55 * this.expansion) * 255), scale_x: 1, scale_y: 1});
                };
                dot._updateVisuals();
            }
            if (dot.width_multiplier !== pill / size)
                dot.width_multiplier = pill / size;
            if (dot.expansion > 0.5)
                dot._dot.add_style_class_name('mk-ws-active');
            else
                dot._dot.remove_style_class_name('mk-ws-active');
        }
        if (n === this._dressN)
            return;                          // (sizes only change with the number of desktops)
        this._dressN = n;
        box.style = `spacing: ${gap}px;`;
        for (const dot of box.get_children())
            dot._dot?.set_style(`min-width: ${size}px; min-height: ${size}px; width: ${size}px; height: ${size}px; ` +
                `border-radius: ${size / 2}px;`);           // (GNOME's theme sets a min-width of 0.5455 em)
        const width = Math.max(1, n - 1) * size + pill + Math.max(0, n - 1) * gap + 16;
        if (this._dotsWidth === undefined || !St.Settings.get().enable_animations) {
            slot.set_width(width);
        } else {
            slot.remove_transition('width');
            slot.ease({width, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
        this._dotsWidth = width;
    }

    _untintDots() {
        const box = this._dotsBox;
        if (!box)
            return;
        this._dotsBox = null;
        this._dotsWidth = undefined;
        try {
            delete box._updateExpansion;     // (the class's own again)
            box.style = null;
            for (const dot of box.get_children()) {
                if (dot._mkVisuals) {
                    delete dot._updateVisuals;
                    delete dot._mkVisuals;
                    dot._updateVisuals();
                }
                dot._dot?.set_style(null);
                dot._dot?.remove_style_class_name('mk-ws-active');
            }
            box._updateExpansion();
        } catch {}                           // (already gone with the bar)
    }

    _unanchor(dots) {
        this._untintDots();
        try {
            dots.remove_style_class_name('mk-ws-anchor');
            dots.clip_to_allocation = false;
            dots.set_width(-1);
        } catch {}                 // (already gone with its extension)
    }

    _queueOrder() {
        if (this._orderIdle || this._barGone)
            return;
        this._orderIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._orderIdle = 0;
            this._orderLeft();
            return GLib.SOURCE_REMOVE;
        });
    }

    _orderLeft() {
        if (this._barGone)
            return;
        const left = Main.panel._leftBox, area = Main.panel.statusArea;
        this._divider ??= new St.Widget({style_class: 'mk-island-divider', y_align: Clutter.ActorAlign.CENTER});
        if (!this._divider.get_parent())
            left.add_child(this._divider);
        // the emblem (WACK Shell's menu), Places, a divider, the workspace dots, then the app (or "WS 2")
        // (the dots: WACK Shell's workspace button when it's on, GNOME's own otherwise)
        const dotsItem = area['wack-workspace-button'] ?? area.activities;
        // the logo: WACK Shell's when it shows one, MK's otherwise (never both)
        // (and never two Finders, Places or app pills: WACK Sonoma Live Lockscreen's own top bar
        // pieces, when it shows them, win over the engine's; it hides GNOME's Places itself)
        const shown = name => area[name] && area[name].container.get_parent() === left;
        const wack = area['wack-logo-menu'];
        if (area['mk-logo'])
            area['mk-logo'].container.visible = !shown('wack-finder') &&
                !(wack && wack.container.get_parent() === left && wack.visible);
        // (the suite owns the app indicator: with its own switched off, there's none at all)
        if (area['mk-active-app'])
            area['mk-active-app'].container.visible = !shown('wack-app-indicator') && !isActive(UNIFIED);
        const order = [area['wack-finder']?.container, area['mk-logo']?.container, area['wack-logo-menu']?.container,
            this._divider, area['wack-places']?.container, area['places-menu']?.container,
            area['wack-workspace-button']?.container, area.activities?.container,
            area['wack-app-indicator']?.container, area['mk-active-app']?.container]
            .filter(a => a && a.get_parent() === left);
        order.forEach((actor, i) => left.set_child_at_index(actor, i));
        // the divider sits inside the brand island, between the logo and Places (when both show)
        const placesShown = ['wack-places', 'places-menu'].some(n => shown(n) && area[n].container.visible);
        const logoShown = ['wack-finder', 'mk-logo', 'wack-logo-menu'].some(n => shown(n) && area[n].container.visible);
        this._divider.visible = placesShown && logoShown;
        this._islands?.queue();
        // the dots sit in a slot of their own size (64 px for WACK's button): the active dot morphs inside it, the
        // capsule never moves (it shifted while swiping between workspaces)
        const dots = dotsItem;
        if (this._dots && this._dots !== dots)
            this._unanchor(this._dots);
        this._dots = dots;
        if (dots && !dots.has_style_class_name('mk-ws-anchor')) {
            dots.add_style_class_name('mk-ws-anchor');
            dots.clip_to_allocation = true;
            dots.set_width(64);                 // (a panel button sizes itself; GNOME's dots resize it to fit)
            this._tintDots(dots);
        }
    }

    _teardown() {
        if (!this._barGone) {
            for (const id of [this._leftId, this._leftGoneId, this._leftDeadId].filter(Boolean))
                Main.panel._leftBox.disconnect(id);
        }
        this._leftId = this._leftGoneId = this._leftDeadId = 0;
        if (this._orderIdle)
            GLib.source_remove(this._orderIdle);
        this._orderIdle = 0;
        this._islands?.destroy();
        this._islands = null;
        this._divider?.destroy();
        this._divider = null;
        if (this._dots)
            this._unanchor(this._dots);
        this._dots = null;
        this._tray?.destroy();
        this._quiet?.destroy();
        this._battery?.destroy();
        this._glassMenus?.destroy();
        this._glassMenus = null;
        this._logo?.destroy();
        this._tray = this._quiet = this._battery = this._logo = null;
        Main.panel.remove_style_class_name('mk-islands');
        Main.panel.remove_style_class_name('mk-clear');
        Main.panel.remove_style_class_name('mk-edge');
        for (const off of this._unblur ?? [])
            off();
        this._unblur = null;
        this._app?.destroy();
        this._clock?.destroy();
        this._autohide?.destroy();
        this._app = this._clock = this._autohide = null;
    }

    _rebuild() {
        this._teardown();
        this._build();
    }

    destroy() {
        this._unwatch();
        for (const id of this._ids)
            this._settings.disconnect(id);
        this._teardown();
    }
}
