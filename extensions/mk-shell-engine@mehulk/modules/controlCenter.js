// MK Shell Engine: Quick Settings as a bento grid. GNOME's menu, its toggles
// and sliders stay as they are (and whatever other extensions add to it); the
// engine restyles them: a wider menu so no toggle title is cut short, rounded
// dark cards that light up in your accent colour when on, thicker slider
// tracks, and frosted glass over what's behind while it's open. All the look
// is in stylesheet.css under .mk-bento, so switching the engine off restores
// GNOME's at once.
//
// It also leaves out what you rarely need there (qs-hidden): by default Dark
// Style, Airplane Mode and the Welcome light toggle, and the battery reading
// in the header (the top bar already shows it), so the toggles are a clean
// 2 x 4: Wi-Fi, Bluetooth, Power Mode, Night Light, Do Not Disturb, Caffeine,
// and two the engine adds: Screenshot and Screen Record (they open GNOME's
// screenshot tool, set to a picture or to recording).
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

const QS_GLASS = {sigma: 52, brightness: 0.56};

// name in qs-hidden -> the item in GNOME's (or MK's) Quick Settings
const ITEMS = {
    'dark-style': qs => qs._darkMode?.quickSettingsItems?.[0],
    'airplane-mode': qs => qs._rfkill?.quickSettingsItems?.[0],
    'battery': qs => qs._system?._systemItem?._powerToggle,
    'welcome-light': qs => qs.menu._grid?.get_children().find(c => c.constructor.name.includes('WelcomeToggle')),
};

export class ControlCenter {
    constructor(settings) {
        this._settings = settings;
        this._qs = Main.panel.statusArea.quickSettings;
        this._box = this._qs?.menu?.box;
        if (!this._box)
            throw new Error('no Quick Settings menu');
        this._box.add_style_class_name('mk-bento');
        this._hidden = [];
        this._original = new Map();     // each item's own visibility, from before the engine hid it
        this._ids = [
            [settings, settings.connect('changed::qs-hidden', () => this._prune())],
            [this._qs.menu, this._qs.menu.connect('open-state-changed', (_m, open) => this._glass(open))],
        ];
        // GNOME adds its toggles a moment after startup, and other extensions add theirs
        // whenever they start: prune again as items join the grid
        const grid = this._qs.menu._grid;
        if (grid)
            this._ids.push([grid, grid.connect('child-added', () => this._queuePrune())]);
        this._prune();
        this._addCaptureToggles();
    }

    // Screenshot and Screen Record, as two tiles (GNOME's screenshot tool: 0 picture, 1 recording)
    _addCaptureToggles() {
        this._capture = new QuickSettings.SystemIndicator();
        for (const [title, icon, mode] of [['Screenshot', 'camera-photo-symbolic', 0],
            ['Screen Record', 'media-record-symbolic', 1]]) {
            const toggle = new QuickSettings.QuickToggle({title, iconName: icon, toggleMode: false});
            toggle.connect('clicked', () => {
                this._qs.menu.close();
                // (after the menu has gone, so it isn't in the picture)
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                    Main.screenshotUI.open(mode).catch?.(e => console.warn(`mk-shell-engine: ${title}: ${e.message}`));
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._capture.quickSettingsItems.push(toggle);
        }
        this._qs.addExternalIndicator(this._capture);
    }

    _prune() {
        this._restore();
        for (const name of this._settings.get_strv('qs-hidden')) {
            const item = ITEMS[name]?.(this._qs);
            if (!item)
                continue;
            if (!this._original.has(item))
                this._original.set(item, item.visible);
            item.visible = false;
            // (GNOME shows some of these again by itself when their state changes)
            const id = item.connect('notify::visible', () => item.visible && (item.visible = false));
            this._hidden.push([item, id]);
        }
    }

    _queuePrune() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._prune();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restore() {
        for (const [item, id] of this._hidden) {
            item.disconnect(id);
            item.visible = this._original.get(item) ?? true;
        }
        this._hidden = [];
    }

    // frosted glass over what's behind (windows too) while the menu is open
    _glass(open) {
        this._unglass?.();
        this._unglass = null;
        if (open)
            this._unglass = addWallpaperGlass(this._box, this._qs.menu.actor, QS_GLASS, 26, desktopCopy);
    }

    destroy() {
        if (this._idle)
            GLib.source_remove(this._idle);
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._unglass?.();
        if (this._capture) {
            this._capture.quickSettingsItems.forEach(item => item.destroy());
            this._capture.destroy();
        }
        this._restore();
        this._original.clear();
        this._box.remove_style_class_name('mk-bento');
    }
}
