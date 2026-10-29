// Network section of the system monitor's menu: which connection carries
// your traffic, and a live graph of it (down filled, up as a line).
// It uses the counters the monitor already reads (/proc/net/dev): no sockets,
// no timers of its own, nothing on the network. The full speed test is the
// Speed Test app (mk speedtest --gui), only when you open it.
import Cairo from 'cairo';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { accentRGB } from './accent.js';

const HISTORY = 60;
const fmtRate = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} kB/s` : `${b.toFixed(0)} B/s`;

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
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Network'));
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'mk-monitor-row'});
        const box = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 4px;'});
        const head = new St.BoxLayout({x_expand: true, style: 'spacing: 14px;'});
        this._conn = new St.Label({text: '…', style_class: 'mk-monitor-name', x_expand: true});
        this._conn.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._live = new St.Label({text: '', style_class: 'mk-monitor-value'});
        head.add_child(this._conn);
        head.add_child(this._live);
        box.add_child(head);
        this._graph = new St.DrawingArea({height: 22, x_expand: true});
        this._graph.connect('repaint', area => this._paintGraph(area));
        box.add_child(this._graph);
        item.add_child(box);
        menu.addMenuItem(item);
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

    destroy() {
        this._graph = null;
    }
}
