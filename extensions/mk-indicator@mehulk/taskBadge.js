// A small pill in the top bar with the Companion's to-do list: a checklist
// icon and "3 Left" (every unfinished task), then a calendar glyph and "2"
// when some are for today (pinned, or a reminder due today or overdue). With
// nothing left to do it's gone from the bar entirely. It follows
// companion.json live. Click: the agenda, every upcoming reminder in time
// order with a countdown ("in 25 mins", "in 2 hours", "Tomorrow 9:00 AM"),
// and the Companion's tasks one click away. Right-click: hide it
// (TASK_BADGE=off in ~/.config/mk-workstation/welcome.conf; mk tasks badge
// on). Hidden on the lock screen.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

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

// Open tasks with a reminder, soonest first (overdue ones lead).
export function upcomingReminders() {
    try {
        const [ok, bytes] = GLib.file_get_contents(COMPANION);
        const data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
        return (data.tasks || []).filter(t => !t.done && t.remind_at).sort((a, b) => a.remind_at - b.remind_at);
    } catch (e) {
        return [];
    }
}

// "Overdue", "in 25 mins", "in 2 hours", "Tomorrow 9:00 AM", "Thu 12 Nov, 9:00 AM"
export function countdown(at, now = Date.now() / 1000) {
    const d = at - now;
    if (d < 0)
        return 'Overdue';
    if (d < 3600)
        return `in ${Math.max(1, Math.round(d / 60))} min${Math.round(d / 60) === 1 ? '' : 's'}`;
    const when = GLib.DateTime.new_from_unix_local(at), today = GLib.DateTime.new_now_local();
    const clock = when.format('%-l:%M %p');
    if (when.get_day_of_year() === today.get_day_of_year() && when.get_year() === today.get_year()) {
        const h = Math.round(d / 3600);
        return `in ${h} hour${h === 1 ? '' : 's'}`;
    }
    const tomorrow = today.add_days(1);
    if (when.get_day_of_year() === tomorrow.get_day_of_year() && when.get_year() === tomorrow.get_year())
        return `Tomorrow ${clock}`;
    return when.format('%a %-e %b, ') + clock;
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
        this._button = new St.Button({style_class: 'mk-task-badge', y_align: Clutter.ActorAlign.CENTER,
            reactive: true, can_focus: true, visible: false});
        // a checklist icon and "3 Left"; a calendar glyph and "2" for today's (no emoji)
        const row = new St.BoxLayout({style: 'spacing: 5px;', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Icon({icon_name: 'checkbox-checked-symbolic', icon_size: 13}));
        this._left = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._left);
        this._todayIcon = new St.Icon({icon_name: 'x-office-calendar-symbolic', icon_size: 13, style: 'margin-left: 4px;'});
        this._today = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._todayIcon);
        row.add_child(this._today);
        this._button.set_child(row);
        // the agenda: every reminder ahead, in time order, with a countdown
        this._menu = new PopupMenu.PopupMenu(this._button, 0.5, St.Side.TOP);
        this._menu.box.add_style_class_name('mk-agenda');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        Main.panel.menuManager.addMenu(this._menu);
        this._button.connect('button-release-event', (_b, event) => {
            if (event.get_button() === 3) {
                this._hide();
                return Clutter.EVENT_STOP;
            }
            if (!this._menu.isOpen)
                this._fillAgenda();
            this._menu.toggle();
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
        this._left.text = `${remaining} Left`;
        this._today.text = `${scheduled}`;
        this._todayIcon.visible = this._today.visible = scheduled > 0;
        this._button.accessible_name = `${remaining} tasks left${scheduled ? `, ${scheduled} for today` : ''}`;
        // nothing to do: not in the bar at all (no "All Done" pill)
        this._button.visible = !this._locked && remaining > 0 && badgeOn();
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

    _fillAgenda() {
        const menu = this._menu;
        menu.removeAll();
        const items = upcomingReminders();
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(items.length ? 'Coming up' : 'No reminders set'));
        // each one opens in place: when exactly, and Done / Snooze 15 min / Open
        for (const task of items.slice(0, 12)) {
            const item = new PopupMenu.PopupSubMenuMenuItem(task.text ?? '', false);
            item.add_style_class_name('mk-agenda-row');
            item.label.clutter_text.ellipsize = 3;   // END
            const when = countdown(task.remind_at);
            item.insert_child_below(new St.Label({text: when, y_align: Clutter.ActorAlign.CENTER,
                style_class: when === 'Overdue' ? 'mk-agenda-pill mk-agenda-late' : 'mk-agenda-pill'}), item._triangleBin);
            const at = GLib.DateTime.new_from_unix_local(task.remind_at);
            const detail = new PopupMenu.PopupMenuItem(at.format('%A %-e %B, %-l:%M %p') +
                (task.repeat && task.repeat !== 'none' ? `  ·  repeats ${task.repeat}` : ''), {reactive: false});
            detail.add_style_class_name('mk-agenda-detail');
            item.menu.addMenuItem(detail);
            item.menu.addAction('Mark Done', () => this._updateTask(task.id, t => {
                t.done = true;
                if ((t.repeat ?? 'none') === 'none')
                    t.remind_at = null;
            }), 'object-select-symbolic');
            item.menu.addAction('Snooze 15 min', () => this._updateTask(task.id, t => {
                t.remind_at = Math.max(t.remind_at ?? 0, Date.now() / 1000) + 900;
            }), 'alarm-symbolic');
            item.menu.addAction('Open in Companion', () => this._openTasks(), 'document-open-symbolic');
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Open Tasks', () => this._openTasks());
    }

    // change one task in companion.json (the Companion picks it up from the file)
    _updateTask(id, change) {
        try {
            const [ok, bytes] = GLib.file_get_contents(COMPANION);
            const data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
            const task = data?.tasks?.find(t => t.id === id);
            if (!task)
                return;
            change(task);
            GLib.file_set_contents(COMPANION, JSON.stringify(data, null, 2));
        } catch (e) {
            console.warn(`mk-indicator: agenda: ${e.message}`);
        }
        this._refresh();
    }

    _openTasks() {
        try {
            Gio.Subprocess.new([`${BIN}/mk-companion`, 'tasks'], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn(`mk-indicator: companion: ${e.message}`);
        }
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
        this._menu?.destroy();
        this._button?.destroy();
        this._button = this._menu = null;
    }
}
