// MK Shell Engine: Quick Settings as a bento grid. GNOME's menu, its toggles
// and sliders stay as they are (and whatever other extensions add to it); the
// engine restyles them: a wider menu so no toggle title is cut short, rounded
// dark cards that light up in your accent colour when on, thicker slider
// tracks, and frosted glass over what's behind while it's open. All the look
// is in stylesheet.css under .mk-bento, so switching the engine off restores
// GNOME's at once.
//
// It also leaves out what you rarely need there (qs-hidden): by default Dark
// Style and the Welcome light toggle (never the battery: GNOME shows the top
// bar's battery icon only while that tile is there), so the toggles are a clean 2 x 4: Wi-Fi,
// Bluetooth, Power Mode, Night Light, Do Not Disturb, Airplane Mode, Microphone
// (the engine's own) and Caffeine (when installed), in that order. Screenshots have their keys:
// Super+Shift+S, Print, Super+Print.
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

// The grid's order, two by two: Wi-Fi, Bluetooth / Power Mode, Night Light /
// Do Not Disturb, Airplane Mode / Microphone, Caffeine. (What else is there
// follows; whatever isn't there is skipped.)
const ORDER = ['NMWirelessToggle', 'BluetoothToggle', 'PowerProfilesToggle', 'NightLightToggle',
    'DoNotDisturbToggle', 'RfkillToggle', 'MkMicToggle', 'CaffeineToggle'];

// Microphone: on = listening; off mutes the default input (the same mute as Settings).
const MicToggle = GObject.registerClass({GTypeName: 'MkMicToggle'}, class MicToggle extends QuickToggle {
    constructor() {
        super({title: 'Microphone', iconName: 'audio-input-microphone-symbolic', toggleMode: true});
        this._control = getMixerControl();
        this._controlId = this._control.connect('default-source-changed', () => this._follow());
        this._stateId = this._control.connect('state-changed', () => this._follow());
        this.connect('clicked', () => this._stream?.change_is_muted(!this.checked));
        this._follow();
    }

    _follow() {
        if (this._muteId)
            this._stream.disconnect(this._muteId);
        this._muteId = 0;
        this._stream = this._control.get_default_source();
        this.reactive = !!this._stream;
        if (this._stream)
            this._muteId = this._stream.connect('notify::is-muted', () => this._sync());
        this._sync();
    }

    _sync() {
        const on = !!this._stream && !this._stream.is_muted;
        this.checked = on;
        this.subtitle = !this._stream ? 'None' : on ? 'On' : 'Muted';
        this.iconName = on ? 'audio-input-microphone-symbolic' : 'microphone-disabled-symbolic';
    }

    destroy() {
        if (this._muteId)
            this._stream.disconnect(this._muteId);
        this._control.disconnect(this._controlId);
        this._control.disconnect(this._stateId);
        super.destroy();
    }
});

const QS_GLASS = {sigma: 52, brightness: 0.56};

// name in qs-hidden -> the item in GNOME's (or MK's) Quick Settings
const ITEMS = {
    'dark-style': qs => qs._darkMode?.quickSettingsItems?.[0],
    'airplane-mode': qs => qs._rfkill?.quickSettingsItems?.[0],
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
        // Rapid open / close: GNOME's close() stops the animation under way before it
        // reverses, its open() doesn't, so reopening mid-close could leave two eases
        // fighting (a blank, see-through panel). This menu's open() stops it first.
        const pointer = this._qs.menu._boxPointer;
        if (pointer && !pointer._mkOpen) {
            pointer._mkOpen = pointer.open;
            pointer.open = function (...args) {
                this.remove_all_transitions();
                return this._mkOpen(...args);
            };
            this._pointer = pointer;
        }
        this._ids = [
            [settings, settings.connect('changed::qs-hidden', () => this._prune())],
            [this._qs.menu, this._qs.menu.connect('open-state-changed', (_m, open) => this._glass(open))],
        ];
        // GNOME adds its toggles a moment after startup, and other extensions add theirs
        // whenever they start: prune again as items join the grid
        const grid = this._qs.menu._grid;
        if (grid)
            this._ids.push([grid, grid.connect('child-added', () => this._queuePrune())]);
        // the microphone toggle (a quick-settings indicator of its own, no top bar icon)
        try {
            this._mic = new SystemIndicator();
            this._mic.quickSettingsItems.push(new MicToggle());
            this._qs.addExternalIndicator(this._mic);
        } catch (e) {
            console.warn(`mk-shell-engine: microphone toggle: ${e.message}`);
            this._mic = null;
        }
        this._prune();
    }

    // the toggles in ORDER, where the first of them was (sliders and the rest stay put)
    _order() {
        const grid = this._qs.menu._grid;
        if (!grid)
            return;
        const kids = grid.get_children();
        const named = ORDER.map(name => kids.find(c => c.constructor.name === name ||
            c.constructor.$gtype?.name === name || c.get_children?.().some(k => k.constructor.name === name)))
            .filter(Boolean);
        if (!named.length)
            return;
        const start = Math.min(...named.map(c => kids.indexOf(c)));
        named.forEach((child, i) => {
            if (grid.get_child_at_index(start + i) !== child)
                grid.set_child_at_index(child, start + i);
        });
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
            this._order();
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
        if (this._mic) {
            this._mic.quickSettingsItems.forEach(item => item.destroy());
            this._mic.destroy();
        }
        if (this._pointer) {
            this._pointer.open = this._pointer._mkOpen;
            delete this._pointer._mkOpen;
        }
        this._restore();
        this._original.clear();
        this._box.remove_style_class_name('mk-bento');
    }
}
