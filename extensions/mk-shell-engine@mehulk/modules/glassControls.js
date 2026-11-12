// MK Shell Engine: the shell's glass, adjustable live from Quick Settings.
//   Frost (a slider; its icon switches it off and on): the blur behind the top bar's capsules, the
//     dock and MK's popovers, from 0 (clear glass) to 64 (heavy frost); 38 is MK's own
//     (`panel-blur-enabled`, `panel-blur-sigma`, applied through blur.js to every blur, now and later)
//   Glass Tint (a tile with a menu): Wallpaper Auto (the accent), Obsidian Neutral, Arctic Cyan,
//     Amethyst, Emerald, Warm Amber, or Apply Copied #Hex; and a Tint strength slider, 0-45 %
//     (`panel-tint-color`, `panel-tint-opacity`). It's a stylesheet of its own for the capsules, the
//     dock and the popovers, loaded over the engine's: shell surfaces only, never an app's window.
//     Changes ease in over 220 ms.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { QuickMenuToggle, QuickSlider, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { setFrost } from './blur.js';
import { accentRGB, onAccentChanged } from './colour.js';

const TINTS = [['Wallpaper Auto', 'auto'], ['Obsidian Neutral', '#0f1117'], ['Arctic Cyan', '#22d3ee'],
    ['Amethyst', '#a855f7'], ['Emerald', '#10b981'], ['Warm Amber', '#f59e0b']];
const BASE = [15, 18, 26];             // the glass's own colour (rgba(15,18,26,0.72) in the stylesheet)
const CSS = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'glass-tint.css']);
// what takes the tint: the top bar's capsules (islands, the left block, the app pill), the dock, MK's popovers
const SURFACES = ['#panel.mk-islands #panelCenter', '#panel.mk-islands #panelRight', '.mk-left-island',
    '#panel.mk-islands .wack-app-pill', '.mk-dock', '.mk-glass-menu', '.mk-wall-grid'];

const hexRGB = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
};

const TintToggle = GObject.registerClass({GTypeName: 'MkGlassTintToggle'}, class TintToggle extends QuickMenuToggle {
    constructor() {
        super({title: 'Glass Tint', iconName: 'applications-graphics-symbolic', toggleMode: true});
    }
});

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
        // Frost: a slider (0-64), its icon switches the blur off and on
        this._frost = new QuickSlider({iconName: 'weather-fog-symbolic', iconReactive: true, iconLabel: 'Frosted glass'});
        this._frost.accessible_name = 'Frost';
        const syncFrost = () => {
            this._syncing = true;
            this._frost.slider.value = s.get_int('panel-blur-sigma') / 64;
            this._frost.slider.opacity = s.get_boolean('panel-blur-enabled') ? 255 : 110;
            this._syncing = false;
        };
        this._frost.slider.connect('notify::value', () => {
            if (this._syncing)
                return;
            s.set_int('panel-blur-sigma', Math.round(this._frost.slider.value * 64));
            if (!s.get_boolean('panel-blur-enabled'))
                s.set_boolean('panel-blur-enabled', true);
        });
        this._frost.connect('icon-clicked', () => s.set_boolean('panel-blur-enabled', !s.get_boolean('panel-blur-enabled')));
        // Tint strength: 0-45 %
        this._strength = new QuickSlider({iconName: 'color-select-symbolic', iconLabel: 'Glass tint strength'});
        this._strength.accessible_name = 'Glass tint strength';
        const syncStrength = () => {
            this._syncing = true;
            this._strength.slider.value = s.get_int('panel-tint-opacity') / 45;
            this._syncing = false;
        };
        this._strength.slider.connect('notify::value', () => {
            if (!this._syncing)
                s.set_int('panel-tint-opacity', Math.round(this._strength.slider.value * 45));
        });
        s.connectObject('changed::panel-blur-sigma', syncFrost, 'changed::panel-blur-enabled', syncFrost,
            'changed::panel-tint-opacity', syncStrength, this);
        syncFrost();
        syncStrength();
        qs.menu.addItem(this._frost, 2);
        qs.menu.addItem(this._strength, 2);
        // Glass Tint: the colour, from a menu of presets (the tile is on while any tint shows)
        this._indicator = new SystemIndicator();
        this._toggle = new TintToggle();
        this._toggle.menu.setHeader('applications-graphics-symbolic', 'Glass Tint', 'The top bar, the dock and popovers');
        this._items = TINTS.map(([label, value]) => {
            const item = new PopupMenu.PopupMenuItem(label);
            if (value !== 'auto') {
                item.insert_child_at_index(new St.Widget({style_class: 'mk-tint-swatch',
                    style: `background-color: ${value};`}), 1);
            }
            item.connect('activate', () => {
                s.set_string('panel-tint-color', value);
                if (s.get_int('panel-tint-opacity') === 0)
                    s.set_int('panel-tint-opacity', 18);           // (picking a colour means you want to see it)
            });
            this._toggle.menu.addMenuItem(item);
            return [value, item];
        });
        const copied = new PopupMenu.PopupMenuItem('Apply Copied #Hex');
        copied.connect('activate', () => St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, text) => {
            const hex = (text ?? '').trim();
            if (/^#[0-9a-f]{6}$/i.test(hex)) {
                s.set_string('panel-tint-color', hex.toLowerCase());
                if (s.get_int('panel-tint-opacity') === 0)
                    s.set_int('panel-tint-opacity', 18);
            } else {
                Main.panel._mkIsland?.show({icon: 'dialog-information-symbolic', text: 'Copy a #rrggbb colour first'});
            }
        }));
        this._toggle.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._toggle.menu.addMenuItem(copied);
        const syncToggle = () => {
            const value = s.get_string('panel-tint-color');
            this._toggle.checked = s.get_int('panel-tint-opacity') > 0;
            this._toggle.subtitle = TINTS.find(([, v]) => v === value)?.[0] ?? value;
            for (const [v, item] of this._items)
                item.setOrnament(v === value ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        };
        this._toggle.connect('clicked', () => s.set_int('panel-tint-opacity', this._toggle.checked ? 18 : 0));
        s.connectObject('changed::panel-tint-color', syncToggle, 'changed::panel-tint-opacity', syncToggle, this);
        syncToggle();
        this._indicator.quickSettingsItems.push(this._toggle);
        qs.addExternalIndicator(this._indicator);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._accentOff?.();
        if (this._loaded) {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._loaded);
            this._loaded = null;
        }
        setFrost(true, 38);                          // (MK's own glass when the engine stops)
        this._frost?.destroy();
        this._strength?.destroy();
        this._indicator?.quickSettingsItems.forEach(item => item.destroy());
        this._indicator?.destroy();
    }
}
