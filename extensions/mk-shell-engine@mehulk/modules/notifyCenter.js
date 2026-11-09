// MK Shell Engine: the calendar menu's notification side, made more useful.
//   - the weather inline after the date in the header ("24°C Clear Sky", from
//     MehulK Workstation & Sonoma Suite's weather, cached so it shows at once)
//   - GNOME's media card dressed up: the track's cover as a dimmed, blurred
//     backdrop, and a progress bar with elapsed and total time (click to seek)
//   - a shelf of the 4 latest clipboard entries (text or pictures) under the
//     notifications; a click puts one on the clipboard and marks it Selected,
//     and nothing moves (the history keeps its order)
//   - Focus 25m beside Clear: Do Not Disturb (no banners) with a live countdown;
//     a second press stops it, the end puts banners back and says so
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { UNIFIED } from './conflicts.js';

const CLIP_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'clipboard']);
const CLIP_STORE = GLib.build_filenamev([CLIP_DIR, 'history.json']);
const CLIP_VIEW = GLib.build_filenamev([CLIP_DIR, 'view.json']);
const FOCUS_MIN = 25;

function readJson(path, fallback) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? JSON.parse(new TextDecoder().decode(bytes)) : fallback;
    } catch {
        return fallback;
    }
}

// the suite's settings (its own compiled schema), or null when it isn't installed
export function suiteSettings() {
    const dir = Main.extensionManager.lookup(UNIFIED)?.dir?.get_child('schemas');
    if (!dir?.query_exists(null))
        return null;
    const source = Gio.SettingsSchemaSource.new_from_directory(dir.get_path(), Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.wack-sonoma-lockscreen', false);
    return schema?.has_key('weather-cache-text') ? new Gio.Settings({settings_schema: schema}) : null;
}

const clock = us => {
    const s = Math.max(0, Math.floor(us / 1e6));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export class NotifyCenter {
    constructor() {
        const dm = Main.panel.statusArea.dateMenu;
        this._dm = dm;
        this._list = dm?._messageList;
        if (!this._list)
            throw new Error('no notification list');
        this._menu = dm.menu;
        this._ids = [];
        this._weather();
        this._shelf();
        this._focus();
        this._ids.push([this._menu, this._menu.connect('open-state-changed', (_m, open) => this._opened(open))]);
    }

    // ----- the weather after the date
    _weather() {
        const label = this._dm._date?._dateLabel;
        this._suite = suiteSettings();
        if (!label || !this._suite)
            return;
        // on the date's own line: the date label and the weather side by side in a row of their own
        this._weatherLabel = new St.Label({style_class: 'mk-cal-weather', y_align: Clutter.ActorAlign.END});
        const parent = label.get_parent();
        this._dateRow = new St.BoxLayout({x_align: Clutter.ActorAlign.START});
        parent.insert_child_above(this._dateRow, label);
        parent.remove_child(label);
        this._dateRow.add_child(label);
        this._dateRow.add_child(this._weatherLabel);
        this._dateLabel = label;
        this._dateParent = parent;
        const sync = () => {
            const text = this._suite.get_boolean('weather-enabled') ? this._suite.get_string('weather-cache-text') : '';
            this._weatherLabel.text = text ? `· ${text}` : '';
            this._weatherLabel.visible = text !== '';
        };
        for (const k of ['weather-cache-text', 'weather-enabled'])
            this._ids.push([this._suite, this._suite.connect(`changed::${k}`, sync)]);
        sync();
    }

    _opened(open) {
        if (this._tick)
            GLib.source_remove(this._tick);
        this._tick = 0;
        if (!open)
            return;
        this._fillShelf();
        this._dressMedia();
        // the progress bars, once a second while the menu is open
        this._tick = GLib.timeout_add(GLib.PRIORITY_LOW, 1000, () => {
            this._dressMedia();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ----- the media card: a blurred cover behind it, a progress bar under it
    _dressMedia() {
        const view = this._list._messageView;
        const find = a => (a.has_style_class_name?.('media-message') ? [a] : a.get_children().flatMap(find));
        for (const msg of view ? find(view) : []) {
            const player = msg._player;
            if (!player)
                continue;
            if (/LiveLockScreen|mk.?live.?wallpaper/i.test(player._busName ?? '')) {
                msg.visible = false;                 // (the live wallpaper's own player: not media)
                continue;
            }
            if (!msg._mkDressed)
                this._dress(msg);
            const art = player.trackCoverUrl ?? '';
            if (art !== msg._mkArt) {
                msg._mkArt = art;
                const local = art.startsWith('file://') ? art : '';
                msg._mkBackdrop.style = local
                    ? `background-image: url("${local.replace(/["\\]/g, c => `\\${c}`)}"); background-size: cover; background-position: center;`
                    : null;
                msg._mkBackdrop.visible = local !== '';
            }
            this._position(msg, player);
        }
    }

    _dress(msg) {
        msg._mkDressed = true;
        msg.add_style_class_name('mk-media-card');
        const content = msg.get_child();
        const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        const backdrop = new St.Widget({style_class: 'mk-media-backdrop', x_expand: true, y_expand: true, visible: false});
        backdrop.add_effect(new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, radius: 24, brightness: 0.42}));
        msg.set_child(stack);
        stack.add_child(backdrop);
        stack.add_child(content);
        msg._mkBackdrop = backdrop;
        // the progress bar: elapsed · bar · total (click the bar to jump there)
        const bar = new St.BoxLayout({style_class: 'mk-media-progress', x_expand: true});
        const elapsed = new St.Label({style_class: 'mk-media-time', y_align: Clutter.ActorAlign.CENTER});
        const track = new St.Widget({style_class: 'mk-media-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            reactive: true});
        const fill = new St.Widget({style_class: 'mk-media-fill'});
        track.add_child(fill);
        const total = new St.Label({style_class: 'mk-media-time', y_align: Clutter.ActorAlign.CENTER});
        [elapsed, track, total].forEach(a => bar.add_child(a));
        const box = content.get_children?.().length ? content : null;
        (box ?? content).add_child?.(bar);
        msg._mkBar = {bar, elapsed, track, fill, total};
        track.connect('button-release-event', (_a, event) => {
            const [x] = event.get_coords();
            const [tx] = track.get_transformed_position();
            this._seek(msg, Math.max(0, Math.min(1, (x - tx) / Math.max(1, track.width))));
            return Clutter.EVENT_STOP;
        });
        msg._mkUndress = () => {
            try {
                stack.remove_child(content);
                msg.set_child(content);
                bar.destroy();
                stack.destroy();
                msg.remove_style_class_name('mk-media-card');
            } catch {}
            delete msg._mkDressed;
            delete msg._mkUndress;
        };
        (this._dressed ??= new Set()).add(msg);
    }

    _meta(player) {
        try {
            return player._playerProxy?.Metadata ?? {};
        } catch {
            return {};
        }
    }

    _unpack(v) {
        return v?.deepUnpack ? v.deepUnpack() : v;
    }

    _position(msg, player) {
        const meta = this._meta(player);
        const length = Number(this._unpack(meta['mpris:length']) ?? 0);
        const ui = msg._mkBar;
        ui.bar.visible = length > 0;
        if (!length)
            return;
        Gio.DBus.session.call(player._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, 800, null,
            (bus, res) => {
                let pos = 0;
                try {
                    pos = Number(bus.call_finish(res).deepUnpack()[0].deepUnpack());
                } catch {
                    return;
                }
                if (!ui.track.get_stage())
                    return;
                ui.elapsed.text = clock(pos);
                ui.total.text = clock(length);
                ui.fill.set_size(Math.round(Math.max(0, Math.min(1, pos / length)) * (ui.track.width || 200)), 4);
            });
    }

    _seek(msg, fraction) {
        const player = msg._player, meta = this._meta(player);
        const length = Number(this._unpack(meta['mpris:length']) ?? 0);
        const id = this._unpack(meta['mpris:trackid']);
        if (!length || !id)
            return;
        Gio.DBus.session.call(player._busName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'SetPosition',
            new GLib.Variant('(ox)', [id, Math.round(length * fraction)]), null, Gio.DBusCallFlags.NONE, 800, null,
            () => this._position(msg, player));
    }

    // ----- the clipboard shelf
    _shelf() {
        const controls = this._list._clearButton?.get_parent();
        const column = controls?.get_parent();
        if (!column)
            return;
        this._shelfBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-clip-shelf',
            y_expand: false});
        this._shelfBox.add_child(new St.Label({text: 'Recent Clipboard', style_class: 'mk-clip-shelf-title'}));
        this._shelfRow = new St.BoxLayout({style_class: 'mk-clip-shelf-row', x_expand: true, y_expand: false, height: 56});
        this._shelfBox.add_child(this._shelfRow);
        column.insert_child_below(this._shelfBox, controls);
    }

    _fillShelf() {
        if (!this._shelfRow)
            return;
        this._shelfRow.destroy_all_children();
        const items = readJson(CLIP_STORE, []);
        const view = readJson(CLIP_VIEW, {});
        const latest = (Array.isArray(items) ? items : []).slice(0, 4);
        this._shelfBox.visible = latest.length > 0;
        for (const item of latest) {
            const selected = item.id === view.selected;
            const b = new St.Button({style_class: `mk-clip-shelf-item${selected ? ' mk-clip-shelf-selected' : ''}`,
                can_focus: true, x_expand: true, y_expand: false, height: 54, width: 72, clip_to_allocation: true, accessible_name: item.image ? 'Picture' : (item.text ?? '').slice(0, 40)});
            const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
            if (item.image) {
                const thumb = item.image.replace(/\.png$/, '-thumb.png');
                const file = GLib.file_test(thumb, GLib.FileTest.EXISTS) ? thumb : item.image;
                holder.add_child(new St.Widget({style_class: 'mk-clip-shelf-pic', x_expand: true, y_expand: true,
                    style: `background-image: url("${Gio.File.new_for_path(file).get_uri()}");`}));
            } else {
                const l = new St.Label({text: (item.text ?? '').replace(/\s+/g, ' ').slice(0, 60), style_class: 'mk-clip-shelf-text'});
                l.clutter_text.line_wrap = true;
                holder.add_child(l);
            }
            if (selected)
                holder.add_child(new St.Label({text: '✓ Selected', style_class: 'mk-clip-selected-badge',
                    x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.END}));   // (the corner: the text stays readable)
            b.set_child(holder);
            b.connect('clicked', () => this._pick(item));
            this._shelfRow.add_child(b);
        }
    }

    // on the clipboard, in place: the pick goes to view.json first (MK's history then
    // knows the copy that follows is this entry, and doesn't move it to the top)
    _pick(item) {
        const view = readJson(CLIP_VIEW, {});
        view.selected = item.id;
        view.selected_at = Date.now();
        try {
            GLib.mkdir_with_parents(CLIP_DIR, 0o700);
            GLib.file_set_contents(CLIP_VIEW, JSON.stringify(view));
        } catch {}
        const clipboard = St.Clipboard.get_default();
        if (item.image) {
            try {
                const [, data] = GLib.file_get_contents(item.image);
                clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(data));
            } catch {
                return;
            }
        } else {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text ?? '');
        }
        this._fillShelf();
    }

    // ----- Focus 25m
    _focus() {
        const controls = this._list._clearButton?.get_parent();
        if (!controls)
            return;
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._focusBtn = new St.Button({style_class: 'mk-focus-button button', can_focus: true,
            label: `Focus ${FOCUS_MIN}m`, x_align: Clutter.ActorAlign.END});
        this._focusBtn.connect('clicked', () => (this._focusEnd ? this._stopFocus(false) : this._startFocus()));
        controls.add_child(this._focusBtn);
    }

    _startFocus() {
        this._focusEnd = GLib.get_monotonic_time() / 1e6 + FOCUS_MIN * 60;
        this._bannersWere = this._notif.get_boolean('show-banners');
        this._notif.set_boolean('show-banners', false);              // Do Not Disturb
        this._focusBtn.add_style_pseudo_class('checked');
        const tick = () => {
            const left = Math.round(this._focusEnd - GLib.get_monotonic_time() / 1e6);
            if (left <= 0) {
                this._stopFocus(true);
                return GLib.SOURCE_REMOVE;
            }
            this._focusBtn.label = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
            return GLib.SOURCE_CONTINUE;
        };
        tick();
        this._focusTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, tick);
    }

    _stopFocus(finished) {
        if (this._focusTimer)
            GLib.source_remove(this._focusTimer);
        this._focusTimer = 0;
        this._focusEnd = 0;
        if (this._bannersWere !== undefined)
            this._notif.set_boolean('show-banners', this._bannersWere);
        this._bannersWere = undefined;
        if (this._focusBtn) {
            this._focusBtn.label = `Focus ${FOCUS_MIN}m`;
            this._focusBtn.remove_style_pseudo_class('checked');
        }
        if (finished)
            Main.notify('Focus session done', `${FOCUS_MIN} minutes: time for a break. Notifications are back on.`);
    }

    destroy() {
        if (this._tick)
            GLib.source_remove(this._tick);
        this._stopFocus(false);
        for (const [obj, id] of this._ids)
            obj.disconnect(id);
        for (const msg of this._dressed ?? []) {
            try {
                msg._mkUndress?.();
            } catch {}
        }
        if (this._dateRow) {
            try {
                this._dateRow.remove_child(this._dateLabel);
                this._dateParent.insert_child_above(this._dateLabel, this._dateRow);
            } catch {}                       // (the menu went first)
            this._dateRow.destroy();
        }
        this._shelfBox?.destroy();
        this._focusBtn?.destroy();
    }
}
