// WACK Sonoma Live Lockscreen: settings (the gear in Extension Manager).
// Four pages: Live Wallpaper & Media, Sonoma Clock & Typography, Animations &
// Unlock Behavior, Notifications & User Pill. Every switch writes the merged
// schema (org.gnome.shell.extensions.wack-sonoma-lockscreen); the lock screen
// follows the changes the next time it shows (most of them at once while locked).
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MEDIA_TYPES = ['video/mp4', 'video/webm', 'video/x-matroska', 'video/quicktime', 'image/gif', 'image/png',
    'image/jpeg', 'image/webp'];

export default class WackSonomaLivePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(680, 720);
        window.set_search_enabled(true);
        window.add(this._mediaPage(window, s));
        window.add(this._clockPage(window, s));
        window.add(this._animationPage(s));
        window.add(this._userPage(s));
    }

    // ----- Page 1: Live Wallpaper & Media
    _mediaPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Live Wallpaper & Media', icon_name: 'video-display-symbolic'});
        const media = new Adw.PreferencesGroup({title: 'Lock screen media',
            description: 'A video, GIF or picture behind the lock screen, decoded by the graphics card, always silent.'});
        media.add(switchRow(s, 'live-enabled', 'Enable Live Video / GIF Wallpaper'));

        const file = new Adw.ActionRow({title: 'Select Lockscreen Media File'});
        const show = () => {
            const path = s.get_string('background-video-path');
            file.subtitle = path ? GLib.path_get_basename(path) : 'None chosen (GNOME\'s own wallpaper shows)';
        };
        show();
        s.connect('changed::background-video-path', show);
        const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
        choose.connect('clicked', () => {
            const filter = new Gtk.FileFilter({name: 'Videos, GIFs and pictures'});
            MEDIA_TYPES.forEach(t => filter.add_mime_type(t));
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            const dialog = new Gtk.FileDialog({title: 'Lock screen media', filters, default_filter: filter});
            const videos = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS);
            if (videos)
                dialog.set_initial_folder(Gio.File.new_for_path(videos));
            dialog.open(window, null, (d, res) => {
                try {
                    const picked = d.open_finish(res);
                    if (picked)
                        s.set_string('background-video-path', picked.get_path());
                } catch {}                                 // (cancelled)
            });
        });
        const clear = new Gtk.Button({icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
            tooltip_text: 'No media: GNOME\'s own wallpaper'});
        clear.connect('clicked', () => s.set_string('background-video-path', ''));
        file.add_suffix(choose);
        file.add_suffix(clear);
        media.add(file);

        // Live Lock Screen's "at the end": 0 loops, 1 holds the last frame
        const loop = new Adw.SwitchRow({title: 'Loop Video Continuously', subtitle: 'Off: it plays once and holds its last frame'});
        loop.active = s.get_int('general-action-on-end') === 0;
        loop.connect('notify::active', () => s.set_int('general-action-on-end', loop.active ? 0 : 1));
        media.add(loop);
        page.add(media);

        const look = new Adw.PreferencesGroup({title: 'Background'});
        look.add(scaleRow(s, 'dim-opacity', 'Background Dimming Opacity', 0, 80, 5, '%'));
        look.add(scaleRow(s, 'background-video-blur-radius', 'Background Blur Radius', 0, 40, 1, 'px',
            'While the clock shows'));
        look.add(scaleRow(s, 'prompt-blur-radius', 'Blur While Typing', 0, 40, 1, 'px',
            'When the password field shows (Animations: Blur Background When Password Prompt Focuses)'));
        page.add(look);
        return page;
    }

    // ----- Page 2: Sonoma Clock & Typography
    _clockPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Sonoma Clock & Typography', icon_name: 'preferences-system-time-symbolic'});
        const clock = new Adw.PreferencesGroup({title: 'Clock'});
        clock.add(comboRow(s, 'clock-style', 'Clock Style',
            [['sonoma-bold', 'Sonoma Bold Rounded'], ['cupertino-thin', 'Cupertino Thin'], ['digital', 'Classic Digital'],
                ['custom', 'Custom Font']]));

        const fontRow = new Adw.ActionRow({title: 'Custom Clock Font &amp; Size', subtitle: 'Used when the style is Custom Font'});
        const fontButton = new Gtk.FontDialogButton({dialog: new Gtk.FontDialog({title: 'Clock font'}), valign: Gtk.Align.CENTER,
            use_font: true, use_size: true});
        const saved = s.get_string('clock-font');
        if (saved)
            fontButton.font_desc = Pango.FontDescription.from_string(saved);
        fontButton.connect('notify::font-desc', () => {
            if (fontButton.font_desc) {
                s.set_string('clock-font', fontButton.font_desc.to_string());
                if (s.get_string('clock-style') !== 'custom')
                    s.set_string('clock-style', 'custom');
            }
        });
        fontRow.add_suffix(fontButton);
        clock.add(fontRow);
        clock.add(colourRow(s, 'clock-color', 'Clock Color'));
        clock.add(colourRow(s, 'date-color', 'Date Color'));
        clock.add(scaleRow(s, 'clock-offset', 'Clock Vertical Offset', -200, 200, 5, 'px', 'Up (negative) or down'));
        page.add(clock);
        return page;
    }

    // ----- Page 3: Animations & Unlock Behavior
    _animationPage(s) {
        const page = new Adw.PreferencesPage({title: 'Animations & Unlock Behavior', icon_name: 'emblem-system-symbolic'});
        const anims = new Adw.PreferencesGroup({title: 'Animations'});
        anims.add(comboRow(s, 'unlock-animation', 'Unlock Animation Preset',
            [['slow-stop', 'Sonoma Slow-Stop & Dissolve'], ['zoom', 'Cupertino Scale Zoom'], ['crossfade', 'Smooth Crossfade'],
                ['none', 'None']]));
        anims.add(scaleRow(s, 'animation-duration', 'Animation Duration', 120, 600, 10, 'ms'));
        anims.add(switchRow(s, 'lock-entry-animation', 'Lock Animation', 'Fades in from 1.04x as the screen locks'));
        page.add(anims);
        const behaviour = new Adw.PreferencesGroup({title: 'Behavior'});
        behaviour.add(switchRow(s, 'prompt-change-blur', 'Blur Background When Password Prompt Focuses'));
        // Live Lock Screen's "when the screen turns off": 1 pauses, 0 carries on
        const sleep = new Adw.SwitchRow({title: 'Pause Video Immediately on Lid Close / Sleep',
            subtitle: 'Prevents a glitch as the screen wakes (suspending always pauses it)'});
        sleep.active = s.get_int('general-action-on-blank') !== 0;
        sleep.connect('notify::active', () => s.set_int('general-action-on-blank', sleep.active ? 1 : 0));
        behaviour.add(sleep);
        page.add(behaviour);
        return page;
    }

    // ----- Page 4: Notifications & User Pill
    _userPage(s) {
        const page = new Adw.PreferencesPage({title: 'Notifications & User Pill', icon_name: 'avatar-default-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'On the lock screen'});
        group.add(switchRow(s, 'show-notifications', 'Show Lockscreen Notifications'));
        group.add(switchRow(s, 'show-avatar', 'Show User Avatar at Bottom'));
        group.add(switchRow(s, 'hide-fingerprint-hint', 'Hide the Fingerprint Hint',
            'No "touch the fingerprint reader" line; the reader still unlocks'));
        const hint = new Adw.EntryRow({title: 'Custom Lockscreen Hint / Greeting Text',
            text: s.get_string('cupertino-lockscreen-message-text'), show_apply_button: true});
        hint.connect('apply', () => {
            const text = hint.text.trim();
            s.set_string('cupertino-lockscreen-message-text', text);
            s.set_boolean('cupertino-lockscreen-message-enable', text !== '');
        });
        group.add(hint);
        page.add(group);
        return page;
    }
}

function switchRow(s, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    s.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function comboRow(s, key, title, choices) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(([, label]) => label))});
    const sync = () => {
        const i = choices.findIndex(([value]) => value === s.get_string(key));
        row.selected = Math.max(0, i);
    };
    sync();
    s.connect(`changed::${key}`, sync);
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && value !== s.get_string(key))
            s.set_string(key, value);
    });
    return row;
}

function scaleRow(s, key, title, min, max, step, unit, subtitle = '') {
    const row = new Adw.ActionRow({title, subtitle});
    const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, min, max, step);
    scale.set_hexpand(true);
    scale.set_size_request(220, -1);
    scale.set_valign(Gtk.Align.CENTER);
    scale.set_draw_value(true);
    scale.set_value_pos(Gtk.PositionType.RIGHT);
    scale.set_format_value_func((_s, v) => `${Math.round(v)} ${unit}`);
    scale.set_value(s.get_int(key));
    scale.connect('value-changed', () => {
        const v = Math.round(scale.get_value() / step) * step;
        if (v !== s.get_int(key))
            s.set_int(key, v);
    });
    s.connect(`changed::${key}`, () => {
        if (Math.round(scale.get_value()) !== s.get_int(key))
            scale.set_value(s.get_int(key));
    });
    row.add_suffix(scale);
    return row;
}

function colourRow(s, key, title) {
    const row = new Adw.ActionRow({title});
    const button = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({title, with_alpha: false}),
        valign: Gtk.Align.CENTER});
    const rgba = new Gdk.RGBA();
    if (rgba.parse(s.get_string(key) || 'white'))
        button.rgba = rgba;
    button.connect('notify::rgba', () => s.set_string(key, button.rgba.to_string()));
    const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
        tooltip_text: 'The theme\'s colour'});
    reset.connect('clicked', () => s.set_string(key, ''));
    row.add_suffix(button);
    row.add_suffix(reset);
    return row;
}
