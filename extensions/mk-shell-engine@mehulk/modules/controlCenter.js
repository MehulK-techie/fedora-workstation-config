// MK Shell Engine: Quick Settings as a bento grid. GNOME's menu, its toggles
// and sliders stay exactly as they are (and whatever other extensions add
// to it); the engine restyles them: a wider menu (about 370 px) so no toggle
// title is cut short, rounded dark cards instead of pills, an indigo / cyan
// glow on the ones that are on, thicker slider tracks. All of it is in
// stylesheet.css under .mk-bento, so switching the engine off restores
// GNOME's look at once.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ControlCenter {
    constructor() {
        this._box = Main.panel.statusArea.quickSettings?.menu?.box;
        if (!this._box)
            throw new Error('no Quick Settings menu');
        this._box.add_style_class_name('mk-bento');
    }

    destroy() {
        this._box.remove_style_class_name('mk-bento');
    }
}
