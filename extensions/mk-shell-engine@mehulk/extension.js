// MK Shell Engine: MK Workstation's own shell pieces, replacing third-party
// extensions one at a time. Each module starts on its own, so one that fails
// leaves the others (and GNOME Shell) running.
//   modules/tiling.js  snap layouts (Super+Z) and the coder desktop (Super+Shift+Z)
//   modules/dock.js    the glass dock (while Dash to Dock is off)
//   modules/blur.js    native blur (GNOME's GPU blur) for the dock, islands and switcher (while Blur my Shell is off)
//   modules/panel.js   the top bar as three glass islands, the active app, the clock
//   modules/controlCenter.js  Quick Settings as a bento grid
//   modules/magicLamp.js   the genie minimize, into the dock icon (while Magic Lamp is off)
//   modules/appSwitcher.js the Super+Tab app switcher
//   modules/snip.js        area screenshots start fresh and are taken on release
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SnapLayouts, bindSnapLayouts, unbindSnapLayouts } from './modules/tiling.js';
import { Dock } from './modules/dock.js';
import { MagicLamp } from './modules/magicLamp.js';
import { AppSwitcher } from './modules/appSwitcher.js';
import { Snip } from './modules/snip.js';
import { Panel } from './modules/panel.js';
import { ControlCenter } from './modules/controlCenter.js';

export default class MKShellEngine extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._parts = [];
        this._start('snap layouts', () => {
            const snap = new SnapLayouts();
            bindSnapLayouts(this, snap);
            return {destroy: () => {
                unbindSnapLayouts();
                snap.destroy();
            }};
        });
        this._start('dock', () => (this._dock = new Dock(this._settings)));
        // the islands top bar blurs each island; the plain panel blur only without it
        this._start('top bar', () => new Panel(this._settings));
        this._start('quick settings', () => new ControlCenter());
        this._start('genie', () => new MagicLamp(() => this._dock));
        this._start('app switcher', () => new AppSwitcher());
        this._start('snip', () => new Snip(this._settings));
    }

    _start(name, make) {
        try {
            this._parts.push(make());
        } catch (e) {
            console.error(`mk-shell-engine: ${name} didn't start: ${e.message}\n${e.stack}`);
        }
    }

    disable() {
        for (const part of this._parts.reverse()) {
            try {
                part.destroy();
            } catch (e) {
                console.error(`mk-shell-engine: ${e.message}`);
            }
        }
        this._parts = [];
        this._dock = null;
        this._settings = null;
    }
}
