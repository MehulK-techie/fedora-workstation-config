// Welcome light: after you log in, a neon line races around the screen edges
// (like the OnePlus edge light) and a greeting fades in: "Welcome back home,
// sir." Optionally the same edge light flashes for notifications.
//
// Under the greeting: the date, your pinned tasks, the next reminder today and
// a low-battery hint; pinned tasks also get a notification with an Open button.
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
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
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
    EDGE_NOTIFY: 'off', COLOR_A: 'auto', COLOR_B: 'auto', TASKS: 'on', VARIETY: 'on', BIRTHDAY: '', BIRTHDAY_COUNTDOWN: 'on',
};
const COMPANION = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'companion.json']);
const GREETING_FILES = [GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'greetings.conf']),
    GLib.build_filenamev([CONFIG_DIR, 'greetings.conf'])];
const HISTORY = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'greet-history.json']);

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
const easeInOut = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

// What's waiting for you: pinned open tasks and the next reminder today.
export function agenda() {
    let data = {};
    try {
        const [ok, bytes] = GLib.file_get_contents(COMPANION);
        data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    } catch (e) {
        data = {};
    }
    const tasks = (data.tasks || []).filter(t => !t.done);
    const pinned = tasks.filter(t => t.pinned).map(t => t.text);
    const now = Date.now() / 1000, midnight = new Date().setHours(24, 0, 0, 0) / 1000;
    const upcoming = [...(data.tasks || []).filter(t => !t.done), ...(data.notes || [])]
        .filter(i => i.remind_at && i.remind_at > now && i.remind_at < midnight)
        .sort((x, y) => x.remind_at - y.remind_at);
    const next = upcoming[0];
    return {
        pinned,
        open: tasks.length,
        next: next ? {at: GLib.DateTime.new_from_unix_local(Math.round(next.remind_at)).format('%H:%M'),
            text: next.text || next.title || 'Reminder'} : null,
    };
}

function batteryHint() {
    for (const bat of ['BAT0', 'BAT1', 'BAT2']) {
        try {
            const [ok, cap] = GLib.file_get_contents(`/sys/class/power_supply/${bat}/capacity`);
            const [, st] = GLib.file_get_contents(`/sys/class/power_supply/${bat}/status`);
            const level = ok ? parseInt(new TextDecoder().decode(cap), 10) : NaN;
            if (level <= 25 && new TextDecoder().decode(st).trim() === 'Discharging')
                return `Battery at ${level}%: plug in soon`;
            return null;
        } catch (e) {
            // try the next name
        }
    }
    return null;
}

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
    play({greeting = null, subtitle = false, duration = 2600, extra = []} = {}) {
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
        // Two comets leave the bottom centre, run up the sides and meet at the
        // top, where they bloom; then the whole frame glows once and fades.
        const TRAVEL = 0.5;
        const paint = (cr, ox, oy) => {
            const travel = easeInOut(Math.min(1, progress / TRAVEL));
            const after = Math.max(0, (progress - TRAVEL) / (1 - TRAVEL));
            const half = W + H; // approx. length of each side's path
            const head = travel * half;
            if (after === 0 && head < 1)
                return;
            cr.translate(-ox, -oy);
            cr.setLineCap(Cairo.LineCap.ROUND);
            const stroke = (clockwise, width, alpha, dash, offset) => {
                const gradient = new Cairo.LinearGradient(0, H, W, 0);
                gradient.addColorStopRGBA(0, ...a, alpha);
                gradient.addColorStopRGBA(1, ...b, alpha);
                edgePath(cr, W, H, 5, 20, clockwise);
                cr.setSource(gradient);
                cr.setLineWidth(width);
                cr.setDash(dash, offset);
                cr.stroke();
            };
            for (const clockwise of [true, false]) {
                if (after === 0) {
                    // the tail fades in steps behind a bright head
                    const tail = Math.max(160, half * 0.32) * (0.6 + 0.4 * travel);
                    for (let k = 5; k >= 0; k--) {
                        const len = Math.min(head, tail * (k + 1) / 6);
                        const fade = 1 - k / 6;
                        for (const [width, layer] of [[24, 0.10], [10, 0.28], [3.5, 1]])
                            stroke(clockwise, width, layer * fade, [len, half * 2], -Math.max(0, head - len));
                    }
                    stroke(clockwise, 7, 0.9, [1, half * 2], -Math.max(0, head - 1));  // the head
                } else {
                    // the full frame breathes out
                    const glow = Math.sin(Math.min(1, after * 1.6) * Math.PI / 2) * (1 - after) ** 1.5;
                    for (const [width, layer] of [[28, 0.12], [12, 0.32], [3.5, 1]])
                        stroke(clockwise, width, layer * glow, [], 0);
                }
            }
            if (oy === 0 && progress > TRAVEL * 0.9 && after < 0.7) {
                // the bloom where the comets meet, at the top centre
                const k = Math.min(1, (progress - TRAVEL * 0.9) / (TRAVEL * 0.15)) * (1 - after / 0.7);
                const bloom = new Cairo.RadialGradient(W / 2, 5, 0, W / 2, 5, 220);
                bloom.addColorStopRGBA(0, 1, 1, 1, 0.9 * k);
                bloom.addColorStopRGBA(0.15, ...a, 0.5 * k);
                bloom.addColorStopRGBA(1, ...b, 0);
                cr.setSource(bloom);
                cr.rectangle(W / 2 - 240, 0, 480, T);
                cr.fill();
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
            this._showGreeting(greeting, subtitle, duration + 400 * extra.length, monitor, a, extra);
    }

    _showGreeting(text, subtitle, duration, monitor, [r, g, b], extra = []) {
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
        const lines = [];
        if (subtitle)
            lines.push(GLib.DateTime.new_now_local().format('%A, %e %B · %H:%M').replace(/\s+/g, ' '));
        for (const line of extra)
            lines.push(line);
        lines.forEach((line, i) => {
            const sub = new St.Label({
                text: line,
                style: i === 0 && subtitle
                    ? 'font-size: 16px; color: rgba(230,244,255,0.78); margin-top: 10px;'
                    : 'font-size: 15px; color: rgba(230,244,255,0.70); margin-top: 6px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            sub.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            box.add_child(sub);
        });
        Main.layoutManager.uiGroup.add_child(box);
        this._greeting = box;
        box.set_position(monitor.x, monitor.y + Math.round(monitor.height * 0.33));
        box.set_pivot_point(0.5, 0.5);
        box.set_scale(0.96, 0.96);
        box.ease({
            // in as the comets meet at the top: light and words land together
            opacity: 255, scale_x: 1, scale_y: 1, delay: Math.round(duration * 0.32), duration: 520,
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

// Lines from greetings.conf (MK's, then yours), by section.
function greetingPools() {
    const pools = {};
    for (const path of GREETING_FILES) {
        let section = 'any';
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                continue;
            for (const raw of new TextDecoder().decode(bytes).split('\n')) {
                const line = raw.trim();
                const head = line.match(/^\[(\w+)\]$/);
                if (head)
                    section = head[1].toLowerCase();
                else if (line && !line.startsWith('#'))
                    (pools[section] ??= []).push(line);
            }
        } catch (e) {
            // a missing file adds nothing
        }
    }
    return pools;
}

function readJson(path, fallback) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? JSON.parse(new TextDecoder().decode(bytes)) : fallback;
    } catch (e) {
        return fallback;
    }
}

// BIRTHDAY= is MM-DD or YYYY-MM-DD (the year is ignored). Returns [month, day].
export function birthdayOf(conf) {
    const m = (conf.BIRTHDAY || '').trim().match(/^(?:\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

// "3 months and 12 days until your birthday", or null on the day itself or
// without a birthday. A 29 February birthday counts as 28 February in
// other years.
export function birthdayCountdown(conf, now = GLib.DateTime.new_now_local()) {
    const bd = birthdayOf(conf);
    if (!bd)
        return null;
    const today = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);
    const on = year => {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const day = bd[0] === 2 && bd[1] === 29 && !leap ? 28 : bd[1];
        return GLib.DateTime.new_local(year, bd[0], day, 0, 0, 0);
    };
    let next = on(today.get_year());
    if (next.compare(today) < 0)
        next = on(today.get_year() + 1);
    if (next.compare(today) === 0)
        return null;
    let months = 0;
    while (today.add_months(months + 1).compare(next) <= 0)
        months++;
    const days = Math.round(next.difference(today.add_months(months)) / GLib.TIME_SPAN_DAY);
    const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [months && unit(months, 'month'), days && unit(days, 'day')].filter(Boolean);
    return `${parts.join(' and ')} until your birthday`;
}

// The first login after starting the computer on a new day gets an
// energetic greeting; later starts that day get a "welcome back".
function bootId() {
    try {
        const [, bytes] = GLib.file_get_contents('/proc/sys/kernel/random/boot_id');
        return new TextDecoder().decode(bytes).trim();
    } catch (e) {
        return '';
    }
}

// A greeting for right now: the time of day, the day of the week, an
// occasion (your BIRTHDAY=MM-DD, New Year), coming back the same day, or
// after a few days away; never one of the last few. VARIETY=off always
// gives your GREETING= line.
export function pickGreeting(conf = welcomeConf()) {
    if (conf.VARIETY === 'off')
        return greetingText(conf);
    const pools = greetingPools();
    const history = readJson(HISTORY, {lines: []});
    const boot = bootId();
    const now = GLib.DateTime.new_now_local();
    const today = now.format('%F'), md = now.format('%m-%d');
    const hour = now.get_hour(), weekday = now.get_day_of_week();  // 1 = Monday
    const away = history.last ? (now.to_unix() - history.last) / 86400 : 0;
    const timeOfDay = hour < 5 || hour >= 22 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const dayPool = weekday === 1 ? 'monday' : weekday === 5 ? 'friday' : weekday >= 6 ? 'weekend' : null;
    const bd = birthdayOf(conf);
    const newBoot = Boolean(boot) && boot !== history.boot;
    let pool;
    if (bd && md === `${String(bd[0]).padStart(2, '0')}-${String(bd[1]).padStart(2, '0')}`)
        pool = pools.birthday;
    else if (md === '01-01')
        pool = pools.newyear;
    else if (away >= 3)
        pool = pools.long;
    else if (newBoot && history.day !== today)
        pool = pools.firstlogin;
    else if (newBoot || (history.day === today && Math.random() < 0.35))
        pool = pools.return;
    if (!pool?.length) {
        const roll = Math.random();
        pool = roll < 0.5 ? pools[timeOfDay] : roll < 0.7 && dayPool ? pools[dayPool] : null;
        if (!pool?.length)
            pool = [...(pools.any ?? []), conf.GREETING];
    }
    const fill = lines => [...new Set(lines.map(line => greetingText({...conf, GREETING: line})))];
    const fresh = lines => fill(lines).filter(line => !history.lines.includes(line));
    // A small pool that has run out falls back to everything for this time of day.
    const wide = [...(pools[timeOfDay] ?? []), ...(dayPool ? pools[dayPool] ?? [] : []), ...(pools.any ?? []), conf.GREETING];
    let choices = fresh(pool);
    if (!choices.length)
        choices = fresh(wide);
    if (!choices.length)
        choices = fill(wide);
    const line = choices[Math.floor(Math.random() * choices.length)] || greetingText(conf);
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(HISTORY), 0o755);
        GLib.file_set_contents(HISTORY, JSON.stringify({
            last: now.to_unix(), day: today, boot, lines: [line, ...history.lines].slice(0, 6),
        }));
    } catch (e) {
        // history is a nicety
    }
    return line;
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
        // The title choices fold into one row, so the menu stays short and
        // "Edit greeting…" is never pushed off the screen.
        this._titleMenu = new PopupMenu.PopupSubMenuMenuItem('Call me', true);
        this._titleMenu.icon.icon_name = 'avatar-default-symbolic';
        this.menu.addMenuItem(this._titleMenu);
        this._titleItems = TITLES.map(([key, label]) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                writeUserKey('TITLE', key);
                this._sync();
                this._titleMenu.setSubmenuShown(false);
                run(['nice', `${BIN}/mk-voice`, 'prepare']);
            });
            this._titleMenu.menu.addMenuItem(item);
            return [key, item];
        });
        this._voice = new PopupMenu.PopupSwitchMenuItem('Speak the greeting', welcomeConf().VOICE === 'on');
        this._voice.connect('toggled', (_i, state) => {
            writeUserKey('VOICE', state ? 'on' : 'off');
            if (state)
                run(['nice', `${BIN}/mk-voice`, 'prepare']);
        });
        this.menu.addMenuItem(this._voice);
        this._variety = new PopupMenu.PopupSwitchMenuItem('A different greeting each time', welcomeConf().VARIETY !== 'off');
        this._variety.connect('toggled', (_i, state) => writeUserKey('VARIETY', state ? 'on' : 'off'));
        this.menu.addMenuItem(this._variety);
        this.menu.addAction('Play it now', () => onPreview());
        this.menu.addAction('Edit greeting…', () => run([`${BIN}/mk-companion`, 'welcome']));
        this.menu.connect('open-state-changed', (_m, open) => open && this._sync());
        this._sync();
    }

    _sync() {
        const conf = welcomeConf();
        const current = (conf.TITLE || 'sir').toLowerCase().replace("ma'am", 'maam');
        for (const [key, item] of this._titleItems) {
            item.setOrnament(key === current ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            if (key === current)
                this._titleMenu.label.text = `Call me: ${item.label.text}`;
        }
        this._voice.setToggleState(conf.VOICE === 'on');
        this._variety.setToggleState(conf.VARIETY !== 'off');
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
    whenSettled(callback, {quietMs = 150, maxMs = 3000} = {}) {
        const pending = [ExtensionState.INITIALIZED, ExtensionState.ACTIVATING, ExtensionState.DOWNLOADING];
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const started = GLib.get_monotonic_time();
        let lastChange = started;
        // Apps starting at login keep the processor busy for a moment; light
        // drawn then would stutter. Wait for a calm reading (or give up at maxMs).
        let lastCpu = null;
        const cpuQuiet = () => {
            try {
                const [, bytes] = GLib.file_get_contents('/proc/stat');
                const f = new TextDecoder().decode(bytes).match(/^cpu\s+(.*)$/m)[1].split(/\s+/).map(Number);
                const total = f.slice(0, 8).reduce((x, y) => x + y, 0), idle = f[3] + f[4];
                const prev = lastCpu;
                lastCpu = {total, idle};
                return prev ? 1 - (idle - prev.idle) / Math.max(1, total - prev.total) < 0.6 : false;
            } catch (e) {
                return true;
            }
        };
        this._stateId = Main.extensionManager.connect('extension-state-changed', () => {
            lastChange = GLib.get_monotonic_time();
        });
        this._loginId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            const now = GLib.get_monotonic_time();
            const busy = shell.get_strv('enabled-extensions').some(uuid => {
                const ext = Main.extensionManager.lookup(uuid);
                return ext && pending.includes(ext.state);
            });
            const settled = !busy && (now - lastChange) / 1000 >= quietMs && cpuQuiet();
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
        const firstToday = readJson(HISTORY, {}).day !== GLib.DateTime.new_now_local().format('%F');
        const greeting = pickGreeting(conf);
        const extra = [];
        const todo = conf.TASKS !== 'off' ? agenda() : {pinned: [], next: null};
        if (todo.pinned.length) {
            const shown = todo.pinned.slice(0, 2).join(' · ');
            extra.push(`📌 ${shown}${todo.pinned.length > 2 ? `  +${todo.pinned.length - 2} more` : ''}`);
        }
        if (todo.next)
            extra.push(`⏰ ${todo.next.at}  ${todo.next.text}`);
        // The birthday countdown: at the first greeting of the day (and in
        // "Play it now").
        const countdown = conf.BIRTHDAY_COUNTDOWN !== 'off' ? birthdayCountdown(conf) : null;
        if (countdown && (force || firstToday))
            extra.push(`🎂 ${countdown}`);
        const battery = batteryHint();
        if (battery)
            extra.push(`🔋 ${battery}`);
        const duration = 3600;
        this._light.play({greeting, subtitle: conf.SUBTITLE !== 'off', duration, extra});
        if (conf.VOICE === 'on') {
            // spoken as the words appear, not before
            this._voiceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(duration * 0.28), () => {
                this._voiceId = 0;
                run([`${BIN}/mk-voice`, 'say', greeting]);
                return GLib.SOURCE_REMOVE;
            });
        }
        if (conf.VOICE === 'on') {
            // Render the other greetings in the background for next time.
            this._prepareId = GLib.timeout_add(GLib.PRIORITY_LOW, duration + 4000, () => {
                this._prepareId = 0;
                run(['nice', `${BIN}/mk-voice`, 'prepare']);
                return GLib.SOURCE_REMOVE;
            });
        }
        if (todo.pinned.length && !force) {
            this._remindId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration + 1200, () => {
                this._remindId = 0;
                this._remindPinned(todo.pinned);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // After the welcome: your pinned tasks, one click from the Companion.
    _remindPinned(pinned) {
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: pinned.length === 1 ? 'Pinned task' : `${pinned.length} pinned tasks`,
            body: pinned.slice(0, 5).map(t => `• ${t}`).join('\n'),
            gicon: new Gio.ThemedIcon({name: 'view-pin-symbolic'}),
        });
        notification.addAction('Open', () => run([`${BIN}/mk-companion`, 'tasks']));
        source.addNotification(notification);
    }

    _onNotification() {
        const conf = welcomeConf();
        const banners = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        if (conf.EDGE_NOTIFY === 'on' && banners.get_boolean('show-banners') && !Main.sessionMode.isLocked)
            this._light.play({duration: 1400});
    }

    disable() {
        for (const id of ['_voiceId', '_remindId', '_prepareId']) {
            if (this[id])
                GLib.source_remove(this[id]);
            this[id] = 0;
        }
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
