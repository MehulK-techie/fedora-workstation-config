// Media tile in the top bar, for Spotify and any player that speaks MPRIS
// (the standard Linux media interface): album art as a spinning record and the
// song title (cut short with "…", never scrolling). Its menu has the art with a
// glow in the art's own colour, title and artist, a seek bar, controls, and
// More: album, player, which speakers or headphones to use, Open player.
// The tile fades out when playback stops and fades back in when it starts.
//
// config/media.conf, yours in ~/.config/mk-workstation/media.conf:
//   MEDIA=on|off      off removes the tile completely
//   TICKER=on|off     the song title next to the record (off: the record only)
//   PLAYERS=all|spotify  every player, or Spotify only (also a switch under More)
//   TRACK_PILL=on|off  a small pill under the top bar when the song changes
//
// Browsers (YouTube and the like) play short muted previews as you scroll past
// thumbnails, each one a "player". A browser only shows here after it has
// played the same thing for 4 seconds, so previews never take over the tile.
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import Graphene from 'gi://Graphene';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { dominantHue, hsvToRgb } from './colour.js';
import { expectFocus } from './focus.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'media.conf']);
const DEFAULT_CONF = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'media.conf']);
const ART_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'album-art']);

export function mediaConf() {
    const out = {MEDIA: 'on', TICKER: 'on', PLAYERS: 'all', TRACK_PILL: 'on'};
    for (const path of [DEFAULT_CONF, USER_CONF]) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (ok) {
                for (const line of new TextDecoder().decode(bytes).split('\n')) {
                    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(\S*)/);
                    if (m)
                        out[m[1]] = m[2];
                }
            }
        } catch (e) {
            // defaults
        }
    }
    return out;
}

const ART_MAX = 5 * 1024 * 1024;
const BROWSER_STEADY_MS = 4000;
const BROWSERS = /chrom|firefox|brave|edge|opera|vivaldi|zen|librewolf|epiphany|falkon|qutebrowser|plasma-browser/i;

function writeUserKey(key, value) {
    const values = {};
    try {
        const [ok, bytes] = GLib.file_get_contents(USER_CONF);
        if (ok) {
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
                const m = line.match(/^\s*([A-Z_]+)\s*=\s*(\S*)/);
                if (m)
                    values[m[1]] = m[2];
            }
        }
    } catch (e) {
        // a new file
    }
    values[key] = value;
    GLib.mkdir_with_parents(GLib.path_get_dirname(USER_CONF), 0o755);
    GLib.file_set_contents(USER_CONF, '# Your media tile settings (mk-indicator)\n' +
        Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

// Only decode real images: PNG, JPEG or WebP, by their first bytes.
function isImage(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
        (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
        (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45);
}

function fileLooksLikeImage(path) {
    try {
        const stream = Gio.File.new_for_path(path).read(null);
        const head = stream.read_bytes(16, null).get_data();
        stream.close(null);
        const info = Gio.File.new_for_path(path).query_info('standard::size,standard::type', 0, null);
        return info.get_file_type() === Gio.FileType.REGULAR && info.get_size() <= ART_MAX && isImage(head);
    } catch (e) {
        return false;
    }
}

const fmt = us => {
    const s = Math.max(0, Math.floor(us / 1e6));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class MediaTile {
    enable() {
        this._conf = mediaConf();
        if (this._conf.MEDIA === 'off')
            return;
        this._bus = Gio.DBus.session;
        this._players = new Set();
        this._meta = {};
        this._status = 'Stopped';
        this._session = new Soup.Session({timeout: 10});
        GLib.mkdir_with_parents(ART_DIR, 0o755);
        this._pruneArt();

        this._button = new PanelMenu.Button(0.5, 'Media', false);
        this._button.add_style_class_name('mk-media');
        const box = new St.BoxLayout({style: 'spacing: 8px;', y_align: Clutter.ActorAlign.CENTER});
        this._disc = new St.Widget({style_class: 'mk-media-disc', width: 20, height: 20,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}), y_align: Clutter.ActorAlign.CENTER});
        // Title only, cut short with "…": no scrolling text in the top bar.
        this._ticker = new St.Label({style_class: 'mk-media-ticker', y_align: Clutter.ActorAlign.CENTER,
            visible: this._conf.TICKER !== 'off'});
        this._ticker.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._disc);
        box.add_child(this._ticker);
        this._button.add_child(box);
        this._button.visible = false;
        this._button.opacity = 0;
        this._buildMenu();
        Main.panel.addToStatusArea('mk-media', this._button, 1, 'right');
        // The panel can go before we're disabled (logout): stop listening then.
        this._button.connect('destroy', () => this._teardown());

        this._spin = new Clutter.Timeline({actor: this._disc, duration: 4000, repeat_count: -1});
        this._spin.connect('new-frame', (t, ms) => {
            this._disc.rotation_angle_z = (ms / 4000) * 360;
        });

        this._nameId = this._bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, , owner] = params.deep_unpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (owner)
                    this._players.add(name);
                else
                    this._players.delete(name);
                this._choose();
            });
        this._propsId = this._bus.signal_subscribe(null, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            PATH, null, Gio.DBusSignalFlags.NONE, () => this._choose());
        this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
                try {
                    for (const name of c.call_finish(res).deep_unpack()[0]) {
                        if (name.startsWith(PREFIX))
                            this._players.add(name);
                    }
                } catch (e) {
                    return;
                }
                this._choose();
            });
    }

    _buildMenu() {
        const menu = this._button.menu;
        menu.box.add_style_class_name('mk-media-menu');
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const col = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 10px;'});
        this._art = new St.Widget({style_class: 'mk-media-art', width: 240, height: 240, x_align: Clutter.ActorAlign.CENTER});
        col.add_child(this._art);
        this._title = new St.Label({style_class: 'mk-media-title', x_align: Clutter.ActorAlign.CENTER});
        this._artist = new St.Label({style_class: 'mk-media-artist', x_align: Clutter.ActorAlign.CENTER});
        for (const label of [this._title, this._artist])
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        col.add_child(this._title);
        col.add_child(this._artist);
        this._slider = new Slider(0);
        this._slider.accessible_name = 'Position';
        this._slider.connect('drag-end', () => this._seek());
        col.add_child(this._slider);
        const times = new St.BoxLayout({x_expand: true});
        this._elapsed = new St.Label({style_class: 'mk-media-time', x_expand: true});
        this._length = new St.Label({style_class: 'mk-media-time'});
        times.add_child(this._elapsed);
        times.add_child(this._length);
        col.add_child(times);
        const controls = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 18px;'});
        const control = (icon, method) => {
            const b = new St.Button({style_class: 'mk-media-control', can_focus: true,
                child: new St.Icon({icon_name: icon, icon_size: 20})});
            b.connect('clicked', () => this._call(method));
            controls.add_child(b);
            return b;
        };
        control('media-skip-backward-symbolic', 'Previous');
        this._playButton = control('media-playback-start-symbolic', 'PlayPause');
        this._playButton.add_style_class_name('mk-media-play');
        control('media-skip-forward-symbolic', 'Next');
        col.add_child(controls);
        item.add_child(col);
        menu.addMenuItem(item);
        // More: album, player, speakers or headphones (GNOME menus can't nest
        // a submenu in a submenu, so the outputs are listed right here).
        this._more = new PopupMenu.PopupSubMenuMenuItem('More', true);
        this._more.icon.icon_name = 'view-more-horizontal-symbolic';
        menu.addMenuItem(this._more);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._openApp = menu.addAction('Open player', () => this._raise());
        menu.connect('open-state-changed', (_m, open) => {
            // Filled here, not when More opens: GNOME won't open an empty submenu.
            if (open)
                this._fillMore();
            if (open && !this._posId) {
                this._pollPosition();
                this._posId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
                    this._pollPosition();
                    return GLib.SOURCE_CONTINUE;
                });
            } else if (!open && this._posId) {
                GLib.source_remove(this._posId);
                this._posId = 0;
            }
        });
    }

    // Which player the tile shows. Playing beats paused, Spotify first, the
    // one already shown stays while it plays. A browser counts only after the
    // same title has played for BROWSER_STEADY_MS (not a hover preview), and
    // a paused browser only if it's the one already shown. PLAYERS=spotify
    // leaves only Spotify.
    _choose() {
        if (!this._button)
            return;
        const spotifyOnly = this._conf.PLAYERS === 'spotify';
        const names = [...this._players].filter(n => !spotifyOnly || n.includes('spotify'));
        if (!names.length) {
            this._noPlayer();
            return;
        }
        let pending = names.length;
        const info = {};
        for (const name of names) {
            this._getAll(name, props => {
                info[name] = props;
                if (--pending)
                    return;
                this._decide(names.filter(n => info[n]), info);
            });
        }
    }

    _decide(names, info) {
        const now = GLib.get_monotonic_time() / 1000;
        this._seen ??= new Map();
        for (const name of names) {
            const key = `${info[name].PlaybackStatus}\n${info[name].Metadata?.['xesam:title'] ?? ''}`;
            if (this._seen.get(name)?.key !== key)
                this._seen.set(name, {key, since: now});
        }
        for (const name of [...this._seen.keys()]) {
            if (!names.includes(name))
                this._seen.delete(name);
        }
        const browser = n => BROWSERS.test(n.slice(PREFIX.length));
        const title = n => info[n].Metadata?.['xesam:title'] ?? '';
        const steady = n => !browser(n) || now - this._seen.get(n).since >= BROWSER_STEADY_MS ||
            (n === this._current && title(n) === this._meta.title);
        const playing = names.filter(n => info[n].PlaybackStatus === 'Playing' && steady(n));
        const paused = names.filter(n => info[n].PlaybackStatus === 'Paused' &&
            (!browser(n) || (n === this._current && title(n) === this._meta.title)));
        const spotify = list => list.find(n => n.includes('spotify'));
        const pick = spotify(playing) ?? (playing.includes(this._current) ? this._current : playing[0]) ??
            spotify(paused) ?? (paused.includes(this._current) ? this._current : paused[0]) ?? null;

        // A browser that has just started: look again once it's been steady.
        const waiting = names.filter(n => browser(n) && info[n].PlaybackStatus === 'Playing' && !steady(n));
        if (waiting.length && !this._recheckId) {
            const wait = Math.max(...waiting.map(n => BROWSER_STEADY_MS - (now - this._seen.get(n).since)));
            this._recheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(wait) + 50, () => {
                this._recheckId = 0;
                this._choose();
                return GLib.SOURCE_REMOVE;
            });
        }
        if (!pick) {
            this._noPlayer();
            return;
        }
        if (pick !== this._current) {
            this._current = pick;
            this._artUrl = null;
        }
        this._apply(info[pick]);
    }

    _noPlayer() {
        this._current = null;
        this._showTile(false);
        this._spin.stop();
    }

    _getAll(name, cb) {
        this._bus.call(name, PATH, 'org.freedesktop.DBus.Properties', 'GetAll', new GLib.Variant('(s)', [PLAYER]),
            null, Gio.DBusCallFlags.NONE, 1000, null, (c, res) => {
                try {
                    cb(c.call_finish(res).recursiveUnpack()[0]);
                } catch (e) {
                    cb(null);
                }
            });
    }

    _get(name, prop, cb) {
        this._bus.call(name, PATH, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', [PLAYER, prop]),
            null, Gio.DBusCallFlags.NONE, 1000, null, (c, res) => {
                try {
                    cb(c.call_finish(res).deep_unpack()[0].deep_unpack());
                } catch (e) {
                    cb(null);
                }
            });
    }

    _refresh() {
        this._choose();
    }

    _apply(props) {
        if (!this._button)
            return;
        const meta = props.Metadata ?? {};
        this._status = props.PlaybackStatus ?? 'Stopped';
        const title = meta['xesam:title'] || '';
        const artist = (meta['xesam:artist'] ?? []).join(', ');
        this._meta = {title, artist, length: meta['mpris:length'] ?? 0, track: meta['mpris:trackid'],
            art: meta['mpris:artUrl'], album: meta['xesam:album'] || ''};
        this._showTile(this._status !== 'Stopped' && Boolean(title));
        const key = `${this._current}|${title}|${artist}`;
        if (key !== this._trackKey) {
            // Not for the first song seen, nor when the menu shows it anyway.
            if (this._trackKey && this._status === 'Playing' && title && !this._button.menu.isOpen)
                this._showPill(title, artist);
            this._trackKey = key;
        }
        this._title.text = title;
        this._artist.text = artist;
        this._length.text = this._meta.length ? fmt(this._meta.length) : '';
        this._playButton.child.icon_name = this._status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._ticker.text = title;
        if (this._status === 'Playing')
            this._spin.start();
        else
            this._spin.stop();
        this._loadArt(this._meta.art);
    }

    // Fade in when something plays, fade out when playback stops or the
    // player quits; hidden on the lock screen whatever happens.
    _showTile(show) {
        if (!this._button)
            return;
        show = show && !this._locked;
        if (show === this._tileShown)
            return;
        this._tileShown = show;
        this._button.remove_transition('opacity');
        if (show) {
            this._button.visible = true;
            this._button.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._button.menu.close();
            this._button.ease({opacity: 0, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._button && !this._tileShown)
                        this._button.visible = false;
                }});
        }
    }

    // The art cache keeps the newest 200 pictures (YouTube Music, Netflix and
    // other streaming sites change art every track); older ones are deleted.
    _pruneArt() {
        try {
            const dir = Gio.File.new_for_path(ART_DIR);
            const files = [];
            const e = dir.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = e.next_file(null)))
                files.push([info.get_modification_date_time()?.to_unix() ?? 0, info.get_name()]);
            files.sort((x, y) => y[0] - x[0]);
            for (const [, fname] of files.slice(200))
                dir.get_child(fname).delete(null);
        } catch (e) {
            // a missing or unreadable cache: nothing to prune
        }
    }

    // Album art: local files directly, web addresses downloaded once.
    _loadArt(url) {
        if (!url || url === this._artUrl)
            return;
        this._artUrl = url;
        if (url.startsWith('file://')) {
            this._setArt(Gio.File.new_for_uri(url).get_path());
            return;
        }
        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1);
        const path = GLib.build_filenamev([ART_DIR, name]);
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            this._setArt(path);
            return;
        }
        if (!url.startsWith('https://'))
            return;
        // Read at most 5 MB, and only if the server says it's an image.
        const msg = Soup.Message.new('GET', url);
        this._session.send_async(msg, GLib.PRIORITY_LOW, null, (s, res) => {
            let input;
            try {
                input = s.send_finish(res);
            } catch (e) {
                return;
            }
            const type = msg.get_response_headers().get_content_type()[0] ?? '';
            if (msg.get_status() !== Soup.Status.OK || !type.startsWith('image/')) {
                input.close_async(GLib.PRIORITY_LOW, null, null);
                return;
            }
            const chunks = [];
            let size = 0;
            const read = () => input.read_bytes_async(64 * 1024, GLib.PRIORITY_LOW, null, (st, r) => {
                let bytes;
                try {
                    bytes = st.read_bytes_finish(r);
                } catch (e) {
                    return;
                }
                const n = bytes.get_size();
                if (n > 0 && size + n <= ART_MAX) {
                    chunks.push(bytes.get_data());
                    size += n;
                    read();
                    return;
                }
                input.close_async(GLib.PRIORITY_LOW, null, null);
                if (n > 0)
                    return;  // larger than 5 MB: no art
                const all = new Uint8Array(size);
                let at = 0;
                for (const c of chunks) {
                    all.set(c, at);
                    at += c.length;
                }
                if (!isImage(all))
                    return;
                try {
                    GLib.file_set_contents(path, all);
                } catch (e) {
                    return;
                }
                if (this._artUrl === url)
                    this._setArt(path);
            });
            read();
        });
    }

    _setArt(path) {
        if (!this._button || !fileLooksLikeImage(path))
            return;
        let glow = '79,211,255';
        try {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 48, 48, true);
            const hue = dominantHue(pixbuf, 0.3);
            if (hue !== null)
                glow = hsvToRgb(hue, 0.7, 1).join(',');
        } catch (e) {
            // keep the default glow
        }
        const uri = Gio.File.new_for_path(path).get_uri();
        this._art.style = `background-image: url("${uri}"); background-size: cover; border-radius: 18px;
            box-shadow: 0 10px 36px 4px rgba(${glow},0.45);`;
        this._disc.style = `background-image: url("${uri}"); background-size: cover; border-radius: 10px;
            border: 2px solid rgba(255,255,255,0.25);`;
        // The art often arrives after the pill showed: fill it in then.
        this._artStyle = `background-image: url("${uri}"); background-size: cover;`;
        if (this._pillArt)
            this._pillArt.style = this._artStyle;
    }

    // The song changed: a pill under the top bar (art, title, artist) fades
    // in, stays a moment and fades out. One at a time; never on the lock screen.
    _showPill(title, artist) {
        if (this._conf.TRACK_PILL === 'off' || this._locked)
            return;
        if (!this._pill) {
            this._pill = new St.BoxLayout({style_class: 'mk-track-pill', opacity: 0, reactive: false});
            this._pillArt = new St.Widget({style_class: 'mk-track-pill-art', width: 32, height: 32,
                y_align: Clutter.ActorAlign.CENTER});
            const text = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
            this._pillTitle = new St.Label({style_class: 'mk-track-pill-title'});
            this._pillArtist = new St.Label({style_class: 'mk-track-pill-artist'});
            for (const label of [this._pillTitle, this._pillArtist]) {
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                text.add_child(label);
            }
            this._pill.add_child(this._pillArt);
            this._pill.add_child(text);
            Main.layoutManager.uiGroup.add_child(this._pill);
        }
        this._pillTitle.text = title;
        this._pillArtist.text = artist;
        this._pillArtist.visible = Boolean(artist);
        this._pillArt.style = this._artStyle ?? '';
        const monitor = Main.layoutManager.primaryMonitor;
        const [, width] = this._pill.get_preferred_width(-1);
        this._pill.set_position(Math.round(monitor.x + (monitor.width - width) / 2),
            monitor.y + Main.panel.height + 8);
        if (this._pillHideId)
            GLib.source_remove(this._pillHideId);
        this._pill.remove_all_transitions();
        this._pill.show();
        this._pill.ease({opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._pillHideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2600, () => {
            this._pillHideId = 0;
            this._pill?.ease({opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => this._pill?.hide()});
            return GLib.SOURCE_REMOVE;
        });
    }

    _pollPosition() {
        if (!this._current || !this._meta.length)
            return;
        this._get(this._current, 'Position', pos => {
            if (pos === null || this._slider.dragging)
                return;
            this._slider.value = Math.min(1, pos / this._meta.length);
            this._elapsed.text = fmt(pos);
        });
    }

    _seek() {
        if (!this._current || !this._meta.track || !this._meta.length)
            return;
        const target = Math.round(this._slider.value * this._meta.length);
        this._bus.call(this._current, PATH, PLAYER, 'SetPosition',
            new GLib.Variant('(ox)', [this._meta.track, target]), null, Gio.DBusCallFlags.NONE, 1000, null, null);
        this._elapsed.text = fmt(target);
    }

    // Hidden on the lock screen, whatever the player does meanwhile.
    setLocked(locked) {
        this._locked = locked;
        if (!this._button)
            return;
        if (locked) {
            this._button.menu.close();
            this._pill?.hide();
            this._tileShown = false;
            this._button.remove_transition('opacity');
            this._button.opacity = 0;
            this._button.visible = false;
        } else {
            this._showTile(this._status !== 'Stopped' && Boolean(this._meta?.title));
        }
    }

    // PlayPause, Next, Previous. Some players (browsers, older Spotify) refuse
    // PlayPause while paused: then send Play or Pause by name instead.
    _call(method) {
        if (!this._current || this._locked)
            return;
        const name = this._current;
        // Show the new state at once; the player's own update follows.
        if (method === 'PlayPause') {
            this._playButton.child.icon_name = this._status === 'Playing'
                ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
        }
        this._bus.call(name, PATH, PLAYER, method, null, null, Gio.DBusCallFlags.NONE, 2000, null, (c, res) => {
            try {
                c.call_finish(res);
            } catch (e) {
                if (method === 'PlayPause') {
                    const direct = this._status === 'Playing' ? 'Pause' : 'Play';
                    this._bus.call(name, PATH, PLAYER, direct, null, null, Gio.DBusCallFlags.NONE, 2000, null,
                        () => this._refresh());
                    return;
                }
                console.warn(`mk-indicator: media ${method} failed: ${e.message}`);
            }
            this._refresh();
        });
    }

    // Open player: bring the player itself to the front. The player is asked
    // first (MPRIS Raise): a browser then shows the very tab that's playing,
    // rather than just its last window. Spotify on Wayland often can't raise
    // itself; if its app isn't in front half a second later, GNOME activates
    // it (and starts it when it has no window). The focus helper lets the
    // raised window through GNOME's focus-stealing protection.
    _raise() {
        if (!this._current || this._locked)
            return;
        const name = this._current;
        this._button.menu.close();
        this._bus.call(name, PATH, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', ['org.mpris.MediaPlayer2']), null, Gio.DBusCallFlags.NONE,
            1000, null, (c, res) => {
                let root = {};
                try {
                    root = c.call_finish(res).recursiveUnpack()[0];
                } catch (e) {
                    // no root properties: guess from the bus name below
                }
                const app = this._findApp(root.DesktopEntry ?? '', name);
                expectFocus(app);
                const fallback = () => {
                    if (app) {
                        if (Shell.WindowTracker.get_default().focus_app !== app)
                            app.activate();
                        return;
                    }
                    // No app to match (an unusual browser build or Flatpak):
                    // the newest window whose class names the player.
                    const guess = name.slice(PREFIX.length).split('.')[0].toLowerCase();
                    const win = global.display.get_tab_list(0, null)
                        .find(w => (w.get_wm_class() ?? '').toLowerCase().includes(guess));
                    if (win)
                        Main.activateWindow(win);
                };
                if (root.CanRaise === false) {
                    fallback();
                    return;
                }
                this._bus.call(name, PATH, 'org.mpris.MediaPlayer2', 'Raise', null, null,
                    Gio.DBusCallFlags.NONE, 1000, null, (cc, r) => {
                        try {
                            cc.call_finish(r);
                        } catch (e) {
                            fallback();
                            return;
                        }
                        this._raiseCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                            this._raiseCheckId = 0;
                            fallback();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
            });
    }

    _findApp(entry, busName) {
        const system = Shell.AppSystem.get_default();
        const guess = busName.slice(PREFIX.length).split('.')[0];
        for (const id of [entry, guess].filter(Boolean)) {
            const app = system.lookup_app(`${id}.desktop`) ?? system.lookup_desktop_wmclass(id) ??
                system.lookup_startup_wmclass(id);
            if (app)
                return app;
        }
        return system.get_running().find(app => app.get_id().toLowerCase().includes(guess.toLowerCase())) ?? null;
    }

    _fillMore() {
        const menu = this._more.menu;
        menu.removeAll();
        const info = [this._meta.album && `Album: ${this._meta.album}`,
            this._current && `Player: ${this._findApp('', this._current)?.get_name() ?? this._current.slice(PREFIX.length)}`];
        for (const text of info.filter(Boolean)) {
            const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
            item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            menu.addMenuItem(item);
        }
        const only = new PopupMenu.PopupSwitchMenuItem('Spotify only', this._conf.PLAYERS === 'spotify');
        only.connect('toggled', (_i, state) => {
            this._conf.PLAYERS = state ? 'spotify' : 'all';
            writeUserKey('PLAYERS', this._conf.PLAYERS);
            this._choose();
        });
        menu.addMenuItem(only);
        const control = getMixerControl();
        const current = control.get_default_sink();
        const sinks = control.get_sinks();
        if (sinks.length)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Play on'));
        for (const sink of sinks) {
            const item = new PopupMenu.PopupMenuItem(sink.get_description() || sink.get_name());
            if (current && sink.get_id() === current.get_id())
                item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => control.set_default_sink(sink));
            menu.addMenuItem(item);
        }
    }

    disable() {
        const button = this._button;
        this._teardown();
        button?.destroy();
    }

    _teardown() {
        for (const id of ['_nameId', '_propsId']) {
            if (this[id])
                this._bus.signal_unsubscribe(this[id]);
            this[id] = 0;
        }
        for (const id of ['_posId', '_recheckId', '_raiseCheckId', '_pillHideId']) {
            if (this[id])
                GLib.source_remove(this[id]);
            this[id] = 0;
        }
        this._pill?.destroy();
        this._pill = this._pillArt = null;
        this._spin?.stop();
        this._session?.abort();
        this._button = null;
    }
}
