// WACK Sonoma Live Lockscreen: one extension made of two, plus MK's own touches.
//
//   sonoma.js + src/   WACK Sonoma Lockscreen 2.2.0 (rinzler69-wastaken, GPL-3.0):
//                      the Sonoma clock and date, the user pill and password field,
//                      frosted notification cards
//   live.js + core/ helpers/ utils/ external/   Live Lock Screen (nick-redwill,
//                      AGPL-3.0): a video, GIF or picture behind the lock screen,
//                      played by mpv (hardware decoding), shown as a live copy of
//                      its window; paused while the screen is off or the computer
//                      sleeps. MK forces it silent (no audio stream, ever).
//   this file          starts both when the screen locks and stops them once the
//                      unlock animation is over; the lock and unlock animations;
//                      the scrim, clock style / font / colours / offset, the avatar
//                      and notification switches, no fingerprint hint line; zero-lag
//                      mode (no blur pass unless the password field shows), the
//                      password field on waking, the lock screen video's volume.
//   lockWidgets.js     (MK) battery and weather under the date, Now Playing, the
//                      power button, compact notification pills
//   topbar.js          (MK) Finder, Places and the app indicator in the top bar (user
//                      session only), Hibernate in Quick Settings
//   desktop.js         (MK) the desktop's live wallpaper, with optional sound
//   media.js, power.js (MK) media players (MPRIS); Sleep and Hibernate
//
// The combined work is under AGPL-3.0 (GPL-3.0 section 13 allows combining with
// it): LICENSE.AGPL-3.0, with WACK's own notice in LICENSE.GPL-3.0.
//
// Session modes user + unlock-dialog: in the user session the top bar pieces and
// the desktop wallpaper; while locked the top bar pieces go (the desktop video
// pauses) and the lock screen parts run, as each upstream extension did alone.
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import SonomaPart from './sonoma.js';
import LivePart from './live.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import { LockWidgets } from './lockWidgets.js';
import { TopBar, QuickSettingsHibernate } from './topbar.js';
import { DesktopWallpaper } from './desktop.js';
import { MediaWatcher } from './media.js';

const STYLE_KEYS = ['dim-opacity', 'clock-style', 'clock-font', 'clock-color', 'date-color', 'clock-offset',
    'show-notifications', 'show-avatar', 'hide-fingerprint-hint', 'zero-lag-lock', 'lock-clock-layout', 'lock-glass-card',
    'lock-greeting', 'lock-clock-glow', 'lock-card-opacity', 'lock-date-format', 'lock-tagline'];
// the clock's layout presets: the time's size, the date's, how far up
// the clock's layout presets: the time's size, the date's, how far up; where it sits (center,
// left: 96 px in from the left, corner: the top-left corner); a glass card of its own; a glow
const LAYOUTS = {
    'sonoma-center': {time: 0, date: 0, lift: 0, place: 'center'},
    'sequoia-split': {time: 104, date: 26, lift: 0, place: 'left'},
    'vertical-stacked': {time: 112, date: 24, lift: -24, place: 'center', neon: true},
    'corner-hud': {time: 64, date: 18, lift: 0, place: 'corner'},
    'glass-framed': {time: 112, date: 26, lift: 0, place: 'center', card: true},
    'sequoia-compact': {time: 84, date: 22, lift: -48, place: 'center'},
    'minimal-left': {time: 96, date: 24, lift: 0, place: 'left'},
};
// a change to any of these restarts the lock screen's video (when it's showing)
const LIVE_KEYS = ['live-enabled', 'lockscreen-audio-enabled', 'wallpaper-sync-mode', 'zero-lag-lock', 'pause-on-sleep'];
const CLOCK_FONTS = {
    'sonoma-bold': 'font-family: "SF Pro Rounded", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 700;',
    'cupertino-thin': 'font-family: "SF Pro Display", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 200;',
    'digital': 'font-family: "DSEG7 Classic", "DejaVu Sans Mono", monospace; font-weight: 700;',
    'sf-rounded-heavy': 'font-family: "SF Pro Rounded", "Nunito", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 900;',
    'jetbrains-mono': 'font-family: "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace; font-weight: 600;',
    'editorial-serif': 'font-family: "Playfair Display", "Noto Serif Display", "DejaVu Serif", serif; font-weight: 600; font-style: italic;',
    'futura-geometric': 'font-family: "Futura", "Jost", "Century Gothic", "URW Gothic", sans-serif; font-weight: 500;',
};
// the date's own formats (full and short are WACK's own)
const DATE_FORMATS = {numeric: '%x', iso: '%Y-%m-%d'};

export default class WackSonomaLiveLockscreen extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._hookShield();
        this._sessionId = Main.sessionMode.connect('updated', () => this._sync());
        this._styleIds = STYLE_KEYS.map(k => this._settings.connect(`changed::${k}`, () => this._applyStyle()));
        this._liveIds = LIVE_KEYS.map(k => this._settings.connect(`changed::${k}`, () => this._restartLive()));
        this._volumeIds = ['lockscreen-audio-volume', 'audio-auto-mute-on-other-media'].map(k =>
            this._settings.connect(`changed::${k}`, () => this._syncLockVolume()));
        // both sessions: the desktop video (paused while locked), Hibernate in Quick Settings
        this._desktop = this._make('desktop wallpaper', () => new DesktopWallpaper(this._settings));
        this._qsHibernate = this._make('hibernate', () => new QuickSettingsHibernate(this._settings));
        // waking: the password field at once, 250 ms on (once the screen is back)
        this._login = LoginManager.getLoginManager();
        this._login.connectObject('prepare-for-sleep', (_m, sleeping) => (sleeping ? this._sleeping() : this._woke()), this);
        this._sync();
    }

    _make(name, make) {
        try {
            return make();
        } catch (e) {
            console.error(`wack-sonoma-lockscreen: ${name}: ${e.message}\n${e.stack}`);
            return null;
        }
    }

    // going to sleep: no blur pass on the lock screen while the display goes down and comes back
    _sleeping() {
        if (this._wakeId)
            GLib.source_remove(this._wakeId);
        this._wakeId = 0;
        this._blurAsleep = true;
        for (const w of Main.screenShield?._dialog?._backgroundGroup?.get_children() ?? []) {
            const effect = w.get_effect('blur');
            if (effect)
                effect.enabled = false;
        }
    }

    // awake: 600 ms on (the display back, the password field drawn), the password field and the blur
    _woke() {
        if (this._wakeId)
            GLib.source_remove(this._wakeId);
        this._wakeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._wakeId = 0;
            this._blurAsleep = false;
            for (const w of Main.screenShield?._dialog?._backgroundGroup?.get_children() ?? []) {
                const effect = w.get_effect('blur');
                if (effect)
                    effect.enabled = !this._settings?.get_boolean('zero-lag-lock') || effect.radius > 0;
            }
            if (Main.sessionMode.isLocked && this._settings?.get_boolean('wake-to-password'))
                Main.screenShield?._dialog?._showPrompt?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    // the top bar pieces: the user session only
    _syncTopBar(locked) {
        if (locked && this._topBar) {
            this._topBar.destroy();
            this._topBar = null;
        } else if (!locked && !this._topBar) {
            this._topBar = this._make('top bar', () => new TopBar(this._settings, this));
        }
    }

    // ----- the two parts, while locked
    _sync() {
        const locked = Main.sessionMode.isLocked;
        this._syncTopBar(locked);
        if (locked) {
            if (this._stopId) {                          // locked again during the unlock animation
                GLib.source_remove(this._stopId);
                this._stopId = 0;
            }
            if (!this._running)
                this._startParts();
        } else if (this._running && !this._stopId) {
            // GNOME leaves the lock screen mode as the curtain starts to lift: the parts
            // stay until the unlock animation is over (the video slows and dissolves)
            // (the fallback: normally _hideLockScreenComplete, below, stops them first)
            const wait = this._settings.get_int('animation-duration') + 1500;
            this._stopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
                this._stopId = 0;
                this._stopParts();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _part(Kind) {
        // each upstream extension, built with this extension's metadata: the merged
        // settings schema, this folder for its files
        const part = new Kind(this.metadata);
        try {
            part.enable();
        } catch (e) {
            console.error(`wack-sonoma-lockscreen: ${Kind.name}: ${e.message}`);
        }
        return part;
    }

    _startParts() {
        this._running = true;
        // the desktop's top bar stays away while locked: no second battery or status icons
        // (the lock screen's own pill under the clock shows the battery and the weather)
        if (Main.panel.visible) {
            Main.panel.hide();
            this._hidPanel = true;
        }
        this._sonoma = this._part(SonomaPart);
        if (this._settings.get_boolean('live-enabled'))
            this._live = this._part(LivePart);
        this._widgets = this._make('lock widgets', () => new LockWidgets(this._settings));
        // the lock screen video's sound (when on): quiet while another player plays
        this._media = new MediaWatcher();
        this._media.connect('changed', () => this._syncLockVolume());
        this._styleTries = 0;
        this._applyStyle();
        this._syncLockVolume();
    }

    _syncLockVolume() {
        if (!this._live || !this._settings.get_boolean('lockscreen-audio-enabled'))
            return;
        const muted = this._settings.get_boolean('audio-auto-mute-on-other-media') && this._media?.anyPlaying;
        this._live.setVolume?.(muted ? 0 : this._settings.get_double('lockscreen-audio-volume'));
    }

    _restartLive() {
        if (!this._running)
            return;
        this._stopPart('_live');
        if (this._settings.get_boolean('live-enabled'))
            this._live = this._part(LivePart);
        this._syncLockVolume();
    }

    _stopPart(name) {
        try {
            const part = this[name];
            if (part?.disable)
                part.disable();
            else
                part?.destroy();
        } catch (e) {
            console.error(`wack-sonoma-lockscreen: ${e.message}`);
        }
        this[name] = null;
    }

    _stopParts() {
        this._running = false;
        if (this._styleRetry) {
            GLib.source_remove(this._styleRetry);
            this._styleRetry = 0;
        }
        if (this._hidPanel) {
            Main.panel.show();
            this._hidPanel = false;
        }
        this._dim?.destroy();
        this._dim = null;
        this._greeting?.destroy();
        this._greeting = null;
        this._tagline?.destroy();
        this._tagline = null;
        this._unformatDate();
        this._unlayoutClock();
        this._unwatchBlur();
        this._media?.destroy();
        this._media = null;
        this._stopPart('_widgets');
        this._stopPart('_live');
        this._stopPart('_sonoma');
    }

    // ----- the look: dimming, the clock, the avatar, notifications, the hint line
    _applyStyle() {
        const dialog = Main.screenShield?._dialog;
        if (!this._running)
            return;
        if (!dialog) {
            // (the parts start as GNOME enters the lock screen, a moment before its dialog exists)
            this._retryStyle();
            return;
        }
        // GNOME 51's unlock dialog asks its clock to show the hint for the way you'll sign in
        // (as the password field is made, on waking): WACK's clock has its own hint line
        if (dialog._clock && typeof dialog._clock.selectAuthHint !== 'function')
            dialog._clock.selectAuthHint = () => {};
        const s = this._settings;
        // a light scrim, rgba(12,14,20,a), over the wallpaper and video, under the clock and the prompt
        const dim = s.get_int('dim-opacity') / 100;
        if (!this._dim || this._dim.get_parent() !== dialog) {
            this._dim?.destroy();
            const veil = new St.Widget({style: 'background-color: rgb(12, 14, 20);', reactive: false,
                constraints: new Clutter.BindConstraint({source: dialog, coordinate: Clutter.BindCoordinate.SIZE})});
            veil.connect('destroy', () => {
                if (this._dim === veil)
                    this._dim = null;
            });
            this._dim = veil;
            const bg = dialog._backgroundGroup;
            if (bg?.get_parent() === dialog)
                dialog.insert_child_above(this._dim, bg);
            else
                dialog.insert_child_at_index(this._dim, 0);
        }
        this._dim.opacity = Math.round(dim * 255);
        this._dim.visible = dim > 0;

        // the clock: WACK's time and date, in the lock screen's group beside the dialog
        // (made as the lock screen appears: look again a few times)
        const group = Main.screenShield._lockDialogGroup ?? dialog;
        // WACK's clock box (date, time, and the pill and Now Playing MK adds) and its own labels
        const clockBox = dialog._clock?.has_style_class_name?.('unlock-dialog-clock') ? dialog._clock : null;
        const time = clockBox?._time ?? findByClass(group, 'wack-time');
        const date = clockBox?._dateOutput ?? findByClass(group, 'wack-date');
        const layout = LAYOUTS[s.get_string('lock-clock-layout')] ?? LAYOUTS['sonoma-center'];
        if (time) {
            const style = s.get_string('clock-style');
            let font = CLOCK_FONTS[style] ?? '';
            if (style === 'custom' && s.get_string('clock-font'))
                font = fontToCss(s.get_string('clock-font'));
            const colour = s.get_string('clock-color') || (layout.neon ? '#67e8f9' : '');
            // a glow / drop shadow (the cyberpunk stack glows cyan by itself)
            const glow = Math.max(s.get_int('lock-clock-glow'), layout.neon ? 45 : 0);
            const shadow = glow ? ` text-shadow: 0 ${Math.round(glow / 25)}px ${Math.round(4 + glow * 0.3)}px ` +
                `${layout.neon ? `rgba(34, 211, 238, ${(glow / 100).toFixed(2)})` : `rgba(0, 0, 0, ${(0.2 + glow / 160).toFixed(2)})`};` : '';
            // the layout's size first, so a custom font's own size still wins; laid over WACK's
            // own style (it rewrites the time's colour and weight as it samples the wallpaper)
            this._timeStyle = `${layout.time ? `font-size: ${layout.time}px; ` : ''}${font}${colour ? ` color: ${colour};` : ''}${shadow}`;
            this._clockLift = s.get_int('clock-offset') + layout.lift;
            this._layoutClock(clockBox, time, date, layout);
        }
        if (date) {
            const colour = s.get_string('date-color');
            const size = layout.date ? `font-size: ${layout.date}px; ` : '';
            this._dateStyle = `${size}${colour ? `color: ${colour};` : ''}`;
        }
        this._overWack(clockBox, time, date);
        this._greet(dialog);
        this._tag(clockBox);
        this._formatDate(date);
        this._avatar(dialog);
        if (!time)
            this._retryStyle();
        // the user pill (avatar and name) above the password field
        const well = dialog._authPrompt?._userWell;
        if (well)
            well.visible = s.get_boolean('show-avatar');
        // notifications on the lock screen
        if (dialog._notificationsBox)
            dialog._notificationsBox.visible = s.get_boolean('show-notifications');
        // zero-lag: GNOME's blur pass only runs while it blurs (the password field showing)
        if (s.get_boolean('zero-lag-lock'))
            this._watchBlur(dialog);
        else
            this._unwatchBlur();
        // no "touch the fingerprint reader" line (the reader still works)
        if (s.get_boolean('hide-fingerprint-hint'))
            dialog.add_style_class_name('mk-hide-fp-hint');
        else
            dialog.remove_style_class_name('mk-hide-fp-hint');
    }

    _retryStyle() {
        if (this._styleRetry || this._styleTries++ >= 12)
            return;
        this._styleRetry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._styleRetry = 0;
            this._applyStyle();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The clock's layout (LAYOUTS): its place (centred, 96 px in from the left, or the
    // top-left corner), hours over minutes for the stack; the glass card behind it all
    // (the clock box holds the date, the time, the tagline, the pill and Now Playing)
    _layoutClock(block, time, date, layout) {
        if (!block?.add_style_class_name)
            return;
        const s = this._settings, name = s.get_string('lock-clock-layout');
        if (s.get_boolean('lock-glass-card') || layout.card) {
            block.add_style_class_name('wack-glass-card');
            block.set_style(`background-color: rgba(18, 20, 30, ${(s.get_int('lock-card-opacity') / 100).toFixed(2)});`);
        } else {
            block.remove_style_class_name('wack-glass-card');
            block.set_style(null);
        }
        const left = layout.place !== 'center';
        for (const a of [time, date])
            if (a)
                a.x_align = left ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
        if (!this._clockBlock || this._clockBlock !== block) {
            this._unlayoutClock();
            this._clockBlock = block;
            this._clockTime = time;
            this._blockId = block.connect('notify::allocation', () => this._placeClock());
            this._timeId = time.clutter_text.connect('notify::text', () => this._stackTime());
        }
        time.clutter_text.line_alignment = left ? 0 : 1;       // Pango.Alignment LEFT / CENTER
        this._placeClock();
        if (name === 'vertical-stacked')
            this._stackTime();
        else if (time.text.includes('\n'))
            this._sonoma?._clock?._updateTime?.();             // back to one line
    }

    _stackTime() {
        const time = this._clockTime;
        if (!time || this._settings?.get_string('lock-clock-layout') !== 'vertical-stacked' || !time.text.includes(':'))
            return;
        time.text = time.text.replace(/\s*:\s*/, '\n');
    }

    _placeClock() {
        const block = this._clockBlock;
        if (!block || this._placing || !this._settings)
            return;
        this._placing = true;
        const m = Main.layoutManager.primaryMonitor;
        const place = (LAYOUTS[this._settings.get_string('lock-clock-layout')] ?? LAYOUTS['sonoma-center']).place;
        const [x, y] = block.get_transformed_position();
        block.translation_x = m && place !== 'center' ? Math.round(m.x + (place === 'corner' ? 64 : 96) - (x - block.translation_x)) : 0;
        block.translation_y = m && place === 'corner' ? Math.round(m.y + 56 - (y - block.translation_y)) : (this._clockLift ?? 0);
        this._placing = false;
    }

    // WACK's clock writes its own style on the time and date (colour, weight) whenever it
    // samples the wallpaper: ours goes on top of it each time, later declarations winning
    _overWack(clockBox, time, date) {
        const apply = () => {
            if (time && this._timeStyle && !(time.style ?? '').includes(this._timeStyle))
                time.set_style(`${time.style ?? ''} ${this._timeStyle}`.trim());
            if (date && this._dateStyle && !(date.style ?? '').includes(this._dateStyle))
                date.set_style(`${date.style ?? ''} ${this._dateStyle}`.trim());
        };
        if (clockBox?._applyTextStyle && !clockBox._mkStyled) {
            const own = clockBox._applyTextStyle;
            clockBox._mkStyled = true;
            clockBox._applyTextStyle = function (...args) {
                const result = own.apply(this, args);
                apply();
                return result;
            };
        }
        if (clockBox?._applyTextStyle)
            clockBox._applyTextStyle();                // (WACK's own style afresh, then ours: never piled up)
        else
            apply();
    }

    // a tagline under the time
    _tag(clockBox) {
        const text = this._settings.get_string('lock-tagline').trim();
        if (!text || !clockBox?.add_child) {
            this._tagline?.destroy();
            this._tagline = null;
            return;
        }
        if (!this._tagline || this._tagline.get_parent() !== clockBox) {
            this._tagline?.destroy();
            this._tagline = new St.Label({style_class: 'wack-tagline', x_align: Clutter.ActorAlign.CENTER});
            this._tagline.connect('destroy', l => {
                if (this._tagline === l)
                    this._tagline = null;
            });
            const after = clockBox._time ? clockBox.get_children().indexOf(clockBox._time) + 1 : clockBox.get_n_children();
            clockBox.insert_child_at_index(this._tagline, after);
        }
        this._tagline.text = text;
        this._tagline.x_align = (LAYOUTS[this._settings.get_string('lock-clock-layout')]?.place ?? 'center') === 'center'
            ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
    }

    // the date's format: full / short are WACK's own (date-style); numeric and ISO are written here
    _formatDate(date) {
        if (!date)
            return;
        const fmt = this._settings.get_string('lock-date-format');
        const wack = fmt === 'short' ? 'short' : 'full';
        if (this._settings.get_string('date-style') !== wack)
            this._settings.set_string('date-style', wack);
        if (this._dateLabel !== date) {
            this._unformatDate();
            this._dateLabel = date;
            this._dateId = date.clutter_text.connect('notify::text', () => this._writeDate());
        }
        this._writeDate();
    }

    _writeDate() {
        const pattern = DATE_FORMATS[this._settings?.get_string('lock-date-format')];
        if (!pattern || !this._dateLabel)
            return;
        const text = GLib.DateTime.new_now_local().format(pattern);
        if (this._dateLabel.text !== text)
            this._dateLabel.text = text;
    }

    _unformatDate() {
        try {
            if (this._dateId)
                this._dateLabel.clutter_text.disconnect(this._dateId);
        } catch {}
        this._dateId = 0;
        this._dateLabel = null;
    }

    // your picture at 56 px above the password field
    _avatar(dialog) {
        const icon = findByClass(dialog, 'user-icon');
        if (icon && icon._iconSize !== 56 && typeof icon.update === 'function') {
            icon._iconSize = 56;
            icon.update();
        }
    }

    _unlayoutClock() {
        try {
            if (this._blockId)
                this._clockBlock.disconnect(this._blockId);
            if (this._timeId)
                this._clockTime.clutter_text.disconnect(this._timeId);
        } catch {}                          // (gone with the lock screen)
        this._blockId = this._timeId = 0;
        this._clockBlock = this._clockTime = null;
    }

    // a line of your own above the password field
    _greet(dialog) {
        const text = this._settings.get_string('lock-greeting').trim();
        const box = dialog._promptBox ?? dialog._authPrompt?.get_parent();
        if (!text || !box) {
            this._greeting?.destroy();
            this._greeting = null;
            return;
        }
        if (!this._greeting || this._greeting.get_parent() !== box) {
            this._greeting?.destroy();
            this._greeting = new St.Label({style_class: 'wack-greeting', x_align: Clutter.ActorAlign.CENTER});
            this._greeting.connect('destroy', g => {
                if (this._greeting === g)
                    this._greeting = null;
            });
            box.insert_child_at_index(this._greeting, 0);
        }
        this._greeting.text = text;
    }

    // A Shell.BlurEffect at radius 0 still copies the whole screen through an offscreen
    // buffer every frame: switched off until something gives it a radius
    // (GNOME makes the backgrounds again when monitors change or the lock screen is set up:
    // each new one is watched as it comes)
    _watchBlur(dialog) {
        const group = dialog._backgroundGroup;
        if (!group || this._blurGroup === group)
            return;
        this._unwatchBlur();
        this._blurGroup = group;
        this._blurIds = [];
        this._blurAddId = group.connect('child-added', (_g, widget) => this._watchBlurOn(widget));
        group.get_children().forEach(w => this._watchBlurOn(w));
    }

    _watchBlurOn(widget) {
        const effect = widget.get_effect('blur');
        if (!(effect instanceof Shell.BlurEffect))
            return;
        const sync = () => (effect.enabled = !this._blurAsleep && effect.radius > 0);
        this._blurIds.push([effect, effect.connect('notify::radius', sync)]);
        sync();
    }

    _unwatchBlur() {
        for (const [effect, id] of this._blurIds ?? []) {
            try {
                effect.disconnect(id);
                effect.enabled = true;
            } catch {}                      // (gone with the dialog)
        }
        try {
            if (this._blurAddId)
                this._blurGroup.disconnect(this._blurAddId);
        } catch {}
        this._blurIds = this._blurGroup = null;
        this._blurAddId = 0;
    }

    // ----- the lock and unlock animations (GNOME's screen shield, wrapped)
    _hookShield() {
        const shield = Main.screenShield, self = this;
        if (!shield || shield._mkLockHooked)
            return;
        shield._mkLockHooked = true;
        this._shield = shield;
        this._saved = {show: shield._resetLockScreen, deactivate: shield.deactivate,
            cont: shield._continueDeactivate, complete: shield._completeDeactivate};

        // the lock screen is gone and GNOME is about to destroy its dialog: the parts stop
        // here, first (they get the whole unlock animation, and nothing after it)
        shield._completeDeactivate = function (...args) {
            if (self._running) {
                if (self._stopId) {
                    GLib.source_remove(self._stopId);
                    self._stopId = 0;
                }
                self._stopParts();
            }
            return self._saved.complete.apply(this, args);
        };

        // locking: fades in from 1.04x to its size (instead of the curtain dropping); GNOME's
        // own completion step (_lockScreenShown) runs when it's done, as with its curtain
        shield._resetLockScreen = function (params = {}) {
            const wasHidden = this._lockScreenState === MessageTray.State.HIDDEN;
            const result = self._saved.show.call(this, params);
            if (wasHidden && params.animateLockScreen && self._settings.get_boolean('lock-entry-animation') &&
                St.Settings.get().enable_animations) {
                const group = this._lockDialogGroup;
                group.remove_all_transitions();
                group.set_pivot_point(0.5, 0.5);
                group.set({translation_y: 0, opacity: 0, scale_x: 1.04, scale_y: 1.04});
                group.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 280,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => this._lockScreenShown({fadeToBlack: params.fadeToBlack, animateFade: true})});
            }
            return result;
        };

        // unlocking: the chosen preset. GNOME slides the lock screen up (twice over:
        // _hideLockScreen, then _continueDeactivate, which ends in _completeDeactivate);
        // slow-stop keeps that slide (the video slowing as it goes); the others replace it
        shield.deactivate = function (...args) {
            self._unlocking();
            return self._saved.deactivate.apply(this, args);
        };
        shield._continueDeactivate = function (animate, ...rest) {
            const result = self._saved.cont.call(this, animate, ...rest);
            const preset = self._settings.get_string('unlock-animation');
            if (preset === 'slow-stop' || this._isGreeter)
                return result;
            const group = this._lockDialogGroup;
            group.remove_all_transitions();              // (GNOME's slide, and its completion)
            group.translation_y = 0;
            group.set_pivot_point(0.5, 0.5);
            const duration = animate && preset !== 'none' && St.Settings.get().enable_animations
                ? self._settings.get_int('animation-duration') : 0;
            group.ease({opacity: 0, ...(preset === 'zoom' ? {scale_x: 1.06, scale_y: 1.06} : {}),
                duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this._hideLockScreenComplete();      // (both of GNOME's completions, as its slide does)
                    this._completeDeactivate();
                    // back to normal for the next lock, now that it's all hidden (GNOME's own
                    // slide-in moves the group but never resets its opacity)
                    group.set({scale_x: 1, scale_y: 1, opacity: 255});
                }});
            return result;
        };
    }

    // the video: slow-stop slows it to a stop as the lock screen goes; the others just go
    _unlocking() {
        const player = this._live?._player;
        if (!player)
            return;
        if (this._settings.get_string('unlock-animation') !== 'slow-stop')
            return;
        const duration = this._settings.get_int('animation-duration');
        const steps = [0.6, 0.35, 0.15];
        steps.forEach((speed, i) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(duration * i / steps.length),
            () => {
                player._queueCommand?.('set_property', 'speed', speed);
                return GLib.SOURCE_REMOVE;
            }));
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            player.pauseImmediately?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        for (const id of ['_stopId', '_wakeId']) {
            if (this[id])
                GLib.source_remove(this[id]);
            this[id] = 0;
        }
        this._stopParts();
        this._login?.disconnectObject(this);
        this._login = null;
        this._syncTopBar(true);
        for (const part of ['_qsHibernate', '_desktop']) {
            try {
                this[part]?.destroy();
            } catch (e) {
                console.error(`wack-sonoma-lockscreen: ${e.message}`);
            }
            this[part] = null;
        }
        if (this._shield) {
            for (const [name, saved] of [['_resetLockScreen', this._saved.show], ['deactivate', this._saved.deactivate],
                ['_continueDeactivate', this._saved.cont], ['_completeDeactivate', this._saved.complete]]) {
                this._shield[name] = saved;
                if (Object.getPrototypeOf(this._shield)[name] === saved)
                    delete this._shield[name];
            }
            delete this._shield._mkLockHooked;
            this._shield = null;
        }
        Main.screenShield?._dialog?.remove_style_class_name('mk-hide-fp-hint');
        Main.sessionMode.disconnect(this._sessionId);
        for (const id of this._styleIds)
            this._settings.disconnect(id);
        for (const id of [...this._liveIds, ...this._volumeIds])
            this._settings.disconnect(id);
        this._settings = null;
    }
}

function findByClass(actor, cls) {
    if (actor.has_style_class_name?.(cls))
        return actor;
    for (const child of actor.get_children()) {
        const found = findByClass(child, cls);
        if (found)
            return found;
    }
    return null;
}

// "Inter Display Bold 96" -> CSS for St
function fontToCss(desc) {
    const fd = Pango.FontDescription.from_string(desc);
    const parts = [];
    if (fd.get_family())
        parts.push(`font-family: "${fd.get_family()}";`);
    parts.push(`font-weight: ${fd.get_weight()};`);
    if (fd.get_size() > 0)
        parts.push(`font-size: ${fd.get_size() / Pango.SCALE}${fd.get_size_is_absolute() ? 'px' : 'pt'};`);
    if (fd.get_style() !== Pango.Style.NORMAL)
        parts.push('font-style: italic;');
    return parts.join(' ');
}
