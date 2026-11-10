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
import { MediaWatcher } from './media.js';
import { powerActions } from './power.js';
import { glowColour, underClock } from './clockStack.js';

const KEYS = ['lock-status-pill', 'lock-weather', 'lock-media-controls', 'lock-power-button', 'compact-notifications',
    'show-hibernate', 'lock-clock-layout'];
const NOTIF_SHOWN = 3;

// ----- battery and weather
class StatusPill {
    // ONLY: 'battery' or 'weather' for one of them alone (Sequoia's widget cards), else both
    constructor(settings, {only = null, styleClass = 'wack-status-pill'} = {}) {
        this._settings = settings;
        this._only = only;
        this.actor = new St.BoxLayout({style_class: styleClass, x_align: Clutter.ActorAlign.CENTER,
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

    // the weather: weather.js's last reading (cached in the settings, so it's there at once)
    _startWeather() {
        this._wIds = ['weather-cache-text', 'weather-cache-icon', 'lock-weather'].map(k =>
            this._settings.connect(`changed::${k}`, () => this._sync()));
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
        this._batIcon.visible = this._batLabel.visible = Boolean(hasBattery) && this._only !== 'weather';

        const temp = this._settings.get_boolean('lock-weather') ? this._settings.get_string('weather-cache-text') : '';
        if (temp)
            this._wIcon.icon_name = this._settings.get_string('weather-cache-icon');
        this._wIcon.visible = this._wLabel.visible = temp !== '' && this._only !== 'battery';
        this._wLabel.text = temp;
        this._sep.visible = this._batLabel.visible && this._wLabel.visible;
        this.actor.visible = this._batLabel.visible || this._wLabel.visible;
    }

    destroy() {
        this._cancel.cancel();
        if (this._upowerId)
            this._upower.disconnect(this._upowerId);
        (this._wIds ?? []).forEach(id => this._settings.disconnect(id));
        this._upower = null;
        this.actor.destroy();
        this.actor = null;
    }
}

// ----- the media hub: what's playing (Spotify, a YouTube tab, any MPRIS player), under the clock
// Hidden while nothing plays; fades in (250 ms) the moment something starts, and stays (paused)
// for a player that played while locked, so you can start it again. Cover (52 px, rounded),
// title and artist (cut short, never shifting the card), a Spotify / YouTube badge, Previous /
// Play-Pause / Next, and a thin progress bar you can drag (01:24 / 03:45).
const FADE = 250;
const mmss = us => {
    const t = Math.max(0, Math.floor(us / 1e6));
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

class NowPlaying {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'wack-media-hub', orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, visible: false, opacity: 0, reactive: true});
        const row = new St.BoxLayout({style_class: 'wack-media-row'});
        this._art = new St.Widget({style_class: 'wack-media-art', width: 52, height: 52, y_align: Clutter.ActorAlign.CENTER});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'wack-media-text'});
        const top = new St.BoxLayout({style_class: 'wack-media-top'});
        this._title = new St.Label({style_class: 'wack-media-title', x_expand: true});
        this._badge = new St.Label({style_class: 'wack-media-badge', y_align: Clutter.ActorAlign.CENTER, visible: false});
        top.add_child(this._title);
        top.add_child(this._badge);
        this._artist = new St.Label({style_class: 'wack-media-artist'});
        this._title.clutter_text.ellipsize = this._artist.clutter_text.ellipsize = 3;    // (END)
        text.add_child(top);
        text.add_child(this._artist);
        const controls = new St.BoxLayout({style_class: 'wack-media-controls', y_align: Clutter.ActorAlign.CENTER});
        const button = (icon, label, method) => {
            const b = new St.Button({style_class: 'wack-media-button', can_focus: true, accessible_name: label,
                child: new St.Icon({icon_name: icon, icon_size: 16})});
            b.connect('clicked', () => this._player?.call(method));
            controls.add_child(b);
            return b;
        };
        this._prev = button('media-skip-backward-symbolic', 'Previous', 'Previous');
        this._play = button('media-playback-start-symbolic', 'Play or pause', 'PlayPause');
        this._next = button('media-skip-forward-symbolic', 'Next', 'Next');
        [this._art, text, controls].forEach(a => row.add_child(a));
        // the progress bar: a thin track, the played part in white; click or drag to seek
        const progress = new St.BoxLayout({style_class: 'wack-media-progress'});
        this._track = new St.Widget({style_class: 'wack-media-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            reactive: true, layout_manager: new Clutter.BinLayout()});
        this._fill = new St.Widget({style_class: 'wack-media-fill', x_align: Clutter.ActorAlign.START, width: 0});
        this._track.add_child(this._fill);
        this._time = new St.Label({style_class: 'wack-media-time', y_align: Clutter.ActorAlign.CENTER});
        progress.add_child(this._track);
        progress.add_child(this._time);
        const seek = (_a, event) => {
            const p = this._player, len = p?.metadata.length ?? 0;
            if (!p?.canSeek || len <= 0)
                return Clutter.EVENT_PROPAGATE;
            const [x] = event.get_coords();
            const [tx] = this._track.get_transformed_position();
            const frac = Math.min(1, Math.max(0, (x - tx) / Math.max(1, this._track.width)));
            p.seek(frac * len);
            this._show(frac * len, len);
            return Clutter.EVENT_STOP;
        };
        this._track.connect('button-press-event', seek);
        this._track.connect('motion-event', (a, event) =>
            event.get_state() & Clutter.ModifierType.BUTTON1_MASK ? seek(a, event) : Clutter.EVENT_PROPAGATE);
        this.actor.add_child(row);
        this.actor.add_child(progress);
        this._played = new Set();                       // players that played while locked
        this._media = new MediaWatcher();
        this._media.connect('changed', () => this._sync());
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
        this._sync();
    }

    _sync() {
        if (!this.actor)
            return;
        const playing = [...this._media._players.values()].find(p => p.playing);
        if (playing)
            this._played.add(playing.name);
        const player = playing ?? this._media.active;
        const show = Boolean(player && (player.playing || this._played.has(player.name)));
        this._player = show ? player : null;
        this._fadeTo(show);
        if (!show)
            return;
        const {title, artist, art} = player.metadata;
        this._title.text = title || 'Now Playing';
        this._artist.text = artist;
        this._artist.visible = artist !== '';
        const source = player.source;
        this._badge.visible = Boolean(source);
        this._badge.text = source === 'spotify' ? 'Spotify' : 'YouTube';
        this._badge.style_class = `wack-media-badge ${source ?? ''}`.trim();
        this._play.child.icon_name = player.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._prev.reactive = player.canGoPrevious;
        this._next.reactive = player.canGoNext;
        if (art !== this._artUrl) {
            this._artUrl = art;
            const uri = art.startsWith('/') ? `file://${art}` : art;
            this._art.style = uri.startsWith('file://')
                ? `background-image: url("${uri.replace(/"/g, '%22')}"); background-size: cover;` : null;
            this._art.destroy_all_children();
            if (!this._art.style)
                this._art.add_child(new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 22,
                    style_class: 'wack-media-art-none', x_expand: true, y_expand: true,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        }
        this._poll();
    }

    _fadeTo(show) {
        if (show === this._shown)
            return;
        this._shown = show;
        this.actor.remove_transition('opacity');
        if (show) {
            this.actor.show();
            this.actor.ease({opacity: 255, duration: FADE, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this.actor.ease({opacity: 0, duration: FADE, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.actor && !this._shown && this.actor.hide()});
        }
    }

    _poll() {
        const p = this._player;
        if (!p || !this.actor)
            return;
        const len = p.metadata.length;
        if (len <= 0) {
            this._show(0, 0);
            return;
        }
        p.position(us => this._player === p && this._show(us, len));
    }

    _show(us, len) {
        if (!this.actor)
            return;
        this._track.visible = len > 0;
        this._time.text = len > 0 ? `${mmss(us)} / ${mmss(len)}` : 'Live';
        if (len > 0)
            this._fill.width = Math.round(Math.min(1, us / len) * this._track.width);
    }

    destroy() {
        if (this._tick)
            GLib.source_remove(this._tick);
        this._tick = 0;
        this._media.destroy();
        this.actor.destroy();
        this.actor = null;
    }
}

// ----- the power button, bottom right (an inline menu: popups can't float above the lock screen)
class PowerButton {
    // Two pieces on the lock screen: the 44 px round button, 24 px from the bottom-right
    // corner, and a 170 px card of actions just above it (its bottom 78 px up). The actions go
    // straight to systemd-logind (power.js powerActions): GNOME's own power dialogs can't open
    // while the screen is locked, which is why these buttons used to do nothing.
    constructor(settings, group) {
        this._settings = settings;
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'wack-lock-power-menu',
            visible: false, reactive: true, width: 170});
        const entries = [
            ['Sleep', 'weather-clear-night-symbolic', () => (settings.get_boolean('remap-sleep-to-hibernate')
                ? powerActions.hibernate() : powerActions.suspend())],
            ...(settings.get_boolean('show-hibernate') ? [['Hibernate', 'media-floppy-symbolic', () => powerActions.hibernate()]] : []),
            ['Restart', 'system-reboot-symbolic', () => powerActions.reboot()],
            ['Shut Down', 'system-shutdown-symbolic', () => powerActions.powerOff()],
        ];
        for (const [label, icon, act] of entries) {
            const row = new St.BoxLayout({style_class: 'wack-lock-power-row'});
            row.add_child(new St.Icon({icon_name: icon, icon_size: 16}));
            row.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            const b = new St.Button({style_class: 'wack-lock-power-item', can_focus: true, reactive: true, track_hover: true,
                child: row, accessible_name: label, x_expand: true});
            b.connect('clicked', () => {
                this._list.visible = false;
                act();
            });
            this._list.add_child(b);
        }
        // one 18 px icon, centred in a 44 px frosted circle (never a label, never a second icon)
        group.get_children().filter(a => a.has_style_class_name?.('wack-lock-power-button') ||
            a.has_style_class_name?.('wack-lock-power-menu')).forEach(a => a.destroy());
        this._toggle = new St.Button({style_class: 'wack-lock-power-button', can_focus: true, reactive: true,
            track_hover: true, accessible_name: 'Power', width: 44, height: 44,
            child: new St.Icon({icon_name: 'system-shutdown-symbolic', icon_size: 18,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true})});
        this._toggle.connect('clicked', () => {
            this._list.visible = !this._list.visible;
            this._place();
        });
        group.add_child(this._list);
        group.add_child(this._toggle);
        this.actor = this._toggle;
        this._ids = [[this._list, this._list.connect('notify::size', () => this._place())],
            [this._toggle, this._toggle.connect('notify::size', () => this._place())]];
        this._monId = Main.layoutManager.connect('monitors-changed', () => this._place());
        this._place();
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._toggle)
            return;
        const right = m.x + m.width - 24, bottom = m.y + m.height - 24;
        this._toggle.set_position(right - this._toggle.width, bottom - this._toggle.height);
        this._list.set_position(right - this._list.width, m.y + m.height - 78 - this._list.height);
    }

    destroy() {
        Main.layoutManager.disconnect(this._monId);
        this._list.destroy();
        this._toggle.destroy();
        this._list = this._toggle = this.actor = null;
    }
}

// ----- "Click or press a key to unlock": out of sight until the pointer moves
// GNOME fades the hint in after 4 s of idling; here it's the other way round: it fades in
// (180 ms) when the mouse moves, out again after 2.5 s without movement, and at once on Esc.
const HINT_IN = 180, HINT_IDLE = 2500;

class HintFader {
    constructor(hint) {
        this._hint = hint;
        this._ease = hint.ease;                          // (GNOME's own idle fade-in is ignored)
        hint.ease = () => {};
        hint.remove_all_transitions();
        hint.opacity = 0;
        this._eventId = global.stage.connect('captured-event', (_s, event) => {
            const type = event.type();
            if (type === Clutter.EventType.MOTION)
                this._show();
            else if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape)
                this._fade(0);
            return Clutter.EVENT_PROPAGATE;
        });
        // (and Mutter's idle monitor, which sees every device: active again -> in, 2.5 s idle -> out)
        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._idleId = this._idleMonitor.add_idle_watch(HINT_IDLE, () => {
            this._fade(0);
            this._armActive();
        });
        this._armActive();
    }

    _armActive() {
        if (this._activeId || !this._idleMonitor)
            return;
        this._activeId = this._idleMonitor.add_user_active_watch(() => {
            this._activeId = 0;                          // (a watch like this fires once)
            this._show();
        });
    }

    _fade(opacity) {
        if (!this._hint)
            return;
        this._ease.call(this._hint, {opacity, duration: HINT_IN, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        if (opacity === 0 && this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
    }

    _show() {
        if (!this._hint)
            return;
        if (this._hint.opacity < 255)
            this._fade(255);
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HINT_IDLE, () => {
            this._timer = 0;
            this._fade(0);
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        global.stage.disconnect(this._eventId);
        for (const id of [this._idleId, this._activeId].filter(Boolean))
            this._idleMonitor.remove_watch(id);
        this._idleMonitor = null;
        if (this._timer)
            GLib.source_remove(this._timer);
        try {
            delete this._hint.ease;                      // (back to Clutter's own)
        } catch {}
        this._hint = null;
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
        // Sequoia Split: the clock on the left (with its battery and weather row), Now Playing on the right
        const split = s.get_string('lock-clock-layout') === 'sequoia-split';
        if (split) {
            this._column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'wack-split-column'});
            (shield._lockDialogGroup ?? dialog).add_child(this._column);
            const place = () => {
                const m = Main.layoutManager.primaryMonitor;
                if (m && this._column)
                    this._column.set_position(m.x + m.width - this._column.width - 80, m.y + Math.round(m.height * 0.28));
            };
            this._column.connect('notify::size', place);
            place();
        }
        // the battery and weather row: always in the clock's own stack, right under the time
        // (never floating on its own beside it)
        // (in the column right under the time: clockStack.js; the tagline first, then this row)
        // (Sequoia: weather and battery as cards of their own in the right-hand column instead)
        const stack = underClock(clock._time) ?? clock;
        if (s.get_boolean('lock-status-pill') && split) {
            this._weatherCard = new StatusPill(s, {only: 'weather', styleClass: 'wack-split-card'});
            this._batteryCard = new StatusPill(s, {only: 'battery', styleClass: 'wack-split-card'});
            this._column.add_child(this._weatherCard.actor);
            this._column.add_child(this._batteryCard.actor);
        } else if (s.get_boolean('lock-status-pill')) {
            this._pill = new StatusPill(s);
            const kids = stack.get_children();
            const tag = kids.findIndex(a => a.has_style_class_name?.('wack-tagline'));
            const time = kids.indexOf(clock._time);
            stack.insert_child_at_index(this._pill.actor, Math.max(tag, time) + 1);
        }
        // Cyberpunk: a HUD line under the stacked clock, [ 13:45:07 ] BAT 97% · 22°C, in the glow colour
        if (s.get_string('lock-clock-layout') === 'vertical-stacked') {
            const neon = glowColour();
            this._hud = new St.Label({style_class: 'wack-hud-telemetry', x_align: Clutter.ActorAlign.CENTER,
                style: `color: ${neon.hex}; text-shadow: 0 0 8px rgba(${neon.rgb}, 0.65);`});
            stack.add_child(this._hud);
            const tick = () => {
                const now = GLib.DateTime.new_now_local();
                const bits = [];
                if (this._pill?._batLabel.visible)
                    bits.push(`BAT ${this._pill._batLabel.text.replace(', charging', '+')}`);
                if (this._pill?._wLabel.visible)
                    bits.push(this._pill._wLabel.text.split(' ')[0]);
                this._hud.text = `[ ${now.format('%H:%M:%S')} ]${bits.length ? `   ${bits.join('  ·  ')}` : ''}`;
                return GLib.SOURCE_CONTINUE;
            };
            tick();
            this._hudTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, tick);
        }
        if (s.get_boolean('lock-media-controls')) {
            this._media = new NowPlaying();
            (split ? this._column : stack).add_child(this._media.actor);                          // under the time
        }
        if (s.get_boolean('lock-power-button')) {
            this._power = new PowerButton(s, shield._lockDialogGroup ?? dialog);
        }
        if (clock._hint)
            this._hint = new HintFader(clock._hint);
        if (s.get_boolean('compact-notifications'))
            this._notifs = new CompactNotifications(dialog);
    }

    _teardown() {
        if (this._retry)
            GLib.source_remove(this._retry);
        this._retry = 0;
        if (this._hudTimer)
            GLib.source_remove(this._hudTimer);
        this._hudTimer = 0;
        try {
            this._hud?.destroy();
        } catch {}                                   // (gone with the lock screen)
        this._hud = null;
        for (const part of ['_pill', '_weatherCard', '_batteryCard', '_hint', '_media', '_power', '_notifs']) {
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
