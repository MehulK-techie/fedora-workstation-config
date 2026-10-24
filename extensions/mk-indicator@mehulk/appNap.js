// App Nap: under memory or processor pressure, pause apps you haven't used for
// a while, and wake them the moment you go back to them.
//
// Pausing freezes the app's systemd scope (cgroup freezer, the same as
// `systemctl --user freeze`): it gets no CPU, and the kernel can move its
// memory to zram swap. Nothing is lost: focusing any of its windows, or
// clicking it in the dock, thaws it before you see a stale frame.
//
// Only paused when ALL hold: pressure (memory > MEM_THRESHOLD %, or CPU >
// CPU_THRESHOLD % for a minute), unused for IDLE_MINUTES, every window
// minimized or on another desktop, not playing sound, not in NEVER.
// config/appnap.conf; `mk nap` lists what's napping (state in
// ~/.cache/mk-workstation/app-nap.json, also used to thaw after a shell restart).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';

const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'appnap.conf']);
const DEFAULT_CONF = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'appnap.conf']);
const STATE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mk-workstation', 'app-nap.json']);
const CHECK_S = 10;

function readConf() {
    const out = {APP_NAP: 'on', MEM_THRESHOLD: '85', CPU_THRESHOLD: '90', IDLE_MINUTES: '5', NEVER: ''};
    for (const path of [DEFAULT_CONF, USER_CONF]) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                continue;
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
                const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
                if (m)
                    out[m[1]] = m[2];
            }
        } catch (e) {
            // defaults
        }
    }
    return out;
}

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch (e) {
        return '';
    }
}

// The app's own systemd scope, or null. GNOME starts each app in a scope named
// after it (app-gnome-<id>-<pid>.scope, app-flatpak-<id>-<pid>.scope). An app
// started from a terminal or an editor lives in *that* app's scope instead,
// and freezing it would freeze the terminal too: such apps are left alone.
function scopeOf(app) {
    const id = app.get_id().replace(/\.desktop$/, '');
    const units = new Set();
    for (const pid of app.get_pids()) {
        const m = readFile(`/proc/${pid}/cgroup`).match(/\/app\.slice\/(app-[^/\n]+\.scope)/);
        if (!m)
            return null;
        units.add(m[1]);
    }
    if (units.size !== 1)
        return null;
    const unit = [...units][0];
    const named = unit.replace(/\\x2d/g, '-');
    return named.startsWith(`app-gnome-${id}-`) || named.startsWith(`app-flatpak-${id}-`) ||
        named.startsWith(`app-${id}-`) ? unit : null;
}

export class AppNap {
    enable() {
        this._conf = readConf();
        this._lastUsed = new Map();   // app id -> monotonic µs
        this._frozen = new Map();     // app id -> scope unit
        this._busySince = 0;
        this._cpu = null;
        this._bus = Gio.DBus.session;
        this._tracker = Shell.WindowTracker.get_default();
        this._thawLeftovers();
        if (this._conf.APP_NAP === 'off')
            return;
        const now = GLib.get_monotonic_time();
        for (const app of Shell.AppSystem.get_default().get_running())
            this._lastUsed.set(app.get_id(), now);
        // Wake on focus: a window of a napping app gets focus (click, Alt+Tab,
        // dock), or the app is activated.
        this._focusId = global.display.connect('notify::focus-window', () => this._onFocus());
        this._appStateId = Shell.AppSystem.get_default().connect('app-state-changed', (_s, app) => {
            if (app.state === Shell.AppState.RUNNING)
                this._lastUsed.set(app.get_id(), GLib.get_monotonic_time());
            else
                this._frozen.delete(app.get_id());
        });
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, CHECK_S, () => {
            this._check();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onFocus() {
        const app = this._tracker.focus_app;
        if (!app)
            return;
        this._lastUsed.set(app.get_id(), GLib.get_monotonic_time());
        if (this._frozen.has(app.get_id()))
            this._thaw(app.get_id());
    }

    _pressure() {
        const mem = readFile('/proc/meminfo');
        const total = Number(mem.match(/MemTotal:\s+(\d+)/)?.[1] ?? 0);
        const avail = Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0);
        const memUsed = total ? 100 * (1 - avail / total) : 0;
        const f = readFile('/proc/stat').match(/^cpu\s+(.*)$/m)?.[1].split(/\s+/).map(Number) ?? [];
        const all = f.slice(0, 8).reduce((a, b) => a + b, 0), idle = (f[3] ?? 0) + (f[4] ?? 0);
        let cpuBusy = 0;
        if (this._cpu)
            cpuBusy = 100 * (1 - (idle - this._cpu.idle) / Math.max(1, all - this._cpu.all));
        this._cpu = {all, idle};
        const now = GLib.get_monotonic_time();
        if (cpuBusy > Number(this._conf.CPU_THRESHOLD))
            this._busySince ||= now;
        else
            this._busySince = 0;
        const cpuSustained = this._busySince && now - this._busySince >= 60e6;
        return memUsed > Number(this._conf.MEM_THRESHOLD) || cpuSustained;
    }

    _audible() {
        const names = [];
        try {
            for (const stream of getMixerControl().get_sink_inputs()) {
                if (!stream.is_event_stream)
                    names.push(`${stream.get_application_id() ?? ''} ${stream.get_name() ?? ''}`.toLowerCase());
            }
        } catch (e) {
            // no mixer: treat nothing as audible
        }
        return names;
    }

    _check() {
        if (!this._pressure())
            return;
        const never = this._conf.NEVER.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const idleUs = Number(this._conf.IDLE_MINUTES) * 60e6;
        const now = GLib.get_monotonic_time();
        const audible = this._audible();
        const workspace = global.workspace_manager.get_active_workspace();
        for (const app of Shell.AppSystem.get_default().get_running()) {
            const id = app.get_id();
            const lower = `${id} ${app.get_name()}`.toLowerCase();
            if (this._frozen.has(id) || app === this._tracker.focus_app)
                continue;
            if (never.some(n => lower.includes(n)))
                continue;
            if (now - (this._lastUsed.get(id) ?? now) < idleUs)
                continue;
            const windows = app.get_windows();
            if (!windows.length || windows.some(w => !w.minimized && w.located_on_workspace(workspace)))
                continue;
            const short = id.replace(/\.desktop$/, '').toLowerCase();
            const word = app.get_name().toLowerCase();
            if (audible.some(a => a.includes(short) || a.includes(word)))
                continue;
            const unit = scopeOf(app);
            if (unit)
                this._freeze(id, unit);
        }
    }

    _manager(method, unit, done) {
        this._bus.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
            method, new GLib.Variant('(s)', [unit]), null, Gio.DBusCallFlags.NONE, 2000, null, (c, res) => {
                try {
                    c.call_finish(res);
                    done?.(true);
                } catch (e) {
                    console.warn(`mk-indicator: App Nap ${method} ${unit}: ${e.message}`);
                    done?.(false);
                }
            });
    }

    _freeze(id, unit) {
        this._frozen.set(id, unit);
        this._manager('FreezeUnit', unit, ok => {
            if (!ok)
                this._frozen.delete(id);
            this._save();
        });
    }

    _thaw(id) {
        const unit = this._frozen.get(id);
        this._frozen.delete(id);
        this._manager('ThawUnit', unit, () => this._save());
    }

    _save() {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(STATE), 0o755);
            GLib.file_set_contents(STATE, JSON.stringify(Object.fromEntries(this._frozen)));
        } catch (e) {
            // state is only for mk nap and crash recovery
        }
    }

    // After a shell restart or an update, nothing must stay frozen.
    _thawLeftovers() {
        try {
            for (const unit of Object.values(JSON.parse(readFile(STATE) || '{}')))
                this._manager('ThawUnit', unit);
        } catch (e) {
            // a broken state file: nothing to thaw
        }
        GLib.file_set_contents(STATE, '{}');
    }

    disable() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        if (this._focusId)
            global.display.disconnect(this._focusId);
        if (this._appStateId)
            Shell.AppSystem.get_default().disconnect(this._appStateId);
        this._focusId = this._appStateId = 0;
        for (const id of [...(this._frozen?.keys() ?? [])])
            this._thaw(id);
    }
}
