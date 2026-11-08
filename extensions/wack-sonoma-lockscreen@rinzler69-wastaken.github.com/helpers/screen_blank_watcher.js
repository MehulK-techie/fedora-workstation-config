import Gio from 'gi://Gio';

import { getPowerSaveMode } from '../utils/dbus.js';
import { logInfo } from '../utils/logging.js';

/**
 * Tracks display power saving state (DPMS on/off) via Mutter DBus interface.
 * PowerSaveMode: 0 = on, 1 = standby, 2 = suspend, 3 = off.
 *
 * Only reports, what to do with the player is up to the caller:
 *  - onScreenOn()  : display turned on
 *  - onScreenOff() : display went blank (standby, suspend or off)
 *
 * NOTE: Callbacks fire only on on <-> off transitions,
 * e.g. standby -> off does not call onScreenOff() again
 */
export class ScreenBlankWatcher {
    constructor({ onScreenOn, onScreenOff }) {
        this._onScreenOn = onScreenOn;
        this._onScreenOff = onScreenOff;

        // Unknown until the initial query below or the first change arrives
        this._isOn = null;
        this._destroyed = false;

        this._dbusSubId = Gio.DBus.session.signal_subscribe(
            'org.gnome.Mutter.DisplayConfig',
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            '/org/gnome/Mutter/DisplayConfig',
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, parameters) => {
                const [_, changed] = parameters.deep_unpack();
                if (!('PowerSaveMode' in changed)) return;

                const mode = Number(changed['PowerSaveMode'].deep_unpack());
                logInfo(`PowerSaveMode changed to ${mode}`);

                this._setOn(mode === 0);
            }
        );

        // Initial state is stored silently, callbacks are only for changes
        getPowerSaveMode().then((mode) => {
            // A change signal that arrived in the meantime is more recent
            if (this._destroyed || this._isOn !== null) return;
            this._isOn = mode === 0;
        });
    }

    /**
     * Whether the display is currently on.
     * NOTE: true while the initial state is still unknown
     * (same as getPowerSaveMode() on failure)
     */
    get isOn() {
        return this._isOn ?? true;
    }

    _setOn(isOn) {
        if (isOn === this._isOn) return;
        this._isOn = isOn;

        if (isOn)
            this._onScreenOn?.();
        else
            this._onScreenOff?.();
    }

    destroy() {
        this._destroyed = true;

        if (this._dbusSubId) {
            Gio.DBus.session.signal_unsubscribe(this._dbusSubId);
            this._dbusSubId = 0;
        }

        this._onScreenOn = null;
        this._onScreenOff = null;
    }
}
