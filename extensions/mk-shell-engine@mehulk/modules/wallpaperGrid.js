// MK Shell Engine: the wallpaper picker (Super+W): a 3 x 3 grid of your pictures in a frosted card.
//
//   the header: Search (type to filter by name), Shuffle (a random one), Auto-rotate (Off, 15m, 30m,
//   1h: `wallpaper-shuffle-minutes`) and Open Folder (Pictures/Wallpapers in Files: drop pictures in)
//   the tiles: 16:9, rounded, the picked one ringed in the accent colour, eight colours from each
//   picture along its bottom; more than nine scroll
//   arrows move, Enter or a click sets it (the contour-trace transition), Esc closes
// The pictures: Pictures/Wallpapers and MK's own (`mk-wallpaper list
// --json`: cached thumbnails and palettes). Pictures/Wallpapers is watched: whatever you drop in shows
// up in the grid at once, open or not.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './colour.js';
import { openModal } from './modal.js';

const HELPER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-wallpaper']);
const FOLDER = GLib.build_filenamev([GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ??
    GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']), 'Wallpapers']);
const WIDTH = 780, COLS = 3, GAP = 14, PAD = 18;
const TILE_W = Math.floor((WIDTH - 2 * PAD - (COLS - 1) * GAP) / COLS), TILE_H = Math.round(TILE_W * 9 / 16);
const ROTATE = [['Off', 0], ['15m', 15], ['30m', 30], ['1h', 60]];

export class WallpaperGrid {
    constructor(settings, onPick, onShuffle) {
        this._settings = settings;
        this._onPick = onPick;
        this._onShuffle = onShuffle;
        // the drop-in folder, watched (a new picture shows up in an open grid at once)
        try {
            GLib.mkdir_with_parents(FOLDER, 0o755);
            this._monitor = Gio.File.new_for_path(FOLDER).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor.connect('changed', () => this._folderChanged());
        } catch (e) {
            console.warn(`mk-shell-engine: wallpaper folder: ${e.message}`);
        }
    }

    get shown() {
        return Boolean(this._actor);
    }

    _folderChanged() {
        if (!this._actor || this._reloadId)
            return;
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {   // (a copy settles first)
            this._reloadId = 0;
            this._load(items => this._actor && this._fill(items));
            return GLib.SOURCE_REMOVE;
        });
    }

    _load(done) {
        this._cancel?.cancel();
        this._cancel = new Gio.Cancellable();
        let proc;
        try {
            proc = Gio.Subprocess.new([HELPER, 'list', '--json'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            Main.panel._mkIsland?.show({icon: 'preferences-desktop-wallpaper-symbolic', text: 'mk-wallpaper is missing: run mk sync'});
            return;
        }
        const cancel = this._cancel;
        proc.communicate_utf8_async(null, cancel, (p, res) => {
            let items = [];
            try {
                items = JSON.parse(p.communicate_utf8_finish(res)[1]);
            } catch {}
            if (!cancel.is_cancelled())
                done(items);
        });
    }

    open() {
        if (this._actor || this._opening)
            return;
        this._opening = true;
        this._load(items => {
            this._opening = false;
            try {
                this._build(items);
            } catch (e) {
                console.warn(`mk-shell-engine: wallpaper grid: ${e.message}`);
                this.close();
            }
        });
    }

    _build(items) {
        const m = Main.layoutManager.primaryMonitor;
        const [r, g, b] = accentRGB() ?? [120, 170, 255];
        this._accent = `${r},${g},${b}`;
        this._actor = new St.Widget({reactive: true, x: m.x, y: m.y, width: m.width, height: m.height, opacity: 0,
            style: 'background-color: rgba(0,0,0,0.30);'});
        this._actor.connect('button-press-event', (_a, event) => {
            if (event.get_source() === this._actor)
                this.close();
            return Clutter.EVENT_STOP;
        });
        const card = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-wall-grid',
            reactive: true, width: WIDTH});
        // the header
        const head = new St.BoxLayout({style_class: 'mk-wall-head'});
        this._search = new St.Entry({hint_text: 'Search wallpapers…', can_focus: true, x_expand: true,
            style_class: 'mk-wall-search'});
        this._search.clutter_text.connect('text-changed', () => this._filter());
        this._search.clutter_text.connect('activate', () => this._pick());
        head.add_child(this._search);
        const button = (label, icon, fn) => {
            const inner = new St.BoxLayout({style: 'spacing: 6px;'});
            inner.add_child(new St.Icon({icon_name: icon, icon_size: 14, y_align: Clutter.ActorAlign.CENTER}));
            inner.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            const b = new St.Button({child: inner, style_class: 'mk-wall-btn', can_focus: true});
            b.connect('clicked', fn);
            head.add_child(b);
            return b;
        };
        button('Shuffle', 'media-playlist-shuffle-symbolic', () => {
            this.close();
            this._onShuffle();
        });
        const rotate = new St.BoxLayout({style_class: 'mk-wall-rotate'});
        rotate.add_child(new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 13, y_align: Clutter.ActorAlign.CENTER,
            style: 'margin: 0 4px 0 6px;'}));
        const now = this._settings.get_int('wallpaper-shuffle-minutes');
        this._rotateButtons = ROTATE.map(([label, minutes]) => {
            const b = new St.Button({label, style_class: 'mk-wall-rotate-btn', toggle_mode: true, can_focus: true,
                checked: minutes === now || (minutes === 0 && !ROTATE.some(([, v]) => v === now))});
            b.connect('clicked', () => {
                this._settings.set_int('wallpaper-shuffle-minutes', minutes);
                this._rotateButtons.forEach(([v, o]) => (o.checked = v === minutes));
            });
            rotate.add_child(b);
            return [minutes, b];
        });
        head.add_child(rotate);
        button('Open Folder', 'folder-pictures-symbolic', () => {
            this.close();
            try {
                Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(FOLDER).get_uri(), global.create_app_launch_context(0, -1));
            } catch (e) {
                console.warn(`mk-shell-engine: open wallpaper folder: ${e.message}`);
            }
        });
        card.add_child(head);
        // the grid: 3 x 3 in view, more scroll. (Rows of boxes: a ScrollView takes only a scrollable
        // child, which a box is and a plain widget with a grid layout isn't: that refused to build)
        this._grid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-wall-tiles',
            style: `spacing: ${GAP}px;`});
        this._scroll = new St.ScrollView({child: this._grid, hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, style_class: 'mk-wall-scroll',
            height: TILE_H * 3 + GAP * 2 + 8, x_expand: true});
        card.add_child(this._scroll);
        this._empty = new St.Label({style_class: 'mk-wall-empty', visible: false, x_align: Clutter.ActorAlign.CENTER,
            text: 'No pictures yet: Open Folder and drop some in'});
        card.add_child(this._empty);
        this._actor.add_child(card);
        card.set_position(Math.round((m.width - WIDTH) / 2), Math.max(40, Math.round(m.height * 0.14)));
        Main.layoutManager.addTopChrome(this._actor);
        this._modal = openModal(this._actor, () => this.close());
        if (!this._modal) {
            this.close();
            return;
        }
        this._actor.connect('key-press-event', (_a, e) => this._key(e));
        this._fill(items);
        this._search.grab_key_focus();
        this._actor.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        card.set_pivot_point(0.5, 0.2);
        card.set_scale(0.94, 0.94);
        card.ease({scale_x: 1, scale_y: 1, duration: 190, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    _fill(items) {
        this._items = items;
        const current = items.findIndex(i => i.current);
        this._filter(current >= 0 ? current : 0);
    }

    _filter(prefer = null) {
        const query = this._search?.get_text().trim().toLowerCase() ?? '';
        this._shown = this._items.map((item, i) => [item, i]).filter(([item]) => !query || item.name.toLowerCase().includes(query));
        this._grid.destroy_all_children();
        let row = null;
        this._tiles = this._shown.map(([item], k) => {
            const tile = new St.Button({style_class: 'mk-wall-tile', can_focus: false, width: TILE_W, height: TILE_H,
                style: `background-image: url("${Gio.File.new_for_path(item.thumb).get_uri()}"); background-size: cover;`});
            const dots = new St.BoxLayout({style_class: 'mk-wall-swatches', x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true});
            for (const colour of (item.palette ?? []).slice(0, 8))
                dots.add_child(new St.Widget({style_class: 'mk-wall-swatch', style: `background-color: ${colour};`}));
            const layer = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
            layer.add_child(dots);
            tile.set_child(layer);
            tile.connect('clicked', () => {
                this._select(k);
                this._pick();
            });
            tile.connect('notify::hover', () => tile.hover && this._select(k, false));
            if (k % COLS === 0) {
                row = new St.BoxLayout({style: `spacing: ${GAP}px;`});
                this._grid.add_child(row);
            }
            row.add_child(tile);
            return tile;
        });
        this._empty.visible = this._tiles.length === 0;
        const start = prefer !== null ? this._shown.findIndex(([, i]) => i === prefer) : 0;
        if (this._tiles.length)
            this._select(Math.max(0, start));
    }

    _select(k, scroll = true) {
        if (!this._tiles?.length)
            return;
        this._index = Math.max(0, Math.min(this._tiles.length - 1, k));
        this._tiles.forEach((tile, j) => {
            const ring = j === this._index ? `border: 2px solid rgba(${this._accent},1); box-shadow: 0 0 18px 0 rgba(${this._accent},0.45);` : '';
            tile.style = tile.style.replace(/border:[^;]*;|box-shadow:[^;]*;/g, '') + ring;
        });
        if (scroll) {
            const row = Math.floor(this._index / COLS);
            const adj = this._scroll.vadjustment;
            const top = row * (TILE_H + GAP), view = adj.page_size || TILE_H * 3;
            if (top < adj.value)
                adj.ease(top, {duration: 160, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            else if (top + TILE_H > adj.value + view)
                adj.ease(top + TILE_H - view, {duration: 160, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    _key(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        const moves = {[Clutter.KEY_Right]: 1, [Clutter.KEY_Left]: -1, [Clutter.KEY_Down]: COLS, [Clutter.KEY_Up]: -COLS};
        if (key in moves) {
            this._select(this._index + moves[key]);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
            this._pick();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;          // (typing goes to the search)
    }

    _pick() {
        const item = this._shown?.[this._index]?.[0];
        this.close();
        if (item && !item.current)
            this._onPick(item.path);
    }

    close() {
        this._cancel?.cancel();
        this._opening = false;
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = 0;
        if (!this._actor)
            return;
        this._modal?.close();
        this._modal = null;
        const actor = this._actor;
        this._actor = this._grid = this._tiles = this._items = this._shown = this._search = this._scroll = null;
        actor.ease({opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                Main.layoutManager.removeChrome(actor);
                actor.destroy();
            }});
    }

    destroy() {
        const actor = this._actor;
        this.close();
        if (actor) {
            actor.remove_all_transitions();
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._monitor?.cancel();
        this._monitor = null;
    }
}
