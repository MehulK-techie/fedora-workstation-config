import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { DockGlow } from './dockGlow.js';
import { Welcome } from './welcome.js';
import { TimerPill } from './timerPill.js';
import { SwitcherAnimation } from './switcher.js';
import { OsdStack } from './osdStack.js';
import { Accent } from './accent.js';
import { SystemMonitor } from './systemMonitor.js';
import { MediaTile } from './mediaTile.js';
import { FocusHelper } from './focus.js';

const USER_BRAND = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'brand.conf']);
const DEFAULT_BRAND = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'brand.conf']);

// The short tag from brand.conf (yours first, then the installed default).
function brandShort() {
    for (const path of [USER_BRAND, DEFAULT_BRAND]) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            const match = ok && new TextDecoder().decode(bytes).match(/^SHORT=(.*)$/m);
            if (match && match[1].trim())
                return match[1].trim();
        } catch (e) {
            // missing file: try the next one
        }
    }
    return 'MK';
}

export default class MKIndicatorExtension extends Extension {
    enable() {
        this._indicator = new St.Button({
            style_class: 'panel-button',
            can_focus: false,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'padding: 0 5px; margin: 0 2px; background: transparent; border: none; box-shadow: none;'
        });

        // Translucent aesthetic monogram
        this._label = new St.Label({
            text: brandShort(),
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 700; font-size: 10px; letter-spacing: 2px; color: rgba(255, 255, 255, 0.25);'
        });

        this._indicator.set_child(this._label);

        this._indicator.connect('notify::hover', () => {
            if (this._indicator.hover) {
                this._label.set_style('font-weight: 700; font-size: 10px; letter-spacing: 2px; color: rgba(255, 255, 255, 0.85); transition-duration: 200ms;');
            } else {
                this._label.set_style('font-weight: 700; font-size: 10px; letter-spacing: 2px; color: rgba(255, 255, 255, 0.25); transition-duration: 250ms;');
            }
        });

        Main.panel._rightBox.insert_child_at_index(this._indicator, 0);

        // `mk rename` and the Companion's menu rewrite this file: follow it live.
        this._brandMonitor = Gio.File.new_for_path(USER_BRAND)
            .monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._brandMonitor.connect('changed', () => this._label?.set_text(brandShort()));

        // The dock auto-hides on the desktop, but Dash to Dock always shows it
        // in the overview, on top of window titles. Fade it out there too.
        // Only its opacity changes while the overview animates: hiding or
        // showing the dock re-lays it out, and doing that mid-animation froze
        // a frame for ~300 ms. That happens once the animation is over.
        this._overviewIds = [
            Main.overview.connect('showing', () => {
                this._dockGlow?.resetMagnify();
                this._fadeDocks(0);
            }),
            Main.overview.connect('shown', () => this._docks().forEach(dock => dock.hide())),
            Main.overview.connect('hidden', () => {
                this._docks().forEach(dock => {
                    dock.opacity = 0;
                    dock.show();
                });
                this._fadeDocks(255);
            }),
        ];

        // Dock icons glow in their app's own colour and magnify on hover.
        // This extension stays loaded on the lock screen (metadata session-modes),
        // so unlocking doesn't rebuild everything: pause the dock parts while
        // locked and pick them up again after.
        // Accent first: the other parts read its colour.
        this._accent = new Accent();
        this._accent.enable(() => this._timerPill?.repaint());
        this._welcome = new Welcome();
        this._welcome.enable();
        this._timerPill = new TimerPill();
        this._timerPill.enable();
        this._switcher = new SwitcherAnimation();
        this._switcher.enable();
        this._osdStack = new OsdStack();
        this._osdStack.enable();
        this._sysMonitor = new SystemMonitor();
        this._sysMonitor.enable();
        this._media = new MediaTile();
        this._media.enable();
        this._focus = new FocusHelper();
        this._focus.enable();
        this._sessionId = Main.sessionMode.connect('updated', () => this._onSessionMode());
        this._onSessionMode();

        // Blur my Shell can blur the top bar before the wallpaper is loaded at
        // login and then shows no blur until the next unlock. Rebuild its panel
        // blur once, after the shell has finished starting up. Not on unlock:
        // a second rebuild there was a visible hitch.
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                // Greet the moment extensions have stopped loading (usually
                // right away); fix the top-bar blur only after the animation, so
                // nothing redraws underneath it.
                this._welcome?.whenSettled(() => {
                    this._welcome?.greet(false);
                    this._greetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3600, () => {
                        this._greetId = 0;
                        this._refreshBlur();
                        return GLib.SOURCE_REMOVE;
                    });
                });
            });
        }
    }

    _onSessionMode() {
        const locked = Main.sessionMode.isLocked;
        this._indicator.visible = !locked;
        this._timerPill?.setLocked(locked);
        this._sysMonitor?.setLocked(locked);
        this._media?.setLocked(locked);
        if (locked && this._dockGlow) {
            this._dockGlow.disable();
            this._dockGlow = null;
        } else if (!locked && !this._dockGlow) {
            this._dockGlow = new DockGlow();
            this._dockGlow.enable();
        }
    }

    _refreshBlur() {
        const blur = global.blur_my_shell;
        const panel = blur?._panel_blur;
        if (panel && blur._settings?.panel?.BLUR) {
            if (panel.enabled)
                panel.reset();
            else
                panel.enable();
        }
    }

    _docks() {
        return Main.uiGroup.get_children().filter(actor => actor.name === 'dashtodockContainer');
    }

    _fadeDocks(opacity) {
        for (const dock of this._docks()) {
            dock.remove_transition('opacity');
            dock.ease({opacity, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    disable() {
        if (this._sessionId) {
            Main.sessionMode.disconnect(this._sessionId);
            this._sessionId = 0;
        }
        this._dockGlow?.disable();
        this._dockGlow = null;
        this._welcome?.disable();
        this._welcome = null;
        this._timerPill?.disable();
        this._timerPill = null;
        this._switcher?.disable();
        this._switcher = null;
        this._osdStack?.disable();
        this._osdStack = null;
        this._sysMonitor?.disable();
        this._sysMonitor = null;
        this._media?.disable();
        this._media = null;
        this._focus?.disable();
        this._focus = null;
        this._accent?.disable();
        this._accent = null;
        this._brandMonitor?.cancel();
        this._brandMonitor = null;
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        if (this._greetId) {
            GLib.source_remove(this._greetId);
            this._greetId = 0;
        }
        this._overviewIds?.forEach(id => Main.overview.disconnect(id));
        this._overviewIds = null;
        for (const dock of Main.uiGroup.get_children()) {
            if (dock.name === 'dashtodockContainer') {
                dock.remove_transition('opacity');
                dock.opacity = 255;
                dock.show();
            }
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
            this._label = null;
        }
    }
}
