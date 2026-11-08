// MK Shell Engine: MK Workstation's own shell pieces, replacing third-party
// extensions one at a time. Each module starts on its own, so one that fails
// leaves the others (and GNOME Shell) running.
//   modules/tiling.js  snap layouts (Super+Z), Snap Assist, Super+Left / Right, the coder desktop (Super+Shift+Z)
//   modules/screenshotActions.js  Annotate, OCR Text, Open Folder on the screenshot notification
//   modules/liveWallpaper.js  a video as the desktop background (bin/mk-live-wallpaper)
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
import { ScreenshotActions } from './modules/screenshotActions.js';
import { LiveWallpaper } from './modules/liveWallpaper.js';
import { Panel } from './modules/panel.js';
import { ControlCenter } from './modules/controlCenter.js';

export default class MKShellEngine extends Extension {
    // The engine also runs on the lock screen (metadata: session-modes), but there only the
    // desktop's live wallpaper, paused (so it plays on the moment you unlock): everything
    // else stops as the screen locks and starts again after unlocking, as GNOME does with
    // other extensions. The lock screen itself is WACK Sonoma Live Lockscreen's.
    enable() {
        this._settings = this.getSettings();
        this._parts = [];
        try {
            this._wallpaper = new LiveWallpaper();
        } catch (e) {
            console.error(`mk-shell-engine: live wallpaper didn't start: ${e.message}\n${e.stack}`);
        }
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncSession());
        this._syncSession();
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
        this._start('screenshot actions', () => new ScreenshotActions());
    }

    _stopParts() {
        this._running = false;
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
        try {
            this._wallpaper?.destroy();
        } catch (e) {
            console.error(`mk-shell-engine: ${e.message}`);
        }
        this._wallpaper = null;
        this._settings = null;
    }
}
