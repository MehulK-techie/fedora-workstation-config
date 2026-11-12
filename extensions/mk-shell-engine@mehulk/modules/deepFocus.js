// MK Shell Engine: Deep Focus, one key (deep-focus, Super+Alt+F) or the Quick Settings tile.
// On: Do Not Disturb (no banners), the live wallpaper dims and pauses (no CPU, no GPU: WACK Sonoma
// Live Lockscreen's desktop.js), the dock tucks away (the bottom edge still brings it back), and an
// MK Companion focus session starts (mk-timer, 50 minutes, "Deep Focus"). Off (the key again, the
// tile, or that session ending): every piece back as it was before, the session ended cleanly.
// Idle it does nothing at all: no timers, one file watch on Companion's state while it's on.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { UNIFIED } from './conflicts.js';

const MINUTES = 50;
const TIMER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-timer']);
const TIMER_STATE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'timer.json']);

// (locking the screen takes the engine's parts down and builds them again after: Deep Focus is
// carried across that, not ended)
let carried = null;

const DeepToggle = GObject.registerClass({GTypeName: 'MkDeepFocusToggle'}, class DeepToggle extends QuickToggle {
    constructor(onClick) {
        super({title: 'Deep Focus', subtitle: 'Super+Alt+F', iconName: 'weather-clear-night-symbolic', toggleMode: false});
        this.connect('clicked', onClick);
    }
});

export class DeepFocus {
    constructor(settings, getDock) {
        this._settings = settings;
        this._getDock = getDock;
        this._on = false;
        Main.wm.addKeybinding('deep-focus', settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.toggle());
        try {
            this._indicator = new SystemIndicator();
            this._toggle = new DeepToggle(() => this.toggle());
            this._indicator.quickSettingsItems.push(this._toggle);
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        } catch (e) {
            console.warn(`mk-shell-engine: deep focus tile: ${e.message}`);
        }
        if (carried) {
            Object.assign(this, carried);
            carried = null;
            this._toggle?.set({checked: true});
            this._getDock()?.setTucked?.(true);
            this._wallpaper()?.setDeepFocus?.(true);
            this._watchTimer();
        }
    }

    _wallpaper() {
        return Main.extensionManager.lookup(UNIFIED)?.stateObj?._desktop ?? null;
    }

    toggle() {
        if (this._on)
            this._end();
        else
            this._begin();
    }

    _begin() {
        this._on = true;
        this._toggle?.set({checked: true});
        // what was there before, to put back
        this._notif ??= new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._bannersWere = this._notif.get_boolean('show-banners');
        this._notif.set_boolean('show-banners', false);
        this._wallpaper()?.setDeepFocus?.(true);
        this._getDock()?.setTucked?.(true);
        // a Companion session (unless one already runs: that one is yours, left alone)
        this._ownTimer = null;
        if (!this._companionRunning() && GLib.file_test(TIMER, GLib.FileTest.IS_EXECUTABLE)) {
            try {
                this._ownTimer = Gio.Subprocess.new([TIMER, String(MINUTES), 'Deep Focus'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                console.warn(`mk-shell-engine: deep focus timer: ${e.message}`);
            }
        }
        this._seenRunning = false;
        this._watchTimer();
        Main.panel._mkIsland?.show({icon: 'weather-clear-night-symbolic', text: 'Deep Focus on'});
    }

    // the session ending on its own ends Deep Focus too
    _watchTimer() {
        try {
            this._watch = Gio.File.new_for_path(TIMER_STATE).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._watch.connect('changed', () => {
                if (this._on && this._ownTimer && this._seenRunning && !this._companionRunning())
                    this._end(true);
                if (this._companionRunning())
                    this._seenRunning = true;
            });
        } catch {}
    }

    _end(sessionOver = false) {
        if (!this._on)
            return;
        this._on = false;
        this._toggle?.set({checked: false});
        this._watch?.cancel();
        this._watch = null;
        if (this._bannersWere !== undefined)
            this._notif.set_boolean('show-banners', this._bannersWere);
        this._bannersWere = undefined;
        this._wallpaper()?.setDeepFocus?.(false);
        this._getDock()?.setTucked?.(false);
        // our session ends with it (mk-timer stops cleanly on SIGTERM); one you started stays
        if (this._ownTimer && !sessionOver) {
            try {
                this._ownTimer.send_signal(15);
            } catch {}
        }
        this._ownTimer = null;
        Main.panel._mkIsland?.show({icon: 'weather-clear-night-symbolic', text: sessionOver ? 'Deep Focus done' : 'Deep Focus off'});
    }

    // (a small file, read only on a change while Deep Focus is on, or once as it begins)
    _companionRunning() {
        try {
            const [, bytes] = GLib.file_get_contents(TIMER_STATE);
            return Boolean(JSON.parse(new TextDecoder().decode(bytes)).running);
        } catch {
            return false;
        }
    }

    destroy() {
        if (this._on && Main.sessionMode.isLocked) {
            carried = {_on: true, _notif: this._notif, _bannersWere: this._bannersWere, _ownTimer: this._ownTimer,
                _seenRunning: this._seenRunning};
            this._watch?.cancel();
            this._watch = null;
        } else {
            this._end();
        }
        Main.wm.removeKeybinding('deep-focus');
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
        }
        this._indicator = this._toggle = null;
    }
}
