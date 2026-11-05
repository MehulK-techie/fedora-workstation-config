// MK Shell Engine: MK Workstation's own shell pieces, replacing third-party
// extensions one at a time. Each module starts on its own, so one that fails
// leaves the others (and GNOME Shell) running.
//   modules/tiling.js  snap layouts (Super+Z) and the coder desktop (Super+Shift+Z)
//   modules/dock.js    the glass dock (while Dash to Dock is off)
//   modules/blur.js    native blur behind the top bar and the dock (while Blur my Shell is off)
//   modules/magicLamp.js   the genie minimize, into the dock icon (while Magic Lamp is off)
//   modules/appSwitcher.js the Super+Tab app switcher
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SnapLayouts, bindSnapLayouts, unbindSnapLayouts } from './modules/tiling.js';
import { Dock } from './modules/dock.js';
import { Blur } from './modules/blur.js';
import { MagicLamp } from './modules/magicLamp.js';
import { AppSwitcher } from './modules/appSwitcher.js';

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
        this._start('blur', () => new Blur(this._settings));
        this._start('genie', () => new MagicLamp(() => this._dock));
        this._start('app switcher', () => new AppSwitcher());
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
