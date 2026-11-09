// MehulK Workstation & Sonoma Suite: settings (the gear in Extension Manager).
// A live preview of the screen sits at the top of the first and third pages.
// Five pages: Wallpapers & Audio, Finder & Top Bar, Sonoma Lock Screen,
// Performance & Refresh Rate, Power & Hibernate. Every switch writes the merged
// schema (org.gnome.shell.extensions.wack-sonoma-lockscreen); the shell follows
// most changes at once (the lock screen's the next time it shows, or at once
// while locked). bin/mk-live-wallpaper sets the same keys from a terminal.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { LivePreview } from './preview.js';

const MEDIA_TYPES = ['video/mp4', 'video/webm', 'video/x-matroska', 'video/quicktime', 'image/gif', 'image/png',
    'image/jpeg', 'image/webp'];
const IMAGE_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
// root-owned, installed by setup.sh: pkexec only ever runs this fixed path, never a file in $HOME
const GDM_HELPER = '/usr/local/libexec/mk-gdm-monitors';
const BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin']);
const LAYOUT_CHOICES = [['sonoma-center', 'Sonoma Classic Center'], ['sequoia-split', 'Sequoia Split (Clock Left, Widgets Right)'],
    ['vertical-stacked', 'Cyberpunk Vertical Stack'], ['corner-hud', 'Minimalist Corner HUD'],
    ['glass-framed', 'Glass Card Framed']];
const STYLE_CHOICES = [['sf-rounded-heavy', 'SF Pro Rounded Heavy'], ['jetbrains-mono', 'JetBrains Mono Tech'],
    ['editorial-serif', 'Editorial Serif'], ['futura-geometric', 'Futura Geometric'], ['sonoma-bold', 'Sonoma Bold Rounded'],
    ['cupertino-thin', 'Cupertino Thin'], ['digital', 'Classic Digital'], ['custom', 'Custom System Font']];
const DATE_CHOICES = [['full', 'Monday, November 9'], ['short', 'Mon, Nov 9'], ['numeric', 'Numeric (your locale)'],
    ['iso', 'ISO (2026-11-09)']];

export default class WackSonomaLivePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(700, 760);
        window.set_search_enabled(true);
        window.set_title('MehulK Workstation & Sonoma Suite');
        window.add(this._wallpaperPage(window, s));
        window.add(this._topBarPage(window, s));
        window.add(this._lockPage(s));
        window.add(this._performancePage(window, s));
        window.add(this._powerPage(s));
    }

    // The live preview: the screen as it'll look, following every change; a button locks for real
    _previewGroup(s) {
        const group = new Adw.PreferencesGroup({title: 'Live Preview'});
        const preview = new LivePreview(s, this.dir.get_child('icons'));
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, halign: Gtk.Align.CENTER,
            margin_bottom: 6});
        box.append(preview.widget);
        const lock = new Gtk.Button({label: 'Preview Fullscreen Lock Screen', halign: Gtk.Align.CENTER,
            css_classes: ['pill'], tooltip_text: 'Locks the screen now (your password unlocks it)'});
        lock.connect('clicked', () => run(['loginctl', 'lock-session'], () => {}));
        box.append(lock);
        group.add(box);
        return group;
    }

    // ----- 1. Wallpapers & Audio
    _wallpaperPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Wallpapers & Audio', icon_name: 'video-display-symbolic'});
        page.add(this._previewGroup(s));

        const desktop = new Adw.PreferencesGroup({title: 'Desktop',
            description: 'A video, GIF or picture as the desktop background, below every window.'});
        desktop.add(fileRow(window, s, 'desktop-wallpaper-path', 'Desktop Live Wallpaper', MEDIA_TYPES,
            'None (GNOME\'s own wallpaper)', GLib.UserDirectory.DIRECTORY_VIDEOS));
        desktop.add(comboRow(s, 'desktop-hwaccel', 'Video Decoding', [['vaapi', 'Graphics card (VA-API)'],
            ['none', 'Processor']]));
        page.add(desktop);

        const lock = new Adw.PreferencesGroup({title: 'Lock screen',
            description: 'Behind the Sonoma clock, decoded by the graphics card.'});
        lock.add(switchRow(s, 'live-enabled', 'Enable Live Video / GIF Wallpaper'));
        lock.add(switchRow(s, 'wallpaper-sync-mode', 'Same as the Desktop',
            'The lock screen plays the desktop\'s wallpaper'));
        const lockFile = fileRow(window, s, 'background-video-path', 'Lock Screen Media', MEDIA_TYPES,
            'None (GNOME\'s own wallpaper)', GLib.UserDirectory.DIRECTORY_VIDEOS);
        s.bind('wallpaper-sync-mode', lockFile, 'sensitive', Gio.SettingsBindFlags.INVERT_BOOLEAN | Gio.SettingsBindFlags.GET);
        lock.add(lockFile);
        // Live Lock Screen's "at the end": 0 loops, 1 holds the last frame
        const loop = new Adw.SwitchRow({title: 'Loop Video Continuously', subtitle: 'Off: it plays once and holds its last frame'});
        loop.active = s.get_int('general-action-on-end') === 0;
        loop.connect('notify::active', () => s.set_int('general-action-on-end', loop.active ? 0 : 1));
        lock.add(loop);
        page.add(lock);

        const audio = new Adw.PreferencesGroup({title: 'Sound',
            description: 'Off by default: with the sound off no audio stream is opened at all.'});
        audio.add(switchRow(s, 'desktop-audio-enabled', 'Desktop Wallpaper Sound'));
        const dVol = volumeRow(s, 'desktop-audio-volume', 'Desktop Volume');
        s.bind('desktop-audio-enabled', dVol, 'sensitive', Gio.SettingsBindFlags.GET);
        audio.add(dVol);
        audio.add(switchRow(s, 'lockscreen-audio-enabled', 'Lock Screen Video Sound'));
        const lVol = volumeRow(s, 'lockscreen-audio-volume', 'Lock Screen Volume');
        s.bind('lockscreen-audio-enabled', lVol, 'sensitive', Gio.SettingsBindFlags.GET);
        audio.add(lVol);
        audio.add(switchRow(s, 'audio-auto-mute-on-other-media', 'Mute While Other Media Plays',
            'Music or a video playing anywhere else silences the wallpaper until it stops'));
        page.add(audio);
        return page;
    }

    // ----- 2. Finder & Top Bar
    _topBarPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Finder & Top Bar', icon_name: 'view-app-grid-symbolic'});
        const bar = new Adw.PreferencesGroup({title: 'Top bar',
            description: 'Finder, Places and the app indicator, at the left of the bar. MK Shell Engine\'s own Finder and app pill stand aside while these show.'});
        bar.add(switchRow(s, 'topbar-enabled', 'Show Finder, Places and the App Indicator'));
        page.add(bar);

        const finder = new Adw.PreferencesGroup({title: 'Finder'});
        finder.add(comboRow(s, 'finder-logo-preset', 'Logo', [['fedora-blue', 'Fedora Blue'],
            ['fedora-mono', 'Fedora Monochrome'], ['mk', 'MK Emblem'], ['apple', 'Apple Fruit'], ['custom', 'Custom Image'],
            ['none', 'None']]));
        const custom = fileRow(window, s, 'finder-custom-logo', 'Custom Logo Image', IMAGE_TYPES, 'None chosen',
            GLib.UserDirectory.DIRECTORY_PICTURES);
        const syncCustom = () => (custom.sensitive = s.get_string('finder-logo-preset') === 'custom');
        s.connect('changed::finder-logo-preset', syncCustom);
        syncCustom();
        finder.add(custom);
        finder.add(switchRow(s, 'finder-show-label', 'Show the Label'));
        const label = new Adw.EntryRow({title: 'Label Text', text: s.get_string('finder-label'), show_apply_button: true});
        label.connect('apply', () => s.set_string('finder-label', label.text.trim()));
        finder.add(label);
        finder.add(scaleRow(s, 'finder-icon-size', 'Logo Size', 14, 30, 1, 'px', 'The top bar follows as you drag'));
        finder.add(switchRow(s, 'finder-logo-circular', 'Round Custom Logo', 'A picture is cropped to a circle, like an avatar'));
        page.add(finder);

        const more = new Adw.PreferencesGroup({title: 'Places and the app indicator'});
        more.add(switchRow(s, 'places-show-text', 'Places Label', 'Off: an icon only'));
        more.add(switchRow(s, 'show-app-indicator', 'App Indicator',
            'The focused app\'s icon and name, with New Window, Hide, Maximize, Close and Quit'));
        page.add(more);
        return page;
    }

    // ----- 3. Sonoma Lock Screen
    _lockPage(s) {
        const page = new Adw.PreferencesPage({title: 'Sonoma Lock Screen', icon_name: 'system-lock-screen-symbolic'});
        page.add(this._previewGroup(s));
        const clock = new Adw.PreferencesGroup({title: 'Clock'});
        clock.add(comboRow(s, 'lock-clock-layout', 'Clock Layout',
            LAYOUT_CHOICES));
        clock.add(switchRow(s, 'lock-glass-card', 'Glass Card Behind the Clock',
            'A frosted card behind the clock, the battery and weather pill and Now Playing'));
        clock.add(scaleRow(s, 'lock-card-opacity', 'Glass Card Opacity', 10, 90, 2, '%'));
        clock.add(comboRow(s, 'clock-style', 'Clock Typography', STYLE_CHOICES));
        clock.add(scaleRow(s, 'lock-clock-glow', 'Clock Glow &amp; Shadow', 0, 100, 5, '%'));
        clock.add(comboRow(s, 'lock-date-format', 'Date Format', DATE_CHOICES));
        const tagline = new Adw.EntryRow({title: 'Tagline Under the Clock', text: s.get_string('lock-tagline'),
            show_apply_button: true});
        tagline.connect('apply', () => s.set_string('lock-tagline', tagline.text.trim()));
        clock.add(tagline);
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

        const look = new Adw.PreferencesGroup({title: 'Background'});
        look.add(scaleRow(s, 'dim-opacity', 'Scrim', 0, 85, 5, '%', 'A light veil, rgba(12, 14, 20), under the clock'));
        page.add(look);

        const widgets = new Adw.PreferencesGroup({title: 'On the lock screen'});
        widgets.add(switchRow(s, 'lock-media-controls', 'Now Playing', 'Cover, title, Previous, Play / Pause, Next'));
        widgets.add(switchRow(s, 'lock-status-pill', 'Battery &amp; Weather Under the Date'));
        widgets.add(switchRow(s, 'weather-enabled', 'Live Weather',
            'Open-Meteo for where your connection is (no account); off: no weather requests at all'));
        widgets.add(switchRow(s, 'lock-weather', 'Weather in the Pill', 'Beside the battery, under the time'));
        widgets.add(switchRow(s, 'show-notifications', 'Show Notifications'));
        widgets.add(switchRow(s, 'compact-notifications', 'Compact Notification Pills',
            'Three at a time and a count of the rest, with Clear (GNOME\'s own Lock Screen Notifications switch, in Settings › Notifications, must be on)'));
        widgets.add(switchRow(s, 'show-avatar', 'Show User Avatar'));
        widgets.add(switchRow(s, 'hide-fingerprint-hint', 'Hide the Fingerprint Hint',
            'No "touch the fingerprint reader" line; the reader still unlocks'));
        const hint = new Adw.EntryRow({title: 'Custom Lockscreen Hint / Greeting Text',
            text: s.get_string('cupertino-lockscreen-message-text'), show_apply_button: true});
        hint.connect('apply', () => {
            const text = hint.text.trim();
            s.set_string('cupertino-lockscreen-message-text', text);
            s.set_boolean('cupertino-lockscreen-message-enable', text !== '');
        });
        widgets.add(hint);
        const greeting = new Adw.EntryRow({title: 'Greeting or Quote Above the Password Field',
            text: s.get_string('lock-greeting'), show_apply_button: true});
        greeting.connect('apply', () => s.set_string('lock-greeting', greeting.text.trim()));
        widgets.add(greeting);
        page.add(widgets);

        const anims = new Adw.PreferencesGroup({title: 'Animations'});
        anims.add(comboRow(s, 'unlock-animation', 'Unlock Animation Preset',
            [['slow-stop', 'Sonoma Slow-Stop & Dissolve'], ['zoom', 'Cupertino Scale Zoom'], ['crossfade', 'Smooth Crossfade'],
                ['none', 'None']]));
        anims.add(scaleRow(s, 'animation-duration', 'Animation Duration', 120, 600, 10, 'ms'));
        anims.add(switchRow(s, 'lock-entry-animation', 'Lock Animation', 'Fades in from 1.04x as the screen locks'));
        page.add(anims);
        return page;
    }

    // ----- 4. Performance & Refresh Rate
    _performancePage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Performance & Refresh Rate', icon_name: 'power-profile-performance-symbolic'});
        const perf = new Adw.PreferencesGroup({title: 'Lock screen'});
        perf.add(switchRow(s, 'zero-lag-lock', 'Zero-Lag Lock Screen',
            'No heavy blur (a light scrim instead), the video in step with the screen\'s refresh rate'));
        perf.add(switchRow(s, 'prompt-change-blur', 'Blur While the Password Field Shows', 'A single blur pass, only then'));
        perf.add(scaleRow(s, 'prompt-blur-radius', 'Password Field Blur', 0, 40, 1, 'px'));
        perf.add(switchRow(s, 'pause-on-sleep', 'Pause on Sleep and Screen Off',
            'The video plays again 250 ms after waking'));
        perf.add(switchRow(s, 'wake-to-password', 'Password Field on Wake', 'Waking shows the password field, not the clock'));
        page.add(perf);

        const gdm = new Adw.PreferencesGroup({title: 'Login screen',
            description: 'GDM (the login screen) keeps its own display settings: copying yours there makes it run at your refresh rate and resolution, with no mode switch as you log in.'});
        const row = new Adw.ActionRow({title: 'Sync Refresh Rate to GDM', subtitle: 'Asks for your password'});
        const button = new Gtk.Button({label: 'Sync', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        button.connect('clicked', () => {
            if (!rootOwned(GDM_HELPER)) {
                row.subtitle = 'Not installed yet: run sudo ./setup.sh once, or sudo scripts/setup-system-optimizations.sh';
                return;
            }
            button.sensitive = false;
            row.subtitle = 'Waiting for your password…';
            run(['pkexec', GDM_HELPER], (ok, out) => {
                button.sensitive = true;
                row.subtitle = GLib.markup_escape_text(ok ? out.trim().split('\n').pop()
                    : `Not synced: ${out.trim().split('\n').pop() || 'cancelled'}`, -1);
            });
        });
        row.add_suffix(button);
        gdm.add(row);
        page.add(gdm);
        return page;
    }

    // ----- 5. Power & Hibernate
    _powerPage(s) {
        const page = new Adw.PreferencesPage({title: 'Power & Hibernate', icon_name: 'system-shutdown-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Hibernate',
            description: 'Saves everything to disk and powers off; it all comes back as it was.'});
        group.add(switchRow(s, 'show-hibernate', 'Hibernate Buttons',
            'In the Finder menu, Quick Settings\' power menu and the lock screen\'s power button'));
        group.add(switchRow(s, 'remap-sleep-to-hibernate', 'Sleep Means Hibernate',
            'This extension\'s Sleep buttons hibernate instead'));
        group.add(switchRow(s, 'lock-power-button', 'Power Button on the Lock Screen', 'Bottom right'));
        const status = new Adw.ActionRow({title: 'This Computer', subtitle: 'Checking…'});
        const check = () => run([GLib.build_filenamev([BIN, 'mk-hibernate']), '--check'], (ok, out) => {
            status.subtitle = ok ? GLib.markup_escape_text(out.trim(), -1)
                : 'mk-hibernate isn\'t installed yet (./sync.sh)';
        });
        const again = new Gtk.Button({icon_name: 'view-refresh-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
            tooltip_text: 'Check again'});
        again.connect('clicked', check);
        status.add_suffix(again);
        check();
        group.add(status);
        page.add(group);

        const setup = new Adw.PreferencesGroup({title: 'Setting it up',
            description: 'Once, in a terminal: sudo scripts/setup-hibernate.sh (a swap file the size of your memory, the kernel\'s resume setting, and permission to hibernate without a password). Secure Boot keeps the kernel from hibernating while it\'s on.'});
        page.add(setup);

        const about = new Adw.PreferencesGroup({title: 'About',
            description: 'MehulK Workstation and Sonoma Suite, v18.0 (MehulK Personal Edition), by MehulK. ' +
                'Built on WACK Sonoma Lockscreen by rinzler69-wastaken (GPL-3.0) and Live Lock Screen by nick-redwill ' +
                '(AGPL-3.0); the whole is under AGPL-3.0 (LICENSE.AGPL-3.0, NOTICE).'});
        page.add(about);
        return page;
    }
}

// a file root owns and only root can change (else pkexec would run what anyone wrote)
function rootOwned(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info('unix::uid,unix::mode,standard::type,standard::is-symlink',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return info.get_file_type() === Gio.FileType.REGULAR && info.get_attribute_uint32('unix::uid') === 0 &&
            (info.get_attribute_uint32('unix::mode') & 0o022) === 0;
    } catch {
        return false;
    }
}

// a command's output, asynchronously: done(succeeded, stdout + stderr)
// (the live preview group is built per page: a widget lives in one place)

function run(argv, done) {
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                done(p.get_successful(), out ?? '');
            } catch (e) {
                done(false, e.message);
            }
        });
    } catch (e) {
        done(false, e.message);
    }
}

function fileRow(window, s, key, title, types, none, folder) {
    const row = new Adw.ActionRow({title});
    const show = () => {
        const path = s.get_string(key);
        row.subtitle = GLib.markup_escape_text(path ? GLib.path_get_basename(path) : none, -1);
    };
    show();
    s.connect(`changed::${key}`, show);
    const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
    choose.connect('clicked', () => {
        const filter = new Gtk.FileFilter({name: title});
        types.forEach(t => filter.add_mime_type(t));
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        const dialog = new Gtk.FileDialog({title, filters, default_filter: filter});
        const dir = GLib.get_user_special_dir(folder);
        if (dir)
            dialog.set_initial_folder(Gio.File.new_for_path(dir));
        dialog.open(window, null, (d, res) => {
            try {
                const picked = d.open_finish(res);
                if (picked)
                    s.set_string(key, picked.get_path());
            } catch {}                                 // (cancelled)
        });
    });
    const clear = new Gtk.Button({icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
        tooltip_text: 'Clear'});
    clear.connect('clicked', () => s.set_string(key, ''));
    row.add_suffix(choose);
    row.add_suffix(clear);
    return row;
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

function slider(min, max, step, format) {
    const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, min, max, step);
    scale.set_hexpand(true);
    scale.set_size_request(220, -1);
    scale.set_valign(Gtk.Align.CENTER);
    scale.set_draw_value(true);
    scale.set_value_pos(Gtk.PositionType.RIGHT);
    scale.set_format_value_func((_s, v) => format(v));
    return scale;
}

function scaleRow(s, key, title, min, max, step, unit, subtitle = '') {
    const row = new Adw.ActionRow({title, subtitle});
    const scale = slider(min, max, step, v => `${Math.round(v)} ${unit}`);
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

// a 0-1 volume (a double key) as 0-100 %; the shell follows it as it moves
function volumeRow(s, key, title) {
    const row = new Adw.ActionRow({title});
    const scale = slider(0, 100, 1, v => `${Math.round(v)} %`);
    scale.set_value(Math.round(s.get_double(key) * 100));
    scale.connect('value-changed', () => {
        const v = Math.round(scale.get_value()) / 100;
        if (Math.abs(v - s.get_double(key)) > 0.001)
            s.set_double(key, v);
    });
    s.connect(`changed::${key}`, () => {
        const v = Math.round(s.get_double(key) * 100);
        if (Math.round(scale.get_value()) !== v)
            scale.set_value(v);
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
