import Gio from 'gi://Gio';

import { logInfo, logWarn } from '../utils/logging.js';

/**
 * Tracks whether the system runs on battery via UPower's OnBattery property.
 *
 * Only reports, what to do with the player is up to the caller:
 *  - onUnplugged() : switched to battery
 *  - onPlugged()   : switched to AC power
 *
 * NOTE: Callbacks fire only on actual transitions, not for the initial state.
 * Use isOnBattery() to get the current one.
 * If UPower is not available the system is treated as plugged in.
 */
export class BatteryWatcher {
    constructor({ onPlugged, onUnplugged }) {
        this._onPlugged = onPlugged;
        this._onUnplugged = onUnplugged;

        this._proxy = null;
        this._onBattery = false;
        this._cancellable = new Gio.Cancellable();

        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower',
            'org.freedesktop.UPower',
            this._cancellable,
            (_source, result) => this._onProxyReady(result)
        );
    }

    _onProxyReady(result) {
        try {
            this._proxy = Gio.DBusProxy.new_for_bus_finish(result);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logWarn(`BatteryWatcher: UPower not available: ${e.message}`);
            return;
        }

        this._onBattery = this._readOnBattery();
        this._proxy.connectObject('g-properties-changed', () => {
            this._setOnBattery(this._readOnBattery());
        }, this);
    }

    _readOnBattery() {
        return this._proxy?.get_cached_property('OnBattery')?.unpack() ?? false;
    }

    /**
     * @returns {boolean} whether the system currently runs on battery.
     * NOTE: false until UPower answered
     */
    isOnBattery() {
        return this._onBattery;
    }

    _setOnBattery(onBattery) {
        if (onBattery === this._onBattery) return;
        this._onBattery = onBattery;

        logInfo(`Power source changed to ${onBattery ? 'battery' : 'AC'}`);
        if (onBattery)
            this._onUnplugged?.();
        else
            this._onPlugged?.();
    }

    destroy() {
        this._cancellable?.cancel();
        this._cancellable = null;

        this._proxy?.disconnectObject(this);
        this._proxy = null;

        this._onPlugged = null;
        this._onUnplugged = null;
    }
}
