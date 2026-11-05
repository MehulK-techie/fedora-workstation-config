// MK Shell Engine: the top bar as three floating glass islands. GNOME's bar
// keeps its three groups (left, centre, right) and everything in them; the
// engine only turns the bar itself clear and gives each group its own
// rounded, blurred island. Plus two things GNOME's bar doesn't have:
//   - the app you're using, in its own colours (never a grey symbolic icon),
//     with its name; a click opens New Window, Snap Left / Right, Keep on Top,
//     Quit. It slides in (150 ms) when you switch apps.
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
import { PANEL_GLASS, addWallpaperGlass, blurAllowed } from './blur.js';
import { partRect, place } from './tiling.js';
import { watch } from './conflicts.js';

const ISLAND_RADIUS = 12;            // (the islands' CSS corners; the glass is cut to match)

// The focused app: icon (its own colours), name, and a menu of what you can do
// with its window. With nothing focused it reads "Desktop · WS 2" instead of
// vanishing; switching crossfades (150 ms).
class ActiveApp {
    constructor() {
        this.button = new PanelMenu.Button(0.0, 'Active app', false);
        this.button.add_style_class_name('mk-active-app');
        this._box = new St.BoxLayout({style_class: 'mk-active-app-box', y_align: Clutter.ActorAlign.CENTER});
        this._iconBin = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'mk-active-app-name', y_align: Clutter.ActorAlign.CENTER});
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
        this._sync(false);
    }

    _sync(animate) {
        this.button.visible = !Main.overview.visible;
        const app = this._tracker.focus_app;
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
            icon = new St.Icon({icon_name: 'user-desktop-symbolic', icon_size: 16});
        }
        this._iconBin.set_child(icon);
        this._label.text = app ? app.get_name() : `Desktop · WS ${ws}`;
        if (animate && St.Settings.get().enable_animations) {
            this._box.remove_all_transitions();
            this._box.opacity = 0;
            this._box.translation_y = 4;
            this._box.ease({opacity: 255, translation_y: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
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
        menu.addAction('New Window', () => app.open_new_window(-1));
        if (win) {
            const to = part => place(win, partRect(win.get_work_area_current_monitor(), part));
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            menu.addAction('Split Left', () => to([0, 0, 0.5, 1]));
            menu.addAction('Split Right', () => to([0.5, 0, 0.5, 1]));
            menu.addAction('Center Stage', () => to([0.1, 0.05, 0.8, 0.9]));
            const onTop = new PopupMenu.PopupSwitchMenuItem('Pin on Top', win.is_above());
            onTop.connect('toggled', (_i, state) => state ? win.make_above() : win.unmake_above());
            menu.addMenuItem(onTop);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(`Quit ${app.get_name()}`, () => app.request_quit());
    }

    destroy() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this.button.destroy();
    }
}

// Finder: your folders in one click (they open in Files).
class Finder {
    constructor() {
        this.button = new PanelMenu.Button(0.0, 'Finder', false);
        this.button.add_style_class_name('mk-finder');
        this.button.add_child(new St.Label({text: 'Finder', style_class: 'mk-finder-label', y_align: Clutter.ActorAlign.CENTER}));
        const home = GLib.get_home_dir();
        const dir = d => GLib.get_user_special_dir(d);
        const places = [
            ['Home', 'user-home-symbolic', home],
            ['Desktop', 'user-desktop-symbolic', dir(GLib.UserDirectory.DIRECTORY_DESKTOP)],
            ['Downloads', 'folder-download-symbolic', dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)],
            ['Documents', 'folder-documents-symbolic', dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS)],
            ['Pictures', 'folder-pictures-symbolic', dir(GLib.UserDirectory.DIRECTORY_PICTURES)],
            ['Projects', 'folder-symbolic', GLib.build_filenamev([home, 'Projects'])],
        ];
        for (const [label, icon, path] of places) {
            if (path && GLib.file_test(path, GLib.FileTest.IS_DIR))
                this.button.menu.addAction(label, () => open(`file://${path}`), icon);
        }
        this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.button.menu.addAction('Recent', () => open('recent:///'), 'document-open-recent-symbolic');
        this.button.menu.addAction('Trash', () => open('trash:///'), 'user-trash-symbolic');
        function open(uri) {
            try {
                Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
            } catch (e) {
                Main.notify('Finder', e.message);
            }
        }
    }

    destroy() {
        this.button.destroy();
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

export class Panel {
    constructor(settings) {
        this._settings = settings;
        this._parts = [];
        this._ids = ['changed::top-bar-style', 'changed::show-active-app', 'changed::blur', 'changed::autohide-top-bar'].map(
            signal => settings.connect(signal, () => this._rebuild()));
        this._unwatch = watch(() => this._rebuild());        // Blur my Shell on or off
        this._build();
    }

    _build() {
        const panel = Main.panel;
        const style = this._settings.get_string('top-bar-style');
        panel.add_style_class_name(style === 'edge' ? 'mk-edge' : 'mk-islands');
        if (blurAllowed(this._settings)) {
            const glass = style === 'edge' ? [panel] : [panel._leftBox, panel._centerBox, panel._rightBox];
            this._unblur = glass.map(actor => addWallpaperGlass(actor, Main.layoutManager.panelBox, PANEL_GLASS,
                style === 'edge' ? 0 : ISLAND_RADIUS));
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
            this._finder = new Finder();
            panel.addToStatusArea('mk-finder', this._finder.button, 0, 'left');
        } catch (e) {
            console.error(`mk-shell-engine: finder: ${e.message}`);
        }
        try {
            this._tray = new TrayFold(this._settings);
        } catch (e) {
            console.error(`mk-shell-engine: tray fold: ${e.message}`);
        }
        this._orderLeft();
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

    // The left island, flush to the corner: the MK emblem, Finder, Places, the
    // workspace dots, a divider, the app you're in (Fitts's law: the most used
    // things at the screen's edge, where the pointer stops by itself).
    _orderLeft() {
        const left = Main.panel._leftBox, area = Main.panel.statusArea;
        const mk = Main.extensionManager.lookup('mk-indicator@mehulk')?.stateObj?._indicator;
        if (mk && mk.get_parent() && mk.get_parent() !== left) {
            this._mkHome = [mk.get_parent(), mk.get_parent().get_children().indexOf(mk)];
            mk.get_parent().remove_child(mk);
            left.insert_child_at_index(mk, 0);
            this._mk = mk;
        }
        this._divider ??= new St.Widget({style_class: 'mk-island-divider', y_align: Clutter.ActorAlign.CENTER});
        if (!this._divider.get_parent())
            left.add_child(this._divider);
        const order = [this._mk ?? (mk?.get_parent() === left ? mk : null), area['mk-finder']?.container,
            area['places-menu']?.container, area.activities?.container, this._divider, area['mk-active-app']?.container]
            .filter(a => a && a.get_parent() === left);
        order.forEach((actor, i) => left.set_child_at_index(actor, i));
        this._divider.visible = !!area['mk-active-app'];
    }

    _teardown() {
        if (this._mk && this._mkHome && this._mk.get_parent()) {         // the MK emblem goes back where it was
            const [home, index] = this._mkHome;
            this._mk.get_parent().remove_child(this._mk);
            home.insert_child_at_index(this._mk, Math.min(index, home.get_n_children()));
        }
        this._mk = this._mkHome = null;
        this._divider?.destroy();
        this._divider = null;
        this._finder?.destroy();
        this._tray?.destroy();
        this._finder = this._tray = null;
        Main.panel.remove_style_class_name('mk-islands');
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
