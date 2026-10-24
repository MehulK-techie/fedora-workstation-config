// Focus timer countdown in the top bar: a small ring and the time left,
// shown only while mk-timer runs. mk-timer writes its state to
// ~/.cache/mk-workstation/timer.json; clicking the pill opens the timer.
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './accent.js';

const STATE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'timer.json']);
const TIMER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-timer']);

function fmt(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export class TimerPill {
    enable() {
        this._state = null;
        this._button = new St.Button({
            style_class: 'panel-button', reactive: true, can_focus: true, visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const box = new St.BoxLayout({style: 'spacing: 6px;'});
        this._ring = new St.DrawingArea({width: 16, height: 16, y_align: Clutter.ActorAlign.CENTER});
        this._ring.connect('repaint', area => this._paintRing(area));
        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-feature-settings: "tnum"; font-weight: 700;',
        });
        box.add_child(this._ring);
        box.add_child(this._label);
        this._button.set_child(box);
        this._button.connect('clicked', () => {
            try {
                Gio.Subprocess.new([TIMER], Gio.SubprocessFlags.NONE);
            } catch (e) {
                console.warn(`mk-indicator: can't open the focus timer: ${e.message}`);
            }
        });
        Main.panel._centerBox.add_child(this._button);
        // The panel can be torn down before we're disabled (logout): stop then.
        this._button.connect('destroy', () => this._teardown());

        GLib.mkdir_with_parents(GLib.path_get_dirname(STATE), 0o755);
        this._monitor = Gio.File.new_for_path(STATE).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._load());
        this._load();
    }

    _load() {
        try {
            const [ok, bytes] = GLib.file_get_contents(STATE);
            this._state = ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
        } catch (e) {
            this._state = null;
        }
        if (!this._button)
            return;
        const running = Boolean(this._state?.running);
        this._button.visible = running && !Main.sessionMode.isLocked;
        if (running && !this._tickId) {
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!running && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        this._update();
    }

    _left() {
        const st = this._state;
        if (!st?.running)
            return 0;
        return st.paused ? st.left ?? 0 : Math.max(0, st.end - Date.now() / 1000);
    }

    _update() {
        if (!this._button || !this._state?.running)
            return;
        const left = this._left();
        this._label.text = this._state.paused ? `${fmt(left)} ⏸` : fmt(left);
        this._button.accessible_name = `Focus timer: ${fmt(left)} left, ${this._state.label}`;
        this._ring.queue_repaint();
    }

    // The accent changed (new wallpaper).
    repaint() {
        this._ring?.queue_repaint();
    }

    _paintRing(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const total = this._state?.total || 1;
        const frac = Math.min(1, this._left() / total);
        const [r, g, b] = frac > 0.25 ? accentRGB().map(c => c / 255) : frac > 0.1 ? [1, 0.72, 0.2] : [1, 0.36, 0.45];
        const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2 - 2;
        cr.setLineWidth(2.5);
        cr.setSourceRGBA(1, 1, 1, 0.18);
        cr.arc(cx, cy, rad, 0, 2 * Math.PI);
        cr.stroke();
        if (frac > 0.001) {
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setSourceRGBA(r, g, b, 1);
            cr.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac);
            cr.stroke();
        }
        cr.$dispose();
    }

    setLocked(locked) {
        if (this._button)
            this._button.visible = !locked && Boolean(this._state?.running);
    }

    _teardown() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        this._monitor?.cancel();
        this._monitor = null;
        this._button = this._label = this._ring = null;
    }

    disable() {
        const button = this._button;
        this._teardown();
        button?.destroy();
    }
}
