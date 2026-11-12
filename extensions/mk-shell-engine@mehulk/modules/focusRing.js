// MK Shell Engine: a crisp outline around the window you're working in (as Niri draws it): 2 px, a border only,
// in your accent colour, following the window's corners, just above it in the stacking (so a
// window over it still covers it), on floating and tiled windows. Never on a maximized or
// full-screen window, in the overview, not while workspaces slide, not on dialogs or menus.
// `focus-ring` (on by default) under org.gnome.shell.extensions.mk-shell-engine switches it.
//
// Cost: one non-reactive actor, moved only when the focused window moves, resizes or changes.
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB, onAccentChanged } from './colour.js';
import { isWallpaperWindow } from './wallpaperWindow.js';

const WIDTH = 2;            // px
const RADIUS = 12;          // libadwaita's window corners
const TYPES = [Meta.WindowType.NORMAL];

export class FocusRing {
    constructor(settings) {
        this._settings = settings;
        this._ring = new St.Widget({name: 'mk-focus-ring', reactive: false, opacity: 0, visible: false});
        global.window_group.add_child(this._ring);
        this._paint();
        this._accentOff = onAccentChanged(() => this._paint());
        // (and on every restack: Mutter re-orders its window actors and would leave the outline on top)
        global.display.connectObject('notify::focus-window', () => this._follow(), 'restacked', () => this._sync(), this);
        global.window_manager.connectObject('switch-workspace', () => this._pauseForSlide(), this);
        Main.overview.connectObject('showing', () => this._hide(), 'hidden', () => this._sync(), this);
        settings.connectObject('changed::focus-ring', () => this._sync(), this);
        this._follow();
    }

    _paint() {
        const [r, g, b] = accentRGB() ?? [120, 170, 255];
        // (a border only: St draws a box-shadow as a blurred fill of the whole box, and on an empty
        // box over a window that tinted the entire window in the accent colour)
        this._ring.style = `border: ${WIDTH}px solid rgba(${r},${g},${b},0.90); border-radius: ${RADIUS}px;`;
    }

    _follow() {
        this._win?.disconnectObject(this);
        this._win = global.display.focus_window;
        this._win?.connectObject('position-changed', () => this._sync(), 'size-changed', () => this._sync(),
            'notify::maximized-horizontally', () => this._sync(), 'notify::maximized-vertically', () => this._sync(),
            'notify::fullscreen', () => this._sync(), 'notify::minimized', () => this._sync(),
            'unmanaged', () => this._follow(), this);
        this._sync();
    }

    _wanted(win) {
        if (!win || !this._settings.get_boolean('focus-ring') || Main.overview.visible || this._sliding)
            return false;
        if (!TYPES.includes(win.window_type) || win.minimized || win.fullscreen || isWallpaperWindow(win))
            return false;
        if (win.maximized_horizontally && win.maximized_vertically)
            return false;                            // (maximized: every pixel is the window's)
        return win.get_workspace() === global.workspace_manager.get_active_workspace() || win.is_on_all_workspaces();
    }

    _sync() {
        try {
            const win = this._win;
            if (!this._wanted(win)) {
                this._hide();
                return;
            }
            const actor = win.get_compositor_private();
            if (!actor) {
                this._hide();
                return;
            }
            const rect = win.get_frame_rect();
            this._ring.set_position(rect.x - WIDTH, rect.y - WIDTH);
            this._ring.set_size(rect.width + 2 * WIDTH, rect.height + 2 * WIDTH);
            // just above its window: windows stacked over it still cover the outline
            if (actor.get_parent() === global.window_group)
                global.window_group.set_child_above_sibling(this._ring, actor);
            else
                global.window_group.set_child_above_sibling(this._ring, null);
            if (!this._ring.visible || this._ring.opacity < 255) {
                this._ring.show();
                this._ring.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            }
        } catch {
            this._hide();                            // (a window going away as it's read)
        }
    }

    _hide() {
        this._ring.remove_all_transitions();
        this._ring.opacity = 0;
        this._ring.hide();
    }

    // workspaces sliding: the windows move inside the slide, the outline would stay behind
    _pauseForSlide() {
        this._sliding = true;
        this._hide();
        if (this._slideId)
            GLib.source_remove(this._slideId);
        this._slideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 480, () => {
            this._slideId = 0;
            this._sliding = false;
            this._follow();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._slideId)
            GLib.source_remove(this._slideId);
        this._slideId = 0;
        this._accentOff?.();
        this._win?.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._ring.destroy();
    }
}
