// MK: the media players on the session bus (MPRIS), for the lock screen's Now
// Playing card and for muting the live wallpaper while something else plays.
// The lock screen video's own player (org.mpris.MediaPlayer2.LiveLockScreen) is
// left out. Emits 'changed' whenever a player comes, goes, or changes its track
// or state.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const OWN = new Set([`${PREFIX}LiveLockScreen`, `${PREFIX}mk-live-wallpaper`]);
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';

class Player {
    constructor(name, onChange) {
        this.name = name;
        this._onChange = onChange;
        this._cancel = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, name, PATH, IFACE, this._cancel,
            (_o, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch {
                    return;                          // (gone already, or not a real player)
                }
                this._propsId = this._proxy.connect('g-properties-changed', () => this._onChange());
                this._onChange();
            });
        this.seen = GLib.get_monotonic_time();
    }

    _prop(name) {
        return this._proxy?.get_cached_property(name)?.recursiveUnpack();
    }

    get status() {
        return this._prop('PlaybackStatus') ?? 'Stopped';
    }

    get playing() {
        return this.status === 'Playing';
    }

    get metadata() {
        const m = this._prop('Metadata') ?? {};
        const artist = m['xesam:artist'];
        return {
            title: m['xesam:title'] ?? '',
            artist: Array.isArray(artist) ? artist.join(', ') : artist ?? '',
            art: m['mpris:artUrl'] ?? '',
        };
    }

    get canGoNext() {
        return this._prop('CanGoNext') ?? true;
    }

    get canGoPrevious() {
        return this._prop('CanGoPrevious') ?? true;
    }

    call(method) {
        this._proxy?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    destroy() {
        this._cancel.cancel();
        if (this._propsId)
            this._proxy.disconnect(this._propsId);
        this._proxy = null;
    }
}

export class MediaWatcher extends Signals.EventEmitter {
    constructor() {
        super();
        this._players = new Map();
        this._bus = Gio.DBus.session;
        this._ownerId = this._bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _sig, params) => {
                const [name, , owner] = params.deepUnpack();
                if (!name.startsWith(PREFIX) || OWN.has(name))
                    return;
                if (owner)
                    this._add(name);
                else
                    this._remove(name);
            });
        this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null,
            new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                try {
                    const [names] = bus.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(PREFIX) && !OWN.has(n)).forEach(n => this._add(n));
                } catch {}
            });
    }

    _add(name) {
        if (this._players.has(name) || !this._bus)
            return;
        this._players.set(name, new Player(name, () => this._changed()));
    }

    _remove(name) {
        this._players.get(name)?.destroy();
        if (this._players.delete(name))
            this._changed();
    }

    _changed() {
        if (this._bus)
            this.emit('changed');
    }

    // the one to show: playing first, then paused with a track, the newest first
    get active() {
        const list = [...this._players.values()].filter(p => p.metadata.title || p.playing);
        return list.find(p => p.playing) ??
            list.filter(p => p.status === 'Paused').sort((a, b) => b.seen - a.seen)[0] ?? null;
    }

    get anyPlaying() {
        return [...this._players.values()].some(p => p.playing);
    }

    destroy() {
        if (!this._bus)
            return;
        this._bus.signal_unsubscribe(this._ownerId);
        for (const p of this._players.values())
            p.destroy();
        this._players.clear();
        this._bus = null;
    }
}
