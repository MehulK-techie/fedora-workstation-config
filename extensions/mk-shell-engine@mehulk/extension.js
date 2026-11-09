// MK Shell Engine: MK Workstation's own shell pieces, replacing third-party
// extensions one at a time. Each module starts on its own, so one that fails
// leaves the others (and GNOME Shell) running.
//   modules/tiling.js  snap layouts (Super+Z), Snap Assist, Super+Left / Right, the coder desktop (Super+Shift+Z)
//   modules/screenshotActions.js  Annotate, OCR Text, Open Folder on the screenshot notification
//   modules/liveWallpaper.js  a video as the desktop background (bin/mk-live-wallpaper), while
//                             WACK Sonoma Live Lockscreen (which has its own) is off
//   modules/dock.js    the glass dock (while Dash to Dock is off)
//   modules/blur.js    native blur (GNOME's GPU blur) for the dock, islands and switcher (while Blur my Shell is off)
//   modules/panel.js   the top bar as three glass islands, the active app, the clock
//   modules/controlCenter.js  Quick Settings as a bento grid
//   modules/magicLamp.js   minimize / restore as a glide into / out of the dock icon (while Magic Lamp is off)
//   modules/appSwitcher.js the Super+Tab app switcher
//   modules/snip.js        area screenshots start fresh and are taken on release
//   modules/mediaKeys.js   Previous / Next track: one press, one skip
//   modules/windowAnimations.js  windows open and close with a little spring (while Burn My Windows is off)
//   modules/calendarDeck.js      the calendar as glass, and a reminder for any day ahead
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { HalfSwap, SnapLayouts, bindSnapLayouts, unbindSnapLayouts } from './modules/tiling.js';
import { Dock } from './modules/dock.js';
import { MagicLamp } from './modules/magicLamp.js';
import { AppSwitcher } from './modules/appSwitcher.js';
import { Snip } from './modules/snip.js';
import { MediaKeys } from './modules/mediaKeys.js';
import { WindowAnimations } from './modules/windowAnimations.js';
import { CalendarDeck } from './modules/calendarDeck.js';
import { NotifyCenter } from './modules/notifyCenter.js';
import { ScreenshotActions } from './modules/screenshotActions.js';
import { LiveWallpaper } from './modules/liveWallpaper.js';
import { Panel } from './modules/panel.js';
import { ControlCenter } from './modules/controlCenter.js';
import { UNIFIED, isActive, watch } from './modules/conflicts.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export default class MKShellEngine extends Extension {
    // The engine also runs on the lock screen (metadata: session-modes), but there only the
    // desktop's live wallpaper, paused (so it plays on the moment you unlock): everything
    // else stops as the screen locks and starts again after unlocking, as GNOME does with
    // other extensions. The lock screen itself is WACK Sonoma Live Lockscreen's.
    enable() {
        this._settings = this.getSettings();
        this._parts = [];
        // the desktop's live wallpaper: WACK Sonoma Live Lockscreen plays it while that's on
        // (decided once every extension has started: it's enabled after this one)
        this._wallpaperIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._wallpaperIdle = 0;
            this._syncWallpaper();
            return GLib.SOURCE_REMOVE;
        });
        this._unwatch = watch(() => this._syncWallpaper());
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncSession());
        this._syncSession();
    }

    _syncWallpaper() {
        if (this._wallpaperIdle)
            return;                                  // (not yet: see enable)
        const yours = !isActive(UNIFIED);
        if (yours && !this._wallpaper) {
            try {
                this._wallpaper = new LiveWallpaper();
            } catch (e) {
                console.error(`mk-shell-engine: live wallpaper didn't start: ${e.message}\n${e.stack}`);
            }
        } else if (!yours && this._wallpaper) {
            this._stopWallpaper();
        }
    }

    _stopWallpaper() {
        try {
            this._wallpaper?.destroy();
        } catch (e) {
            console.error(`mk-shell-engine: ${e.message}`);
        }
        this._wallpaper = null;
    }

    _syncSession() {
        const locked = Main.sessionMode.isLocked;
        if (locked && this._running)
            this._stopParts();
        else if (!locked && !this._running)
            this._startParts();
    }

    _startParts() {
        this._running = true;
        this._parts = [];
        this._start('snap layouts', () => {
            const snap = new SnapLayouts();
            bindSnapLayouts(this, snap);
            const swap = new HalfSwap();          // Super+Left / Right
            return {destroy: () => {
                swap.destroy();
                unbindSnapLayouts();
                snap.destroy();
            }};
        });
        this._start('dock', () => (this._dock = new Dock(this._settings)));
        // the islands top bar blurs each island; the plain panel blur only without it
        this._start('top bar', () => new Panel(this._settings));
        this._start('quick settings', () => new ControlCenter(this._settings));
        this._start('genie', () => new MagicLamp(() => this._dock));
        this._start('app switcher', () => new AppSwitcher());
        this._start('snip', () => new Snip(this._settings));
        this._start('media keys', () => new MediaKeys(this._settings));
        this._start('window animations', () => new WindowAnimations());
        this._start('calendar', () => new CalendarDeck(this._settings));
        this._start('notification centre', () => new NotifyCenter());
        this._start('screenshot actions', () => new ScreenshotActions());
        if (Main.layoutManager._startingUp && !this._bootFaded)
            this._bootFade();
    }

    // At login the top bar and the dock come in together: invisible at first, then (120 ms
    // later, once the session has drawn) a 260 ms fade with a 12 px glide into place
    _bootFade() {
        this._bootFaded = true;
        const parts = [[Main.layoutManager.panelBox, -12], [this._dock?._chrome, 12]].filter(([a]) => a);
        for (const [actor, from] of parts) {
            actor.opacity = 0;
            actor.translation_y = from;
        }
        const go = () => {
            this._bootId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                this._bootId = 0;
                for (const [actor] of parts)
                    actor.ease({opacity: 255, translation_y: 0, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                return GLib.SOURCE_REMOVE;
            });
        };
        // (GNOME slides the panel in itself while starting up: ours follows once that's done)
        const id = Main.layoutManager.connect('startup-complete', () => {
            Main.layoutManager.disconnect(id);
            this._bootWait = 0;
            for (const [actor, from] of parts) {
                actor.remove_all_transitions();
                actor.opacity = 0;
                actor.translation_y = from;
            }
            go();
        });
        this._bootWait = id;
    }

    _endBootFade() {
        if (this._bootWait)
            Main.layoutManager.disconnect(this._bootWait);
        if (this._bootId)
            GLib.source_remove(this._bootId);
        this._bootWait = this._bootId = 0;
        for (const actor of [Main.layoutManager.panelBox, this._dock?._chrome].filter(Boolean)) {
            actor.opacity = 255;
            actor.translation_y = 0;
        }
    }

    _stopParts() {
        this._running = false;
        if (this._bootWait || this._bootId)
            this._endBootFade();
        for (const part of this._parts.reverse()) {
            try {
                part.destroy();
            } catch (e) {
                console.error(`mk-shell-engine: ${e.message}`);
            }
        }
        this._parts = [];
        this._dock = null;
    }

    _start(name, make) {
        try {
            this._parts.push(make());
        } catch (e) {
            console.error(`mk-shell-engine: ${name} didn't start: ${e.message}\n${e.stack}`);
        }
    }

    disable() {
        if (this._sessionId)
            Main.sessionMode.disconnect(this._sessionId);
        this._sessionId = 0;
        this._stopParts();
        if (this._wallpaperIdle)
            GLib.source_remove(this._wallpaperIdle);
        this._wallpaperIdle = 0;
        this._unwatch?.();
        this._unwatch = null;
        this._stopWallpaper();
        this._settings = null;
    }
}
