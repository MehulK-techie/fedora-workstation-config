// A quiet system monitor for the top bar: a CPU sparkline and the numbers you
// choose, and a menu with the full picture. It reads the kernel's own counters
// (/proc and /sys) every 2 seconds, the same figures GNOME System Monitor and
// `top` use, and stops while the screen is locked.
//
// config/monitor.conf, yours in ~/.config/mk-workstation/monitor.conf:
//   PANEL=cpu,temp     what the top bar shows: cpu, mem, temp, net, power
//   INTERVAL=2         seconds between readings
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { accentRGB } from './accent.js';
import { InternetSection } from './network.js';

const USER_CONF = GLib.build_filenamev([GLib.get_user_config_dir(), 'mk-workstation', 'monitor.conf']);
const DEFAULT_CONF = GLib.build_filenamev([GLib.get_user_data_dir(), 'mk-workstation', 'config', 'monitor.conf']);
const HISTORY = 30;
const decoder = new TextDecoder();

function read(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes) : null;
    } catch (e) {
        return null;
    }
}
const readInt = path => {
    const text = read(path);
    return text === null ? null : parseInt(text, 10);
};

function conf() {
    const out = {PANEL: 'cpu,temp', INTERVAL: '2'};
    for (const path of [DEFAULT_CONF, USER_CONF]) {
        for (const line of (read(path) || '').split('\n')) {
            const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
            if (m)
                out[m[1]] = m[2];
        }
    }
    return out;
}

const fmtBytes = b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${(b / 1e3).toFixed(0)} kB`;
const fmtRate = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} kB/s` : `${b.toFixed(0)} B/s`;
const fmtTime = h => !isFinite(h) || h <= 0 ? '' : h >= 1 ? `${Math.floor(h)} h ${Math.round(h % 1 * 60)} min` : `${Math.round(h * 60)} min`;

// Find the sensors once: CPU (AMD k10temp/zenpower, Intel coretemp, ACPI as a
// last resort), GPU and SSD, the battery and the GPU load counter.
function findSensors() {
    const sensors = {};
    const hw = Gio.File.new_for_path('/sys/class/hwmon');
    let names = [];
    try {
        const en = hw.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)))
            names.push(info.get_name());
    } catch (e) {
        names = [];
    }
    const byName = {};
    for (const dir of names) {
        const base = `/sys/class/hwmon/${dir}`;
        byName[(read(`${base}/name`) || '').trim()] = base;
    }
    const cpu = byName.k10temp || byName.zenpower || byName.coretemp || byName.cpu_thermal || byName.acpitz;
    if (cpu)
        sensors.cpuTemp = `${cpu}/temp1_input`;
    if (byName.amdgpu)
        sensors.gpuTemp = `${byName.amdgpu}/temp1_input`;
    if (byName.nvme)
        sensors.ssdTemp = `${byName.nvme}/temp1_input`;
    for (const card of ['card0', 'card1', 'card2']) {
        if (readInt(`/sys/class/drm/${card}/device/gpu_busy_percent`) !== null) {
            sensors.gpuBusy = `/sys/class/drm/${card}/device/gpu_busy_percent`;
            break;
        }
    }
    for (const bat of ['BAT0', 'BAT1', 'BAT2', 'CMB0']) {
        if (read(`/sys/class/power_supply/${bat}/capacity`) !== null) {
            sensors.battery = `/sys/class/power_supply/${bat}`;
            break;
        }
    }
    return sensors;
}

class Sampler {
    constructor() {
        this.sensors = findSensors();
        this.cpuHistory = [];
        this._last = null;
        this._procLast = new Map();
    }

    sample(withProcesses) {
        const now = GLib.get_monotonic_time() / 1e6;
        const s = {};
        // CPU: busy share of all time since the last reading (iowait counts as idle).
        const stat = read('/proc/stat') || '';
        const cpu = stat.match(/^cpu\s+(.*)$/m)?.[1].split(/\s+/).map(Number) || [];
        const total = cpu.slice(0, 8).reduce((a, b) => a + b, 0), idle = (cpu[3] || 0) + (cpu[4] || 0);
        // Memory: what's really in use (MemTotal - MemAvailable), as GNOME counts it.
        const mem = Object.fromEntries((read('/proc/meminfo') || '').split('\n')
            .map(l => l.match(/^(\w+):\s+(\d+)/)).filter(Boolean).map(m => [m[1], +m[2] * 1024]));
        s.memTotal = mem.MemTotal || 0;
        s.memUsed = s.memTotal - (mem.MemAvailable || 0);
        s.swapTotal = mem.SwapTotal || 0;
        s.swapUsed = s.swapTotal - (mem.SwapFree || 0);
        // Network: every real interface (not loopback, containers or bridges).
        let rx = 0, tx = 0;
        for (const line of (read('/proc/net/dev') || '').split('\n').slice(2)) {
            const m = line.match(/^\s*([^:]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
            if (m && !/^(lo|docker|veth|virbr|br-|tun|wg|tailscale)/.test(m[1])) {
                rx += +m[2];
                tx += +m[3];
            }
        }
        // Disk activity: sectors (512 bytes) read and written by whole disks,
        // not partitions, loop devices, zram or device-mapper layers.
        let dRead = 0, dWrite = 0;
        for (const line of (read('/proc/diskstats') || '').split('\n')) {
            const f = line.trim().split(/\s+/);
            if (/^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|mmcblk\d+)$/.test(f[2] ?? '')) {
                dRead += +f[5] * 512;
                dWrite += +f[9] * 512;
            }
        }
        if (this._last) {
            const dt = Math.max(0.1, now - this._last.time);
            s.diskRead = Math.max(0, (dRead - this._last.dRead) / dt);
            s.diskWrite = Math.max(0, (dWrite - this._last.dWrite) / dt);
            const dTotal = total - this._last.total;
            s.cpu = dTotal > 0 ? Math.max(0, Math.min(100, 100 * (1 - (idle - this._last.idle) / dTotal))) : 0;
            s.down = Math.max(0, (rx - this._last.rx) / dt);
            s.up = Math.max(0, (tx - this._last.tx) / dt);
        } else {
            s.cpu = 0;
            s.down = s.up = s.diskRead = s.diskWrite = 0;
        }
        this._last = {time: now, total, idle, rx, tx, dRead, dWrite};
        this.cpuHistory.push(s.cpu);
        if (this.cpuHistory.length > HISTORY)
            this.cpuHistory.shift();
        s.cores = (stat.match(/^cpu\d+/gm) || []).length;
        const freqs = [];
        for (let i = 0; i < s.cores; i++) {
            const f = readInt(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
            if (f)
                freqs.push(f);
        }
        s.freq = freqs.length ? freqs.reduce((a, b) => a + b, 0) / freqs.length / 1e6 : null;
        const temp = path => {
            const v = path && readInt(path);
            return v ? v / 1000 : null;
        };
        s.cpuTemp = temp(this.sensors.cpuTemp);
        s.gpuTemp = temp(this.sensors.gpuTemp);
        s.ssdTemp = temp(this.sensors.ssdTemp);
        s.gpu = this.sensors.gpuBusy ? readInt(this.sensors.gpuBusy) : null;
        if (this.sensors.battery) {
            const b = this.sensors.battery;
            s.battery = readInt(`${b}/capacity`);
            s.batteryStatus = (read(`${b}/status`) || '').trim();
            let power = readInt(`${b}/power_now`);
            if (!power) {
                const current = readInt(`${b}/current_now`), voltage = readInt(`${b}/voltage_now`);
                power = current && voltage ? current * voltage / 1e6 : null;
            }
            s.power = power ? power / 1e6 : null;
            const energy = readInt(`${b}/energy_now`), full = readInt(`${b}/energy_full`);
            if (s.power && energy) {
                s.timeLeft = s.batteryStatus === 'Discharging' ? energy / 1e6 / s.power
                    : s.batteryStatus === 'Charging' && full ? (full - energy) / 1e6 / s.power : null;
            }
        }
        if (withProcesses)
            s.top = this._processes(total);
        return s;
    }

    // Busiest processes since the last reading (only while the menu is open).
    _processes(total) {
        const seen = new Map(), out = [];
        const dTotal = this._procTotal ? total - this._procTotal : 0;
        let dir;
        try {
            dir = Gio.File.new_for_path('/proc').enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return [];
        }
        let info;
        while ((info = dir.next_file(null))) {
            const pid = info.get_name();
            if (!/^\d+$/.test(pid))
                continue;
            const stat = read(`/proc/${pid}/stat`);
            if (!stat)
                continue;
            const close = stat.lastIndexOf(')');
            const name = stat.slice(stat.indexOf('(') + 1, close);
            const f = stat.slice(close + 2).split(' ');
            const ticks = +f[11] + +f[12];
            seen.set(pid, ticks);
            const before = this._procLast.get(pid);
            if (before !== undefined && dTotal > 0)
                out.push({name, cpu: 100 * (ticks - before) / dTotal * (this._cores || 1)});
        }
        this._procLast = seen;
        this._procTotal = total;
        this._cores = (read('/proc/stat')?.match(/^cpu\d+/gm) || []).length;
        return out.filter(p => p.cpu > 0.5).sort((a, b) => b.cpu - a.cpu).slice(0, 3);
    }
}

// One "label ······ value" row with an optional meter under it.
// A small history line under a value: DATA (oldest first), scaled to MAX
// (or to its own peak when MAX is null, for speeds).
function paintSpark(area, data, max) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const [r, g, b] = accentRGB().map(c => c / 255);
    const top = max ?? Math.max(1, ...data);
    if (data.length > 1) {
        const step = w / (HISTORY - 1), x0 = w - (data.length - 1) * step;
        const y = v => h - 1 - (h - 2) * Math.min(1, v / top);
        cr.moveTo(x0, h);
        data.forEach((v, i) => cr.lineTo(x0 + i * step, y(v)));
        cr.lineTo(w, h);
        cr.closePath();
        const grad = new Cairo.LinearGradient(0, 0, 0, h);
        grad.addColorStopRGBA(0, r, g, b, 0.45);
        grad.addColorStopRGBA(1, r, g, b, 0.05);
        cr.setSource(grad);
        cr.fill();
        cr.setLineWidth(1.4);
        cr.setSourceRGBA(r, g, b, 0.95);
        data.forEach((v, i) => (i ? cr.lineTo : cr.moveTo).call(cr, x0 + i * step, y(v)));
        cr.stroke();
    }
    cr.$dispose();
}

class Row {
    constructor(menu, label, meter = false, spark = null) {
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'mk-monitor-row'});
        const box = new St.BoxLayout({vertical: true, x_expand: true});
        const line = new St.BoxLayout({x_expand: true, style: 'spacing: 14px;'});
        this.label = new St.Label({text: label, style_class: 'mk-monitor-name', x_expand: true});
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        // Fixed width, right-aligned: a value going from 9% to 100% or a long
        // process name never resizes the menu.
        this.value = new St.Label({text: '…', style_class: 'mk-monitor-value'});
        line.add_child(this.label);
        // spark: the scale of the history line (100 for percentages), or
        // 'auto' for speeds (scaled to their own peak).
        if (spark !== null) {
            this.history = [];
            this.sparkMax = spark === 'auto' ? null : spark;
            this.spark = new St.DrawingArea({width: 64, height: 16, y_align: Clutter.ActorAlign.CENTER});
            this.spark.connect('repaint', area => paintSpark(area, this.history, this.sparkMax));
            line.add_child(this.spark);
        }
        line.add_child(this.value);
        box.add_child(line);
        if (meter) {
            this.track = new St.Widget({style_class: 'mk-monitor-track', x_expand: true});
            this.fill = new St.Widget({style_class: 'mk-monitor-fill'});
            this.track.add_child(this.fill);
            box.add_child(this.track);
        }
        this.item.add_child(box);
        menu.addMenuItem(this.item);
    }

    set(value, fraction = null, sub = null) {
        this.value.text = value;
        if (sub !== null)
            this.label.text = sub;
        if (this.fill && fraction !== null) {
            const width = this.track.width || 220;
            this.fill.set_size(Math.max(2, Math.round(width * Math.min(1, fraction))), 4);
            const [r, g, b] = fraction > 0.9 ? [255, 92, 110] : fraction > 0.75 ? [255, 176, 32] : accentRGB();
            this.fill.style = `background-color: rgb(${r},${g},${b});`;
        }
    }

    // Add a reading to the history line (kept even while the menu is closed).
    push(v) {
        if (!this.history)
            return;
        this.history.push(v);
        if (this.history.length > HISTORY)
            this.history.shift();
        if (this.item.visible && this.item.get_stage())
            this.spark.queue_repaint();
    }

    hide(hidden) {
        this.item.visible = !hidden;
    }
}

export class SystemMonitor {
    enable() {
        this._conf = conf();
        this._sampler = new Sampler();
        this._button = new PanelMenu.Button(0.5, 'System monitor', false);
        this._button.add_style_class_name('mk-monitor');
        const box = new St.BoxLayout({style_class: 'mk-monitor-panel', y_align: Clutter.ActorAlign.CENTER});
        this._spark = new St.DrawingArea({width: 30, height: 14, y_align: Clutter.ActorAlign.CENTER});
        this._spark.connect('repaint', area => this._paintSpark(area));
        this._text = new St.Label({style_class: 'mk-monitor-text', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._spark);
        box.add_child(this._text);
        this._button.add_child(box);

        const menu = this._button.menu;
        menu.box.add_style_class_name('mk-monitor-menu');
        this._rows = {
            cpu: new Row(menu, 'Processor', true, 100),
            mem: new Row(menu, 'Memory', true, 100),
            swap: new Row(menu, 'Swap', true),
            gpu: new Row(menu, 'Graphics', true),
            disk: new Row(menu, 'Disk ( / )', true),
            io: new Row(menu, 'Disk activity', false, 'auto'),
        };
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._rows.temp = new Row(menu, 'Temperatures');
        this._rows.power = new Row(menu, 'Battery');
        this._internet = new InternetSection(menu);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Busiest right now'));
        this._procRows = [0, 1, 2].map(() => new Row(menu, ''));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        // Free cached memory: no password (mk-drop-caches' polkit action);
        // the item shows how much came back for a few seconds. Power modes
        // live in GNOME's Quick Settings; the speed test is its own app.
        // One fixed footer row, two buttons side by side: always in view.
        const footer = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false,
            style_class: 'mk-monitor-footer'});
        const freeLabel = new St.Label({text: 'Free cached memory'});
        const free = new St.Button({child: freeLabel, style_class: 'mk-monitor-action', can_focus: true,
            x_expand: true});
        free.connect('clicked', () => this._freeMemory());
        const monitor = new St.Button({label: 'System Monitor', style_class: 'mk-monitor-action', can_focus: true});
        monitor.connect('clicked', () => {
            menu.close();
            try {
                Gio.AppInfo.create_from_commandline('gnome-system-monitor', null, Gio.AppInfoCreateFlags.NONE).launch([], null);
            } catch (e) {
                console.warn(`mk-indicator: ${e.message}`);
            }
        });
        const row = new St.BoxLayout({x_expand: true, style: 'spacing: 8px;'});
        row.add_child(free);
        row.add_child(monitor);
        footer.add_child(row);
        menu.addMenuItem(footer);
        this._freeItem = {label: freeLabel};  // its text shows what came back
        this._openId = menu.connect('open-state-changed', (_m, open) => {
            this._restart(open ? 1 : Number(this._conf.INTERVAL) || 2);
            if (open)
                this._tick();
        });
        Main.panel.addToStatusArea('mk-monitor', this._button, 0, 'right');
        this._monitor = Gio.File.new_for_path(USER_CONF).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => {
            this._conf = conf();
            this._tick();
        });
        this._restart(Number(this._conf.INTERVAL) || 2);
        this._tick();
        this._diskTick = 0;
    }

    _restart(seconds) {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_LOW, Math.max(500, seconds * 1000), () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    setLocked(locked) {
        if (!this._button)
            return;
        this._button.visible = !locked;
        if (locked && this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        } else if (!locked && !this._timer) {
            this._restart(Number(this._conf.INTERVAL) || 2);
        }
    }

    _tick() {
        if (!this._button)
            return;
        const open = this._button.menu.isOpen;
        const s = this._sampler.sample(open);
        this._s = s;
        const parts = [];
        for (const key of this._conf.PANEL.split(',').map(k => k.trim())) {
            if (key === 'cpu')
                parts.push(`${Math.round(s.cpu)}%`);
            else if (key === 'mem')
                parts.push(fmtBytes(s.memUsed).replace(' ', ''));
            else if (key === 'temp' && s.cpuTemp)
                parts.push(`${Math.round(s.cpuTemp)}°C`);
            else if (key === 'disk')
                parts.push(`⇅${fmtRate(s.diskRead + s.diskWrite)}`);
            else if (key === 'net')
                parts.push(`↓${fmtRate(s.down)}`);
            else if (key === 'power' && s.power && s.batteryStatus === 'Discharging')
                parts.push(`${s.power.toFixed(1)} W`);
        }
        this._text.text = parts.join('  ');
        this._spark.visible = this._conf.PANEL.includes('cpu');
        this._spark.queue_repaint();
        this._internet?.feed(s.down, s.up);
        this._rows.cpu.push(s.cpu);
        this._rows.mem.push(s.memTotal ? 100 * s.memUsed / s.memTotal : 0);
        this._rows.io.push(s.diskRead + s.diskWrite);
        if (open)
            this._fillMenu(s);
    }

    _fillMenu(s) {
        const r = this._rows;
        r.cpu.set(`${Math.round(s.cpu)}%`, s.cpu / 100,
            `Processor · ${s.cores} threads${s.freq ? ` · ${s.freq.toFixed(1)} GHz` : ''}`);
        r.mem.set(`${fmtBytes(s.memUsed)} of ${fmtBytes(s.memTotal)}`, s.memTotal ? s.memUsed / s.memTotal : 0);
        r.swap.hide(!s.swapTotal);
        if (s.swapTotal)
            r.swap.set(`${fmtBytes(s.swapUsed)} of ${fmtBytes(s.swapTotal)}`, s.swapUsed / s.swapTotal);
        r.gpu.hide(s.gpu === null);
        if (s.gpu !== null)
            r.gpu.set(`${s.gpu}%`, s.gpu / 100);
        if (this._diskTick-- <= 0) {  // the disk barely changes: every 30 readings
            this._diskTick = 30;
            try {
                const info = Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null);
                const size = info.get_attribute_uint64('filesystem::size'), free = info.get_attribute_uint64('filesystem::free');
                r.disk.set(`${fmtBytes(size - free)} of ${fmtBytes(size)}`, size ? (size - free) / size : 0);
            } catch (e) {
                r.disk.hide(true);
            }
        }
        r.io.set(`R ${fmtRate(s.diskRead)} · W ${fmtRate(s.diskWrite)}`);
        const temps = [['CPU', s.cpuTemp], ['GPU', s.gpuTemp], ['SSD', s.ssdTemp]].filter(t => t[1]);
        r.temp.hide(!temps.length);
        r.temp.set(temps.map(([n, t]) => `${n} ${Math.round(t)} °C`).join('   '));
        r.power.hide(s.battery === undefined);
        if (s.battery !== undefined) {
            const draw = s.power ? ` · ${s.power.toFixed(1)} W` : '';
            const left = s.timeLeft ? ` · ${fmtTime(s.timeLeft)} ${s.batteryStatus === 'Charging' ? 'to full' : 'left'}` : '';
            r.power.set(`${s.battery}%${draw}${left}`, null, `Battery · ${s.batteryStatus.toLowerCase() || 'unknown'}`);
        }
        const top = s.top || [];
        this._procRows.forEach((row, i) => {
            row.hide(!top[i]);
            if (top[i])
                row.set(`${top[i].cpu.toFixed(0)}%`, null, top[i].name);
        });
    }

    _freeMemory() {
        const label = this._freeItem.label;
        label.text = 'Freeing cached memory…';
        try {
            const proc = Gio.Subprocess.new([`${GLib.get_home_dir()}/.local/bin/mk`, 'optimize', 'ram'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                let out = '';
                try {
                    [, out] = p.communicate_utf8_finish(res);
                } catch (e) {
                    console.warn(`mk-indicator: mk optimize ram: ${e.message}`);
                }
                const freed = /freed ([\d.]+ GB)/.exec(out ?? '');
                label.text = freed ? `Freed ${freed[1]}` : 'Memory not changed';
                if (this._freeReset)
                    GLib.source_remove(this._freeReset);
                this._freeReset = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                    this._freeReset = 0;
                    label.text = 'Free cached memory';
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            label.text = 'Free cached memory';
            console.warn(`mk-indicator: mk optimize ram: ${e.message}`);
        }
    }

    _paintSpark(area) {
        paintSpark(area, this._sampler?.cpuHistory || [], 100);
    }

    disable() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        if (this._freeReset) {
            GLib.source_remove(this._freeReset);
            this._freeReset = 0;
        }
        this._monitor?.cancel();
        this._monitor = null;
        if (this._openId)
            this._button?.menu.disconnect(this._openId);
        this._internet?.destroy();
        this._internet = null;
        this._button?.destroy();
        this._button = null;
        this._sampler = null;
    }
}
