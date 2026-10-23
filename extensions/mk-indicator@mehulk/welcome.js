// Welcome light: after you log in, a neon line races around the screen edges
// (like the OnePlus edge light) and a greeting fades in: "Welcome back home,
// sir." Optionally the same edge light flashes for notifications.
//
// Settings: config/welcome.conf, yours in ~/.config/mk-workstation/welcome.conf
// (also the "Welcome light" switch in Quick Settings and `mk welcome`).
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import { accentPairUnit } from './accent.js';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation']);
const USER_CONF = GLib.build_filenamev([CONFIG_DIR, 'welcome.conf']);
const DEFAULT_CONF = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'welcome.conf']);
const TEST_FILE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'welcome-test']);
const DEFAULTS = {
    WELCOME: 'on', GREETING: 'Welcome back home, {title}.', TITLE: 'sir', SUBTITLE: 'on', VOICE: 'off',
    EDGE_NOTIFY: 'off', COLOR_A: 'auto', COLOR_B: 'auto',
};

function readConf(path) {
    const conf = {};
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (ok) {
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
                const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
                if (m)
                    conf[m[1]] = m[2];
            }
        }
    } catch (e) {
        // missing file: defaults apply
    }
    return conf;
}

export function welcomeConf() {
    return {...DEFAULTS, ...readConf(DEFAULT_CONF), ...readConf(USER_CONF)};
}

function writeUserKey(key, value) {
    const conf = readConf(USER_CONF);
    conf[key] = value;
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
    const text = '# Your welcome light settings (Quick Settings switch, mk welcome)\n' +
        Object.entries(conf).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    GLib.file_set_contents(USER_CONF, text);
}

function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return Number.isNaN(n) ? [0, 0.78, 1] : [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// The line's two gradient colours: the wallpaper accent and its neighbour on
// the colour wheel when set to auto, otherwise the colours you chose.
function accentPair(conf) {
    const [a, b] = accentPairUnit();
    return [conf.COLOR_A === 'auto' ? a : hexToRgb(conf.COLOR_A),
        conf.COLOR_B === 'auto' ? b : hexToRgb(conf.COLOR_B)];
}

const ease = t => 1 - (1 - t) ** 3;

// Path around the screen edge, starting at the bottom centre and going one way.
function edgePath(cr, w, h, inset, r, clockwise) {
    const l = inset, t = inset, ri = w - inset, b = h - inset;
    cr.newPath();
    cr.moveTo(w / 2, b);
    if (clockwise) {
        cr.lineTo(l + r, b);
        cr.arc(l + r, b - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(l, t + r);
        cr.arc(l + r, t + r, r, Math.PI, 1.5 * Math.PI);
        cr.lineTo(w / 2, t);
    } else {
        cr.lineTo(ri - r, b);
        cr.arcNegative(ri - r, b - r, r, Math.PI / 2, 0);
        cr.lineTo(ri, t + r);
        cr.arcNegative(ri - r, t + r, r, 0, -Math.PI / 2);
        cr.lineTo(w / 2, t);
    }
}

export class EdgeLight {
    // full: run both lines from the bottom to the top, then glow and fade.
    play({greeting = null, subtitle = false, duration = 2600} = {}) {
        this.stop();
        const conf = welcomeConf();
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const [a, b] = accentPair(conf);
        // Four thin strips along the edges instead of one full-screen canvas:
        // about an eighth of the pixels to repaint each frame, which matters
        // right after login while everything else is starting too.
        const W = monitor.width, H = monitor.height, T = 40;
        const strips = [[0, 0, W, T], [0, H - T, W, T], [0, T, T, H - 2 * T], [W - T, T, T, H - 2 * T]];
        let progress = 0;
        const paint = (cr, ox, oy) => {
            const travel = ease(Math.min(1, progress / 0.55));
            const glowPhase = Math.max(0, (progress - 0.55) / 0.45);
            const alpha = glowPhase > 0 ? Math.max(0, 1 - glowPhase) : 1;
            const half = W + H; // approx. length of each side's path
            const segment = Math.max(120, half * 0.28);
            const head = travel * half;
            if (glowPhase === 0 && head < 1)
                return;
            cr.translate(-ox, -oy);
            cr.setLineCap(Cairo.LineCap.ROUND);
            for (const clockwise of [true, false]) {
                for (const [width, layerAlpha] of [[26, 0.12], [12, 0.30], [4, 1]]) {
                    const gradient = new Cairo.LinearGradient(0, H, W, 0);
                    gradient.addColorStopRGBA(0, ...a, alpha * layerAlpha);
                    gradient.addColorStopRGBA(1, ...b, alpha * layerAlpha);
                    edgePath(cr, W, H, 5, 20, clockwise);
                    cr.setSource(gradient);
                    cr.setLineWidth(width);
                    if (glowPhase > 0)
                        cr.setDash([], 0);
                    else
                        cr.setDash([Math.min(segment, head), half * 2], -Math.max(0, head - segment));
                    cr.stroke();
                }
            }
        };
        this._areas = strips.map(([x, y, w, h]) => {
            const strip = new St.DrawingArea({reactive: false, x: monitor.x + x, y: monitor.y + y, width: w, height: h});
            strip.connect('repaint', actor => {
                const cr = actor.get_context();
                paint(cr, x, y);
                cr.$dispose();
            });
            Main.layoutManager.uiGroup.add_child(strip);
            return strip;
        });
        const area = this._areas[0];
        const timeline = new Clutter.Timeline({actor: area, duration});
        timeline.connect('new-frame', () => {
            progress = timeline.get_progress();
            this._areas?.forEach(strip => strip.queue_repaint());
        });
        timeline.connect('completed', () => this.stop());
        this._timeline = timeline;
        timeline.start();

        if (greeting)
            this._showGreeting(greeting, subtitle, duration, monitor, a);
    }

    _showGreeting(text, subtitle, duration, monitor, [r, g, b]) {
        const glow = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},0.85)`;
        // Full monitor width with centred text, so nothing gets ellipsized.
        const box = new St.BoxLayout({
            vertical: true, reactive: false, opacity: 0, width: monitor.width,
        });
        const title = new St.Label({
            text,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 42px; font-weight: 300; color: #f4faff;' +
                `text-shadow: 0 0 22px ${glow};`,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        box.add_child(title);
        if (subtitle) {
            const now = GLib.DateTime.new_now_local();
            const sub = new St.Label({
                text: now.format('%A, %e %B · %H:%M').replace(/\s+/g, ' '),
                style: 'font-size: 16px; color: rgba(230,244,255,0.75); margin-top: 10px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            sub.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            box.add_child(sub);
        }
        Main.layoutManager.uiGroup.add_child(box);
        this._greeting = box;
        box.set_position(monitor.x, monitor.y + Math.round(monitor.height * 0.33));
        box.set_pivot_point(0.5, 0.5);
        box.set_scale(0.96, 0.96);
        box.ease({
            opacity: 255, scale_x: 1, scale_y: 1, delay: 120, duration: 450,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => box.ease({
                opacity: 0, delay: Math.max(600, duration - 1300), duration: 700,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => this._dropGreeting(),
            }),
        });
    }

    _dropGreeting() {
        this._greeting?.destroy();
        this._greeting = null;
    }

    stop() {
        this._timeline?.stop();
        this._timeline = null;
        this._areas?.forEach(strip => strip.destroy());
        this._areas = null;
    }

    destroy() {
        this.stop();
        this._dropGreeting();
    }
}

const BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin']);
const TITLES = [['sir', 'Sir'], ['maam', "Ma'am"], ['name', 'Your first name'], ['none', 'No title']];

function run(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.warn(`mk-indicator: ${argv[0]}: ${e.message}`);
    }
}

// Same rules as lib/mkworkstation/welcome.py.
export function greetingText(conf = welcomeConf()) {
    const key = (conf.TITLE || 'sir').toLowerCase();
    let title = {sir: 'sir', maam: "ma'am", "ma'am": "ma'am", none: ''}[key];
    const first = GLib.get_real_name().split(' ')[0] || GLib.get_user_name();
    if (key === 'name')
        title = first;
    else if (title === undefined)
        title = conf.TITLE;
    let text = conf.GREETING;
    if (!title)
        text = text.replace(', {title}', '').replace(' {title}', '').replace('{title}', '');
    return text.replaceAll('{title}', title).replaceAll('{name}', first).trim();
}

// Quick Settings: click to switch the welcome on or off; the arrow opens
// choices for how you're addressed, the voice, a preview and editing.
const WelcomeToggle = GObject.registerClass(
class WelcomeToggle extends QuickSettings.QuickMenuToggle {
    _init(onPreview) {
        super._init({title: 'Welcome light', iconName: 'starred-symbolic', toggleMode: true});
        this.checked = welcomeConf().WELCOME !== 'off';
        this.connect('notify::checked', () => writeUserKey('WELCOME', this.checked ? 'on' : 'off'));
        this.menu.setHeader('starred-symbolic', 'Welcome light', greetingText());
        this._titleItems = TITLES.map(([key, label]) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                writeUserKey('TITLE', key);
                this._sync();
                run([`${BIN}/mk-voice`, 'render']);
            });
            this.menu.addMenuItem(item);
            return [key, item];
        });
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._voice = new PopupMenu.PopupSwitchMenuItem('Speak the greeting', welcomeConf().VOICE === 'on');
        this._voice.connect('toggled', (_i, state) => {
            writeUserKey('VOICE', state ? 'on' : 'off');
            if (state)
                run([`${BIN}/mk-voice`, 'render']);
        });
        this.menu.addMenuItem(this._voice);
        this.menu.addAction('Play it now', () => onPreview());
        this.menu.addAction('Edit greeting…', () => run([`${BIN}/mk-companion`, 'welcome']));
        this.menu.connect('open-state-changed', (_m, open) => open && this._sync());
        this._sync();
    }

    _sync() {
        const conf = welcomeConf();
        const current = (conf.TITLE || 'sir').toLowerCase().replace("ma'am", 'maam');
        for (const [key, item] of this._titleItems)
            item.setOrnament(key === current ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this._voice.setToggleState(conf.VOICE === 'on');
        this.menu.setHeader('starred-symbolic', 'Welcome light', greetingText(conf));
        this.subtitle = this.checked ? greetingText(conf) : null;
    }
});

export class Welcome {
    enable() {
        this._light = new EdgeLight();
        this._indicator = new QuickSettings.SystemIndicator();
        this._toggle = new WelcomeToggle(() => this.greet(true));
        this._indicator.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        // `mk welcome test` touches this file to replay the welcome.
        GLib.mkdir_with_parents(GLib.path_get_dirname(TEST_FILE), 0o755);
        this._testMonitor = Gio.File.new_for_path(TEST_FILE).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._testMonitor.connect('changed', (_m, _f, _o, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event === Gio.FileMonitorEvent.CREATED)
                this.greet(true);
        });

        this._trayIds = [];
        this._sourceIds = new Map();
        const watch = source => {
            if (!this._sourceIds.has(source))
                this._sourceIds.set(source, source.connect('notification-added', () => this._onNotification()));
        };
        Main.messageTray.getSources().forEach(watch);
        this._trayIds.push(Main.messageTray.connect('source-added', (_t, source) => watch(source)));
        this._trayIds.push(Main.messageTray.connect('source-removed', (_t, source) => {
            const id = this._sourceIds.get(source);
            if (id)
                source.disconnect(id);
            this._sourceIds.delete(source);
        }));

    }

    // At login: wait until every enabled extension has finished loading and
    // nothing has changed for a moment, so the welcome plays on a settled,
    // fully drawn desktop instead of competing with extensions starting up.
    whenSettled(callback, {quietMs = 150, maxMs = 2500} = {}) {
        const pending = [ExtensionState.INITIALIZED, ExtensionState.ACTIVATING, ExtensionState.DOWNLOADING];
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const started = GLib.get_monotonic_time();
        let lastChange = started;
        this._stateId = Main.extensionManager.connect('extension-state-changed', () => {
            lastChange = GLib.get_monotonic_time();
        });
        this._loginId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            const now = GLib.get_monotonic_time();
            const busy = shell.get_strv('enabled-extensions').some(uuid => {
                const ext = Main.extensionManager.lookup(uuid);
                return ext && pending.includes(ext.state);
            });
            const settled = !busy && (now - lastChange) / 1000 >= quietMs;
            if (!settled && (now - started) / 1000 < maxMs)
                return GLib.SOURCE_CONTINUE;
            this._loginId = 0;
            Main.extensionManager.disconnect(this._stateId);
            this._stateId = 0;
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    greet(force) {
        const conf = welcomeConf();
        if (!force && conf.WELCOME === 'off')
            return;
        const greeting = greetingText(conf);
        this._light.play({greeting, subtitle: conf.SUBTITLE !== 'off', duration: 3400});
        if (conf.VOICE === 'on')
            run([`${BIN}/mk-voice`, 'say']);
    }

    _onNotification() {
        const conf = welcomeConf();
        const banners = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        if (conf.EDGE_NOTIFY === 'on' && banners.get_boolean('show-banners') && !Main.sessionMode.isLocked)
            this._light.play({duration: 1400});
    }

    disable() {
        if (this._loginId) {
            GLib.source_remove(this._loginId);
            this._loginId = 0;
        }
        if (this._stateId) {
            Main.extensionManager.disconnect(this._stateId);
            this._stateId = 0;
        }
        this._testMonitor?.cancel();
        this._testMonitor = null;
        this._trayIds?.forEach(id => Main.messageTray.disconnect(id));
        this._trayIds = null;
        for (const [source, id] of this._sourceIds ?? [])
            source.disconnect(id);
        this._sourceIds = null;
        this._toggle?.destroy();
        this._toggle = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._light?.destroy();
        this._light = null;
    }
}
