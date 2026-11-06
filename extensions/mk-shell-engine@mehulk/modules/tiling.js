// MK Shell Engine: snap layouts (Super+Z): a frosted card of five layouts, up at once.
// 1-5 (or the arrows and Enter, or a click) puts the focused window into the
// layout's main part. Hover or arrow onto a layout and its parts show on the
// desktop behind, so you see where everything lands before you choose. Esc,
// Super+Z again or a click outside closes it.
//
// Snap Assist, as in Windows 11: when your other windows on this desktop fit
// the layout's other parts exactly (two windows and a 50 / 50 split), they go
// straight in. With more windows than empty parts, each empty part in turn
// shows a picker over it: a thumbnail of each window left, with its app's
// icon and a number; 1-9 or a click puts that one there. Esc stops (what's
// placed stays placed).
//
// Super+Left / Right: a window snaps to that half (again: back to where it
// was). With two windows side by side, Super+Right on the left one swaps
// them (Super+Left on the right one too), both gliding in 120 ms.
//
// Super+Shift+Z gathers a coder's windows (VS Code or another editor, a
// terminal, a browser on localhost) onto a fresh desktop, side by side.
//
// Nothing here polls or runs a command: it reads the window list when asked.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './colour.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

const GAP = 8;               // between tiles, and to the screen's edge
const FADE = 90;             // the card's fade in, ms
const GLIDE = 140;           // a window gliding to its place, ms
const SWAP_GLIDE = 120;      // two halves trading places, ms
const ASSIST_GLASS = {sigma: 40, brightness: 0.6};
const LEFT_HALF = [0, 0, 0.5, 1], RIGHT_HALF = [0.5, 0, 0.5, 1];

// [name, parts]: a part is [x, y, width, height] in fractions of the work
// area. The first part is the main one: the focused window goes there.
const L = {
    halves: ['50 / 50 Split', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]],
    studio: ['3-Column Studio', [[0.25, 0, 0.5, 1], [0, 0, 0.25, 1], [0.75, 0, 0.25, 1]]],
    stack: ['Main + 2 Stacked', [[0, 0, 0.7, 1], [0.7, 0, 0.3, 0.5], [0.7, 0.5, 0.3, 0.5]]],
    quad: ['2 x 2 Grid', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]],
    duo: ['70 / 30 Duo', [[0, 0, 0.7, 1], [0.7, 0, 0.3, 1]]],
    center: ['Center Stage', [[0.1, 0.05, 0.8, 0.9]]],
    left: ['Left Half', [[0, 0, 0.5, 1]]],
    right: ['Right Half', [[0.5, 0, 0.5, 1]]],
};
// the classic five (the coder desktop uses them by position)
export const LAYOUTS = [L.halves, L.studio, L.stack, L.quad, L.duo];

// The card offers what fits the windows on this desktop, the likeliest first
// (it's the one picked when the card opens, so Enter takes it):
// one window: centred or a half; two: side by side; three: three columns or
// one big and two stacked; four or more: the grid.
export function layoutsFor(count) {
    if (count <= 1)
        return [L.center, L.left, L.right, L.duo, L.halves];
    if (count === 2)
        return [L.halves, L.duo, L.studio, L.stack, L.quad];
    if (count === 3)
        return [L.studio, L.stack, L.halves, L.duo, L.quad];
    return [L.quad, L.studio, L.stack, L.halves, L.duo];
}

const TERMINALS = /ptyxis|gnome-terminal|kgx|console|ghostty|kitty|alacritty|wezterm|foot|tilix|konsole|terminator/;
const EDITORS = /^(code|code-oss|codium|vscodium|com\.visualstudio\.code.*|dev\.zed\.zed|zed|org\.gnome\.builder|jetbrains-.*)$/;
const BROWSERS = /firefox|zen|chrom|brave|vivaldi|epiphany|librewolf/;
const LOCALHOST = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|:\d{4,5}\b/;

const appId = win => (Shell.WindowTracker.get_default().get_window_app(win)?.get_id() ?? win.get_wm_class() ?? '')
    .toLowerCase().replace(/\.desktop$/, '');

// Where part P of the work area AREA is, in pixels, with GAP between tiles.
export function partRect(area, [px, py, pw, ph]) {
    const x0 = Math.round(area.x + GAP + px * (area.width - GAP)), y0 = Math.round(area.y + GAP + py * (area.height - GAP));
    const x1 = Math.round(area.x + GAP + (px + pw) * (area.width - GAP)), y1 = Math.round(area.y + GAP + (py + ph) * (area.height - GAP));
    return {x: x0, y: y0, width: x1 - x0 - GAP, height: y1 - y0 - GAP};
}

// The ordinary windows on the current desktop, most recently used first.
function windowsHere() {
    const ws = global.workspace_manager.get_active_workspace();
    return global.display.get_tab_list(Meta.TabList.NORMAL, ws).filter(w => !w.minimized && !w.skip_taskbar);
}

// Maximized, half-maximized (snapped to an edge) or full screen: such a window
// has to be let go first.
function held(win) {
    return win.is_fullscreen() || win.maximized_horizontally || win.maximized_vertically ||
        (win.is_maximized?.() ?? false);
}

function unmaximize(win) {
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    try {
        win.unmaximize();                          // GNOME 49 and later
    } catch {
        win.unmaximize(Meta.MaximizeFlags.BOTH);   // earlier
    }
}

const SETTLE = 40;           // ms for an app to answer "you're not maximized any more" (Wayland)

// Put WIN at RECT; it glides there from where it was (unless animations are off).
// A maximized window is let go first and moved a moment later: on Wayland the
// app confirms un-maximizing after a frame or two, and that confirmation used
// to put back its old size over a move made at once (Super+Z then only worked
// the second time). It's checked once more after, in case the app was slow.
export function place(win, rect, glide = GLIDE) {
    if (!held(win)) {
        moveTo(win, rect, glide);
        return;
    }
    unmaximize(win);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE, () => {
        if (win.get_compositor_private()) {
            moveTo(win, rect, glide);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                const f = win.get_compositor_private() ? win.get_frame_rect() : null;
                if (f && (Math.abs(f.x - rect.x) > 2 || Math.abs(f.y - rect.y) > 2 ||
                    Math.abs(f.width - rect.width) > 2 || Math.abs(f.height - rect.height) > 2)) {
                    if (held(win))
                        unmaximize(win);
                    win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
        return GLib.SOURCE_REMOVE;
    });
}

function moveTo(win, rect, glide = GLIDE) {
    const before = win.get_frame_rect();
    win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
    const actor = win.get_compositor_private();
    if (!actor || !St.Settings.get().enable_animations)
        return;
    actor.remove_transition('translation-x');
    actor.remove_transition('translation-y');
    actor.translation_x = before.x - rect.x;
    actor.translation_y = before.y - rect.y;
    actor.ease({translation_x: 0, translation_y: 0, duration: glide, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
}

// Tile WINDOWS (main first) into LAYOUT's parts on the work area of the first one's monitor.
export function tile(layout, windows) {
    if (!windows.length)
        return;
    const area = windows[0].get_work_area_current_monitor();
    layout[1].forEach((part, i) => {
        if (windows[i])
            place(windows[i], partRect(area, part));
    });
    windows[0].activate(global.get_current_time());
}

export class SnapLayouts {
    constructor() {
        this._actor = null;
    }

    toggle() {
        if (this._actor)
            this.close();
        else
            this.open();
    }

    open() {
        const focus = global.display.focus_window;
        if (!focus || focus.window_type !== Meta.WindowType.NORMAL) {
            Main.notify('Snap layouts', 'Click a window first: the layout starts with the window you\'re using.');
            return;
        }
        this._focus = focus;
        this._area = focus.get_work_area_current_monitor();
        const here = windowsHere().filter(w => w.get_monitor() === focus.get_monitor());
        this._layouts = layoutsFor(new Set([focus, ...here]).size);
        const monitor = Main.layoutManager.monitors[focus.get_monitor()] ?? Main.layoutManager.primaryMonitor;
        const [r, g, b] = accentRGB();
        this._rgb = `${r},${g},${b}`;

        // the whole monitor: a click outside the card closes; the parts' previews sit on it
        this._actor = new St.Widget({reactive: true, can_focus: true, opacity: 0,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            layout_manager: new Clutter.FixedLayout()});
        this._offset = [monitor.x, monitor.y];
        this._previews = new St.Widget({layout_manager: new Clutter.FixedLayout()});
        this._actor.add_child(this._previews);

        const panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-snap-panel', reactive: true});
        panel.add_effect(new Shell.BlurEffect({radius: 24, brightness: 0.68, mode: Shell.BlurMode.BACKGROUND}));
        panel.add_child(new St.Label({text: 'Snap layouts', style_class: 'mk-snap-heading'}));
        const row = new St.BoxLayout({style: 'spacing: 10px;'});
        this._cards = this._layouts.map((layout, i) => {
            const card = this._card(layout, i);
            row.add_child(card);
            return card;
        });
        panel.add_child(row);
        panel.add_child(new St.Label({style_class: 'mk-snap-hint',
            text: 'Picked for your windows: Enter takes the first. 1-5 or click: snap. Esc closes. Super+Shift+Z: coder desktop.'}));
        this._actor.add_child(panel);
        Main.uiGroup.add_child(this._actor);
        // centre the card on the monitor once it knows its size
        const [, natW] = panel.get_preferred_width(-1), [, natH] = panel.get_preferred_height(natW);
        panel.set_position(Math.round((monitor.width - natW) / 2), Math.round((monitor.height - natH) / 2));

        this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
        this._actor.grab_key_focus();
        this._actor.connect('key-press-event', (_a, event) => this._onKey(event));
        this._actor.connect('button-release-event', (_a, event) => {
            const [x, y] = event.get_coords();
            const [px, py] = panel.get_transformed_position(), [pw, ph] = panel.get_transformed_size();
            if (x < px || x > px + pw || y < py || y > py + ph)
                this.close();
            return Clutter.EVENT_STOP;
        });
        this._select(0);
        this._actor.ease({opacity: 255, duration: FADE, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // A layout card: a small drawing of its parts (the main one lit) and its number and name.
    _card(layout, index) {
        const W = 132, H = 82;
        const card = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, reactive: true, track_hover: true, style_class: 'mk-snap-card'});
        const art = new St.Widget({width: W, height: H, layout_manager: new Clutter.FixedLayout()});
        layout[1].forEach(([x, y, w, h], i) => {
            art.add_child(new St.Widget({x: Math.round(x * W) + 2, y: Math.round(y * H) + 2,
                width: Math.round(w * W) - 4, height: Math.round(h * H) - 4,
                style: `border-radius: 6px; background-color: ${i === 0 ? `rgba(${this._rgb},0.85)` : 'rgba(255,255,255,0.16)'};`}));
        });
        card.add_child(art);
        const label = new St.BoxLayout({style: 'spacing: 6px; margin-top: 8px;'});
        label.add_child(new St.Label({text: `${index + 1}`, style_class: 'mk-snap-key', y_align: Clutter.ActorAlign.CENTER}));
        label.add_child(new St.Label({text: layout[0], style_class: 'mk-snap-name', y_align: Clutter.ActorAlign.CENTER}));
        card.add_child(label);
        card.connect('notify::hover', () => {
            if (card.hover)
                this._select(index);
        });
        card.connect('button-release-event', () => {
            this._apply(index);
            return Clutter.EVENT_STOP;
        });
        return card;
    }

    // Light card INDEX and show its parts on the desktop.
    _select(index) {
        this._selected = index;
        this._cards.forEach((card, i) => {
            if (i === index)
                card.add_style_pseudo_class('checked');
            else
                card.remove_style_pseudo_class('checked');
        });
        this._previews.destroy_all_children();
        const [ox, oy] = this._offset;
        this._layouts[index][1].forEach((part, i) => {
            const r = partRect(this._area, part);
            this._previews.add_child(new St.Widget({x: r.x - ox, y: r.y - oy, width: r.width, height: r.height,
                style: `border-radius: 14px; border: 2px solid rgba(${this._rgb},${i === 0 ? 0.9 : 0.45});
                    background-color: rgba(${this._rgb},${i === 0 ? 0.22 : 0.08});`}));
        });
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        const n = key - Clutter.KEY_1;
        if (n >= 0 && n < this._layouts.length) {
            this._apply(n);
        } else if (key >= Clutter.KEY_KP_1 && key < Clutter.KEY_KP_1 + this._layouts.length) {
            this._apply(key - Clutter.KEY_KP_1);
        } else if (key === Clutter.KEY_Right || key === Clutter.KEY_Down || key === Clutter.KEY_Tab) {
            this._select((this._selected + 1) % this._layouts.length);
        } else if (key === Clutter.KEY_Left || key === Clutter.KEY_Up || key === Clutter.KEY_ISO_Left_Tab) {
            this._select((this._selected + this._layouts.length - 1) % this._layouts.length);
        } else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space) {
            this._apply(this._selected);
        } else if (key === Clutter.KEY_Escape || key === Clutter.KEY_z || key === Clutter.KEY_Z) {
            this.close();
        }
        return Clutter.EVENT_STOP;
    }

    _apply(index) {
        const focus = this._focus, layout = this._layouts[index], area = this._area;
        this.close();
        if (!focus || focus.unmanaging)
            return;
        const others = windowsHere().filter(w => w !== focus && w.get_monitor() === focus.get_monitor());
        const empty = layout[1].slice(1);
        if (others.length <= empty.length) {
            tile(layout, [focus, ...others]);         // they fit: straight in
            return;
        }
        place(focus, partRect(area, layout[1][0]));
        focus.activate(global.get_current_time());
        this._assist = new SnapAssist(area, empty, others, () => (this._assist = null));
    }

    close() {
        if (!this._actor)
            return;
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
        const actor = this._actor;
        this._actor = this._cards = this._previews = this._focus = null;
        actor.destroy();
    }

    // Super+Shift+Z: an editor, a terminal and a browser on localhost onto a
    // desktop of their own, terminal | editor | browser (3-Column Studio).
    coderDesktop() {
        this.close();
        const all = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).filter(w => !w.skip_taskbar);
        const editor = all.find(w => EDITORS.test(appId(w)));
        const terminal = all.find(w => TERMINALS.test(appId(w)));
        const browser = all.find(w => BROWSERS.test(appId(w)) && LOCALHOST.test(w.get_title() ?? ''));
        const found = [editor, terminal, browser].filter(Boolean);
        if (found.length < 2) {
            Main.notify('Coder desktop', 'Needs two of: VS Code (or another editor), a terminal, a browser tab on localhost.');
            return;
        }
        // a fresh desktop: the empty last one GNOME keeps, or a new one
        const manager = global.workspace_manager;
        let index = manager.n_workspaces - 1;
        const last = manager.get_workspace_by_index(index);
        if (last.list_windows().some(w => !found.includes(w) && w.window_type === Meta.WindowType.NORMAL))
            index = manager.append_new_workspace(false, global.get_current_time()).index();
        for (const w of found) {
            if (w.minimized)
                w.unminimize();
            if (w.is_on_all_workspaces())
                w.unstick();
            w.change_workspace_by_index(index, false);
        }
        manager.get_workspace_by_index(index).activate(global.get_current_time());
        const monitor = (editor ?? found[0]).get_monitor();
        for (const w of found) {
            if (w.get_monitor() !== monitor)
                w.move_to_monitor(monitor);
        }
        if (editor && terminal && browser)
            tile(LAYOUTS[1], [editor, terminal, browser]);       // editor in the middle, terminal left, browser right
        else
            tile(LAYOUTS[4], editor ? [editor, ...found.filter(w => w !== editor)] : found);
    }

    destroy() {
        this.close();
        this._assist?.destroy();
    }
}

// Snap Assist: for each empty PART of the layout, a picker over it of the
// windows not placed yet. Fills the rest without asking once they fit.
class SnapAssist {
    constructor(area, parts, candidates, onDone) {
        this._area = area;
        this._parts = [...parts];
        this._left = [...candidates];
        this._onDone = onDone;
        this._next();
    }

    _next() {
        this._hide();
        this._left = this._left.filter(w => !w.unmanaging && w.get_compositor_private());
        if (!this._parts.length || !this._left.length) {
            this.destroy();
            return;
        }
        if (this._left.length <= this._parts.length) {
            // the rest fit: in they go, no question
            this._left.forEach((w, i) => place(w, partRect(this._area, this._parts[i])));
            this.destroy();
            return;
        }
        this._show(partRect(this._area, this._parts[0]));
    }

    _show(rect) {
        const [r, g, b] = accentRGB();
        this._rect = rect;
        this._actor = new St.Widget({reactive: true, can_focus: true, opacity: 0,
            x: 0, y: 0, width: global.stage.width, height: global.stage.height,
            layout_manager: new Clutter.FixedLayout()});
        const zone = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-assist-zone',
            x: rect.x, y: rect.y, width: rect.width, height: rect.height, reactive: true,
            style: `border-color: rgba(${r},${g},${b},0.75);`});
        zone.add_child(new St.Label({text: 'Choose a window for this side', style_class: 'mk-assist-heading',
            x_align: Clutter.ActorAlign.CENTER}));
        const grid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-assist-grid',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, y_expand: true});
        const perRow = rect.width > 900 ? 3 : 2;
        const cardW = Math.min(240, Math.floor((rect.width - 80) / perRow) - 16);
        let row = null;
        this._cards = this._left.slice(0, 9).map((win, i) => {
            if (i % perRow === 0) {
                row = new St.BoxLayout({style_class: 'mk-assist-row'});
                grid.add_child(row);
            }
            const card = this._card(win, i, cardW);
            row.add_child(card);
            return card;
        });
        zone.add_child(grid);
        zone.add_child(new St.Label({text: '1-9 or click to place  ·  Esc to stop', style_class: 'mk-assist-hint',
            x_align: Clutter.ActorAlign.CENTER}));
        this._actor.add_child(zone);
        Main.uiGroup.add_child(this._actor);
        this._unglass = addWallpaperGlass(zone, this._actor, ASSIST_GLASS, 18, desktopCopy);
        this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
        this._actor.grab_key_focus();
        this._actor.connect('key-press-event', (_a, event) => this._key(event));
        this._actor.connect('button-release-event', () => {
            this.destroy();                  // a click outside the zone stops
            return Clutter.EVENT_STOP;
        });
        zone.connect('button-release-event', () => Clutter.EVENT_STOP);
        this._actor.ease({opacity: 255, duration: FADE, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // a window: its live thumbnail, its app's icon and title, and its number
    _card(win, i, width) {
        const card = new St.Button({style_class: 'mk-assist-card', can_focus: true, reactive: true, track_hover: true});
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'spacing: 8px;'});
        const thumbH = Math.round(width * 0.62);
        const frame = new St.Widget({width, height: thumbH, layout_manager: new Clutter.BinLayout(),
            style_class: 'mk-assist-thumb'});
        const actor = win.get_compositor_private();
        const f = win.get_frame_rect(), buf = win.get_buffer_rect();
        if (actor && f.width > 0 && f.height > 0) {
            const k = Math.min(width / f.width, thumbH / f.height);
            // the window's frame (its shadow's margin left out), scaled to fit
            const clone = new Clutter.Clone({source: actor, x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER, width: Math.round(f.width * k), height: Math.round(f.height * k)});
            clone.set_size(Math.round(buf.width * k), Math.round(buf.height * k));
            const holder = new St.Widget({width: Math.round(f.width * k), height: Math.round(f.height * k),
                clip_to_allocation: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            clone.set_position(Math.round((buf.x - f.x) * k), Math.round((buf.y - f.y) * k));
            holder.add_child(clone);
            frame.add_child(holder);
        }
        box.add_child(frame);
        const line = new St.BoxLayout({style: 'spacing: 8px;'});
        line.add_child(new St.Label({text: `${i + 1}`, style_class: 'mk-snap-key', y_align: Clutter.ActorAlign.CENTER}));
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        if (app)
            line.add_child(app.create_icon_texture(20));
        const title = new St.Label({text: win.get_title() ?? app?.get_name() ?? '', style_class: 'mk-assist-title',
            y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        title.clutter_text.ellipsize = 3;          // END
        title.set_width(width - 64);
        line.add_child(title);
        box.add_child(line);
        card.set_child(box);
        card.connect('clicked', () => this._pick(i));
        return card;
    }

    _key(event) {
        const key = event.get_key_symbol();
        let n = key - Clutter.KEY_1;
        if (key >= Clutter.KEY_KP_1 && key <= Clutter.KEY_KP_9)
            n = key - Clutter.KEY_KP_1;
        if (n >= 0 && n < (this._cards?.length ?? 0))
            this._pick(n);
        else if (key === Clutter.KEY_Escape)
            this.destroy();
        return Clutter.EVENT_STOP;
    }

    _pick(i) {
        const win = this._left[i], rect = this._rect;
        if (!win)
            return;
        this._left.splice(i, 1);
        this._parts.shift();
        if (win.minimized)
            win.unminimize();
        place(win, rect);
        win.activate(global.get_current_time());
        this._next();
    }

    _hide() {
        this._unglass?.();
        this._unglass = null;
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
        this._actor?.destroy();
        this._actor = this._cards = null;
    }

    destroy() {
        this._hide();
        this._parts = [];
        this._onDone?.();
        this._onDone = null;
    }
}

// Which half WIN fills, if it's snapped to one (by its shape: about half the
// width, nearly the full height): 'left', 'right' or null.
function halfOf(win) {
    const a = win.get_work_area_current_monitor(), f = win.get_frame_rect();
    if (f.height < a.height * 0.8 || f.width < a.width * 0.35 || f.width > a.width * 0.65)
        return null;
    return f.x + f.width / 2 < a.x + a.width / 2 ? 'left' : 'right';
}

// Super+Left / Right (GNOME's own snap keys, handled here while the engine
// runs): swap two side-by-side windows, or snap one to a half and back.
export class HalfSwap {
    constructor() {
        this._before = new WeakMap();        // where a window was before it was snapped
        for (const [name, side] of [['toggle-tiled-left', 'left'], ['toggle-tiled-right', 'right']])
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, (_d, win) => this._key(win, side));
    }

    _key(win, side) {
        win ??= global.display.focus_window;
        if (!win || win.window_type !== Meta.WindowType.NORMAL || !win.allows_resize?.())
            return;
        const area = win.get_work_area_current_monitor();
        const here = halfOf(win);
        const target = partRect(area, side === 'left' ? LEFT_HALF : RIGHT_HALF);
        if (here && here !== side) {
            // the other half taken: the two trade places
            const partner = windowsHere().find(w => w !== win && w.get_monitor() === win.get_monitor() &&
                halfOf(w) === side);
            if (partner) {
                place(partner, partRect(area, side === 'left' ? RIGHT_HALF : LEFT_HALF), SWAP_GLIDE);
                place(win, target, SWAP_GLIDE);
                return;
            }
        }
        if (here === side) {
            // already there: back to where it was (as GNOME's own keys do)
            const before = this._before.get(win);
            if (before) {
                this._before.delete(win);
                place(win, before);
            }
            return;
        }
        if (!here)
            this._before.set(win, win.get_frame_rect());
        place(win, target);
    }

    destroy() {
        for (const name of ['toggle-tiled-left', 'toggle-tiled-right'])
            Meta.keybindings_set_custom_handler(name, null);     // GNOME's own again
    }
}

export function bindSnapLayouts(extension, snap) {
    const settings = extension.getSettings();
    const modes = Shell.ActionMode.NORMAL;
    Main.wm.addKeybinding('snap-layouts', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, modes, () => snap.toggle());
    Main.wm.addKeybinding('coder-desktop', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, modes, () => snap.coderDesktop());
}

export function unbindSnapLayouts() {
    Main.wm.removeKeybinding('snap-layouts');
    Main.wm.removeKeybinding('coder-desktop');
}
