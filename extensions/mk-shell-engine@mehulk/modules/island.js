// MK Shell Engine: the Dynamic Island. The top bar's centre capsule (the clock) briefly widens into
// a pill that shows what just changed, then settles back. It takes over GNOME's own volume /
// brightness pop-up completely (Main.osdWindowManager), so that never appears; and anything else
// can show in it through Main.panel._mkIsland.show({icon, text, level}):
//   volume, microphone mute, brightness, keyboard backlight (GNOME's OSD calls)
//   power profile changes (power-profiles-daemon)
//   a new track (mk-indicator's media tile), a timer or focus session ending (the calendar)
//
// Motion: it opens from the clock's own size to its width with a spring (EASE_OUT_BACK, 340 ms),
// its contents fading in a beat later so nothing is clipped mid-morph; a level fills its bar
// smoothly; a long line widens it (to 680 px) and stays longer to be read; after 1.6 s without news it settles back (EASE_OUT_EXPO, 300 ms) and fades away. A
// new event while it's open just retargets it: no flicker, no restart. Idle, it costs nothing:
// no timers, no actors drawn (it's hidden).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OPEN_MS = 340, CLOSE_MS = 300, HOLD_MS = 1600;
const WIDTH = 300;                 // the island's width when open (px): at least this
const MAX_WIDTH = 680;             // a longer line (Spidey's greeting) widens it up to this
const READ_MS_PER_CHAR = 55;       // and holds it long enough to read (up to 6 s)
const PROFILES = {'power-saver': ['power-profile-power-saver-symbolic', 'Power Saver'],
    'balanced': ['power-profile-balanced-symbolic', 'Balanced'],
    'performance': ['power-profile-performance-symbolic', 'Performance']};

export class Island {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'mk-island-pill', reactive: false, visible: false, opacity: 0,
            y_align: Clutter.ActorAlign.CENTER});
        this.actor.set_pivot_point(0.5, 0.5);
        this._content = new St.BoxLayout({style_class: 'mk-island-content', x_expand: true, opacity: 0});
        this._icon = new St.Icon({style_class: 'mk-island-icon', icon_size: 16, y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'mk-island-label', y_align: Clutter.ActorAlign.CENTER});
        this._label.clutter_text.ellipsize = 3;              // END
        this._track = new St.Widget({style_class: 'mk-island-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout()});
        this._fill = new St.Widget({style_class: 'mk-island-fill', x_align: Clutter.ActorAlign.START, width: 0});
        this._track.add_child(this._fill);
        this._content.add_child(this._icon);
        this._content.add_child(this._label);
        this._content.add_child(this._track);
        this.actor.add_child(this._content);
        // (GNOME 51 no longer takes affectsInputRegion: then the plain form; the island sits over
        // the top bar's clock, so the input it covers while shown is the bar's anyway)
        try {
            Main.layoutManager.addTopChrome(this.actor, {affectsInputRegion: false, trackFullscreen: true});
        } catch {
            this.actor.get_parent()?.remove_child(this.actor);
            Main.layoutManager.addTopChrome(this.actor, {trackFullscreen: true});
        }

        // GNOME's OSD: every call goes here instead (restored on destroy)
        const osd = Main.osdWindowManager;
        this._osd = osd;
        this._savedShow = osd.show;
        osd.show = (_monitor, gicon, label, level, maxLevel) => {
            const max = maxLevel ?? 1;
            this.show({gicon, text: label ?? '', level: level === undefined || level === null ? -1 : level / Math.max(max, 1e-6),
                over: max > 1 && level > 1});
        };
        this._watchPowerProfile();
        Main.panel._mkIsland = this;
    }

    // where the clock's capsule is: the island grows out of it
    _anchor() {
        const box = Main.panel._centerBox;
        const [x, y] = box.get_transformed_position();
        const [w, h] = box.get_transformed_size();
        return {x: Math.round(x + w / 2), y: Math.round(y), w: Math.max(80, Math.round(w)), h: Math.max(24, Math.round(h))};
    }

    show({icon = null, gicon = null, text = '', level = -1, over = false} = {}) {
        if (Main.sessionMode.isLocked)
            return;
        if (gicon)
            this._icon.gicon = gicon;
        else if (icon)
            this._icon.icon_name = icon;
        this._label.text = text;
        this._label.visible = text !== '';
        this._track.visible = level >= 0;
        (over ? this.actor.add_style_class_name : this.actor.remove_style_class_name).call(this.actor, 'mk-island-over');

        const a = this._anchor();
        // (as wide as the line needs, within the screen)
        const [, natural] = this._label.get_preferred_width(-1);
        const monitor = Main.layoutManager.primaryMonitor;
        const room = monitor ? monitor.width - 80 : MAX_WIDTH;
        const width = Math.round(Math.min(Math.max(a.w, WIDTH, natural + (level >= 0 ? 150 : 64)), MAX_WIDTH, room));
        const hold = Math.max(HOLD_MS, Math.min(6000, 1000 + text.length * READ_MS_PER_CHAR));
        const opening = !this._open;
        this._open = true;
        if (opening) {
            // from the clock's own size, exactly where it is
            this.actor.remove_all_transitions();
            this._content.remove_all_transitions();
            this.actor.set({x: a.x - a.w / 2, y: a.y, width: a.w, height: a.h, opacity: 0, visible: true});
            this._content.opacity = 0;
        }
        this.actor.ease({x: a.x - width / 2, width, opacity: 255, duration: opening ? OPEN_MS : 180,
            mode: Clutter.AnimationMode.EASE_OUT_BACK});
        this._content.ease({opacity: 255, delay: opening ? 90 : 0, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        if (level >= 0) {
            // (the bar's width is known once it's laid out: the level is set as a fraction of it)
            const fill = () => {
                const full = this._track.width;
                if (full <= 0)
                    return;
                this._fill.ease({width: Math.round(Math.min(1, level) * full), duration: opening ? 260 : 120,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            };
            if (this._track.width > 0)
                fill();
            else
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => (fill(), GLib.SOURCE_REMOVE));
        }
        if (this._holdId)
            GLib.source_remove(this._holdId);
        this._holdId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hold, () => {
            this._holdId = 0;
            this._close();
            return GLib.SOURCE_REMOVE;
        });
    }

    _close() {
        if (!this._open)
            return;
        this._open = false;
        const a = this._anchor();
        this._content.ease({opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this.actor.ease({x: a.x - a.w / 2, width: a.w, opacity: 0, duration: CLOSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_EXPO,
            onStopped: done => {
                if (done && !this._open && this.actor) {
                    this.actor.hide();
                    this._fill.width = 0;
                }
            }});
    }

    // power-profiles-daemon: the island says when the profile changes (from anywhere)
    _watchPowerProfile() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'net.hadess.PowerProfiles',
            '/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles', null, (_o, res) => {
                try {
                    this._ppd = Gio.DBusProxy.new_for_bus_finish(res);
                } catch {
                    return;                          // (no power profiles on this machine)
                }
                if (!this.actor) {
                    this._ppd = null;
                    return;
                }
                this._profile = this._ppd.get_cached_property('ActiveProfile')?.unpack();
                this._ppdId = this._ppd.connect('g-properties-changed', () => {
                    const now = this._ppd.get_cached_property('ActiveProfile')?.unpack();
                    if (!now || now === this._profile)
                        return;
                    this._profile = now;
                    const [icon, text] = PROFILES[now] ?? ['power-profile-balanced-symbolic', now];
                    this.show({icon, text});
                });
            });
    }

    destroy() {
        if (this._holdId)
            GLib.source_remove(this._holdId);
        this._holdId = 0;
        if (this._osd.show !== this._savedShow) {
            delete this._osd.show;                   // (the class's own again)
            if (this._osd.show !== this._savedShow)
                this._osd.show = this._savedShow;
        }
        if (this._ppdId)
            this._ppd.disconnect(this._ppdId);
        this._ppd = null;
        if (Main.panel._mkIsland === this)
            delete Main.panel._mkIsland;
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this.actor = null;
    }
}
