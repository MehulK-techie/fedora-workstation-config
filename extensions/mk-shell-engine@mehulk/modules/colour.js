// MK Shell Engine: the accent colour, from GNOME's own accent setting (which
// mk-indicator sets from the wallpaper), as 0-255 RGB.
import Gio from 'gi://Gio';

const ACCENTS = {
    blue: [53, 132, 228], teal: [33, 144, 164], green: [58, 148, 74], yellow: [200, 136, 0],
    orange: [237, 91, 0], red: [230, 45, 66], pink: [213, 97, 153], purple: [145, 65, 172], slate: [111, 131, 150],
};
let iface = null;

export function accentRGB() {
    try {
        iface ??= new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        return ACCENTS[iface.get_string('accent-color')] ?? ACCENTS.blue;
    } catch {
        return ACCENTS.blue;          // (GNOME before 47 has no accent setting)
    }
}
