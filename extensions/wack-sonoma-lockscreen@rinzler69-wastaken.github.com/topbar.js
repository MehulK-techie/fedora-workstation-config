// MK: the left of the top bar, in the user session only (gone while locked):
//   [Fedora + Finder] [Places] [divider] [workspace dots] [App Indicator]
//   Finder         the system menu: a row of power buttons (Shut Down, Restart,
//                  Hibernate, Sleep, Lock, Log Out), then About This System,
//                  System Settings, App Store, Extension Settings, System
//                  Monitor. Logo presets: fedora-blue (Fedora's own logo, in its
//                  #51a2da), fedora-mono, mk, apple, custom, none.
//   Places         an icon (a label with places-show-text): Home, Desktop,
//                  Documents, Downloads, Music, Pictures, Videos, Trash (full or
//                  empty, live), Network, and Recent Files (GTK's list,
//                  ~/.local/share/recently-used.xbel: GTK itself can't load in
//                  the shell, so it's read with GLib.BookmarkFile).
//   App Indicator  the focused app: a 24 px pill, its 16 px icon and bold name
//                  (180 px at most), crossfading with a 4 px slide (110 ms) as
//                  focus moves. Menu: New Window, Hide, Maximize, Close, Quit.
// Never two of anything: MK Shell Engine hides its own Finder and app pill while
// these show (and puts them in this order, with its divider); GNOME's Places
// extension's button is hidden while this one shows, and back when it goes.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { hibernate, sleep } from './power.js';

const FINDER_KEYS = ['finder-logo-preset', 'finder-custom-logo', 'finder-show-label', 'finder-label', 'finder-icon-size',
    'finder-logo-circular'];
const GNOME_PLACES = 'places-menu';

function launchUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notify('Places', e.message);
    }
}

function run(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        Main.notify('Finder', e.message);
    }
}

function launchApp(...ids) {
    const app = ids.map(id => Shell.AppSystem.get_default().lookup_app(id)).find(Boolean);
    if (app)
        app.activate();
    else
        Main.notify('Finder', `Not installed: ${ids[0].replace(/\.desktop$/, '')}`);
}

// ----- Finder
class Finder {
    constructor(settings, extension) {
        this._settings = settings;
        this._extension = extension;
        this.button = new PanelMenu.Button(0.5, 'Finder', false);
        this.button.add_style_class_name('wack-finder');
        const box = new St.BoxLayout({style_class: 'wack-finder-box', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'wack-finder-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._label);
        this.button.add_child(box);
        this.button.menu.actor.add_style_class_name('wack-topbar-menu');
        this._ids = FINDER_KEYS.map(k => settings.connect(`changed::${k}`, () => this._sync()));
        this._ids.push(settings.connect('changed::show-hibernate', () => this._fill()));
        this._fill();
        this._sync();
    }

    _logo() {
        const preset = this._settings.get_string('finder-logo-preset');
        const icons = this._extension.dir.get_child('icons');
        const size = this._settings.get_int('finder-icon-size');
        const themed = name => new St.Icon({icon_name: name, icon_size: size, style_class: 'wack-finder-icon'});
        const file = gfile => new St.Icon({gicon: Gio.FileIcon.new(gfile), icon_size: size, style_class: 'wack-finder-icon'});
        switch (preset) {
        case 'none':
            return null;
        case 'apple':
            return file(icons.get_child('mk-apple-symbolic.svg'));
        case 'mk':
            return file(icons.get_child('mk-emblem-symbolic.svg'));
        case 'custom': {
            const path = this._settings.get_string('finder-custom-logo').replace(/^~(?=\/)/, GLib.get_home_dir());
            if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS))
                return themed('image-missing-symbolic');
            // a photo or picture: a round avatar filling the circle (an SVG glyph stays as drawn)
            if (this._settings.get_boolean('finder-logo-circular') && !/\.svg$/i.test(path)) {
                const uri = Gio.File.new_for_path(path).get_uri().replace(/["\\]/g, c => `\\${c}`);
                return new St.Bin({style_class: 'wack-finder-round', width: size, height: size,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `background-image: url("${uri}"); background-size: cover; background-position: center; ` +
                        `border-radius: ${size / 2}px;`});
            }
            return file(Gio.File.new_for_path(path));
        }
        case 'fedora-mono': {
            // Fedora's logo as a white glyph: no colour, lifted toward the bar's text
            const icon = themed('fedora-logo-icon');
            icon.add_effect(new Clutter.DesaturateEffect({factor: 1.0}));
            const lift = new Clutter.BrightnessContrastEffect();
            lift.set_brightness(0.45);
            icon.add_effect(lift);
            return icon;
        }
        default:
            return themed('fedora-logo-icon');      // Fedora's own logo, in its blue (#51a2da)
        }
    }

    _sync() {
        this._icon.set_child(this._logo());
        const text = this._settings.get_string('finder-label');
        this._label.text = text;
        this._label.visible = this._settings.get_boolean('finder-show-label') && text !== '';
        this.button.accessible_name = text || 'Finder';
    }

    _fill() {
        const menu = this.button.menu, actions = SystemActions.getDefault(), s = this._settings;
        menu.removeAll();
        menu.box.add_style_class_name('wack-finder-menu');
        this._accels = [];
        // a plain list, as on a Mac's  menu; each row shows its keyboard shortcut (live) on the right
        const row = (label, act, shortcut = null) => {
            const item = menu.addAction(label, act);
            if (shortcut) {
                const accel = new St.Label({style_class: 'wack-finder-accel', x_expand: true,
                    x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
                item.add_child(accel);
                this._accels.push([accel, shortcut]);
            }
            return item;
        };
        row('About This Workstation', () => launchApp('gnome-system-panel.desktop', 'org.gnome.Settings.desktop'));
        row('MK Command Centre…', () => run([GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-control-center'])]),
            {command: /mk-c(enter|ontrol-center)\b/});
        row('System Settings…', () => launchApp('org.gnome.Settings.desktop'), {media: 'control-center'});
        row('App Store…', () => launchApp('org.gnome.Software.desktop'));
        row('Extension Settings…', () => launchApp('com.mattjakeman.ExtensionManager.desktop', 'org.gnome.Extensions.desktop'));
        row('System Monitor', () => launchApp('org.gnome.SystemMonitor.desktop', 'gnome-system-monitor.desktop',
            'io.missioncenter.MissionCenter.desktop'), {command: /gnome-system-monitor|missioncenter/});
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        row('Sleep', () => sleep(s), {command: /systemctl suspend|loginctl suspend/});
        if (s.get_boolean('show-hibernate'))
            row('Hibernate', () => hibernate(), {command: /mk-hibernate|systemctl hibernate/});
        row('Restart…', () => actions.activateRestart(), {command: /--reboot\b/, media: 'reboot'});
        row('Shut Down…', () => actions.activatePowerOff(), {command: /--power-off\b/, media: 'power'});
        row('Log Out…', () => actions.activateLogout(), {media: 'logout'});
        this._shortcuts ??= new Shortcuts(() => this._syncAccels());
        this._syncAccels();
    }

    _syncAccels() {
        for (const [label, want] of this._accels ?? []) {
            const accel = this._shortcuts.find(want);
            label.text = accel ? formatAccel(accel) : '';
            label.visible = label.text !== '';
        }
    }

    destroy() {
        this._ids.forEach(id => this._settings.disconnect(id));
        this._shortcuts?.destroy();
        this.button.destroy();
    }
}

// The keyboard shortcuts GNOME and MK set for the Finder's actions: GNOME's own media keys
// (Settings, Log Out, Power Off...) and the custom shortcuts (found by their command: System
// Monitor, Sleep, Restart, Shut Down...). ONCHANGE runs whenever any of them changes, so the
// labels in the menu always show what the keys really are.
const MEDIA = 'org.gnome.settings-daemon.plugins.media-keys';

class Shortcuts {
    constructor(onChange) {
        this._onChange = onChange;
        this._media = new Gio.Settings({schema_id: MEDIA});
        this._mediaId = this._media.connect('changed', (_s, key) => {
            if (key === 'custom-keybindings')
                this._watchCustom();
            this._onChange();
        });
        this._custom = [];
        this._watchCustom();
    }

    _watchCustom() {
        for (const [settings, id] of this._custom)
            settings.disconnect(id);
        this._custom = this._media.get_strv('custom-keybindings').map(path => {
            const settings = new Gio.Settings({schema_id: `${MEDIA}.custom-keybinding`, path});
            return [settings, settings.connect('changed', () => this._onChange())];
        });
    }

    // the first shortcut for WANT ({media: key} and / or {command: RegExp}), or null
    find(want) {
        if (want.media) {
            try {
                const keys = this._media.get_strv(want.media).filter(Boolean);
                if (keys.length)
                    return keys[0];
            } catch {}                        // (a key this GNOME doesn't have)
        }
        if (want.command) {
            for (const [settings] of this._custom) {
                if (want.command.test(settings.get_string('command')) && settings.get_string('binding'))
                    return settings.get_string('binding');
            }
        }
        return null;
    }

    destroy() {
        this._media.disconnect(this._mediaId);
        for (const [settings, id] of this._custom)
            settings.disconnect(id);
        this._custom = [];
    }
}

// "<Control><Alt>Delete" -> "Ctrl + Alt + Del", "<Super>comma" -> "Super + ,"
const KEY_NAMES = {comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', minus: '-', equal: '=',
    space: 'Space', Return: 'Enter', Escape: 'Esc', Delete: 'Del', BackSpace: 'Backspace', Page_Down: 'PgDn',
    Page_Up: 'PgUp', Left: '←', Right: '→', Up: '↑', Down: '↓', Print: 'PrtSc', Tab: 'Tab'};
export function formatAccel(accel) {
    const mods = [...accel.matchAll(/<(\w+)>/g)].map(m => ({Control: 'Ctrl', Primary: 'Ctrl', Alt: 'Alt', Shift: 'Shift',
        Super: 'Super', Meta: 'Super'})[m[1]] ?? m[1]);
    const key = accel.replace(/<\w+>/g, '');
    const name = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    return [...mods, name].join(' + ');
}

// ----- Places
const FOLDERS = [
    ['Home', 'user-home-symbolic', () => GLib.get_home_dir()],
    ['Desktop', 'user-desktop-symbolic', () => GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP)],
    ['Documents', 'folder-documents-symbolic', () => GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS)],
    ['Downloads', 'folder-download-symbolic', () => GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)],
    ['Music', 'folder-music-symbolic', () => GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC)],
    ['Pictures', 'folder-pictures-symbolic', () => GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)],
    ['Videos', 'folder-videos-symbolic', () => GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS)],
];
const RECENT = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const RECENT_MAX = 8;

class Places {
    constructor(settings) {
        this._settings = settings;
        this.button = new PanelMenu.Button(0.5, 'Places', false);
        this.button.add_style_class_name('wack-places');
        const box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, style_class: 'wack-places-box'});
        box.add_child(new St.Icon({icon_name: 'folder-symbolic', icon_size: 16, style_class: 'system-status-icon'}));
        this._label = new St.Label({text: 'Places', y_align: Clutter.ActorAlign.CENTER, style_class: 'wack-places-label'});
        box.add_child(this._label);
        this.button.add_child(box);
        this.button.menu.actor.add_style_class_name('wack-topbar-menu');
        this._textId = settings.connect('changed::places-show-text', () => this._syncLabel());
        this._syncLabel();

        const menu = this.button.menu;
        for (const [name, icon, path] of FOLDERS) {
            const item = menu.addAction(name, () => launchUri(Gio.File.new_for_path(path() ?? GLib.get_home_dir()).get_uri()),
                icon);
            item._wackPath = path;
        }
        this._trash = menu.addAction('Trash', () => launchUri('trash:///'), 'user-trash-symbolic');
        menu.addAction('Network', () => launchUri('network:///'), 'network-workgroup-symbolic');
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._recent = new PopupMenu.PopupSubMenuMenuItem('Recent Files', true);
        this._recent.icon.icon_name = 'document-open-recent-symbolic';
        menu.addMenuItem(this._recent);
        this._openId = menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._fillRecent();
        });

        // the trash, full or empty, as it changes
        try {
            this._trashFile = Gio.File.new_for_uri('trash:///');
            this._trashMonitor = this._trashFile.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._trashMonitor.connect('changed', () => this._syncTrash());
        } catch {}
        this._syncTrash();
    }

    _syncLabel() {
        this._label.visible = this._settings.get_boolean('places-show-text');
    }

    _syncTrash() {
        if (!this._trashFile)
            return;
        this._trashFile.query_info_async('trash::item-count', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
            (f, res) => {
                try {
                    const full = f.query_info_finish(res).get_attribute_uint32('trash::item-count') > 0;
                    this._trash?.setIcon(full ? 'user-trash-full-symbolic' : 'user-trash-symbolic');
                } catch {}
            });
    }

    _fillRecent() {
        const sub = this._recent.menu;
        sub.removeAll();
        const files = [];
        try {
            const bookmarks = new GLib.BookmarkFile();
            bookmarks.load_from_file(RECENT);
            for (const uri of bookmarks.get_uris()) {
                if (!uri.startsWith('file://'))
                    continue;
                const file = Gio.File.new_for_uri(uri);
                if (!file.query_exists(null))
                    continue;
                const when = bookmarks.get_modified_date_time(uri)?.to_unix() ?? 0;
                files.push([when, uri, file.get_basename()]);
            }
        } catch {}
        files.sort((a, b) => b[0] - a[0]);
        for (const [, uri, name] of files.slice(0, RECENT_MAX))
            sub.addAction(name, () => launchUri(uri));
        if (!files.length) {
            const none = sub.addAction('No recent files', () => {});
            none.setSensitive(false);
        } else {
            sub.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            sub.addAction('All Recent…', () => launchUri('recent:///'));
        }
    }

    destroy() {
        this._settings.disconnect(this._textId);
        this._trashMonitor?.cancel();
        this._trashMonitor = this._trashFile = this._trash = null;
        this.button.destroy();
    }
}

// ----- the App Indicator
class AppIndicator {
    constructor(settings) {
        this._settings = settings;
        this.button = new PanelMenu.Button(0.0, 'App', false);
        this.button.add_style_class_name('wack-app-indicator');
        // the glass capsule (stays put while the app inside it changes), and what's inside
        this._pill = new St.BoxLayout({style_class: 'wack-app-pill', y_align: Clutter.ActorAlign.CENTER});
        this._pill.set_pivot_point(0.5, 0.5);
        this._inner = new St.BoxLayout({style_class: 'wack-app-inner', y_align: Clutter.ActorAlign.CENTER});
        this._iconBin = new St.Bin({y_align: Clutter.ActorAlign.CENTER, style_class: 'wack-app-icon'});
        this._label = new St.Label({style_class: 'wack-app-name', y_align: Clutter.ActorAlign.CENTER});
        this._label.clutter_text.ellipsize = 3;            // Pango.EllipsizeMode.END
        this._inner.add_child(this._iconBin);
        this._inner.add_child(this._label);
        this._pill.add_child(this._inner);
        this.button.add_child(this._pill);
        this.button.menu.actor.add_style_class_name('wack-topbar-menu');
        this._tracker = Shell.WindowTracker.get_default();
        this._ids = [
            [this._tracker, this._tracker.connect('notify::focus-app', () => this._sync(true))],
            [Main.overview, Main.overview.connect('showing', () => this._sync(false))],
            [Main.overview, Main.overview.connect('hidden', () => this._sync(false))],
        ];
        this.button.menu.connect('open-state-changed', (_m, open) => open && this._fill());
        this.button.connect('destroy', () => (this._gone = true));
        // nothing focused yet: no capsule until an app is
        this._shown = false;
        this.button.visible = false;
        this._pill.opacity = 0;
        this._sync(false);
    }

    get _animate() {
        return St.Settings.get().enable_animations;          // (always on: only GNOME's own switch stops it)
    }

    // An app focused: its icon and name. None (an empty desktop, everything minimized):
    // the capsule fades and shrinks away (180 ms, to 0.94), and grows back with the next app (180 ms);
    // from one app to another only the inside crossfades (110 ms), the capsule stays.
    _sync(animate) {
        if (this._gone)
            return;
        const app = this._tracker.focus_app;
        const want = Boolean(app) && !Main.overview.visible;
        animate = animate && this._animate;
        const changed = app !== this._app;
        this._app = app;
        if (app && changed) {
            const icon = app.create_icon_texture(16);
            icon.style = '-st-icon-style: requested;';      // its own colours
            this._iconBin.set_child(icon);
            this._label.text = app.get_name();
        }
        if (want && !this._shown) {
            this._shown = true;
            this.button.visible = true;
            this._pill.remove_all_transitions();
            this._inner.remove_all_transitions();
            this._inner.set({opacity: 255, translation_y: 0});
            if (animate) {
                this._pill.set({opacity: 0, scale_x: 0.94, scale_y: 0.94});
                this._pill.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            } else {
                this._pill.set({opacity: 255, scale_x: 1, scale_y: 1});
            }
        } else if (!want && this._shown) {
            this._shown = false;
            this._pill.remove_all_transitions();
            if (animate && !Main.overview.visible) {
                this._pill.ease({opacity: 0, scale_x: 0.94, scale_y: 0.94, duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onStopped: done => {
                        if (done && !this._shown && !this._gone)
                            this.button.visible = false;
                    }});
            } else {
                this._pill.set({opacity: 0});
                this.button.visible = false;
            }
        } else if (want && changed && animate) {
            this._inner.remove_all_transitions();
            this._inner.set({opacity: 0, translation_y: 4});
            this._inner.ease({opacity: 255, translation_y: 0, duration: 110, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    _window() {
        const win = global.display.focus_window;
        return win && this._app?.get_windows().includes(win) ? win : this._app?.get_windows()[0] ?? null;
    }

    _fill() {
        const menu = this.button.menu, app = this._app;
        menu.removeAll();
        if (!app)
            return;
        const win = this._window();
        menu.addAction('New Window', () => app.open_new_window(-1));
        menu.addAction(`Hide ${app.get_name()}`, () => app.get_windows().forEach(w => w.minimize()));
        if (win) {
            const maxed = win.is_maximized();
            menu.addAction(maxed ? 'Restore' : 'Maximize', () => (maxed ? win.unmaximize() : win.maximize()));
            menu.addAction('Close Window', () => win.delete(global.get_current_time()));
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

// ----- the three, in the user session
export class TopBar {
    constructor(settings, extension) {
        this._settings = settings;
        this._extension = extension;
        this._setIds = ['topbar-enabled', 'show-app-indicator'].map(k =>
            settings.connect(`changed::${k}`, () => this._rebuild()));
        this._build();
    }

    _build() {
        if (!this._settings.get_boolean('topbar-enabled'))
            return;
        const panel = Main.panel;
        const mount = (name, make, index) => {
            try {
                const part = make();
                panel.addToStatusArea(name, part.button, index, 'left');
                return part;
            } catch (e) {
                console.error(`wack-sonoma-lockscreen: ${name}: ${e.message}`);
                return null;
            }
        };
        // (each name once: a statusArea name already taken means another copy is up)
        if (!panel.statusArea['wack-finder'])
            this._finder = mount('wack-finder', () => new Finder(this._settings, this._extension), 0);
        if (!panel.statusArea['wack-places'])
            this._places = mount('wack-places', () => new Places(this._settings), 1);
        if (this._settings.get_boolean('show-app-indicator') && !panel.statusArea['wack-app-indicator'])
            this._app = mount('wack-app-indicator', () => new AppIndicator(this._settings), -1);
        // GNOME's Places extension's button stands aside while ours shows (and when it comes back later)
        this._leftId = panel._leftBox.connect('child-added', () => this._hideGnomePlaces());
        this._hideGnomePlaces();
    }

    _hideGnomePlaces() {
        const theirs = Main.panel.statusArea[GNOME_PLACES];
        if (!theirs || !this._places)
            return;
        theirs.container.visible = false;
        this._hidPlaces = theirs;
    }

    _teardown() {
        if (this._leftId)
            Main.panel._leftBox.disconnect(this._leftId);
        this._leftId = 0;
        try {
            if (this._hidPlaces && Main.panel.statusArea[GNOME_PLACES] === this._hidPlaces)
                this._hidPlaces.container.visible = true;
        } catch {}                           // (gone with its extension)
        this._hidPlaces = null;
        for (const part of ['_finder', '_places', '_app']) {
            try {
                this[part]?.destroy();
            } catch (e) {
                console.error(`wack-sonoma-lockscreen: ${e.message}`);
            }
            this[part] = null;
        }
    }

    _rebuild() {
        this._teardown();
        this._build();
    }

    destroy() {
        this._setIds.forEach(id => this._settings.disconnect(id));
        this._teardown();
    }
}

// ----- Hibernate in Quick Settings' power menu, after Suspend
export class QuickSettingsHibernate {
    constructor(settings) {
        this._settings = settings;
        this._id = settings.connect('changed::show-hibernate', () => this._sync());
        this._tries = 0;
        this._sync();
    }

    _sync() {
        this._item?.destroy();
        this._item = null;
        if (!this._settings.get_boolean('show-hibernate'))
            return;
        const menu = Main.panel.statusArea.quickSettings?._system?._systemItem?.menu;
        if (!menu) {
            // (Quick Settings builds its items a moment after the shell starts)
            if (this._tries++ < 20) {
                this._retry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._retry = 0;
                    this._sync();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        this._item = new PopupMenu.PopupMenuItem('Hibernate');
        this._item.add_style_class_name('wack-qs-hibernate');
        this._item.connect('activate', () => {
            Main.panel.closeQuickSettings?.();
            hibernate();
        });
        menu.addMenuItem(this._item, 1);                 // (after Suspend)
    }

    destroy() {
        if (this._retry)
            GLib.source_remove(this._retry);
        this._settings.disconnect(this._id);
        this._item?.destroy();
        this._item = null;
    }
}
