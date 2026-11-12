// MK Shell Engine: an ambient clock on the desktop: the time in bold tabular figures, the date
// under it (Sat, Nov 07), at the left of the primary monitor, in the background layer (under every
// window, never taking a click), the date in your accent colour. It's there for the bare desktop:
// the moment an ordinary window shows on this workspace it fades away (200 ms), and it comes back
// when the workspace is empty again (or Super+D clears it). `desktop-clock` switches it.
// Cost: a minute tick, aligned to the minute, and a recount when windows come, go or move.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB, onAccentChanged } from './colour.js';
import { isWallpaperWindow } from './wallpaperWindow.js';

const FADE = 200;

export class DesktopClock {
    constructor(settings) {
        this._settings = settings;
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-desk-clock',
            reactive: false, opacity: 0});
        this._time = new St.Label({style_class: 'mk-desk-clock-time'});
        this._date = new St.Label({style_class: 'mk-desk-clock-date'});
        this.actor.add_child(this._time);
        this.actor.add_child(this._date);
        Main.layoutManager._backgroundGroup.add_child(this.actor);
        this._place();
        this._tint();
        this._tick();
        this._accentOff = onAccentChanged(() => this._tint());
        Main.layoutManager.connectObject('monitors-changed', () => this._place(), this);
        this._iface.connectObject('changed::clock-format', () => this._tick(false), this);
        settings.connectObject('changed::desktop-clock', () => this._queue(), this);
        global.display.connectObject('restacked', () => this._queue(), 'window-created', () => this._queue(), this);
        global.window_manager.connectObject('minimize', () => this._queue(), 'unminimize', () => this._queue(),
            'map', () => this._queue(), 'destroy', () => this._queue(), this);
        global.workspace_manager.connectObject('active-workspace-changed', () => this._queue(), this);
        Main.overview.connectObject('showing', () => this._queue(), 'hidden', () => this._queue(), this);
        this._queue();
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (m)
            this.actor.set_position(m.x + Math.round(m.width * 0.07), m.y + Math.round(m.height * 0.30));
    }

    _tint() {
        const [r, g, b] = accentRGB() ?? [140, 180, 255];
        this._date.style = `color: rgba(${r},${g},${b},0.92);`;
    }

    // the minute's time now, then again at the next minute's start
    _tick(schedule = true) {
        const now = GLib.DateTime.new_now_local();
        const twelve = this._iface.get_string('clock-format') === '12h';
        this._time.text = now.format(twelve ? '%l:%M' : '%H:%M').trim();
        this._date.text = now.format('%a, %b %d');
        if (!schedule)
            return;
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60 - now.get_second(), () => {
            this._tickId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _windowsHere() {
        const ws = global.workspace_manager.get_active_workspace();
        const primary = Main.layoutManager.primaryIndex;
        return ws.list_windows().some(w => !w.minimized && !w.skip_taskbar && w.get_monitor() === primary &&
            !isWallpaperWindow(w) && (w.window_type === Meta.WindowType.NORMAL || w.window_type === Meta.WindowType.DIALOG));
    }

    _sync() {
        let show = false;
        try {
            show = this._settings.get_boolean('desktop-clock') && !Main.overview.visible && !this._windowsHere();
        } catch {}
        const target = show ? 255 : 0;
        if (this.actor.opacity === target && !this.actor.get_transition('opacity'))
            return;
        this.actor.ease({opacity: target, duration: FADE, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    destroy() {
        for (const id of [this._tickId, this._idle].filter(Boolean))
            GLib.source_remove(id);
        this._tickId = this._idle = 0;
        this._accentOff?.();
        for (const o of [Main.layoutManager, this._iface, this._settings, global.display, global.window_manager,
            global.workspace_manager, Main.overview])
            o.disconnectObject(this);
        this.actor.destroy();
    }
}
