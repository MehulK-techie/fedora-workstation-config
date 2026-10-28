// Internet section of the system monitor's menu: a live graph of what's going
// through your connection right now, which connection that is, and an
// on-demand speed test with a gauge, like the speed-test websites.
//
// The live graph uses the counters the monitor already reads (/proc/net/dev),
// so it costs nothing extra. The speed test only runs when you click it: it
// measures ping, then downloads and uploads test data for a few seconds each
// against Cloudflare's public speed-test servers (speed.cloudflare.com).
import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { accentRGB } from './accent.js';

const ENDPOINT = 'https://speed.cloudflare.com';
const PHASE_SECONDS = 7;          // download and upload each run this long at most
const UPLOAD_CHUNK = 4 * 1024 * 1024;
const HISTORY = 60;

const mbps = (bytes, seconds) => bytes * 8 / Math.max(0.05, seconds) / 1e6;
const fmtMbps = v => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
const fmtRate = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} kB/s` : `${b.toFixed(0)} B/s`;
const now = () => GLib.get_monotonic_time() / 1e6;

// The interface carrying the default route, and its address.
function activeConnection() {
    let iface = null;
    try {
        const [, bytes] = GLib.file_get_contents('/proc/net/route');
        for (const line of new TextDecoder().decode(bytes).split('\n').slice(1)) {
            const f = line.trim().split(/\s+/);
            if (f[1] === '00000000' && f[0]) {
                iface = f[0];
                break;
            }
        }
    } catch (e) {
        return null;
    }
    if (!iface)
        return null;
    const kind = iface.startsWith('wl') ? 'Wi-Fi' : iface.startsWith('en') || iface.startsWith('eth') ? 'Ethernet'
        : iface.startsWith('ww') ? 'Mobile' : iface.startsWith('tun') || iface.startsWith('wg') ? 'VPN' : 'Network';
    return {iface, kind};
}

export class InternetSection {
    constructor(menu) {
        this._down = [];
        this._up = [];
        this._session = new Soup.Session({timeout: 15, user_agent: 'mk-indicator speed test'});
        this._result = null;
        this._phase = null;
        this._value = 0;

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Internet'));
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'mk-monitor-row'});
        const box = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 6px;'});

        const head = new St.BoxLayout({x_expand: true, style: 'spacing: 14px;'});
        this._conn = new St.Label({text: '…', style_class: 'mk-monitor-name', x_expand: true});
        this._live = new St.Label({text: '', style_class: 'mk-monitor-value'});
        head.add_child(this._conn);
        head.add_child(this._live);
        box.add_child(head);

        this._graph = new St.DrawingArea({height: 38, x_expand: true});
        this._graph.connect('repaint', area => this._paintGraph(area));
        box.add_child(this._graph);

        this._gauge = new St.DrawingArea({height: 150, x_expand: true, visible: false});
        this._gauge.connect('repaint', area => this._paintGauge(area));
        box.add_child(this._gauge);

        this._summary = new St.Label({text: 'Speed test: download, upload and ping', style_class: 'mk-monitor-name'});
        box.add_child(this._summary);
        item.add_child(box);
        menu.addMenuItem(item);

        this._button = new PopupMenu.PopupMenuItem('Run network speed test');
        // Not the usual activate (that closes the menu): keep it open to watch.
        this._button.activate = () => this.run();
        menu.addMenuItem(this._button);
    }

    // Called by the monitor with each reading (bytes per second).
    feed(down, up) {
        this._down.push(down);
        this._up.push(up);
        if (this._down.length > HISTORY) {
            this._down.shift();
            this._up.shift();
        }
        const conn = activeConnection();
        this._conn.text = conn ? `${conn.kind} · ${conn.iface}` : 'Offline';
        this._live.text = `↓ ${fmtRate(down)}   ↑ ${fmtRate(up)}`;
        this._graph.queue_repaint();
    }

    _paintGraph(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const [r, g, b] = accentRGB().map(c => c / 255);
        const peak = Math.max(64 * 1024, ...this._down, ...this._up);
        const step = w / (HISTORY - 1);
        const series = (data, fill, rgba) => {
            if (data.length < 2)
                return;
            const x0 = w - (data.length - 1) * step;
            const y = v => h - 1 - (h - 4) * v / peak;
            cr.moveTo(x0, y(data[0]));
            data.forEach((v, i) => cr.lineTo(x0 + i * step, y(v)));
            if (fill) {
                cr.lineTo(w, h);
                cr.lineTo(x0, h);
                cr.closePath();
                const grad = new Cairo.LinearGradient(0, 0, 0, h);
                grad.addColorStopRGBA(0, ...rgba, 0.45);
                grad.addColorStopRGBA(1, ...rgba, 0.04);
                cr.setSource(grad);
                cr.fillPreserve();
            }
            cr.setSourceRGBA(...rgba, 0.95);
            cr.setLineWidth(1.4);
            cr.stroke();
        };
        series(this._down, true, [r, g, b]);
        series(this._up, false, [1, 0.69, 0.13]);
        cr.$dispose();
    }

    _paintGauge(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const [r, g, b] = accentRGB().map(c => c / 255);
        const cx = w / 2, cy = h - 44, radius = Math.min(w / 2 - 14, h - 56);
        // Scale: 0-100 Mbps, widening to 500 or 1000 when you're faster.
        const top = this._value > 500 ? 1000 : this._value > 100 ? 500 : 100;
        const frac = Math.min(1, Math.sqrt(this._value / top));
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(10);
        cr.setSourceRGBA(1, 1, 1, 0.10);
        cr.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
        cr.stroke();
        if (frac > 0.002) {
            const grad = new Cairo.LinearGradient(cx - radius, 0, cx + radius, 0);
            grad.addColorStopRGBA(0, r, g, b, 0.75);
            grad.addColorStopRGBA(1, Math.min(1, r + 0.3), Math.min(1, g + 0.2), b, 1);
            cr.setSource(grad);
            cr.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * frac);
            cr.stroke();
        }
        // ticks: 0, a quarter, half, three quarters, top (on the square-root scale)
        cr.setSourceRGBA(1, 1, 1, 0.45);
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(9);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const a = Math.PI + Math.PI * t;
            const label = `${Math.round(top * t * t)}`;
            const ext = cr.textExtents(label);
            cr.moveTo(cx + Math.cos(a) * (radius - 20) - ext.width / 2, cy + Math.sin(a) * (radius - 20) + 4);
            cr.showText(label);
        }
        // needle
        const a = Math.PI + Math.PI * frac;
        cr.setLineWidth(2.5);
        cr.setSourceRGBA(1, 1, 1, 0.92);
        cr.moveTo(cx, cy);
        cr.lineTo(cx + Math.cos(a) * (radius - 8), cy + Math.sin(a) * (radius - 8));
        cr.stroke();
        cr.arc(cx, cy, 4, 0, 2 * Math.PI);
        cr.fill();
        // number and phase
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(22);
        const text = this._phase === 'ping' ? `${Math.round(this._value)}` : fmtMbps(this._value);
        let ext = cr.textExtents(text);
        cr.moveTo(cx - ext.width / 2, cy + 28);
        cr.showText(text);
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(10);
        cr.setSourceRGBA(1, 1, 1, 0.6);
        const unit = {ping: 'ms · ping', download: 'Mbps · download', upload: 'Mbps · upload'}[this._phase] || 'Mbps';
        ext = cr.textExtents(unit);
        cr.moveTo(cx - ext.width / 2, cy + 42);
        cr.showText(unit);
        cr.$dispose();
    }

    _set(phase, value) {
        this._phase = phase;
        this._value = value;
        this._gauge.queue_repaint();
    }

    async run() {
        if (this._running)
            return;
        this._running = true;
        this._cancel = new Gio.Cancellable();
        this._gauge.show();
        this._button.label.text = 'Testing…';
        this._summary.text = 'Measuring ping…';
        try {
            const ping = await this._ping();
            this._summary.text = `Ping ${Math.round(ping)} ms · measuring download…`;
            const down = await this._download();
            // The cancelled download streams leave half-read connections: drop them.
            this._session.abort();
            this._summary.text = `Ping ${Math.round(ping)} ms · ↓ ${fmtMbps(down)} Mbps · measuring upload…`;
            const up = await this._upload();
            this._set('download', down);
            const when = GLib.DateTime.new_now_local().format('%H:%M');
            this._summary.text = `↓ ${fmtMbps(down)} Mbps   ↑ ${fmtMbps(up)} Mbps   ping ${Math.round(ping)} ms   (${when})`;
        } catch (e) {
            if (!this._cancel?.is_cancelled())
                this._summary.text = `Speed test failed: ${e.message.includes('resolve') ? 'no internet connection' : e.message}`;
        } finally {
            this._running = false;
            if (this._button)
                this._button.label.text = 'Run speed test again';
        }
    }

    _request(method, url, body = null) {
        const msg = Soup.Message.new(method, url);
        if (body)
            msg.set_request_body_from_bytes('application/octet-stream', body);
        return msg;
    }

    _sendAndRead(msg) {
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancel, (s, res) => {
                try {
                    resolve(s.send_and_read_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _ping() {
        const times = [];
        for (let i = 0; i < 6; i++) {
            const t0 = now();
            await this._sendAndRead(this._request('GET', `${ENDPOINT}/__down?bytes=0`));
            times.push((now() - t0) * 1000);
            this._set('ping', Math.min(...times));
        }
        times.shift(); // the first one also opens the connection
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)];
    }

    // Two parallel streams for a few seconds; live speed on the gauge.
    _download() {
        return new Promise((resolve, reject) => {
            let total = 0, open = 2, finished = false;
            const t0 = now();
            const done = () => {
                if (finished)
                    return;
                finished = true;
                GLib.source_remove(tick);
                resolve(mbps(total, now() - t0));
            };
            const tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                this._set('download', mbps(total, now() - t0));
                if (now() - t0 > PHASE_SECONDS) {
                    this._streamCancel.cancel();
                    done();
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
            this._streamCancel = new Gio.Cancellable();
            this._cancel.connect(() => this._streamCancel.cancel());
            const stream = () => {
                const msg = this._request('GET', `${ENDPOINT}/__down?bytes=25000000`);  // the most it serves at once
                this._session.send_async(msg, GLib.PRIORITY_DEFAULT, this._streamCancel, (s, res) => {
                    let input;
                    try {
                        input = s.send_finish(res);
                        if (msg.get_status() !== Soup.Status.OK)
                            throw new Error(`server said ${msg.get_status()}`);
                    } catch (e) {
                        if (!finished && --open === 0)
                            (total ? done : () => reject(e))();
                        return;
                    }
                    const read = () => input.read_bytes_async(256 * 1024, GLib.PRIORITY_DEFAULT, this._streamCancel, (st, r) => {
                        try {
                            const bytes = st.read_bytes_finish(r);
                            if (bytes.get_size() === 0) {
                                // finished early on a fast line: start another
                                if (!finished && now() - t0 < PHASE_SECONDS)
                                    stream();
                                else if (--open === 0)
                                    done();
                                return;
                            }
                            total += bytes.get_size();
                            read();
                        } catch (e) {
                            if (--open === 0)
                                done();
                        }
                    });
                    read();
                });
            };
            stream();
            stream();
        });
    }

    // Upload chunks one after another for a few seconds.
    async _upload() {
        const chunk = new GLib.Bytes(new Uint8Array(UPLOAD_CHUNK));
        let total = 0;
        const t0 = now();
        while (now() - t0 < PHASE_SECONDS) {
            await this._sendAndRead(this._request('POST', `${ENDPOINT}/__up`, chunk));
            total += UPLOAD_CHUNK;
            this._set('upload', mbps(total, now() - t0));
            if (total >= 64 * UPLOAD_CHUNK)
                break;
        }
        return mbps(total, now() - t0);
    }

    destroy() {
        this._cancel?.cancel();
        this._streamCancel?.cancel();
        this._session?.abort();
        this._button = null;
    }
}
