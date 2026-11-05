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
// switches the app button off. Everything else stays GNOME's own.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GnomeDesktop from 'gi://GnomeDesktop';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PANEL_GLASS, addGlass, blurAllowed } from './blur.js';
import { partRect } from './tiling.js';
import { watch } from './conflicts.js';

const ISLAND_RADIUS = 12;

// The focused app: icon, name, and a menu of what you can do with its window.
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
        this._focusId = this._tracker.connect('notify::focus-app', () => this._sync(true));
        this._overviewIds = [Main.overview.connect('showing', () => this._sync(false)),
            Main.overview.connect('hiding', () => this._sync(false))];
        this.button.menu.connect('open-state-changed', (_m, open) => open && this._fillMenu());
        this._sync(false);
    }

    _sync(animate) {
        const app = Main.overview.visible ? null : this._tracker.focus_app;
        this.button.visible = !!app;
        if (!app || app === this._app)
            return;
        this._app = app;
        const icon = app.create_icon_texture(18);
        icon.style = '-st-icon-style: requested;';           // the app's real colours
        this._iconBin.set_child(icon);
        this._label.text = app.get_name();
        if (animate && St.Settings.get().enable_animations) {
            this._box.remove_all_transitions();
            this._box.opacity = 0;
            this._box.translation_y = 6;
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
        if (!app)
            return;
        const win = this._window();
        menu.addAction('New Window', () => app.open_new_window(-1));
        if (win) {
            const snap = part => {
                const area = win.get_work_area_current_monitor();
                const r = partRect(area, part);
                if (win.is_maximized?.())
                    win.unmaximize?.();
                win.move_resize_frame(true, r.x, r.y, r.width, r.height);
            };
            menu.addAction('Snap Left', () => snap([0, 0, 0.5, 1]));
            menu.addAction('Snap Right', () => snap([0.5, 0, 0.5, 1]));
            const onTop = new PopupMenu.PopupSwitchMenuItem('Keep on Top', win.is_above());
            onTop.connect('toggled', (_i, state) => state ? win.make_above() : win.unmake_above());
            menu.addMenuItem(onTop);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(`Quit ${app.get_name()}`, () => app.request_quit());
    }

    destroy() {
        this._tracker.disconnect(this._focusId);
        for (const id of this._overviewIds)
            Main.overview.disconnect(id);
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

export class Panel {
    constructor(settings) {
        this._settings = settings;
        this._parts = [];
        this._ids = ['changed::top-bar-style', 'changed::show-active-app', 'changed::blur'].map(
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
            this._unblur = glass.map(actor => addGlass(actor, PANEL_GLASS, style === 'edge' ? 0 : ISLAND_RADIUS));
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
            this._clock = new Clock();
        } catch (e) {
            console.error(`mk-shell-engine: clock: ${e.message}`);
        }
    }

    _teardown() {
        Main.panel.remove_style_class_name('mk-islands');
        Main.panel.remove_style_class_name('mk-edge');
        for (const off of this._unblur ?? [])
            off();
        this._unblur = null;
        this._app?.destroy();
        this._clock?.destroy();
        this._app = this._clock = null;
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
