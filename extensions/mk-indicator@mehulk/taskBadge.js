// A small pill in the top bar: how many Companion tasks are for today
// ("[ 2 Tasks ]"): open tasks that are pinned or have a reminder due today
// (overdue ones too). Click: the Companion's tasks. Right-click: hide it
// (TASK_BADGE=off in ~/.config/mk-workstation/welcome.conf; mk tasks badge on).
// It's hidden when nothing is due, and on the lock screen.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COMPANION = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'companion.json']);
const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'welcome.conf']);
const BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin']);

// Tasks for today, as the badge and the spoken briefing count them.
export function tasksToday() {
    let data = {};
    try {
        const [ok, bytes] = GLib.file_get_contents(COMPANION);
        data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    } catch (e) {
        return 0;
    }
    const midnight = new Date().setHours(24, 0, 0, 0) / 1000;
    return (data.tasks || []).filter(t => !t.done && (t.pinned || (t.remind_at && t.remind_at < midnight))).length;
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
        this._button = new St.Button({style_class: 'mk-task-badge', y_align: Clutter.ActorAlign.CENTER,
            reactive: true, can_focus: true, visible: false});
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
        const n = tasksToday();
        this._button.label = `${n} ${n === 1 ? 'Task' : 'Tasks'}`;
        this._button.visible = !this._locked && n > 0 && badgeOn();
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
        this._button?.destroy();
        this._button = null;
    }
}
