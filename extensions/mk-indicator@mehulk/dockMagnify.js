// macOS-style dock magnification: the icon under the pointer grows and its
// neighbours grow a little less, in a smooth wave.
//
// Dash to Dock clips its icons to the dock, so scaling them in place would cut
// them off. Instead each magnified dock item is drawn as a clone on the shell's
// UI layer, above the dock, while the real one is hidden underneath. The whole
// tile is cloned (icon, hover background, running dot), so nothing of the
// original shows through as a second, unscaled layer. Settings:
// config/dock.conf (MAGNIFY, MAGNIFY_SPREAD, MAGNIFY_MS); MAGNIFY=1 turns it off.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'dock.conf']);
const DEFAULT_CONF = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'dock.conf']);

export function readDockConf() {
    const conf = {MAGNIFY: 1.4, MAGNIFY_SPREAD: 2, MAGNIFY_MS: 160};
    for (const path of [DEFAULT_CONF, USER_CONF]) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                continue;
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
                const match = line.match(/^\s*(MAGNIFY\w*)\s*=\s*([\d.]+)/);
                if (match)
                    conf[match[1]] = parseFloat(match[2]);
            }
        } catch (e) {
            // no file: keep the defaults
        }
    }
    conf.MAGNIFY = Math.min(Math.max(conf.MAGNIFY, 1), 2);
    return conf;
}

// Hidden but still under the pointer: Clutter never picks an actor at opacity
// 0, so the tile would lose its hover and the zoom would flicker. 1 of 255 is
// invisible and keeps it pickable. A Clone ignores its source's opacity.
const HIDDEN = 1;

export class DockMagnify {
    constructor() {
        this.conf = readDockConf();
        this._clones = new Map();   // tile -> {clone, icon}
        this._focus = null;
        this._leaveId = 0;
        this._docks = [];           // [dock, [signal ids on dock or slider]]
        this._boxes = new Set();    // dock icon boxes we listen to
    }

    // Follow the dock while it slides in or out: the clones live outside it,
    // so without this they'd stay where the icons were when hovering began.
    attach(dock) {
        const slider = dock._slider;
        const ids = [];
        if (slider)
            ids.push([slider, slider.connect('notify::slide-x', () => this._syncSoon())]);
        ids.push([dock, dock.connect('hiding', () => this.reset(true))]);
        // Icons added or removed (another desktop's apps): old positions are
        // stale. connectObject lets go by itself when the box is destroyed.
        const box = dock.dash?._box;
        if (box && !this._boxes.has(box)) {
            this._boxes.add(box);
            box.connectObject(
                'child-added', () => this.reset(true),
                'child-removed', () => this.reset(true),
                'destroy', () => this._boxes.delete(box), this);
        }
        this._docks.push([dock, ids]);
    }

    detach(dock) {
        for (const [d, ids] of this._docks) {
            if (d === dock)
                ids.forEach(([obj, id]) => obj.disconnect(id));
        }
        this._docks = this._docks.filter(([d]) => d !== dock);
    }

    // The dock re-lays itself out after slide-x changes: read the icon
    // positions once that frame's layout is done (an idle callback).
    _syncSoon() {
        if (this._syncId || !this._clones.size)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        for (const {clone, icon} of this._clones.values()) {
            const [x, y] = icon.get_transformed_position();
            clone.set_position(x, y);
        }
    }

    get enabled() {
        return this.conf.MAGNIFY > 1.001;
    }

    // No magnifying for MS milliseconds (a desktop switch is re-laying the dock out).
    suppress(ms) {
        this._quietUntil = GLib.get_monotonic_time() + ms * 1000;
    }

    // Called by DockGlow whenever a dock tile's hover changes.
    hover(tile) {
        if (!this.enabled || GLib.get_monotonic_time() < (this._quietUntil ?? 0))
            return;
        if (tile.hover) {
            if (this._leaveId) {
                GLib.source_remove(this._leaveId);
                this._leaveId = 0;
            }
            this._focus = tile;
            this._update();
        } else if (this._focus === tile && !this._leaveId) {
            // Moving to the next icon fires "leave" just before "enter":
            // wait a moment so the wave glides instead of collapsing.
            this._leaveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                this._leaveId = 0;
                this._focus = null;
                this.reset();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _tiles(tile) {
        const box = tile.get_parent()?.get_parent();
        if (!box)
            return [tile];
        return box.get_children().map(c => c.child ?? c)
            .filter(t => t?.app && t.has_style_class_name?.('overview-tile'));
    }

    _update() {
        const tiles = this._tiles(this._focus);
        const index = tiles.indexOf(this._focus);
        const spread = Math.max(0, Math.round(this.conf.MAGNIFY_SPREAD));
        tiles.forEach((tile, i) => {
            const d = Math.abs(i - index);
            const falloff = d > spread ? 0 : Math.cos((d / (spread + 1)) * Math.PI / 2) ** 2;
            this._scale(tile, 1 + (this.conf.MAGNIFY - 1) * falloff);
        });
        for (const tile of [...this._clones.keys()]) {
            if (!tiles.includes(tile))
                this._scale(tile, 1);
        }
    }

    _scale(tile, scale) {
        let entry = this._clones.get(tile);
        if (scale <= 1.001) {
            if (entry)
                this._shrink(tile, entry);
            return;
        }
        if (!entry) {
            const icon = tile;
            if (!icon.get_stage())
                return;
            const clone = new Clutter.Clone({source: icon, reactive: false});
            clone.pivot_point = new Graphene.Point({x: 0.5, y: 1});
            Main.layoutManager.uiGroup.add_child(clone);
            entry = {clone, icon, destroyId: tile.connect('destroy', () => this._drop(tile))};
            this._clones.set(tile, entry);
            // One layer only: no hover tint or halo while it's
            // magnified (the clone would carry it, and St's style transition
            // left a second, unscaled copy of the halo under the clone).
            tile.add_style_class_name('mk-magnified');
            icon.remove_transition('opacity');
            icon.opacity = HIDDEN;
        }
        const {clone, icon} = entry;
        const [x, y] = icon.get_transformed_position();
        const [w, h] = icon.get_transformed_size();
        clone.set_position(x, y);
        clone.set_size(w, h);
        clone.remove_all_transitions();
        clone.ease({
            scale_x: scale,
            scale_y: scale,
            duration: this.conf.MAGNIFY_MS,
            // Cubic: quick start, long soft landing, like the macOS dock.
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _shrink(tile, entry) {
        entry.clone.remove_all_transitions();
        entry.clone.ease({
            scale_x: 1,
            scale_y: 1,
            duration: this.conf.MAGNIFY_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            // interrupted by a new hover: keep the clone, it grows again
            onStopped: finished => finished && this._drop(tile),
        });
    }

    _drop(tile) {
        const entry = this._clones.get(tile);
        if (!entry)
            return;
        this._clones.delete(tile);
        tile.disconnect(entry.destroyId);
        tile.remove_style_class_name('mk-magnified');
        // Restore only our own change (Dash to Dock fades items it removes).
        if (entry.icon.get_stage() && entry.icon.opacity === HIDDEN)
            entry.icon.opacity = 255;
        entry.clone.destroy();
    }

    // Shrink everything (pointer left the dock, overview opened, ...).
    reset(immediate = false) {
        for (const [tile, entry] of [...this._clones]) {
            if (immediate)
                this._drop(tile);
            else
                this._shrink(tile, entry);
        }
    }

    destroy() {
        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }
        for (const [, ids] of this._docks)
            ids.forEach(([obj, id]) => obj.disconnect(id));
        for (const box of this._boxes)
            box.disconnectObject(this);
        this._boxes.clear();
        this._docks = [];
        if (this._leaveId) {
            GLib.source_remove(this._leaveId);
            this._leaveId = 0;
        }
        this.reset(true);
    }
}
