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
// (the engine's own) and Caffeine (when installed), in that order. (The live wallpaper's
// sound needs no tile: it's heard only on the bare desktop; MK Command Centre sets it.)
// The header row keeps the battery and the Settings gear, plus a button for MK Command
// Centre; GNOME's screenshot, lock and power buttons leave it (Lock and power live in the
// Finder menu; screenshots on Print and Super+Shift+S).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickSlider, QuickToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { suiteSettings } from './notifyCenter.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

// The grid's order, two by two: Wi-Fi, Bluetooth / Power Mode, Night Light /
// Do Not Disturb, Airplane Mode / Microphone, Caffeine. (What else is there
// follows; whatever isn't there is skipped.)
const ORDER = ['NMWirelessToggle', 'BluetoothToggle', 'PowerProfilesToggle', 'NightLightToggle',
    'DoNotDisturbToggle', 'RfkillToggle', 'MkMicToggle', 'MkWallpaperBgPlayToggle', 'CaffeineToggle'];
// the header row's buttons that leave (GNOME's own classes)
// (Screenshot, Settings and Lock stay; Shut Down lives in the Finder menu)
const HEADER_GONE = /ShutdownItem/;

// Wallpaper Bg Play: the live wallpaper's sound plays on under your windows and steps aside
// (fades out) while other media plays (the Suite's wallpaper-background-play; its desktop.js)
const BgPlayToggle = GObject.registerClass({GTypeName: 'MkWallpaperBgPlayToggle'}, class BgPlayToggle extends QuickToggle {
    constructor(settings) {
        super({title: 'Wallpaper Bg Play', subtitle: 'Auto-pauses on media', iconName: 'media-playlist-repeat-symbolic',
            toggleMode: true});
        this.accessible_name = 'Wallpaper background play';
        settings.bind('wallpaper-background-play', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
    }
});

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
            const suite = suiteSettings();
            if (suite?.settings_schema.has_key('wallpaper-background-play'))
                this._mic.quickSettingsItems.push(new BgPlayToggle(suite));
            this._qs.addExternalIndicator(this._mic);
        } catch (e) {
            console.warn(`mk-shell-engine: microphone toggle: ${e.message}`);
            this._mic = null;
        }
        this._prune();
        this._header();
        this._wallpaperSlider();
    }

    // The live wallpaper's volume, under the sound and brightness sliders: the speaker mutes and
    // unmutes it (its sound is heard only on the bare desktop anyway). Only with the suite there.
    _wallpaperSlider() {
        const s = suiteSettings();
        const qs = this._qs;
        if (!s || !qs.menu.insertItemBefore)
            return;
        const slider = new QuickSlider({iconName: 'video-display-symbolic', iconReactive: true,
            iconLabel: 'Live wallpaper sound', style_class: 'quick-slider mk-wallpaper-volume'});
        slider.accessible_name = 'Live wallpaper volume';
        const sync = () => {
            const on = s.get_boolean('desktop-audio-enabled');
            this._syncingWall = true;
            slider.slider.value = s.get_double('desktop-audio-volume');
            this._syncingWall = false;
            slider.iconName = on ? 'video-display-symbolic' : 'audio-volume-muted-symbolic';
            slider.slider.opacity = on ? 255 : 120;
        };
        this._wallIds = [
            [s, s.connect('changed::desktop-audio-volume', sync)],
            [s, s.connect('changed::desktop-audio-enabled', sync)],
            [slider.slider, slider.slider.connect('notify::value', () => {
                if (this._syncingWall)
                    return;
                s.set_double('desktop-audio-volume', Math.round(slider.slider.value * 100) / 100);
                if (!s.get_boolean('desktop-audio-enabled'))
                    s.set_boolean('desktop-audio-enabled', true);    // (moving it means you want it)
            })],
            [slider, slider.connect('icon-clicked', () => s.set_boolean('desktop-audio-enabled',
                !s.get_boolean('desktop-audio-enabled')))],
        ];
        sync();
        qs.menu.addItem(slider, 2);
        this._wallSlider = slider;
        this._wallSettings = s;
        // Shown only for a live wallpaper you can hear: its sound on, a video set, and that video
        // with a sound track (the player says so in $XDG_RUNTIME_DIR/mk-live-wallpaper.json).
        // Otherwise Quick Settings keeps just GNOME's own sliders. Decided as the menu opens (and
        // while it's closed), so muting from the slider never pulls it out from under the pointer.
        const state = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_runtime_dir(), 'mk-live-wallpaper.json']));
        this._wallMonitor = state.get_parent().monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._wallState = state;
        const later = () => !qs.menu.isOpen && this._syncWallVisible();
        this._wallIds.push(
            [this._wallMonitor, this._wallMonitor.connect('changed', (_m, file) => file.equal(state) && later())],
            [s, s.connect('changed::desktop-audio-enabled', later)],
            [s, s.connect('changed::desktop-wallpaper-path', later)],
            [qs.menu, qs.menu.connect('open-state-changed', (_m, open) => open && this._syncWallVisible())]);
        this._syncWallVisible();
        // right under the speaker's volume (then the microphone and brightness), again whenever
        // the grid changes: GNOME adds its own sliders a moment after starting up
        const grid = qs.menu._grid;
        this._wallIds.push([grid, grid.connect('child-added', () => this._placeWallSlider())]);
        this._placeWallSlider();
    }

    _syncWallVisible() {
        const s = this._wallSettings, slider = this._wallSlider;
        if (!s || !slider)
            return;
        const path = s.get_string('desktop-wallpaper-path').replace(/^~(?=\/)/, GLib.get_home_dir());
        let audible = false;
        if (s.get_boolean('desktop-audio-enabled') && path) {
            try {
                const [, bytes] = this._wallState.load_contents(null);
                const info = JSON.parse(new TextDecoder().decode(bytes));
                audible = info.path === path && info.audio === true;
            } catch {}                                   // (no player yet: nothing to hear)
        }
        slider.visible = audible;
    }

    _placeWallSlider() {
        const qs = this._qs, slider = this._wallSlider, grid = qs.menu._grid;
        if (!slider || slider.get_parent() !== grid || this._placingWall)
            return;
        const last = [qs._volumeOutput, qs._volumeInput, qs._brightness]
            .map(ind => ind?.quickSettingsItems?.at(-1)).find(item => item?.get_parent() === grid);
        if (!last || last.get_next_sibling() === slider)
            return;
        this._placingWall = true;
        grid.set_child_above_sibling(slider, last);
        this._placingWall = false;
    }

    // The header row: battery, Settings, MK Command Centre (no screenshot, lock or power button)
    _header() {
        const row = this._qs._system?._systemItem?.child;
        if (!row) {
            if ((this._headerTries = (this._headerTries ?? 0) + 1) <= 20) {
                this._headerRetry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._headerRetry = 0;
                    this._header();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        this._headerHidden = [];
        for (const item of row.get_children()) {
            const name = `${item.constructor.name} ${item.constructor.$gtype?.name ?? ''}`;
            if (!HEADER_GONE.test(name))
                continue;
            item.visible = false;
            // (GNOME shows these again whenever their state changes)
            const id = item.connect('notify::visible', () => item.visible && (item.visible = false));
            this._headerHidden.push([item, id]);
        }
        // (no MK Command Centre button here: it's in the Finder menu, with System Settings; one
        // left by an earlier version goes)
        row.get_children().filter(c => c.accessible_name === 'MK Command Centre').forEach(c => c.destroy());
    }

    _unheader() {
        if (this._headerRetry)
            GLib.source_remove(this._headerRetry);
        for (const [item, id] of this._headerHidden ?? []) {
            try {
                item.disconnect(id);
                item.visible = true;
            } catch {}
        }
        this._headerHidden = [];
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
        this._unheader();
        for (const [obj, id] of this._wallIds ?? [])
            obj.disconnect(id);
        this._wallIds = null;
        this._wallMonitor?.cancel();
        this._wallMonitor = null;
        this._wallSlider?.destroy();
        this._wallSlider = null;
        this._original.clear();
        this._box.remove_style_class_name('mk-bento');
    }
}
