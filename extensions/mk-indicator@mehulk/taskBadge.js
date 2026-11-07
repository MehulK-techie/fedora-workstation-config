// A small pill in the top bar with the Companion's to-do list: a checklist
// icon and "3 Left" (every unfinished task), then a calendar glyph and "2"
// when some are for today (pinned, or a reminder due today or overdue). Tick
// off the last one and it reads "All Done" for half an hour, then leaves the
// bar (with nothing to do it isn't there at all). It follows
// companion.json live. Click: a quick preview of every open task, those with
// a time first in time order with a countdown ("in 25 mins", "Tomorrow 9:00
// AM"), a round checkmark on each (tap: struck through, fades away, done),
// each opening to its date, Mark Done and Snooze. Right-click: hide it
// (TASK_BADGE=off in ~/.config/mk-workstation/welcome.conf; mk tasks badge
// on). Hidden on the lock screen.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
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

// Every open task, as companion.json has it.
export function openTasks() {
    try {
        const [ok, bytes] = GLib.file_get_contents(COMPANION);
        const data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
        return (data.tasks || []).filter(t => !t.done);
    } catch (e) {
        return [];
    }
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

const h24 = () => {
    try {
        return new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('clock-format') === '24h';
    } catch {
        return false;
    }
};

// "Overdue", "in 25m", "at 23:00" (today), "Tomorrow 9:00 AM", "Thu 12 Nov, 9:00 AM"
export function countdown(at, now = Date.now() / 1000) {
    const d = at - now;
    if (d < 0)
        return 'Overdue';
    if (d < 3600)
        return `in ${Math.max(1, Math.round(d / 60))}m`;
    const when = GLib.DateTime.new_from_unix_local(at), today = GLib.DateTime.new_now_local();
    const clock = when.format(h24() ? '%H:%M' : '%-l:%M %p');
    if (when.get_day_of_year() === today.get_day_of_year() && when.get_year() === today.get_year())
        return `at ${clock}`;
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
        // a panel menu button: GNOME 51 opens panel menus from a click gesture (a plain
        // St.Button's button-release-event never came, so a click did nothing)
        this._button = new PanelMenu.Button(0.5, 'Tasks', false);
        this._button.add_style_class_name('mk-task-badge');
        // a checklist icon and "3 Left"; a calendar glyph and "2" for today's (no emoji)
        const row = new St.BoxLayout({style: 'spacing: 5px;', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Icon({icon_name: 'checkbox-checked-symbolic', icon_size: 13}));
        this._left = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._left);
        this._todayIcon = new St.Icon({icon_name: 'x-office-calendar-symbolic', icon_size: 13, style: 'margin-left: 4px;'});
        this._today = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._todayIcon);
        row.add_child(this._today);
        this._button.add_child(row);
        // the agenda: today's tasks in time order with countdowns, then later ones, then the rest
        this._menu = this._button.menu;
        this._menu.box.add_style_class_name('mk-agenda');
        this._menu.connect('open-state-changed', (_m, open) => open && this._fillAgenda());
        // right-click: hide the pill (also in its menu)
        try {
            const right = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY});
            right.connect('recognize', () => {
                this._menu.close();
                this._hide();
            });
            this._button.add_action(right);
        } catch (e) {
            // (the menu's Hide item does the same)
        }
        Main.panel.addToStatusArea('mk-task-badge', this._button, 0, 'right');
        this._fillAgenda();
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
        // the last one just ticked off: "All Done" for half an hour, then gone
        if (remaining === 0 && this._lastRemaining > 0) {
            this._allDoneUntil = Date.now() + 30 * 60 * 1000;
            this._clearAllDone();
            this._allDoneTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30 * 60 + 1, () => {
                this._allDoneTimer = 0;
                this._refresh();
                return GLib.SOURCE_REMOVE;
            });
        }
        this._lastRemaining = remaining;
        const allDone = remaining === 0 && Date.now() < (this._allDoneUntil ?? 0);
        this._left.text = allDone ? 'All Done' : `${remaining} Left`;
        this._today.text = `${scheduled}`;
        this._todayIcon.visible = this._today.visible = scheduled > 0;
        this._button.accessible_name = allDone ? 'All tasks done'
            : `${remaining} tasks left${scheduled ? `, ${scheduled} for today` : ''}`;
        if (allDone)
            this._button.add_style_class_name('mk-task-done');
        else
            this._button.remove_style_class_name('mk-task-done');
        this._button.container.visible = !this._locked && (remaining > 0 || allDone) && badgeOn();
        if (!this._menu.isOpen)
            this._fillAgenda();       // (ready before it opens)
    }

    _clearAllDone() {
        if (this._allDoneTimer)
            GLib.source_remove(this._allDoneTimer);
        this._allDoneTimer = 0;
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

    // The quick preview: every open task. Those with a time first, soonest (and
    // overdue) on top, each with a countdown; then the rest, pinned ones first.
    // Each opens in place: its date (or "No date"), Mark Done, Snooze (when it
    // has a time) and Open in Companion.
    _fillAgenda() {
        const menu = this._menu;
        menu.removeAll();
        const open = openTasks();
        const timed = open.filter(t => t.remind_at).sort((a, b) => a.remind_at - b.remind_at);
        const rest = open.filter(t => !t.remind_at).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        const midnight = new Date().setHours(24, 0, 0, 0) / 1000;
        const today = timed.filter(t => t.remind_at < midnight), later = timed.filter(t => t.remind_at >= midnight);
        if (!open.length)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Nothing to do'));
        for (const [title, list, max] of [['Today', today, 12], ['Later', later, 8]]) {
            if (!list.length)
                continue;
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(title));
            for (const task of list.slice(0, max))
                menu.addMenuItem(this._agendaRow(task));
        }
        if (rest.length)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Tasks'));
        for (const task of rest.slice(0, 8))
            menu.addMenuItem(this._agendaRow(task));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Open Tasks', () => this._openTasks());
        menu.addAction('Hide this pill', () => this._hide());
    }

    _agendaRow(task) {
        const item = new PopupMenu.PopupSubMenuMenuItem(task.text ?? '', false);
        item.add_style_class_name('mk-agenda-row');
        item.label.clutter_text.ellipsize = 3;   // END
        // a round checkmark: tap it and the task is struck through, fades, and is done
        const check = new St.Button({style_class: 'mk-agenda-check', can_focus: true, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'object-select-symbolic', icon_size: 12}), accessible_name: 'Mark done'});
        check.connect('clicked', () => this._complete(item, check, task));
        item.insert_child_at_index(check, item.get_children().indexOf(item.label));
        const when = task.remind_at ? countdown(task.remind_at) : task.pinned ? 'Pinned' : '';
        if (when) {
            item.insert_child_below(new St.Label({text: when, y_align: Clutter.ActorAlign.CENTER,
                style_class: when === 'Overdue' ? 'mk-agenda-pill mk-agenda-late' : 'mk-agenda-pill'}), item._triangleBin);
        }
        const lines = [];
        if (task.remind_at) {
            const at = GLib.DateTime.new_from_unix_local(task.remind_at);
            lines.push(at.format('%A %-e %B, %-l:%M %p') +
                (task.repeat && task.repeat !== 'none' ? `  ·  repeats ${task.repeat}` : ''));
        } else {
            lines.push('No date');
        }
        if (task.created)
            lines.push(`Added ${GLib.DateTime.new_from_unix_local(task.created).format('%a %-e %b')}`);
        const detail = new PopupMenu.PopupMenuItem(lines.join('  ·  '), {reactive: false});
        detail.add_style_class_name('mk-agenda-detail');
        item.menu.addMenuItem(detail);
        item.menu.addAction('Mark Done', () => this._updateTask(task.id, t => {
            t.done = true;
            if ((t.repeat ?? 'none') === 'none')
                t.remind_at = null;
        }), 'object-select-symbolic');
        if (task.remind_at) {
            item.menu.addAction('Snooze 15 min', () => this._updateTask(task.id, t => {
                t.remind_at = Math.max(t.remind_at ?? 0, Date.now() / 1000) + 900;
            }), 'alarm-symbolic');
        }
        item.menu.addAction('Open in Companion', () => this._openTasks(), 'document-open-symbolic');
        return item;
    }

    _complete(item, check, task) {
        if (item._mkDone)
            return;
        item._mkDone = true;
        check.add_style_class_name('mk-agenda-checked');
        item.label.clutter_text.set_markup(`<s>${GLib.markup_escape_text(task.text ?? '', -1)}</s>`);
        const done = () => this._updateTask(task.id, t => {
            t.done = true;
            if ((t.repeat ?? 'none') === 'none')
                t.remind_at = null;
        });
        // the row goes first, then the file changes (the change rebuilds a closed agenda,
        // which would take the row with it)
        const finish = () => {
            if (!item._mkGone) {
                item._mkGone = true;
                item.destroy();
            }
            done();
        };
        item.connect('destroy', () => (item._mkGone = true));
        if (!St.Settings.get().enable_animations) {
            finish();
            return;
        }
        item.ease({opacity: 0, delay: 260, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: finish});
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
        this._clearAllDone();
        this._monitors?.forEach(m => m.cancel());
        this._monitors = null;
        this._button?.destroy();               // (its menu goes with it)
        this._button = this._menu = null;
    }
}
