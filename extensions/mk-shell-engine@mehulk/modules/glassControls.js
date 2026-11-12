// MK Shell Engine: the shell's glass, adjustable live from Quick Settings.
// Set in MK Control Center (Top Bar): these settings; this applies them, live.
//   Frost: the blur behind the top bar's capsules, the
//     dock and MK's popovers, from 0 (clear glass) to 64 (heavy frost); 38 is MK's own
//     (`panel-blur-enabled`, `panel-blur-sigma`, applied through blur.js to every blur, now and later)
//   Glass Tint: Wallpaper Auto (the accent), Obsidian Neutral, Arctic Cyan,
//     Amethyst, Emerald, Warm Amber or a colour of your own; and its strength, 0-45 %
//     (`panel-tint-color`, `panel-tint-opacity`). It's a stylesheet of its own for the capsules, the
//     dock and the popovers, loaded over the engine's: shell surfaces only, never an app's window.
//     Changes ease in over 220 ms.
//   Night Light warmth (a slider in Quick Settings): GNOME's colour temperature, cool to warm; its
//     icon: Night Light on / off
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickSlider } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { setFrost } from './blur.js';
import { accentRGB, onAccentChanged } from './colour.js';

const BASE = [15, 18, 26];             // the glass's own colour (rgba(15,18,26,0.72) in the stylesheet)
const CSS = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'glass-tint.css']);
// what takes the tint: the top bar's capsules (islands, the left block, the app pill), the dock, MK's popovers
const SURFACES = ['#panel.mk-islands #panelCenter', '#panel.mk-islands #panelRight', '.mk-left-island',
    '#panel.mk-islands .wack-app-pill', '.mk-dock', '.mk-glass-menu', '.mk-wall-grid'];

const hexRGB = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
};

export class GlassControls {
    constructor(settings) {
        this._settings = settings;
        this._applyFrost();
        this._applyTint();
        settings.connectObject('changed::panel-blur-enabled', () => this._applyFrost(),
            'changed::panel-blur-sigma', () => this._applyFrost(),
            'changed::panel-tint-color', () => this._applyTint(),
            'changed::panel-tint-opacity', () => this._applyTint(), this);
        this._accentOff = onAccentChanged(() => settings.get_string('panel-tint-color') === 'auto' && this._applyTint());
        try {
            this._buildControls();
        } catch (e) {
            console.warn(`mk-shell-engine: glass controls: ${e.message}`);    // (the glass still follows the settings)
        }
    }

    _applyFrost() {
        setFrost(this._settings.get_boolean('panel-blur-enabled'), this._settings.get_int('panel-blur-sigma'));
    }

    _tintRGB() {
        const value = this._settings.get_string('panel-tint-color');
        if (/^#[0-9a-f]{6}$/i.test(value))
            return hexRGB(value);
        return accentRGB() ?? [120, 170, 255];
    }

    _applyTint() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (this._loaded) {
            theme.unload_stylesheet(this._loaded);
            this._loaded = null;
        }
        const k = this._settings.get_int('panel-tint-opacity') / 100;
        if (k <= 0)
            return;                                  // (no tint: the stylesheet's own glass)
        const tint = this._tintRGB();
        const [r, g, b] = BASE.map((v, i) => Math.round(v * (1 - k) + tint[i] * k * 0.55));
        const rim = tint.map(v => Math.round(255 * 0.75 + v * 0.25));
        const css = `/* MK glass tint (glassControls.js): generated, do not edit */\n${SURFACES.join(',\n')} {\n` +
            `  background-color: rgba(${r},${g},${b},0.80);\n  border-color: rgba(${rim.join(',')},${(0.12 + k * 0.4).toFixed(2)});\n` +
            '  transition-duration: 220ms;\n}\n';
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(CSS), 0o755);
            GLib.file_set_contents(CSS, css);
            this._loaded = Gio.File.new_for_path(CSS);
            theme.load_stylesheet(this._loaded);
        } catch (e) {
            console.warn(`mk-shell-engine: glass tint: ${e.message}`);
            this._loaded = null;
        }
    }

    _buildControls() {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs?.menu?.addItem)
            return;
        const s = this._settings;
        // (Frost and Glass Tint are set in MK Control Center, Top Bar: Quick Settings keeps only this)
        // Night Light warmth: GNOME's own colour temperature, 4700 K (cool, left) to 1700 K (warm,
        // right); its icon switches Night Light on and off
        this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        this._warmth = new QuickSlider({iconName: 'night-light-symbolic', iconReactive: true, iconLabel: 'Night Light'});
        this._warmth.accessible_name = 'Night Light warmth';
        const syncWarmth = () => {
            this._syncing = true;
            this._warmth.slider.value = (4700 - this._color.get_uint('night-light-temperature')) / 3000;
            this._warmth.slider.opacity = this._color.get_boolean('night-light-enabled') ? 255 : 110;
            this._syncing = false;
        };
        this._warmth.slider.connect('notify::value', () => {
            if (!this._syncing)
                this._color.set_uint('night-light-temperature', Math.round(4700 - this._warmth.slider.value * 3000));
        });
        this._warmth.connect('icon-clicked', () => this._color.set_boolean('night-light-enabled',
            !this._color.get_boolean('night-light-enabled')));
        this._color.connectObject('changed::night-light-temperature', syncWarmth, 'changed::night-light-enabled', syncWarmth, this);
        syncWarmth();
        qs.menu.addItem(this._warmth, 2);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._accentOff?.();
        if (this._loaded) {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._loaded);
            this._loaded = null;
        }
        setFrost(true, 38);                          // (MK's own glass when the engine stops)
        this._color?.disconnectObject(this);
        this._warmth?.destroy();
    }
}
