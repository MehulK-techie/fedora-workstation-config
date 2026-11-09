// MK: what the lock screen adds to WACK's clock, while locked:
//   - a status pill under the date: the battery (UPower) and the weather (GNOME's
//     own weather client, the location set in Weather or the clock)
//   - Now Playing under the time: the playing (or last paused) player's cover,
//     title and artist, with Previous, Play / Pause and Next (MPRIS)
//   - a power button at the bottom right: Sleep, Hibernate, Restart, Shut Down
//   - notifications as compact pills (380 px at most): three at a time, a count
//     of the rest, and Clear
// Switches: lock-status-pill, lock-weather, lock-media-controls,
// lock-power-button, compact-notifications, show-hibernate.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { MediaWatcher } from './media.js';
import { hibernate, sleep } from './power.js';

const KEYS = ['lock-status-pill', 'lock-weather', 'lock-media-controls', 'lock-power-button', 'compact-notifications',
    'show-hibernate', 'lock-clock-layout'];
const NOTIF_SHOWN = 3;

// ----- battery and weather
class StatusPill {
    constructor(settings) {
        this._settings = settings;
        this.actor = new St.BoxLayout({style_class: 'wack-status-pill', x_align: Clutter.ActorAlign.CENTER,
            reactive: false});
        this._batIcon = new St.Icon({icon_size: 14, style_class: 'wack-status-icon'});
        this._batLabel = new St.Label({style_class: 'wack-status-text', y_align: Clutter.ActorAlign.CENTER});
        this._sep = new St.Label({text: '·', style_class: 'wack-status-sep', y_align: Clutter.ActorAlign.CENTER});
        this._wIcon = new St.Icon({icon_size: 14, style_class: 'wack-status-icon'});
        this._wLabel = new St.Label({style_class: 'wack-status-text', y_align: Clutter.ActorAlign.CENTER});
        [this._batIcon, this._batLabel, this._sep, this._wIcon, this._wLabel].forEach(a => this.actor.add_child(a));

        this._cancel = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device', this._cancel, (_o, res) => {
                try {
                    this._upower = Gio.DBusProxy.new_for_bus_finish(res);
                    this._upowerId = this._upower.connect('g-properties-changed', () => this._sync());
                } catch {}
                this._sync();
            });
        this._startWeather();
        this._sync();
    }

    async _startWeather() {
        if (!this._settings.get_boolean('lock-weather'))
            return;
        try {
            const {WeatherClient} = await import('resource:///org/gnome/shell/misc/weather.js');
            if (!this.actor)
                return;
            this._weather = new WeatherClient();
            this._weatherId = this._weather.connect('changed', () => this._sync());
            this._weather.update?.();
        } catch (e) {
            console.warn(`wack-sonoma-lockscreen: weather: ${e.message}`);
        }
        this._sync();
    }

    _sync() {
        if (!this.actor)
            return;
        const prop = n => this._upower?.get_cached_property(n)?.unpack();
        // a battery is there (type 2) and present
        const hasBattery = prop('Type') === 2 && prop('IsPresent');
        if (hasBattery) {
            const pct = Math.round(prop('Percentage') ?? 0);
            this._batIcon.icon_name = prop('IconName') || 'battery-symbolic';
            const charging = prop('State') === 1;
            this._batLabel.text = `${pct}%${charging ? ', charging' : ''}`;
        }
        this._batIcon.visible = this._batLabel.visible = Boolean(hasBattery);

        const info = this._weather?.available && !this._weather.loading ? this._weather.info : null;
        let temp = '';
        try {
            if (info?.is_valid())
                temp = info.get_temp_summary();
            if (temp)
                this._wIcon.icon_name = info.get_symbolic_icon_name();
        } catch {}
        this._wIcon.visible = this._wLabel.visible = temp !== '';
        this._wLabel.text = temp;
        this._sep.visible = this._batLabel.visible && this._wLabel.visible;
        this.actor.visible = this._batLabel.visible || this._wLabel.visible;
    }

    destroy() {
        this._cancel.cancel();
        if (this._upowerId)
            this._upower.disconnect(this._upowerId);
        if (this._weatherId)
            this._weather.disconnect(this._weatherId);
        this._upower = this._weather = null;
        this.actor.destroy();
        this.actor = null;
    }
}

// ----- Now Playing
class NowPlaying {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'wack-now-playing', x_align: Clutter.ActorAlign.CENTER,
            visible: false});
        this._art = new St.Bin({style_class: 'wack-np-art', y_align: Clutter.ActorAlign.CENTER});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'wack-np-text'});
        this._title = new St.Label({style_class: 'wack-np-title'});
        this._artist = new St.Label({style_class: 'wack-np-artist'});
        this._title.clutter_text.ellipsize = this._artist.clutter_text.ellipsize = 3;
        text.add_child(this._title);
        text.add_child(this._artist);
        const controls = new St.BoxLayout({style_class: 'wack-np-controls', y_align: Clutter.ActorAlign.CENTER});
        const button = (icon, label, method) => {
            const b = new St.Button({style_class: 'wack-np-button', can_focus: true, accessible_name: label,
                child: new St.Icon({icon_name: icon, icon_size: 16})});
            b.connect('clicked', () => this._media.active?.call(method));
            controls.add_child(b);
            return b;
        };
        this._prev = button('media-skip-backward-symbolic', 'Previous', 'Previous');
        this._play = button('media-playback-start-symbolic', 'Play or pause', 'PlayPause');
        this._next = button('media-skip-forward-symbolic', 'Next', 'Next');
        [this._art, text, controls].forEach(a => this.actor.add_child(a));
        this._media = new MediaWatcher();
        this._media.connect('changed', () => this._sync());
        this._sync();
    }

    _sync() {
        if (!this.actor)
            return;
        const player = this._media.active;
        this.actor.visible = Boolean(player);
        if (!player)
            return;
        const {title, artist, art} = player.metadata;
        this._title.text = title || 'Now Playing';
        this._artist.text = artist;
        this._artist.visible = artist !== '';
        this._play.child.icon_name = player.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._prev.reactive = player.canGoPrevious;
        this._next.reactive = player.canGoNext;
        if (art !== this._artUrl) {
            this._artUrl = art;
            const gicon = art.startsWith('file://') || art.startsWith('/')
                ? Gio.FileIcon.new(art.startsWith('/') ? Gio.File.new_for_path(art) : Gio.File.new_for_uri(art)) : null;
            this._art.set_child(gicon
                ? new St.Icon({gicon, icon_size: 40, style_class: 'wack-np-cover'})
                : new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 20, style_class: 'wack-np-cover-none'}));
        }
    }

    destroy() {
        this._media.destroy();
        this.actor.destroy();
        this.actor = null;
    }
}

// ----- the power button, bottom right (an inline menu: popups can't float above the lock screen)
class PowerButton {
    constructor(settings) {
        this._settings = settings;
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'wack-lock-power',
            reactive: true});
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'wack-lock-power-menu',
            visible: false, x_align: Clutter.ActorAlign.END});
        const actions = SystemActions.getDefault();
        const entries = [
            ['Sleep', 'weather-clear-night-symbolic', () => sleep(settings)],
            ...(settings.get_boolean('show-hibernate') ? [['Hibernate', 'media-floppy-symbolic', () => hibernate()]] : []),
            ['Restart', 'system-reboot-symbolic', () => actions.activateRestart()],
            ['Shut Down', 'system-shutdown-symbolic', () => actions.activatePowerOff()],
        ];
        for (const [label, icon, run] of entries) {
            const row = new St.BoxLayout({style_class: 'wack-lock-power-row'});
            row.add_child(new St.Icon({icon_name: icon, icon_size: 16}));
            row.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            const b = new St.Button({style_class: 'wack-lock-power-item', can_focus: true, child: row,
                accessible_name: label});
            b.connect('clicked', () => {
                this._list.visible = false;
                run();
            });
            this._list.add_child(b);
        }
        this._toggle = new St.Button({style_class: 'wack-lock-power-button', can_focus: true, accessible_name: 'Power',
            x_align: Clutter.ActorAlign.END, child: new St.Icon({icon_name: 'system-shutdown-symbolic', icon_size: 18})});
        this._toggle.connect('clicked', () => {
            this._list.visible = !this._list.visible;
        });
        this.actor.add_child(this._list);
        this.actor.add_child(this._toggle);
        this._sizeId = this.actor.connect('notify::size', () => this._place());
        this._monId = Main.layoutManager.connect('monitors-changed', () => this._place());
    }

    // 28 px in from the primary monitor's bottom-right corner; the menu opens 10 px above
    // the button, right edges lined up (the box grows upward from the corner)
    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this.actor)
            return;
        this.actor.set_position(m.x + m.width - this.actor.width - 28, m.y + m.height - this.actor.height - 28);
    }

    destroy() {
        Main.layoutManager.disconnect(this._monId);
        this.actor.destroy();
        this.actor = null;
    }
}

// ----- compact notifications: three pills, "+N more", Clear
class CompactNotifications {
    constructor(dialog) {
        this._box = dialog._notificationsBox;
        this._list = this._box?._notificationBox;
        if (!this._list)
            return;
        this._box.add_style_class_name('wack-compact-notifs');
        this._footer = new St.BoxLayout({style_class: 'wack-notif-footer', x_align: Clutter.ActorAlign.CENTER});
        this._more = new St.Label({style_class: 'wack-notif-more', y_align: Clutter.ActorAlign.CENTER});
        this._clear = new St.Button({style_class: 'wack-notif-clear', label: 'Clear', can_focus: true});
        this._clear.connect('clicked', () => this._clearAll());
        this._footer.add_child(this._more);
        this._footer.add_child(this._clear);
        this._box.add_child(this._footer);
        this._ids = ['child-added', 'child-removed'].map(sig => this._list.connect(sig, () => this._queue()));
        this._sync();
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        if (!this._list)
            return;
        const items = this._list.get_children();
        items.forEach((child, i) => {
            child.visible = i < NOTIF_SHOWN;
        });
        const rest = items.length - NOTIF_SHOWN;
        this._more.text = rest > 0 ? `+${rest} more` : '';
        this._more.visible = rest > 0;
        this._footer.visible = items.length > 0;
    }

    // every notification the lock screen shows, dismissed
    _clearAll() {
        for (const source of [...(this._box._sources?.keys() ?? [])]) {
            for (const n of [...(source.notifications ?? [])]) {
                try {
                    n.destroy();
                } catch {}
            }
        }
        this._queue();
    }

    destroy() {
        if (!this._list)
            return;
        if (this._idle)
            GLib.source_remove(this._idle);
        try {
            this._ids.forEach(id => this._list.disconnect(id));
            this._list.get_children().forEach(c => (c.visible = true));
            this._box.remove_style_class_name('wack-compact-notifs');
            this._footer.destroy();
        } catch {}                            // (the dialog went first)
        this._list = this._box = null;
    }
}

export class LockWidgets {
    constructor(settings) {
        this._settings = settings;
        this._ids = KEYS.map(k => settings.connect(`changed::${k}`, () => this.rebuild()));
        this._tries = 0;
        this.rebuild();
    }

    rebuild() {
        this._teardown();
        const shield = Main.screenShield, dialog = shield?._dialog;
        const clock = dialog?._clock;
        if (!dialog || !clock?.has_style_class_name?.('unlock-dialog-clock')) {
            // (WACK's clock is made as the lock screen appears: look again shortly)
            if (this._tries++ < 12) {
                this._retry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                    this._retry = 0;
                    this.rebuild();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        const s = this._settings;
        // Sequoia Split: the clock on the left, the pill and Now Playing in a column on the right
        const split = s.get_string('lock-clock-layout') === 'sequoia-split';
        if (split) {
            this._column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'wack-split-column'});
            (shield._lockDialogGroup ?? dialog).add_child(this._column);
            const place = () => {
                const m = Main.layoutManager.primaryMonitor;
                if (m && this._column)
                    this._column.set_position(m.x + m.width - this._column.width - 96, m.y + Math.round(m.height * 0.28));
            };
            this._column.connect('notify::size', place);
            place();
        }
        if (s.get_boolean('lock-status-pill')) {
            this._pill = new StatusPill(s);
            if (split)
                this._column.add_child(this._pill.actor);
            else
                clock.insert_child_at_index(this._pill.actor, Math.min(1, clock.get_n_children()));   // under the date
        }
        if (s.get_boolean('lock-media-controls')) {
            this._media = new NowPlaying();
            (split ? this._column : clock).add_child(this._media.actor);                          // under the time
        }
        if (s.get_boolean('lock-power-button')) {
            this._power = new PowerButton(s);
            (shield._lockDialogGroup ?? dialog).add_child(this._power.actor);
        }
        if (s.get_boolean('compact-notifications'))
            this._notifs = new CompactNotifications(dialog);
    }

    _teardown() {
        if (this._retry)
            GLib.source_remove(this._retry);
        this._retry = 0;
        for (const part of ['_pill', '_media', '_power', '_notifs']) {
            try {
                this[part]?.destroy();
            } catch (e) {
                console.error(`wack-sonoma-lockscreen: ${e.message}`);
            }
            this[part] = null;
        }
        this._column?.destroy();               // (after the parts it held)
        this._column = null;
    }

    destroy() {
        this._ids.forEach(id => this._settings.disconnect(id));
        this._teardown();
    }
}
