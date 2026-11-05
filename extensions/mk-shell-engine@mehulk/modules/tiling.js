// MK Shell Engine: snap layouts (Super+Z): a frosted card of five layouts, up at once.
// 1-5 (or the arrows and Enter, or a click) tiles the focused window into the
// layout's main part and your other windows on this desktop, most recent
// first, into the rest. Hover or arrow onto a layout and its parts show on
// the desktop behind, so you see where everything lands before you choose.
// Esc, Super+Z again or a click outside closes it.
//
// Super+Shift+Z gathers a coder's windows (VS Code or another editor, a
// terminal, a browser on localhost) onto a fresh desktop, side by side.
//
// Nothing here polls or runs a command: it reads the window list when asked.
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './colour.js';

const GAP = 8;               // between tiles, and to the screen's edge
const FADE = 90;             // the card's fade in, ms
const GLIDE = 140;           // a window gliding to its place, ms

// [name, parts]: a part is [x, y, width, height] in fractions of the work
// area. The first part is the main one: the focused window goes there.
export const LAYOUTS = [
    ['50 / 50 Split', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]],
    ['3-Column Studio', [[0.25, 0, 0.5, 1], [0, 0, 0.25, 1], [0.75, 0, 0.25, 1]]],
    ['Center Stage', [[0, 0, 0.7, 1], [0.7, 0, 0.3, 0.5], [0.7, 0.5, 0.3, 0.5]]],
    ['2 x 2 Grid', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]],
    ['70 / 30 Duo', [[0, 0, 0.7, 1], [0.7, 0, 0.3, 1]]],
];

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

function unmaximize(win) {
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    try {
        win.unmaximize();                          // GNOME 49 and later
    } catch {
        win.unmaximize(Meta.MaximizeFlags.BOTH);   // earlier
    }
}

// Put WIN at RECT; it glides there from where it was (unless animations are off).
function place(win, rect) {
    unmaximize(win);
    const before = win.get_frame_rect();
    win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
    const actor = win.get_compositor_private();
    if (!actor || !St.Settings.get().enable_animations)
        return;
    actor.remove_transition('translation-x');
    actor.remove_transition('translation-y');
    actor.translation_x = before.x - rect.x;
    actor.translation_y = before.y - rect.y;
    actor.ease({translation_x: 0, translation_y: 0, duration: GLIDE, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
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

        const panel = new St.BoxLayout({vertical: true, style_class: 'mk-snap-panel', reactive: true});
        panel.add_effect(new Shell.BlurEffect({radius: 24, brightness: 0.68, mode: Shell.BlurMode.BACKGROUND}));
        panel.add_child(new St.Label({text: 'Snap layouts', style_class: 'mk-snap-heading'}));
        const row = new St.BoxLayout({style: 'spacing: 10px;'});
        this._cards = LAYOUTS.map((layout, i) => {
            const card = this._card(layout, i);
            row.add_child(card);
            return card;
        });
        panel.add_child(row);
        panel.add_child(new St.Label({style_class: 'mk-snap-hint',
            text: '1-5 or click: snap. Arrows and Enter pick. Esc closes. Super+Shift+Z: coder desktop.'}));
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
        const card = new St.BoxLayout({vertical: true, reactive: true, track_hover: true, style_class: 'mk-snap-card'});
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
        LAYOUTS[index][1].forEach((part, i) => {
            const r = partRect(this._area, part);
            this._previews.add_child(new St.Widget({x: r.x - ox, y: r.y - oy, width: r.width, height: r.height,
                style: `border-radius: 14px; border: 2px solid rgba(${this._rgb},${i === 0 ? 0.9 : 0.45});
                    background-color: rgba(${this._rgb},${i === 0 ? 0.22 : 0.08});`}));
        });
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        const n = key - Clutter.KEY_1;
        if (n >= 0 && n < LAYOUTS.length) {
            this._apply(n);
        } else if (key >= Clutter.KEY_KP_1 && key < Clutter.KEY_KP_1 + LAYOUTS.length) {
            this._apply(key - Clutter.KEY_KP_1);
        } else if (key === Clutter.KEY_Right || key === Clutter.KEY_Down || key === Clutter.KEY_Tab) {
            this._select((this._selected + 1) % LAYOUTS.length);
        } else if (key === Clutter.KEY_Left || key === Clutter.KEY_Up || key === Clutter.KEY_ISO_Left_Tab) {
            this._select((this._selected + LAYOUTS.length - 1) % LAYOUTS.length);
        } else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space) {
            this._apply(this._selected);
        } else if (key === Clutter.KEY_Escape || key === Clutter.KEY_z || key === Clutter.KEY_Z) {
            this.close();
        }
        return Clutter.EVENT_STOP;
    }

    _apply(index) {
        const focus = this._focus;
        this.close();
        if (!focus || focus.unmanaging)
            return;
        const others = windowsHere().filter(w => w !== focus && w.get_monitor() === focus.get_monitor());
        tile(LAYOUTS[index], [focus, ...others]);
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
