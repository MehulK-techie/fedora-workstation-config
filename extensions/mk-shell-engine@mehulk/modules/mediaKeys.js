// MK Shell Engine: Previous / Next track keys, one press = one skip. GNOME's
// media-keys daemon skips again on every key repeat, so holding (or
// bouncing) the key ran through a playlist. The engine takes those two keys:
// repeats are ignored outright, and presses closer than 350 ms count once.
// The skip goes to the player over MPRIS: playerctl's daemon when it runs
// (it follows the player you used last), else the one playing, else any.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEBOUNCE = 350;
const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';

export class MediaKeys {
    constructor(settings) {
        this._last = 0;
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP;
        for (const [key, method] of [['media-previous', 'Previous'], ['media-next', 'Next']])
            Main.wm.addKeybinding(key, settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, modes, () => this._skip(method));
    }

    _skip(method) {
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._last < DEBOUNCE)
            return;
        this._last = now;
        const bus = Gio.DBus.session;
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null, null,
            Gio.DBusCallFlags.NONE, 1000, null, (c, res) => {
                let names = [];
                try {
                    [names] = c.call_finish(res).deep_unpack();
                } catch {
                    return;
                }
                const players = names.filter(n => n.startsWith(PREFIX));
                const send = name => bus.call(name, PATH, PLAYER, method, null, null, Gio.DBusCallFlags.NONE, 1000, null, null);
                if (players.includes(`${PREFIX}playerctld`)) {
                    send(`${PREFIX}playerctld`);
                    return;
                }
                this._playing(players, name => name && send(name));
            });
    }

    // the first player that's playing, else the first there is
    _playing(players, done) {
        let left = players.length, found = null;
        if (!left) {
            done(null);
            return;
        }
        for (const name of players) {
            Gio.DBus.session.call(name, PATH, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [PLAYER, 'PlaybackStatus']), null, Gio.DBusCallFlags.NONE, 800, null, (c, res) => {
                    try {
                        if (!found && c.call_finish(res).deep_unpack()[0].deep_unpack() === 'Playing')
                            found = name;
                    } catch {}
                    if (--left === 0)
                        done(found ?? players[0]);
                });
        }
    }

    destroy() {
        Main.wm.removeKeybinding('media-previous');
        Main.wm.removeKeybinding('media-next');
    }
}
