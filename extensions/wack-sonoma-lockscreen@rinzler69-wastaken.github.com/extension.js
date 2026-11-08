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
//                      dimming, clock style / font / colours / offset, the avatar
//                      and notification switches, no fingerprint hint line.
//
// The combined work is under AGPL-3.0 (GPL-3.0 section 13 allows combining with
// it): LICENSE.AGPL-3.0, with WACK's own notice in LICENSE.GPL-3.0.
//
// Session modes user + unlock-dialog: in the user session it only waits for the
// screen to lock (and finishes the unlock animation); everything else runs while
// locked, as each part did on its own.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import SonomaPart from './sonoma.js';
import LivePart from './live.js';

const STYLE_KEYS = ['dim-opacity', 'clock-style', 'clock-font', 'clock-color', 'date-color', 'clock-offset',
    'show-notifications', 'show-avatar', 'hide-fingerprint-hint'];
const CLOCK_FONTS = {
    'sonoma-bold': 'font-family: "SF Pro Rounded", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 700;',
    'cupertino-thin': 'font-family: "SF Pro Display", "Inter Display", Inter, Cantarell, sans-serif; font-weight: 200;',
    'digital': 'font-family: "DSEG7 Classic", "DejaVu Sans Mono", monospace; font-weight: 700;',
};

export default class WackSonomaLiveLockscreen extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._hookShield();
        this._sessionId = Main.sessionMode.connect('updated', () => this._sync());
        this._styleIds = STYLE_KEYS.map(k => this._settings.connect(`changed::${k}`, () => this._applyStyle()));
        this._liveId = this._settings.connect('changed::live-enabled', () => this._restartLive());
        this._sync();
    }

    // ----- the two parts, while locked
    _sync() {
        const locked = Main.sessionMode.isLocked;
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
        this._sonoma = this._part(SonomaPart);
        if (this._settings.get_boolean('live-enabled'))
            this._live = this._part(LivePart);
        this._styleTries = 0;
        this._applyStyle();
    }

    _restartLive() {
        if (!this._running)
            return;
        this._stopPart('_live');
        if (this._settings.get_boolean('live-enabled'))
            this._live = this._part(LivePart);
    }

    _stopPart(name) {
        try {
            this[name]?.disable();
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
        this._dim?.destroy();
        this._dim = null;
        this._stopPart('_live');
        this._stopPart('_sonoma');
    }

    // ----- the look: dimming, the clock, the avatar, notifications, the hint line
    _applyStyle() {
        const dialog = Main.screenShield?._dialog;
        if (!this._running || !dialog)
            return;
        const s = this._settings;
        // a dark veil over the wallpaper and video, under the clock and the prompt
        const dim = s.get_int('dim-opacity') / 100;
        if (!this._dim || this._dim.get_parent() !== dialog) {
            this._dim?.destroy();
            const veil = new St.Widget({style: 'background-color: black;', reactive: false,
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
        const time = findByClass(group, 'wack-time'), date = findByClass(group, 'wack-date');
        if (time) {
            const style = s.get_string('clock-style');
            let font = CLOCK_FONTS[style] ?? '';
            if (style === 'custom' && s.get_string('clock-font'))
                font = fontToCss(s.get_string('clock-font'));
            const colour = s.get_string('clock-color');
            time.set_style(`${font}${colour ? ` color: ${colour};` : ''}`);
            const block = time.get_parent();
            if (block)
                block.translation_y = s.get_int('clock-offset');
        }
        if (date) {
            const colour = s.get_string('date-color');
            date.set_style(colour ? `color: ${colour};` : null);
        }
        if (!time && this._styleTries++ < 8) {
            this._styleRetry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this._styleRetry = 0;
                this._applyStyle();
                return GLib.SOURCE_REMOVE;
            });
        }
        // the user pill (avatar and name) above the password field
        const well = dialog._authPrompt?._userWell;
        if (well)
            well.visible = s.get_boolean('show-avatar');
        // notifications on the lock screen
        if (dialog._notificationsBox)
            dialog._notificationsBox.visible = s.get_boolean('show-notifications');
        // no "touch the fingerprint reader" line (the reader still works)
        if (s.get_boolean('hide-fingerprint-hint'))
            dialog.add_style_class_name('mk-hide-fp-hint');
        else
            dialog.remove_style_class_name('mk-hide-fp-hint');
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
        if (this._stopId)
            GLib.source_remove(this._stopId);
        this._stopId = 0;
        this._stopParts();
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
        this._settings.disconnect(this._liveId);
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
