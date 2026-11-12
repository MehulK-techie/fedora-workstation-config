// MK Shell Engine: the calendar (the clock's menu), as glass, with a way to
// plan. The menu gets the frosted look of Quick Settings (glass over whatever
// is behind it, translucent cards, so the dates and notifications stay
// readable over any wallpaper). Under the month, a small card schedules a
// reminder on the day you pick: type what it is, then a time chip (today:
// in 15 min, in 1 hour, tonight 8 PM, tomorrow 9 AM, on two rows; a later day: 9 AM, noon,
// 6 PM) or Enter (in 1 hour today, 9 AM on a later day). It's saved straight
// into the Companion's tasks, so the agenda in the top bar and the reminder
// notification pick it up at once.
//
// Typed times: Enter reads "Review code in 25m", "Call Sam in 2h",
// "Standup @ 11:30", "Dinner at 7pm" (the time leaves the title). Under the
// chips, the chosen day's tasks in time order, each with a countdown
// ("in 14m", "at 18:30") and Done; click one for its notes, when it was added,
// Edit Time, Delete and Complete. Super+Alt+A opens it with the box ready to type in.
//
// The calendar itself: a clean typographic grid (no discs on the days),
// today and the chosen day in your accent; World Clocks and Weather only when
// you've set a place up; under the notifications only Clear (Do Not Disturb
// lives in Quick Settings). GNOME's own media player sits at the top of that list.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { evaluate, format } from './calc.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

const CAL_GLASS = {sigma: 48, brightness: 0.58};

const STORE = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'companion.json']);

function readStore() {
    let data = {notes: [], tasks: []};
    try {
        const [ok, bytes] = GLib.file_get_contents(STORE);
        if (ok)
            data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {}
    data.tasks ??= [];
    data.notes ??= [];
    return data;
}

// Read a time out of what was typed: "in 25m", "in 2h", "in 1h30m",
// "@ 11:30", "at 18:30", "at 7pm", "@6:30 pm". Returns [title, unix time]
// (the time phrase taken out of the title), or [text, null]. DAY: the day
// chosen in the calendar (clock times are on it; past ones today move on a day).
export function parseWhen(text, day = GLib.DateTime.new_now_local()) {
    const rel = text.match(/\s*\bin\s+(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*$/i);
    if (rel && (rel[1] || rel[2])) {
        const secs = (Number(rel[1] ?? 0) * 60 + Number(rel[2] ?? 0)) * 60;
        if (secs > 0)
            return [text.slice(0, rel.index).trim(), Date.now() / 1000 + secs];
    }
    const abs = text.match(/\s*(?:@|\bat\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
    if (abs) {
        let h = Number(abs[1]);
        const m = Number(abs[2] ?? 0), half = abs[3]?.toLowerCase();
        if (half === 'pm' && h < 12)
            h += 12;
        else if (half === 'am' && h === 12)
            h = 0;
        if (h < 24 && m < 60) {
            let when = GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(), h, m, 0);
            if (when.to_unix() <= Date.now() / 1000)
                when = when.add_days(1);           // "at 9" at 10 pm: tomorrow at 9
            return [text.slice(0, abs.index).trim(), when.to_unix()];
        }
    }
    return [text, null];
}

// "Overdue", "in 14m", "at 18:30" (today), "Tue 9:00"
function countdown(at, h24) {
    const d = at - Date.now() / 1000;
    if (d < 0)
        return 'Overdue';
    if (d < 3600)
        return `in ${Math.max(1, Math.round(d / 60))}m`;
    const when = GLib.DateTime.new_from_unix_local(at), now = GLib.DateTime.new_now_local();
    const clock = when.format(h24 ? '%H:%M' : '%-l:%M %p');
    const sameDay = when.get_year() === now.get_year() && when.get_day_of_year() === now.get_day_of_year();
    return sameDay ? `at ${clock}` : `${when.format('%a')} ${clock}`;
}

// Add a task with a reminder to the Companion's list (the same shape the Companion writes).
function addReminder(text, at) {
    const data = readStore();
    data.tasks.unshift({id: GLib.uuid_string_random().replace(/-/g, ''), text, done: false, pinned: false,
        created: Date.now() / 1000, remind_at: Math.round(at), repeat: 'none'});
    GLib.mkdir_with_parents(GLib.path_get_dirname(STORE), 0o700);
    GLib.file_set_contents(STORE, JSON.stringify(data, null, 2));
}

// Change task ID in the Companion's store with CHANGE(task) (false: leave the file alone).
function updateTask(id, change) {
    const data = readStore();
    const task = data.tasks.find(t => t.id === id);
    if (!task || change(task, data) === false)
        return;
    GLib.file_set_contents(STORE, JSON.stringify(data, null, 2));
}

// Mark task ID done (a one-off's reminder cleared, as the Companion does). It stays ticked
// in its day's checklist (agenda_day), and unticking puts its time back (was_at).
function completeTask(id) {
    updateTask(id, task => {
        task.done = true;
        if (task.remind_at) {
            const d = GLib.DateTime.new_from_unix_local(task.remind_at);
            task.agenda_day = GLib.DateTime.new_local(d.get_year(), d.get_month(), d.get_day_of_month(), 0, 0, 0).to_unix();
            task.was_at = task.remind_at;
        }
        if ((task.repeat ?? 'none') === 'none')
            task.remind_at = null;
    });
}

function reopenTask(id) {
    updateTask(id, task => {
        task.done = false;
        if (!task.remind_at && task.was_at)
            task.remind_at = task.was_at;
    });
}

function deleteTask(id) {
    updateTask(id, (_t, data) => {
        data.tasks = data.tasks.filter(t => t.id !== id);
    });
}

export class CalendarDeck {
    constructor(settings) {
        this._dateMenu = Main.panel.statusArea.dateMenu;
        const calendar = this._dateMenu?._calendar;
        if (!calendar)
            throw new Error('no calendar in the top bar');
        this._menu = this._dateMenu.menu;
        this._menu.box.add_style_class_name('mk-cal');

        this._card = new St.BoxLayout({style_class: 'mk-cal-card', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._heading = new St.Label({style_class: 'mk-cal-card-title'});
        this._entry = new St.Entry({hint_text: 'Add event / reminder…', can_focus: true, x_expand: true,
            style_class: 'mk-cal-entry'});
        this._entry.clutter_text.connect('activate', () => this._save(null));
        // the chips, two rows of at most two (four don't fit across the card)
        this._chips = new St.BoxLayout({style_class: 'mk-cal-chips', orientation: Clutter.Orientation.VERTICAL});
        this._saved = new St.Label({style_class: 'mk-cal-saved', visible: false});
        // the next three reminders, each with its countdown and Done
        this._queue = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-cal-queue'});
        this._queueScroll = new St.ScrollView({child: this._queue, style_class: 'mk-cal-queue-scroll',
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true});
        for (const actor of [this._heading, this._entry, this._chips, this._saved, this._queueScroll])
            this._card.add_child(actor);
        this._card.add_child(this._mathBar());
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        calendar.get_parent().insert_child_above(this._card, calendar);
        this._button = this._card;           // (what the rest calls "the control" below the month)

        this._calendar = calendar;
        this._ids = [
            [calendar, calendar.connect('selected-date-changed', (_c, datetime) => this._chosen(datetime))],
            // hovering a day previews its tasks in the list (the chosen day comes back on leaving)
            [calendar, calendar.connect('motion-event', (_c, event) => this._hoverAt(event))],
            [calendar, calendar.connect('leave-event', () => this._hoverAt(null))],
            [this._menu, this._menu.connect('open-state-changed', (_m, open) => this._glass(open))],
        ];
        this._placeholders();
        // Super+Alt+A: the calendar, ready to type a reminder
        this._settings = settings;
        if (settings) {
            Main.wm.addKeybinding('calendar-quick-add', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.quickAdd());
        }
    }

    quickAdd() {
        if (this._menu.isOpen) {
            this._menu.close();
            return;
        }
        this._menu.open();
        this._entry.grab_key_focus();
    }

    // World Clocks and Weather only once you've set a place up (unset, they were
    // buttons that only said "Add world clocks…" / "Select weather location…")
    // The math bar: type 1280 * 1.18 or 512 / 16 and the answer shows as you type; click it to copy
    // (modules/calc.js: its own small parser, never eval)
    _mathBar() {
        const row = new St.BoxLayout({style_class: 'mk-cal-math'});
        const entry = new St.Entry({hint_text: '=  1280 * 1.18', can_focus: true, x_expand: true,
            style_class: 'mk-cal-math-entry'});
        const answer = new St.Button({style_class: 'mk-cal-math-answer', visible: false, can_focus: true,
            accessible_name: 'Copy the answer'});
        let value = null;
        entry.clutter_text.connect('text-changed', () => {
            value = evaluate(entry.get_text());
            answer.label = value === null ? '' : `= ${format(value)}`;
            answer.visible = value !== null;
        });
        const copy = () => {
            if (value === null)
                return;
            const plain = String(Number(value.toPrecision(10)));
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, plain);
            Main.panel._mkIsland?.show({icon: 'accessories-calculator-symbolic', text: `${plain} copied`});
        };
        answer.connect('clicked', copy);
        entry.clutter_text.connect('activate', copy);
        row.add_child(entry);
        row.add_child(answer);
        return row;
    }

    _placeholders() {
        const dm = this._dateMenu;
        this._hidden = [];
        const rules = [
            [dm._clocksItem, 'org.gnome.shell.world-clocks'],
            [dm._weatherItem, 'org.gnome.shell.weather'],
        ];
        for (const [item, schema] of rules) {
            if (!item)
                continue;
            let s;
            try {
                s = new Gio.Settings({schema_id: schema});
            } catch {
                continue;
            }
            const unset = () => s.get_value('locations').n_children() === 0;
            const hold = () => {
                if (unset() && item.visible)
                    item.visible = false;
            };
            const ids = [item.connect('notify::visible', hold)];
            const sid = s.connect('changed::locations', () => {
                if (unset())
                    hold();
                else
                    item._sync?.();          // GNOME's own rule again (set up: shown)
            });
            hold();
            this._hidden.push({item, ids, s, sid});
        }
    }

    // The chosen day's tasks (open ones with a time that day), in time order: a card each
    // with its countdown and Done; a click opens its preview (notes, when it was added,
    // Edit Time, Delete, Complete). An empty day says so.
    _fillQueue(peek = null) {
        this._queue.destroy_all_children();
        const h24 = this._iface.get_string('clock-format') === '24h';
        const day = peek ?? this._day ?? GLib.DateTime.new_now_local();
        const start = GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(), 0, 0, 0).to_unix();
        const end = start + 86400;
        // the day's checklist: open tasks with a time that day, and the ones ticked off it
        const at = t => t.remind_at ?? t.was_at ?? 0;
        const tasks = readStore().tasks.filter(t => (!t.done && t.remind_at >= start && t.remind_at < end) ||
            (t.done && t.agenda_day === start)).sort((a, b) => a.done - b.done || at(a) - at(b));
        this._queueScroll.visible = true;
        if (!tasks.length) {
            this._queue.add_child(new St.Label({text: 'No tasks scheduled for this day', style_class: 'mk-cal-queue-empty'}));
            return;
        }
        for (const task of tasks)
            this._queue.add_child(this._taskCard(task, h24));
    }

    _taskCard(task, h24) {
        const card = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-cal-queue-card'});
        const row = new St.BoxLayout({style_class: 'mk-cal-queue-row'});
        const head = new St.Button({x_expand: true, can_focus: true, style_class: 'mk-cal-queue-head',
            accessible_name: `${task.text}: details`});
        const headBox = new St.BoxLayout({style: 'spacing: 8px;'});
        const stamp = task.remind_at ?? task.was_at;
        const time = GLib.DateTime.new_from_unix_local(stamp).format(h24 ? '%H:%M' : '%-l:%M %p');
        // a checkbox: ticked, the title is struck through (it stays on the day); unticked, it's back
        const check = new St.Button({style_class: `mk-cal-check${task.done ? ' mk-cal-checked' : ''}`, can_focus: true,
            y_align: Clutter.ActorAlign.CENTER, accessible_name: task.done ? 'Not done' : 'Done',
            child: new St.Icon({icon_name: 'object-select-symbolic', icon_size: 11, opacity: task.done ? 255 : 0})});
        check.connect('clicked', () => this._act(() => (task.done ? reopenTask(task.id) : completeTask(task.id))));
        const title = new St.Label({x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            style_class: `mk-cal-queue-title${task.done ? ' mk-cal-queue-struck' : ''}`});
        title.clutter_text.set_markup(task.done ? `<s>${GLib.markup_escape_text(task.text ?? '', -1)}</s>`
            : GLib.markup_escape_text(task.text ?? '', -1));
        title.clutter_text.ellipsize = 3;      // END
        headBox.add_child(title);
        head.set_child(headBox);
        // its time as a badge (a countdown while it's still to come)
        const when = task.done ? time : countdown(task.remind_at, h24);
        const badge = new St.Label({text: when, y_align: Clutter.ActorAlign.CENTER,
            style_class: when === 'Overdue' ? 'mk-cal-queue-badge mk-cal-queue-late' : 'mk-cal-queue-badge'});
        const remove = new St.Button({style_class: 'mk-cal-remove', can_focus: true, accessible_name: 'Delete',
            y_align: Clutter.ActorAlign.CENTER, child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12})});
        remove.connect('clicked', () => this._act(() => deleteTask(task.id)));
        for (const a of [check, head, badge, remove])
            row.add_child(a);
        card.add_child(row);
        // the preview, folded until the card is clicked
        const preview = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-cal-queue-preview',
            visible: false});
        const lines = [];
        if (task.notes)
            lines.push(task.notes);
        lines.push(GLib.DateTime.new_from_unix_local(stamp).format('%A %-e %B, ') + time +
            (task.repeat && task.repeat !== 'none' ? ` · repeats ${task.repeat}` : ''));
        if (task.created)
            lines.push(`Added ${GLib.DateTime.new_from_unix_local(Math.round(task.created)).format('%a %-e %b, %H:%M')}`);
        for (const line of lines) {
            const l = new St.Label({text: line, style_class: 'mk-cal-queue-detail'});
            l.clutter_text.line_wrap = true;
            preview.add_child(l);
        }
        const edit = new St.Entry({hint_text: 'New time: in 30m, @ 18:00, 7pm…', can_focus: true, visible: false,
            style_class: 'mk-cal-entry'});
        edit.clutter_text.connect('activate', () => {
            const typed = edit.get_text().trim();                 // ("7pm" or "18:00" alone: at that time)
            const [, at] = parseWhen(`x ${/^\d/.test(typed) ? `at ${typed}` : typed}`,
                GLib.DateTime.new_from_unix_local(stamp));
            if (!at) {
                edit.set_text('');
                edit.hint_text = 'Try: in 30m, @ 18:00, at 7pm';
                return;
            }
            this._act(() => updateTask(task.id, t => (t.remind_at = Math.round(at))));
        });
        const actions = new St.BoxLayout({style_class: 'mk-cal-queue-actions'});
        actions.add_child(this._pill('document-edit-symbolic', 'Edit Time', () => {
            edit.visible = !edit.visible;
            if (edit.visible)
                edit.grab_key_focus();
        }));
        actions.add_child(this._pill('user-trash-symbolic', 'Delete', () => this._act(() => deleteTask(task.id)), true));
        actions.add_child(this._pill('object-select-symbolic', 'Complete', () => this._act(() => completeTask(task.id))));
        preview.add_child(actions);
        preview.add_child(edit);
        card.add_child(preview);
        head.connect('clicked', () => {
            preview.visible = !preview.visible;
            if (preview.visible)
                card.add_style_pseudo_class('checked');
            else
                card.remove_style_pseudo_class('checked');
        });
        return card;
    }

    _pill(icon, label, callback, danger = false) {
        const b = new St.Button({style_class: `mk-cal-queue-done button${danger ? ' mk-cal-queue-danger' : ''}`,
            can_focus: true, accessible_name: label});
        const box = new St.BoxLayout({style: 'spacing: 4px;'});
        box.add_child(new St.Icon({icon_name: icon, icon_size: 12}));
        const text = new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER});
        text.clutter_text.ellipsize = 0;           // (the whole word: Complete, not Compl…)
        box.add_child(text);
        b.set_child(box);
        b.connect('clicked', callback);
        return b;
    }

    // change the store, then show the day again (the agenda pill follows the file by itself)
    _act(change) {
        try {
            change();
        } catch (e) {
            console.warn(`mk-shell-engine: calendar: ${e.message}`);
        }
        this._fillQueue();
    }

    // ----- hover to preview a day
    _hoverAt(event) {
        let date = null;
        if (event) {
            const [x, y] = event.get_coords();
            for (let a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y); a && a !== this._calendar;
                a = a.get_parent()) {
                if (a._date instanceof Date) {
                    date = a._date;
                    break;
                }
            }
        }
        const key = date ? date.toDateString() : null;
        if (key === this._peekKey)
            return Clutter.EVENT_PROPAGATE;
        this._peekKey = key;
        if (this._peekId)
            GLib.source_remove(this._peekId);
        // (a short wait: sweeping the pointer across the month doesn't flicker the list)
        this._peekId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, key ? 90 : 160, () => {
            this._peekId = 0;
            this._peek(date);
            return GLib.SOURCE_REMOVE;
        });
        return Clutter.EVENT_PROPAGATE;
    }

    _peek(date) {
        if (!this._card || !this._menu.isOpen)
            return;
        const chosen = this._day ?? GLib.DateTime.new_now_local();
        const day = date ? GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1, date.getDate(), 12, 0, 0) : null;
        const same = !day || day.format('%F') === chosen.format('%F');
        const peeking = !same;
        if (peeking === Boolean(this._peeking) && (!peeking || this._peeking === day.format('%F')))
            return;
        this._peeking = peeking ? day.format('%F') : null;
        // the list cross-fades to the hovered day; adding stays with the chosen day
        this._queueScroll.remove_transition('opacity');
        this._queueScroll.ease({opacity: 0, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._card)
                    return;
                if (peeking) {
                    this._card.visible = true;
                    this._peekHeading ??= this._heading.text;
                    this._heading.text = `${day.format('%A %-e %B')} · preview`;
                    [this._entry, this._chips, this._saved].forEach(a => (a.visible = false));
                    this._card.add_style_class_name('mk-cal-peeking');
                    this._fillQueue(day);
                } else {
                    this._card.remove_style_class_name('mk-cal-peeking');
                    this._entry.visible = this._chips.visible = true;
                    if (this._peekHeading !== undefined)
                        this._heading.text = this._peekHeading;
                    this._peekHeading = undefined;
                    this._fillQueue();
                    this._card.visible = this._day !== null;
                }
                this._queueScroll.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            }});
    }

    _chosen(datetime) {
        this._peeking = null;
        this._peekHeading = undefined;
        this._card?.remove_style_class_name('mk-cal-peeking');
        if (this._entry)
            this._entry.visible = this._chips.visible = true;
        const today = GLib.DateTime.new_now_local();
        const midnight = d => GLib.DateTime.new_local(d.get_year(), d.get_month(), d.get_day_of_month(), 0, 0, 0);
        const day = Math.round(midnight(datetime).difference(midnight(today)) / GLib.TIME_SPAN_DAY);   // 0 today, 1 tomorrow
        this._day = day >= 0 ? datetime : null;
        if (day >= 0)
            this._fillQueue();
        this._card.visible = day >= 0;
        if (day < 0)
            return;
        this._heading.text = `Add to Agenda · ${day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : datetime.format('%A %-e %B')}`;
        this._chips.destroy_all_children();
        const at = (h, m = 0, base = datetime) => GLib.DateTime.new_local(base.get_year(), base.get_month(),
            base.get_day_of_month(), h, m, 0).to_unix();
        const now = Date.now() / 1000, tomorrow = today.add_days(1);
        const chips = day === 0
            ? [['15m', now + 900], ['1h', now + 3600], ['Tonight 8 PM', at(20)], ['Tomorrow 9 AM', at(9, 0, tomorrow)]]
                .filter(([, t]) => t > now)
            : [['9 AM', at(9)], ['Noon', at(12)], ['6 PM', at(18)]];
        this._default = day === 0 ? now + 3600 : at(9);
        let row = null;
        for (const [i, [label, time]] of chips.entries()) {
            if (i % 2 === 0) {
                row = new St.BoxLayout({style_class: 'mk-cal-chip-row'});
                this._chips.add_child(row);
            }
            const text = new St.Label({text: label});
            text.clutter_text.ellipsize = 0;                 // (Pango NONE: the whole label, always)
            const chip = new St.Button({child: text, style_class: 'mk-cal-chip button', can_focus: true});
            chip.connect('clicked', () => this._save(time));
            row.add_child(chip);
        }
    }

    _save(at) {
        let text = this._entry.get_text().trim();
        if (!text) {
            this._entry.grab_key_focus();
            return;
        }
        if (at === null) {
            // Enter: a time typed with it ("in 25m", "@ 11:30") wins over the default
            const [title, typed] = parseWhen(text, this._day ?? GLib.DateTime.new_now_local());
            if (typed && title) {
                text = title;
                at = typed;
            }
        }
        try {
            addReminder(text, at ?? this._default);
            const when = GLib.DateTime.new_from_unix_local(Math.round(at ?? this._default)).format('%a %-e %b, %-l:%M %p');
            this._saved.text = `Saved: ${text} · ${when}`;
            this._fillQueue();
            this._saved.visible = true;
            this._entry.set_text('');
        } catch (e) {
            this._saved.text = `Couldn't save: ${e.message}`;
            this._saved.visible = true;
        }
    }

    _glass(open) {
        this._unglass?.();
        this._unglass = null;
        if (open) {
            this._unglass = addWallpaperGlass(this._menu.box, this._menu.actor, CAL_GLASS, 14, desktopCopy);
            this._chosen(GLib.DateTime.new_now_local());     // (GNOME opens it on today: the card's chips for today)
            this._fillQueue();
        } else
            this._saved.visible = false;     // (it opens on today again)
    }

    destroy() {
        if (this._peekId)
            GLib.source_remove(this._peekId);
        this._peekId = 0;
        if (this._settings)
            Main.wm.removeKeybinding('calendar-quick-add');
        for (const {item, ids, s, sid} of this._hidden ?? []) {
            ids.forEach(id => item.disconnect(id));
            s.disconnect(sid);
            item._sync?.();
        }
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._unglass?.();
        this._button.destroy();
        this._menu.box.remove_style_class_name('mk-cal');
    }
}
