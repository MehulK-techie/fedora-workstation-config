// MK: the settings window's live preview, a 360 x 210 (16:9) picture of the
// screen: the lock screen's media (a video plays, muted), the scrim, the clock
// in its style, font, colour, size, glow and layout, the glass card, the
// tagline, the battery and weather pill, your picture (28 px) and name above
// the password field with the greeting, and a mini top bar (18 px) with the
// Finder logo at its size (round when it's a picture). Every picture is scaled
// to its size before it's shown (a full-size picture used to fill the whole
// preview). It follows every setting as it changes. Prefs-only (GTK): the
// shell never loads this file.
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
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
    'sf-rounded-heavy': 'font-family: "SF Pro Rounded", "Nunito", "Inter Display", Inter, sans-serif; font-weight: 900;',
    'jetbrains-mono': 'font-family: "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace; font-weight: 600;',
    'editorial-serif': 'font-family: "Playfair Display", "Noto Serif Display", "DejaVu Serif", serif; font-weight: 600; font-style: italic;',
    'futura-geometric': 'font-family: "Futura", "Jost", "Century Gothic", "URW Gothic", sans-serif; font-weight: 500;',
};
// the lock screen's layouts (extension.js LAYOUTS): sizes and places
const LAYOUTS = {
    'sonoma-center': {time: 117, date: 30, place: 'center'},
    'sequoia-split': {time: 104, date: 26, place: 'left', split: true, inset: 80},
    'vertical-stacked': {time: 112, date: 24, place: 'center', stack: true, neon: true},
    'corner-hud': {time: 56, date: 16, place: 'corner', inset: 48},
    'glass-framed': {time: 112, date: 26, place: 'center', card: true},
    'sequoia-compact': {time: 84, date: 22, place: 'center'},
    'minimal-left': {time: 96, date: 24, place: 'left'},
};
const DATES = {full: '%A, %B %-d', short: '%a, %b %-d', numeric: '%x', iso: '%Y-%m-%d'};
let serial = 0;

const expand = path => (path ?? '').replace(/^~(?=\/)/, GLib.get_home_dir());
const exists = path => path && GLib.file_test(path, GLib.FileTest.IS_REGULAR);

// a picture scaled to fit SIZE x SIZE (its natural size is then SIZE, never the file's)
function scaled(path, size) {
    try {
        return Gdk.Texture.new_for_pixbuf(GdkPixbuf.Pixbuf.new_from_file_at_scale(path, size, size, true));
    } catch {
        return null;
    }
}

function avatarPath() {
    for (const p of [GLib.build_filenamev([GLib.get_home_dir(), '.face']),
        `/var/lib/AccountsService/icons/${GLib.get_user_name()}`]) {
        if (exists(p))
            return p;
    }
    return null;
}

export class LivePreview {
    // ICONS: the extension's icons folder (a Gio.File), for the MK and Apple logos
    constructor(settings, icons) {
        this._s = settings;
        this._icons = icons;
        this._id = `mkp${++serial}`;
        const id = this._id;
        this.widget = new Gtk.Frame({halign: Gtk.Align.CENTER, valign: Gtk.Align.START, css_classes: ['mkp-frame']});
        const overlay = new Gtk.Overlay({width_request: W, height_request: H});
        overlay.set_overflow(Gtk.Overflow.HIDDEN);
        this.widget.set_child(overlay);
        // (a fixed 360 x 210 screen: the overlay's children never make it grow)
        overlay.set_child(new Gtk.Box({width_request: W, height_request: H, hexpand: false, vexpand: false}));
        this._picture = new Gtk.Picture({content_fit: Gtk.ContentFit.COVER, can_shrink: true});
        overlay.add_overlay(this._picture);
        overlay.set_clip_overlay(this._picture, true);
        this._scrim = new Gtk.Box({css_classes: [`${id}-scrim`]});
        overlay.add_overlay(this._scrim);

        // the mini top bar (18 px): the Finder logo and its label
        const bar = new Gtk.Box({valign: Gtk.Align.START, halign: Gtk.Align.FILL, height_request: 18,
            css_classes: [`${id}-bar`], spacing: 4});
        this._logo = new Gtk.Picture({margin_start: 6, valign: Gtk.Align.CENTER, halign: Gtk.Align.START,
            content_fit: Gtk.ContentFit.COVER, can_shrink: false});
        this._logo.set_overflow(Gtk.Overflow.HIDDEN);
        this._logoLabel = new Gtk.Label({css_classes: [`${id}-barlabel`], valign: Gtk.Align.CENTER});
        bar.append(this._logo);
        bar.append(this._logoLabel);
        overlay.add_overlay(bar);
        overlay.set_clip_overlay(bar, true);

        // the clock block (date, time, tagline, pill), and Sequoia Split's widget column
        this._clock = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.START, margin_top: 30,
            css_classes: [`${id}-card`]});
        this._date = new Gtk.Label({css_classes: [`${id}-date`]});
        this._time = new Gtk.Label({css_classes: [`${id}-time`], justify: Gtk.Justification.CENTER});
        this._tagline = new Gtk.Label({css_classes: [`${id}-tagline`]});
        this._pill = new Gtk.Label({label: '82%  ·  21°C', css_classes: [`${id}-pill`], halign: Gtk.Align.CENTER,
            margin_top: 4});
        [this._date, this._time, this._pill, this._tagline].forEach(w => this._clock.append(w));
        overlay.add_overlay(this._clock);
        this._column = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.START, halign: Gtk.Align.END,
            margin_top: 60, margin_end: 18, spacing: 4});
        this._colPill = new Gtk.Label({label: '82%  ·  21°C', css_classes: [`${id}-pill`]});
        this._colMedia = new Gtk.Label({label: '♪  Now Playing', css_classes: [`${id}-media`]});
        this._column.append(this._colPill);
        this._column.append(this._colMedia);
        overlay.add_overlay(this._column);

        // your picture (28 px) and name, the greeting, the password field
        const bottom = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.END, halign: Gtk.Align.CENTER,
            margin_bottom: 12, spacing: 3});
        this._greeting = new Gtk.Label({css_classes: [`${id}-greeting`]});
        // (an Image keeps its 28 px: a Picture took the column's width)
        this._avatar = new Gtk.Image({halign: Gtk.Align.CENTER, pixel_size: 28, css_classes: [`${id}-avatar`]});
        this._avatar.set_overflow(Gtk.Overflow.HIDDEN);
        this._avatarIcon = new Gtk.Image({icon_name: 'avatar-default-symbolic', pixel_size: 28, halign: Gtk.Align.CENTER});
        this._name = new Gtk.Label({label: GLib.get_real_name() || GLib.get_user_name(), css_classes: [`${id}-name`]});
        [this._greeting, this._avatar, this._avatarIcon, this._name,
            new Gtk.Label({label: '••••••', css_classes: [`${id}-field`], width_request: 96})].forEach(w => bottom.append(w));
        overlay.add_overlay(bottom);
        const face = avatarPath();
        const tex = face && scaled(face, 28);
        this._avatar.visible = Boolean(tex);
        this._avatarIcon.visible = !tex;
        if (tex)
            this._avatar.set_from_paintable(tex);

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
            this._picture.set_paintable(scaled(path, 720));      // (a sharp cover, never a 6000 px load)
        }
    }

    // the Finder logo in the mini bar: the slider's 14-30 px, scaled to the 18 px bar (8-15 px)
    _syncLogo() {
        const s = this._s, preset = s.get_string('finder-logo-preset');
        const px = Math.max(8, Math.min(15, Math.round(s.get_int('finder-icon-size') / 2)));
        const custom = expand(s.get_string('finder-custom-logo'));
        let path = null;
        if (preset === 'custom' && exists(custom))
            path = custom;
        else if (preset === 'mk' || preset === 'apple')
            path = this._icons.get_child(`mk-${preset === 'mk' ? 'emblem' : 'apple'}-symbolic.svg`).get_path();
        let tex = path ? scaled(path, px) : null;
        if (!tex && preset !== 'none') {
            const theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
            tex = theme.lookup_icon('fedora-logo-icon', null, px, 1, Gtk.TextDirection.NONE, 0);
        }
        this._logo.set_paintable(preset === 'none' ? null : tex);
        this._logo.visible = preset !== 'none' && Boolean(tex);
        this._logo.set_size_request(px, px);
        this._round = preset === 'custom' && path === custom && s.get_boolean('finder-logo-circular') && !/\.svg$/i.test(custom);
        this._logoLabel.label = s.get_boolean('finder-show-label') ? s.get_string('finder-label') : '';
        return px;
    }

    _sync() {
        const s = this._s, id = this._id;
        this._syncMedia();
        this._syncLogo();
        const name = s.get_string('lock-clock-layout');
        const layout = LAYOUTS[name] ?? LAYOUTS['sonoma-center'];
        const left = layout.place !== 'center';
        this._clock.halign = left ? Gtk.Align.START : Gtk.Align.CENTER;
        this._clock.margin_start = left ? Math.round((layout.inset ?? 96) * SCALE) + 8 : 0;
        // (the corner HUD sits at the bottom left)
        this._clock.valign = layout.place === 'corner' ? Gtk.Align.END : Gtk.Align.START;
        this._clock.margin_bottom = layout.place === 'corner' ? Math.round(48 * SCALE) + 8 : 0;
        this._clock.margin_top = layout.place === 'corner' ? 0 : name === 'sequoia-compact' ? 24 : 30;
        for (const label of [this._date, this._time, this._tagline])
            label.halign = left ? Gtk.Align.START : Gtk.Align.CENTER;
        this._time.justify = left ? Gtk.Justification.LEFT : Gtk.Justification.CENTER;
        const twelve = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('clock-format') === '12h';
        const now = GLib.DateTime.new_now_local();
        let time = now.format(twelve ? '%l:%M' : '%H:%M').trim();
        if (layout.stack)
            time = time.replace(':', '\n');
        this._time.label = time;
        this._date.label = now.format(DATES[s.get_string('lock-date-format')] ?? DATES.full);
        this._tagline.label = s.get_string('lock-tagline').trim() ||
            s.get_string('cupertino-lockscreen-message-text').trim() || 'MK Workstation';
        const pill = s.get_boolean('lock-status-pill');
        this._pill.visible = pill && !layout.split;    // (Sequoia: cards in the right-hand column)
        this._column.visible = Boolean(layout.split);
        this._colPill.visible = pill && Boolean(layout.split);
        this._colMedia.visible = s.get_boolean('lock-media-controls');
        const greeting = s.get_string('lock-greeting').trim();
        this._greeting.label = greeting;
        this._greeting.visible = greeting !== '';

        const style = s.get_string('clock-style');
        let font = FONTS[style] ?? '';
        let size = layout.time * SCALE;
        if (style === 'custom' && s.get_string('clock-font')) {
            const fd = Pango.FontDescription.from_string(s.get_string('clock-font'));
            font = `${fd.get_family() ? `font-family: "${fd.get_family().replace(/"/g, '')}";` : ''} font-weight: ${fd.get_weight()};`;
            if (fd.get_size() > 0)
                size = fd.get_size() / Pango.SCALE * (fd.get_size_is_absolute() ? 1 : 4 / 3) * SCALE;
        }
        const colour = c => (/^[#a-z0-9(),.\s%]+$/i.test(c) ? c : '');   // (a colour, nothing else, into the CSS)
        const clockColour = colour(s.get_string('clock-color')) || (layout.neon ? '#67e8f9' : 'rgba(255,255,255,0.85)');
        const dateColour = colour(s.get_string('date-color')) || 'rgba(255,255,255,0.65)';
        const glow = Math.max(s.get_int('lock-clock-glow'), layout.neon ? 45 : 0);
        const shadow = glow ? `text-shadow: 0 ${(glow / 60).toFixed(1)}px ${(1 + glow * 0.06).toFixed(1)}px ` +
            `${layout.neon ? `rgba(34,211,238,${(glow / 100).toFixed(2)})` : `rgba(0,0,0,${(0.2 + glow / 160).toFixed(2)})`};` : '';
        const scrim = s.get_int('dim-opacity') / 100;
        const card = s.get_boolean('lock-glass-card') || layout.card
            ? `background-color: rgba(16,20,32,${(s.get_int('lock-card-opacity') / 100).toFixed(2)}); ` +
              'border: 1px solid rgba(255,255,255,0.24); border-radius: 10px; padding: 6px 14px;'
            : 'background: none; border: none; padding: 0;';
        this._css.load_from_string(`
            .mkp-frame { border-radius: 10px; }
            .${id}-scrim { background-color: rgba(12, 14, 20, ${scrim.toFixed(2)}); }
            .${id}-bar { background-color: rgba(0, 0, 0, 0.30); min-height: 18px; }
            .${id}-barlabel { color: white; font-weight: 800; font-size: 8px; }
            .${id}-card { ${card} }
            .${id}-time { ${font} font-size: ${size.toFixed(1)}px; color: ${clockColour}; line-height: 0.95; ${shadow} }
            .${id}-date { font-size: ${(layout.date * SCALE).toFixed(1)}px; font-weight: 600; color: ${dateColour}; }
            .${id}-tagline { font-size: 6px; font-weight: 600; color: rgba(255,255,255,0.8); }
            .${id}-pill, .${id}-media { font-size: 7px; font-weight: 600; color: white; background-color: rgba(255,255,255,0.14);
                border-radius: 99px; padding: 1px 6px; }
            .${id}-greeting { font-size: 7px; font-weight: 600; color: rgba(255,255,255,0.88); }
            .${id}-name { font-size: 7px; font-weight: 700; color: white; }
            .${id}-field { font-size: 7px; color: rgba(255,255,255,0.7); background-color: rgba(255,255,255,0.16);
                border-radius: 99px; padding: 2px 10px; }
            image.${id}-avatar { border-radius: 999px; }
            picture.${id}-round { border-radius: 999px; }
        `);
        this._logo.set_css_classes(this._round ? [`${id}-round`] : []);
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
