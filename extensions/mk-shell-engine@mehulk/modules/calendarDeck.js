// MK Shell Engine: the calendar (the clock's menu), as glass, with a way to
// plan ahead. The menu gets the frosted look of Quick Settings (glass over
// whatever is behind it, translucent cards, so the dates and notifications
// stay readable over any wallpaper), and choosing a day after today shows
// "Remind me on Thu 12 Nov": a click opens the Companion ready to
// take a reminder for that day (9:00, change it there).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { addWallpaperGlass, desktopCopy } from './blur.js';

const CAL_GLASS = {sigma: 44, brightness: 0.6};
const COMPANION = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-companion']);

export class CalendarDeck {
    constructor() {
        this._dateMenu = Main.panel.statusArea.dateMenu;
        const calendar = this._dateMenu?._calendar;
        if (!calendar)
            throw new Error('no calendar in the top bar');
        this._menu = this._dateMenu.menu;
        this._menu.box.add_style_class_name('mk-cal');

        this._button = new St.Button({style_class: 'mk-cal-schedule button', can_focus: true, visible: false,
            x_expand: true});
        const row = new St.BoxLayout({style: 'spacing: 8px;', x_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Icon({icon_name: 'alarm-symbolic', icon_size: 14}));
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._label);
        this._button.set_child(row);
        this._button.connect('clicked', () => this._schedule());
        calendar.get_parent().insert_child_above(this._button, calendar);

        this._ids = [
            [calendar, calendar.connect('selected-date-changed', (_c, datetime) => this._chosen(datetime))],
            [this._menu, this._menu.connect('open-state-changed', (_m, open) => this._glass(open))],
        ];
    }

    _chosen(datetime) {
        const today = GLib.DateTime.new_now_local();
        const ahead = datetime.get_year() > today.get_year() ||
            (datetime.get_year() === today.get_year() && datetime.get_day_of_year() > today.get_day_of_year());
        this._day = ahead ? datetime : null;
        this._button.visible = ahead;
        if (ahead)
            this._label.text = `Remind me on ${datetime.format('%a %-e %b')}`;
    }

    _schedule() {
        if (!this._day)
            return;
        this._menu.close();
        try {
            Gio.Subprocess.new([COMPANION, 'remind', this._day.format('%Y-%m-%d')], Gio.SubprocessFlags.NONE);
        } catch (e) {
            Main.notify('Calendar', `The Companion didn't open: ${e.message}`);
        }
    }

    _glass(open) {
        this._unglass?.();
        this._unglass = null;
        if (open)
            this._unglass = addWallpaperGlass(this._menu.box, this._menu.actor, CAL_GLASS, 24, desktopCopy);
        else
            this._button.visible = false;    // (it opens on today again)
    }

    destroy() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._unglass?.();
        this._button.destroy();
        this._menu.box.remove_style_class_name('mk-cal');
    }
}
