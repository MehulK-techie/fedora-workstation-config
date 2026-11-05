// MK Shell Engine: the calendar (the clock's menu), as glass, with a way to
// plan. The menu gets the frosted look of Quick Settings (glass over whatever
// is behind it, translucent cards, so the dates and notifications stay
// readable over any wallpaper). Under the month, a small card schedules a
// reminder on the day you pick: type what it is, then a time chip (today:
// in 15 min, in 1 hour, tonight 8 PM, tomorrow 9 AM; a later day: 9 AM, noon,
// 6 PM) or Enter (in 1 hour today, 9 AM on a later day). It's saved straight
// into the Companion's tasks, so the agenda in the top bar and the reminder
// notification pick it up at once.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

const CAL_GLASS = {sigma: 44, brightness: 0.6};

const STORE = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'companion.json']);

// Add a task with a reminder to the Companion's list (the same shape the Companion writes).
function addReminder(text, at) {
    let data = {notes: [], tasks: []};
    try {
        const [ok, bytes] = GLib.file_get_contents(STORE);
        if (ok)
            data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {}
    data.tasks ??= [];
    data.notes ??= [];
    data.tasks.unshift({id: GLib.uuid_string_random().replace(/-/g, ''), text, done: false, pinned: false,
        created: Date.now() / 1000, remind_at: Math.round(at), repeat: 'none'});
    GLib.mkdir_with_parents(GLib.path_get_dirname(STORE), 0o700);
    GLib.file_set_contents(STORE, JSON.stringify(data, null, 2));
}

export class CalendarDeck {
    constructor() {
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
        this._chips = new St.BoxLayout({style_class: 'mk-cal-chips'});
        this._saved = new St.Label({style_class: 'mk-cal-saved', visible: false});
        for (const actor of [this._heading, this._entry, this._chips, this._saved])
            this._card.add_child(actor);
        calendar.get_parent().insert_child_above(this._card, calendar);
        this._button = this._card;           // (what the rest calls "the control" below the month)

        this._ids = [
            [calendar, calendar.connect('selected-date-changed', (_c, datetime) => this._chosen(datetime))],
            [this._menu, this._menu.connect('open-state-changed', (_m, open) => this._glass(open))],
        ];
    }

    _chosen(datetime) {
        const today = GLib.DateTime.new_now_local();
        const midnight = d => GLib.DateTime.new_local(d.get_year(), d.get_month(), d.get_day_of_month(), 0, 0, 0);
        const day = Math.round(midnight(datetime).difference(midnight(today)) / GLib.TIME_SPAN_DAY);   // 0 today, 1 tomorrow
        this._day = day >= 0 ? datetime : null;
        this._card.visible = day >= 0;
        if (day < 0)
            return;
        this._heading.text = day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : datetime.format('%A %-e %B');
        this._chips.destroy_all_children();
        const at = (h, m = 0, base = datetime) => GLib.DateTime.new_local(base.get_year(), base.get_month(),
            base.get_day_of_month(), h, m, 0).to_unix();
        const now = Date.now() / 1000, tomorrow = today.add_days(1);
        const chips = day === 0
            ? [['15m', now + 900], ['1h', now + 3600], ['Tonight 8 PM', at(20)], ['Tomorrow 9 AM', at(9, 0, tomorrow)]]
                .filter(([, t]) => t > now)
            : [['9 AM', at(9)], ['Noon', at(12)], ['6 PM', at(18)]];
        this._default = day === 0 ? now + 3600 : at(9);
        for (const [label, time] of chips) {
            const chip = new St.Button({label, style_class: 'mk-cal-chip button', can_focus: true});
            chip.connect('clicked', () => this._save(time));
            this._chips.add_child(chip);
        }
    }

    _save(at) {
        const text = this._entry.get_text().trim();
        if (!text) {
            this._entry.grab_key_focus();
            return;
        }
        try {
            addReminder(text, at ?? this._default);
            const when = GLib.DateTime.new_from_unix_local(Math.round(at ?? this._default)).format('%a %-e %b, %-l:%M %p');
            this._saved.text = `Saved: ${text} · ${when}`;
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
        if (open)
            this._unglass = addWallpaperGlass(this._menu.box, this._menu.actor, CAL_GLASS, 24, desktopCopy);
        else
            this._saved.visible = false;     // (it opens on today again)
    }

    destroy() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._unglass?.();
        this._button.destroy();
        this._menu.box.remove_style_class_name('mk-cal');
    }
}
