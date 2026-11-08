import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

/**
 * PowerSaveMode: 0 = on, 1 = standby, 2 = suspend, 3 = off.
 */
export async function getPowerSaveMode() {
    try {
        const result = await Gio.DBus.session.call(
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', [
                'org.gnome.Mutter.DisplayConfig',
                'PowerSaveMode',
            ]),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
        );
        return Number(result.recursiveUnpack()[0]);
    }
    catch(error) {
        return 0;
    }
}