// Dock hover glow in each app's own colour: Spotify glows green, VS Code
// blue, Firefox orange. The colour comes from the app's icon (its most
// saturated hue), worked out once per app and cached.
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DockMagnify } from './dockMagnify.js';

const SAMPLE = 24;
const colourCache = new Map();
let iconTheme = null;

function iconPixbuf(app) {
    const gicon = app.get_icon?.();
    if (!gicon)
        return null;
    try {
        if (gicon instanceof Gio.FileIcon)
            return GdkPixbuf.Pixbuf.new_from_file_at_size(gicon.get_file().get_path(), 48, 48);
        if (gicon instanceof Gio.ThemedIcon) {
            iconTheme ??= new St.IconTheme();
            const info = iconTheme.choose_icon(gicon.get_names(), 48, 0);
            return info ? info.load_icon() : null;
        }
    } catch (e) {
        // unreadable icon: no colour, the default cyan hover applies
    }
    return null;
}

function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r)
            h = ((g - b) / d) % 6;
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h *= 60;
        if (h < 0)
            h += 360;
    }
    return [h, max ? d / max : 0, max];
}

function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(n => Math.round(n * 255));
}

// The icon's dominant vivid colour: a hue histogram weighted by saturation
// and opacity, so Spotify's green wins over its black background.
export function appColour(app) {
    const id = app.get_id?.() ?? '';
    if (colourCache.has(id))
        return colourCache.get(id);
    let colour = null;
    const big = iconPixbuf(app);
    if (big) {
        const pb = big.scale_simple(SAMPLE, SAMPLE, GdkPixbuf.InterpType.BILINEAR);
        const pixels = pb.get_pixels(), stride = pb.get_rowstride(), n = pb.get_n_channels();
        const buckets = new Array(36).fill(0).map(() => ({w: 0, h: 0}));
        for (let y = 0; y < SAMPLE; y++) {
            for (let x = 0; x < SAMPLE; x++) {
                const i = y * stride + x * n;
                const a = n === 4 ? pixels[i + 3] / 255 : 1;
                const [h, s, v] = rgbToHsv(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255);
                const weight = a * s * s * v;
                if (weight < 0.02)
                    continue;
                const bucket = buckets[Math.floor(h / 10) % 36];
                bucket.w += weight;
                bucket.h += h * weight;
            }
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        // Grey or monochrome icons get no colour: the default cyan applies.
        if (best.w > 0.5)
            colour = hsvToRgb(best.h / best.w, 0.72, 0.95);
    }
    colourCache.set(id, colour);
    return colour;
}

function findOverviewIcon(actor) {
    if (actor.has_style_class_name?.('overview-icon'))
        return actor;
    for (const child of actor.get_children()) {
        const found = findOverviewIcon(child);
        if (found)
            return found;
    }
    return null;
}

function* appTiles(actor) {
    if (actor.app && actor.has_style_class_name?.('overview-tile'))
        yield actor;
    for (const child of actor.get_children())
        yield* appTiles(child);
}

export class DockGlow {
    enable() {
        this._magnify = new DockMagnify();
        this._docks = [];
        this._tiles = new Map();
        // Dash to Dock may start after us: look for its docks a few times.
        this._tries = 0;
        this._findId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._attachDocks();
            return ++this._tries < 15 ? GLib.SOURCE_CONTINUE : (this._findId = 0, GLib.SOURCE_REMOVE);
        });
        this._attachDocks();
    }

    _attachDocks() {
        for (const dock of Main.uiGroup.get_children()) {
            if (dock.name !== 'dashtodockContainer' || this._docks.some(d => d.actor === dock))
                continue;
            const box = dock.dash?._box;
            const ids = [];
            if (box) {
                ids.push(box.connect('child-added', () => this._queueScan(dock)));
                ids.push(box.connect('child-removed', () => this._queueScan(dock)));
            }
            this._magnify?.attach(dock);
            const destroyId = dock.connect('destroy', () => {
                this._magnify?.detach(dock);
                this._docks = this._docks.filter(d => d.actor !== dock);
            });
            this._docks.push({actor: dock, box, ids, destroyId});
            this._scan(dock);
        }
    }

    _queueScan(dock) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            // The dock may have been destroyed meanwhile (screen lock, Dash to
            // Dock reloading): only scan docks we still track.
            if (this._docks?.some(d => d.actor === dock))
                this._scan(dock);
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan(dock) {
        for (const tile of appTiles(dock)) {
            if (this._tiles.has(tile))
                continue;
            const id = tile.connect('notify::hover', () => this._hover(tile));
            const destroyId = tile.connect('destroy', () => this._tiles.delete(tile));
            this._tiles.set(tile, [id, destroyId]);
        }
    }

    _hover(tile) {
        this._magnify?.hover(tile);
        const icon = findOverviewIcon(tile);
        if (!icon)
            return;
        const colour = tile.hover ? appColour(tile.app) : null;
        if (!colour) {
            icon.set_style(null);
            return;
        }
        // Subtle on purpose: a soft circular tint and a faint halo, not a neon ring.
        const [r, g, b] = colour;
        icon.set_style(
            'border-radius: 999px;' +
            `background-color: rgba(${r},${g},${b},0.10);` +
            `box-shadow: 0 0 10px 0 rgba(${r},${g},${b},0.22);` +
            'transition-duration: 220ms;');
    }

    // Overview opening, screen locking: no magnified icons left behind.
    resetMagnify() {
        this._magnify?.reset(true);
    }

    disable() {
        this._magnify?.destroy();
        this._magnify = null;
        if (this._findId) {
            GLib.source_remove(this._findId);
            this._findId = 0;
        }
        for (const [tile, ids] of this._tiles) {
            ids.forEach(id => tile.disconnect(id));
            findOverviewIcon(tile)?.set_style(null);
        }
        this._tiles = null;
        for (const {actor, box, ids, destroyId} of this._docks) {
            ids.forEach(id => box?.disconnect(id));
            actor.disconnect(destroyId);
        }
        this._docks = null;
    }
}
