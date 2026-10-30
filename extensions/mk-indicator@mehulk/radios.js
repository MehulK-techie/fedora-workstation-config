// Airplane mode that gives your radios back as they were.
//
// GNOME (gnome-settings-daemon's rfkill plugin) calls it Airplane mode when
// every radio is blocked, and turning Airplane mode off unblocks them all.
// So with Bluetooth off, switching Wi-Fi off shows Airplane mode on (that is
// GNOME's definition, left as it is), and switching Airplane mode off again
// turned Bluetooth on although you had it off. This remembers whether
// Bluetooth was off before Airplane mode came on and, when it goes off,
// switches Bluetooth back off. Wi-Fi comes back on, as in GNOME.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS = 'org.gnome.SettingsDaemon.Rfkill';
const PATH = '/org/gnome/SettingsDaemon/Rfkill';
const IFACE = `<node><interface name="${BUS}">
  <property name="AirplaneMode" type="b" access="readwrite"/>
  <property name="BluetoothAirplaneMode" type="b" access="readwrite"/>
  <property name="BluetoothHasAirplaneMode" type="b" access="read"/>
</interface></node>`;
const Proxy = Gio.DBusProxy.makeProxyWrapper(IFACE);

export class RadioMemory {
    enable() {
        this._btWasOff = null; // Bluetooth before Airplane mode came on
        this._lastBtOff = null; // Bluetooth as last seen outside Airplane mode
        this._proxy = new Proxy(Gio.DBus.session, BUS, PATH, (proxy, error) => {
            if (error || !this._proxy)
                return;
            this._airplane = proxy.AirplaneMode;
            if (!this._airplane)
                this._lastBtOff = proxy.BluetoothAirplaneMode;
            this._changedId = proxy.connect('g-properties-changed', () => this._changed());
        });
    }

    _changed() {
        const p = this._proxy;
        const airplane = p.AirplaneMode, btOff = p.BluetoothAirplaneMode;
        if (airplane && !this._airplane) {
            this._btWasOff = this._lastBtOff;
        } else if (!airplane && this._airplane) {
            if (this._btWasOff && p.BluetoothHasAirplaneMode && !btOff) {
                // gsd has just unblocked everything: Bluetooth goes back off
                this._restoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    this._restoreId = 0;
                    this._blockBluetooth();
                    return GLib.SOURCE_REMOVE;
                });
            }
            this._btWasOff = null;
        }
        if (!airplane)
            this._lastBtOff = btOff;
        this._airplane = airplane;
    }

    _blockBluetooth() {
        Gio.DBus.session.call(BUS, PATH, 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', [BUS, 'BluetoothAirplaneMode', new GLib.Variant('b', true)]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    disable() {
        if (this._restoreId)
            GLib.source_remove(this._restoreId);
        if (this._proxy && this._changedId)
            this._proxy.disconnect(this._changedId);
        this._proxy = null;
    }
}
