// A small pill in the top bar with the Companion's to-do list: "📋 3 Left"
// (every unfinished task), with a softly pulsing dot when any are for today
// (pinned, or a reminder due today or overdue). With nothing left to do it's
// gone from the bar entirely. It follows companion.json live. Click: the Companion's tasks. Right-click:
// hide it (TASK_BADGE=off in ~/.config/mk-workstation/welcome.conf;
// mk tasks badge on). Hidden on the lock screen.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COMPANION = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'companion.json']);
const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'welcome.conf']);
const BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin']);

// The to-do list in two numbers: remaining (not done) and scheduled (of those, the ones for today).
export function taskMetrics() {
    let data = {};
    try {
        const [ok, bytes] = GLib.file_get_contents(COMPANION);
        data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    } catch (e) {
        return {remaining: 0, scheduled: 0};
    }
    const midnight = new Date().setHours(24, 0, 0, 0) / 1000;
    const open = (data.tasks || []).filter(t => !t.done);
    return {remaining: open.length,
        scheduled: open.filter(t => t.pinned || (t.remind_at && t.remind_at < midnight)).length};
}

// Tasks for today, as the spoken briefing counts them.
export function tasksToday() {
    return taskMetrics().scheduled;
}

function badgeOn() {
    try {
        const [ok, bytes] = GLib.file_get_contents(USER_CONF);
        return !(ok && /^\s*TASK_BADGE\s*=\s*off/m.test(new TextDecoder().decode(bytes)));
    } catch (e) {
        return true;
    }
}

export class TaskBadge {
    enable() {
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._dot = new St.Widget({style_class: 'mk-task-badge-dot', y_align: Clutter.ActorAlign.CENTER, visible: false});
        const box = new St.BoxLayout({style_class: 'mk-task-badge-box'});
        box.add_child(this._label);
        box.add_child(this._dot);
        this._button = new St.Button({style_class: 'mk-task-badge', y_align: Clutter.ActorAlign.CENTER,
            reactive: true, can_focus: true, visible: false, child: box});
        this._button.connect('button-release-event', (_b, event) => {
            if (event.get_button() === 3) {
                this._hide();
                return Clutter.EVENT_STOP;
            }
            try {
                Gio.Subprocess.new([`${BIN}/mk-companion`, 'tasks'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                console.warn(`mk-indicator: companion: ${e.message}`);
            }
            return Clutter.EVENT_STOP;
        });
        Main.panel._rightBox.insert_child_at_index(this._button, 0);
        for (const path of [COMPANION, USER_CONF]) {
            const monitor = Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.NONE, null);
            monitor.connect('changed', () => this._refresh());
            (this._monitors ??= []).push(monitor);
        }
        // Reminders become due as the day goes on.
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 300, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this._refresh();
    }

    _refresh() {
        if (!this._button)
            return;
        const {remaining, scheduled} = taskMetrics();
        this._label.text = `📋 ${remaining} Left`;
        this._button.accessible_name = `${remaining} tasks left${scheduled ? `, ${scheduled} for today` : ''}`;
        this._pulse(scheduled > 0);                    // (something's for today)
        // nothing to do: not in the bar at all (no "All Done" pill)
        this._button.visible = !this._locked && remaining > 0 && badgeOn();
    }

    // the today dot breathes a few times when it appears (opacity, 1.2 s each way), then stays lit:
    // a pulse that never stopped would redraw the top bar all day
    _pulse(on) {
        if (on === this._dot.visible)
            return;
        this._dot.remove_all_transitions();
        this._dot.visible = on;
        this._dot.opacity = 255;
        if (on)
            this._dot.ease({opacity: 90, duration: 1200, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: 5, autoReverse: true, onComplete: () => this._dot && (this._dot.opacity = 255)});
    }

    _hide() {
        // Keep everything else in welcome.conf; set TASK_BADGE=off.
        let text = '';
        try {
            text = new TextDecoder().decode(GLib.file_get_contents(USER_CONF)[1]);
        } catch (e) {
            // a new file
        }
        text = text.replace(/^\s*TASK_BADGE\s*=.*\n?/m, '');
        GLib.mkdir_with_parents(GLib.path_get_dirname(USER_CONF), 0o755);
        GLib.file_set_contents(USER_CONF, `${text}${text && !text.endsWith('\n') ? '\n' : ''}TASK_BADGE=off\n`);
        Main.notify('Task badge hidden', 'Bring it back with: mk tasks badge on');
        this._refresh();
    }

    setLocked(locked) {
        this._locked = locked;
        this._refresh();
    }

    disable() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._monitors?.forEach(m => m.cancel());
        this._monitors = null;
        this._dot?.remove_all_transitions();
        this._button?.destroy();
        this._button = this._label = this._dot = null;
    }
}
