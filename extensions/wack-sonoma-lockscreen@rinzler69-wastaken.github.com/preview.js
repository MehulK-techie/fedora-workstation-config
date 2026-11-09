// MK: the settings window's live preview, a 360 x 210 (16:9) picture of the
// screen: the lock screen's media (a video plays, muted), the scrim, the clock
// in its style, font, colour, size and layout, the glass card, the battery and
// weather pill, the greeting above a password field, and the top bar's Finder
// logo at its size (round when it's a picture). It follows every setting as it
// changes. Prefs-only (GTK): the shell never loads this file.
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

const W = 360, H = 210;
const SCALE = W / 1920;                  // the preview against a 1920 px wide screen
const VIDEO = /\.(mp4|webm|mkv|mov|m4v|avi)$/i;
const FONTS = {
    'sonoma-bold': 'font-family: "SF Pro Rounded", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 700;',
    'cupertino-thin': 'font-family: "SF Pro Display", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 200;',
    'digital': 'font-family: "DSEG7 Classic", "DejaVu Sans Mono", monospace; font-weight: 700;',
};
const LAYOUT_SIZE = {'sonoma-center': 128, 'sequoia-compact': 84, 'minimal-left': 96, 'vertical-stacked': 112};
const LAYOUT_DATE = {'sonoma-center': 30, 'sequoia-compact': 22, 'minimal-left': 24, 'vertical-stacked': 24};
let serial = 0;

const expand = path => (path ?? '').replace(/^~(?=\/)/, GLib.get_home_dir());
const exists = path => path && GLib.file_test(path, GLib.FileTest.IS_REGULAR);

export class LivePreview {
    // ICONS: the extension's icons folder (a Gio.File), for the MK and Apple logos
    constructor(settings, icons) {
        this._s = settings;
        this._icons = icons;
        this._id = `mkp${++serial}`;
        this.widget = new Gtk.Frame({halign: Gtk.Align.CENTER, css_classes: ['mkp-frame']});
        const overlay = new Gtk.Overlay({width_request: W, height_request: H});
        overlay.set_overflow(Gtk.Overflow.HIDDEN);
        this.widget.set_child(overlay);

        this._picture = new Gtk.Picture({content_fit: Gtk.ContentFit.COVER, can_shrink: true, width_request: W,
            height_request: H});
        overlay.set_child(this._picture);
        this._scrim = new Gtk.Box({css_classes: [`${this._id}-scrim`]});
        overlay.add_overlay(this._scrim);

        // the top bar: the Finder logo and its label
        const bar = new Gtk.Box({valign: Gtk.Align.START, halign: Gtk.Align.FILL, height_request: 18,
            css_classes: [`${this._id}-bar`], spacing: 4});
        this._logo = new Gtk.Image({margin_start: 8, valign: Gtk.Align.CENTER});
        this._logoPic = new Gtk.Picture({margin_start: 8, valign: Gtk.Align.CENTER, content_fit: Gtk.ContentFit.COVER,
            can_shrink: true});
        this._logoPic.set_overflow(Gtk.Overflow.HIDDEN);
        this._logoLabel = new Gtk.Label({css_classes: [`${this._id}-barlabel`]});
        bar.append(this._logo);
        bar.append(this._logoPic);
        bar.append(this._logoLabel);
        overlay.add_overlay(bar);

        // the clock block (date, time, pill), the greeting and a password field
        this._clock = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.START, margin_top: 32,
            css_classes: [`${this._id}-card`]});
        this._date = new Gtk.Label({css_classes: [`${this._id}-date`]});
        this._time = new Gtk.Label({css_classes: [`${this._id}-time`], justify: Gtk.Justification.CENTER});
        this._pill = new Gtk.Label({label: '82%  ·  21°C', css_classes: [`${this._id}-pill`], halign: Gtk.Align.CENTER,
            margin_top: 4});
        this._clock.append(this._date);
        this._clock.append(this._time);
        this._clock.append(this._pill);
        overlay.add_overlay(this._clock);
        const bottom = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.END, halign: Gtk.Align.CENTER,
            margin_bottom: 16, spacing: 4});
        this._greeting = new Gtk.Label({css_classes: [`${this._id}-greeting`]});
        bottom.append(this._greeting);
        bottom.append(new Gtk.Label({label: '••••••', css_classes: [`${this._id}-field`], width_request: 96}));
        overlay.add_overlay(bottom);

        this._css = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), this._css,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this._changedId = settings.connect('changed', () => this._queue());
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
        this.widget.connect('destroy', () => this.destroy());
        this._sync();
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _media() {
        const s = this._s;
        const lock = s.get_boolean('wallpaper-sync-mode') ? s.get_string('desktop-wallpaper-path') || s.get_string('background-video-path')
            : s.get_string('background-video-path');
        if (s.get_boolean('live-enabled') && exists(expand(lock)))
            return expand(lock);
        // GNOME's own wallpaper otherwise
        try {
            const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            const dark = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('color-scheme') === 'prefer-dark';
            const uri = bg.get_string(dark ? 'picture-uri-dark' : 'picture-uri') || bg.get_string('picture-uri');
            return uri ? Gio.File.new_for_uri(uri).get_path() : null;
        } catch {
            return null;
        }
    }

    _syncMedia() {
        const path = this._media();
        if (path === this._mediaPath)
            return;
        this._mediaPath = path;
        this._stream?.pause?.();
        this._stream = null;
        if (!path) {
            this._picture.set_paintable(null);
        } else if (VIDEO.test(path)) {
            const stream = Gtk.MediaFile.new_for_filename(path);
            stream.muted = true;
            stream.loop = true;
            stream.play();
            this._stream = stream;
            this._picture.set_paintable(stream);
        } else {
            this._picture.set_filename(path);
        }
    }

    _syncLogo() {
        const s = this._s, preset = s.get_string('finder-logo-preset'), size = s.get_int('finder-icon-size');
        const px = Math.round(size * 0.75);                 // (a little smaller: the preview is a small screen)
        const custom = expand(s.get_string('finder-custom-logo'));
        const round = preset === 'custom' && exists(custom) && s.get_boolean('finder-logo-circular') && !/\.svg$/i.test(custom);
        this._logoPic.visible = round;
        this._logo.visible = !round && preset !== 'none';
        if (round) {
            this._logoPic.set_filename(custom);
            this._logoPic.set_size_request(px, px);
        } else if (preset === 'custom' && exists(custom)) {
            this._logo.set_from_file(custom);
        } else if (preset === 'mk' || preset === 'apple') {
            this._logo.set_from_file(this._icons.get_child(`mk-${preset === 'mk' ? 'emblem' : 'apple'}-symbolic.svg`).get_path());
        } else {
            this._logo.set_from_icon_name('fedora-logo-icon');
        }
        this._logo.pixel_size = px;
        this._logoLabel.label = s.get_boolean('finder-show-label') ? s.get_string('finder-label') : '';
        return px;
    }

    _sync() {
        const s = this._s;
        this._syncMedia();
        const logo = this._syncLogo();
        const layout = s.get_string('lock-clock-layout');
        const left = layout === 'minimal-left';
        this._clock.halign = left ? Gtk.Align.START : Gtk.Align.CENTER;
        this._clock.margin_start = left ? Math.round(96 * SCALE) + 8 : 0;
        this._clock.margin_top = layout === 'sequoia-compact' ? 24 : 32;
        this._date.halign = this._time.halign = left ? Gtk.Align.START : Gtk.Align.CENTER;
        this._time.justify = left ? Gtk.Justification.LEFT : Gtk.Justification.CENTER;
        const twelve = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('clock-format') === '12h';
        const now = GLib.DateTime.new_now_local();
        let time = now.format(twelve ? '%l:%M' : '%H:%M').trim();
        if (layout === 'vertical-stacked')
            time = time.replace(':', '\n');
        this._time.label = time;
        this._date.label = now.format('%A, %B %-d');
        this._pill.visible = s.get_boolean('lock-status-pill');
        const greeting = s.get_string('lock-greeting').trim();
        this._greeting.label = greeting;
        this._greeting.visible = greeting !== '';

        const style = s.get_string('clock-style');
        let font = FONTS[style] ?? '';
        let size = (LAYOUT_SIZE[layout] ?? 128) * SCALE;
        if (style === 'custom' && s.get_string('clock-font')) {
            const fd = Pango.FontDescription.from_string(s.get_string('clock-font'));
            font = `${fd.get_family() ? `font-family: "${fd.get_family().replace(/"/g, '')}";` : ''} font-weight: ${fd.get_weight()};`;
            if (fd.get_size() > 0)
                size = fd.get_size() / Pango.SCALE * (fd.get_size_is_absolute() ? 1 : 4 / 3) * SCALE;
        }
        const colour = c => (/^[#a-z0-9(),.\s%]+$/i.test(c) ? c : '');   // (a colour, nothing else, into the CSS)
        const clockColour = colour(s.get_string('clock-color')) || 'rgba(255,255,255,0.85)';
        const dateColour = colour(s.get_string('date-color')) || 'rgba(255,255,255,0.65)';
        const scrim = s.get_int('dim-opacity') / 100;
        const id = this._id;
        const card = s.get_boolean('lock-glass-card')
            ? 'background-color: rgba(18,20,30,0.34); border: 1px solid rgba(255,255,255,0.16); border-radius: 10px; padding: 6px 14px;'
            : 'background: none; border: none; padding: 0;';
        this._css.load_from_string(`
            .mkp-frame { border-radius: 10px; }
            .${id}-scrim { background-color: rgba(12, 14, 20, ${scrim.toFixed(2)}); }
            .${id}-bar { background-color: rgba(0, 0, 0, 0.28); min-height: ${Math.max(18, logo + 6)}px; }
            .${id}-barlabel { color: white; font-weight: 800; font-size: 9px; }
            .${id}-card { ${card} }
            .${id}-time { ${font} font-size: ${size.toFixed(1)}px; color: ${clockColour}; line-height: 0.95; }
            .${id}-date { font-size: ${((LAYOUT_DATE[layout] ?? 30) * SCALE).toFixed(1)}px; font-weight: 600; color: ${dateColour}; }
            .${id}-pill { font-size: 7px; font-weight: 600; color: white; background-color: rgba(255,255,255,0.14);
                border-radius: 99px; padding: 1px 6px; }
            .${id}-greeting { font-size: 8px; font-weight: 600; color: rgba(255,255,255,0.88); }
            .${id}-field { font-size: 7px; color: rgba(255,255,255,0.7); background-color: rgba(255,255,255,0.16);
                border-radius: 99px; padding: 2px 10px; }
            picture.${id}-round { border-radius: 999px; }
        `);
        this._logoPic.set_css_classes([`${id}-round`]);
        this._logoPic.margin_top = 0;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        if (this._idle)
            GLib.source_remove(this._idle);
        if (this._tick)
            GLib.source_remove(this._tick);
        this._s.disconnect(this._changedId);
        this._stream?.pause?.();
        this._stream = null;
        Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(), this._css);
    }
}
