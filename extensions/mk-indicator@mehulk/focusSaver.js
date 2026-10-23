// Focus-timer screensavers drawn over your work instead of in a window, like
// the classic Windows ones: Bubbles, Mystify and Starfield. mk-timer decides
// when you've stepped away and writes `"ambient": "<style>"` to timer.json;
// the first touch of the mouse or keyboard ends it.
//
// Everything is a handful of small actors moved each frame (no full-screen
// canvas), so it costs the GPU next to nothing.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './accent.js';
import { hsvToRgb, rgbToHsv } from './colour.js';

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function accentHue() {
    const [r, g, b] = accentRGB();
    return rgbToHsv(r / 255, g / 255, b / 255)[0];
}

const rgba = (rgb, a) => `rgba(${rgb.join(',')},${a})`;

// Soap bubbles drifting over the desktop and bouncing off each other.
class Bubbles {
    constructor(layer, w, h) {
        this._w = w;
        this._h = h;
        const hue = accentHue();
        this._items = [];
        const count = 7;
        for (let i = 0; i < count; i++) {
            const r = rand(60, 130);
            const tint = hsvToRgb(hue + rand(-40, 60), 0.55, 1);
            const rim = hsvToRgb(hue + 120 + rand(-30, 30), 0.35, 1);
            const actor = new St.Widget({
                width: 2 * r, height: 2 * r,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                style: `border-radius: ${r}px; border: 1px solid rgba(255,255,255,0.32);
                    background-gradient-direction: radial;
                    background-gradient-start: ${rgba(tint, 0.02)};
                    background-gradient-end: ${rgba(rim, 0.28)};`,
            });
            // The window reflection on the glass.
            actor.add_child(new St.Widget({
                x: r * 0.42, y: r * 0.30, width: r * 0.55, height: r * 0.34,
                rotation_angle_z: -28,
                style: `border-radius: ${r}px; background-gradient-direction: radial;
                    background-gradient-start: rgba(255,255,255,0.55);
                    background-gradient-end: rgba(255,255,255,0);`,
            }));
            layer.add_child(actor);
            const speed = rand(70, 150), dir = rand(0, 2 * Math.PI);
            this._items.push({
                actor, r, m: r * r, phase: rand(0, 6.3),
                x: rand(r, w - r), y: rand(r, h - r),
                vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed,
            });
        }
        // Start apart so they don't spawn inside each other.
        for (let k = 0; k < 40; k++)
            this._separate();
    }

    _separate() {
        const items = this._items;
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i], b = items[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.hypot(dx, dy) || 0.01, min = a.r + b.r;
                if (dist >= min)
                    continue;
                const nx = dx / dist, ny = dy / dist, push = (min - dist) / 2;
                a.x -= nx * push;
                a.y -= ny * push;
                b.x += nx * push;
                b.y += ny * push;
                // Elastic bounce along the line between centres.
                const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (rel < 0) {
                    const k = 2 * rel / (a.m + b.m);
                    a.vx += k * b.m * nx;
                    a.vy += k * b.m * ny;
                    b.vx -= k * a.m * nx;
                    b.vy -= k * a.m * ny;
                }
            }
        }
    }

    step(dt, t) {
        for (const b of this._items) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.x < b.r || b.x > this._w - b.r) {
                b.vx = -b.vx;
                b.x = Math.min(Math.max(b.x, b.r), this._w - b.r);
            }
            if (b.y < b.r || b.y > this._h - b.r) {
                b.vy = -b.vy;
                b.y = Math.min(Math.max(b.y, b.r), this._h - b.r);
            }
        }
        this._separate();
        for (const b of this._items) {
            // A slow wobble, as real bubbles have.
            const wob = 0.035 * Math.sin(t * 2.1 + b.phase);
            b.actor.set_position(b.x - b.r, b.y - b.r);
            b.actor.set_scale(1 + wob, 1 - wob);
        }
    }
}

// Two glowing polygons whose corners bounce around the screen, leaving echoes.
class Mystify {
    constructor(layer, w, h) {
        this._w = w;
        this._h = h;
        this._history = [];
        this._t = 0;
        this._shapes = [];
        const hue = accentHue();
        const ECHOES = 6, ECHO_GAP = 0.085;
        this._echoes = ECHOES;
        this._gap = ECHO_GAP;
        for (const [s, hueShift] of [[0, 0], [1, 150]]) {
            const corners = Array.from({length: 4}, () => ({
                x: rand(0, w), y: rand(0, h), vx: rand(120, 260) * (Math.random() < 0.5 ? -1 : 1),
                vy: rand(120, 260) * (Math.random() < 0.5 ? -1 : 1),
            }));
            const echoes = [];
            for (let e = 0; e < ECHOES; e++) {
                const rgb = hsvToRgb(hue + hueShift, 0.7, 1);
                const alpha = (1 - e / ECHOES) ** 1.6;
                // Plain colour, no box-shadow: a shadow is re-rendered every
                // time the line changes length. A wider faint copy is the glow.
                const lines = Array.from({length: 4}, () => [[6, 0.22], [2, 1]].map(([height, a]) => {
                    const line = new St.Widget({
                        height, opacity: Math.round(255 * alpha * a),
                        pivot_point: new Graphene.Point({x: 0, y: 0.5}),
                        style: `background-color: ${rgba(rgb, 1)}; border-radius: ${height / 2}px;`,
                    });
                    layer.add_child(line);
                    return line;
                }));
                echoes.push(lines);
            }
            this._shapes.push({id: s, corners, echoes, hueShift});
        }
    }

    step(dt) {
        this._t += dt;
        for (const shape of this._shapes) {
            for (const c of shape.corners) {
                c.x += c.vx * dt;
                c.y += c.vy * dt;
                if (c.x < 0 || c.x > this._w)
                    c.vx = -c.vx;
                if (c.y < 0 || c.y > this._h)
                    c.vy = -c.vy;
                c.x = Math.min(Math.max(c.x, 0), this._w);
                c.y = Math.min(Math.max(c.y, 0), this._h);
            }
        }
        this._history.push([this._t, this._shapes.map(s => s.corners.map(c => [c.x, c.y]))]);
        const keep = this._t - this._gap * this._echoes - 0.2;
        while (this._history.length > 2 && this._history[0][0] < keep)
            this._history.shift();
        for (const shape of this._shapes) {
            for (let e = 0; e < this._echoes; e++) {
                const when = this._t - e * this._gap;
                let snap = this._history[0];
                for (let i = this._history.length - 1; i >= 0; i--) {
                    if (this._history[i][0] <= when) {
                        snap = this._history[i];
                        break;
                    }
                }
                const pts = snap[1][shape.id];
                shape.echoes[e].forEach((pair, i) => {
                    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % 4];
                    const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
                    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                    for (const line of pair) {
                        line.set_position(x1, y1 - line.height / 2);
                        line.width = len;
                        line.rotation_angle_z = angle;
                    }
                });
            }
        }
    }
}

// Flying through stars, over a dimmed desktop.
class Starfield {
    constructor(layer, w, h) {
        this._w = w;
        this._h = h;
        layer.add_child(new St.Widget({width: w, height: h, style: 'background-color: rgba(2,6,18,0.62);'}));
        const accent = hsvToRgb(accentHue(), 0.45, 1);
        this._stars = Array.from({length: 160}, (_, i) => {
            const tint = i % 4 === 0 ? accent : [235, 242, 255];
            const actor = new St.Widget({
                width: 4, height: 4,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                style: `border-radius: 2px; background-color: ${rgba(tint, 1)}; box-shadow: 0 0 4px 0 ${rgba(tint, 0.7)};`,
            });
            layer.add_child(actor);
            const star = {actor};
            this._reset(star, rand(0.05, 1));
            return star;
        });
    }

    _reset(star, z = 1) {
        star.x = rand(-1, 1) * this._w * 0.6;
        star.y = rand(-1, 1) * this._h * 0.6;
        star.z = z;
    }

    step(dt) {
        const cx = this._w / 2, cy = this._h / 2, f = 0.35;
        for (const s of this._stars) {
            s.z -= dt * 0.28;
            const sx = cx + s.x * f / s.z, sy = cy + s.y * f / s.z;
            if (s.z <= 0.02 || sx < -10 || sx > this._w + 10 || sy < -10 || sy > this._h + 10) {
                this._reset(s);
                continue;
            }
            const near = 1 - s.z;
            s.actor.set_position(sx - 2, sy - 2);
            s.actor.set_scale(0.45 + near * 2.2, 0.45 + near * 2.2);
            s.actor.opacity = Math.round(255 * Math.min(1, near * 1.4));
        }
    }
}

export const STYLES = {bubbles: Bubbles, mystify: Mystify, starfield: Starfield};

export class FocusSaver {
    // style: one of STYLES; label() gives the line shown at the bottom.
    show(style, label) {
        if (this._style === style || !STYLES[style] || Main.sessionMode.isLocked)
            return;
        this.hide(true);
        this._style = style;
        const monitor = Main.layoutManager.primaryMonitor;
        this._actor = new St.Widget({
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            reactive: false, opacity: 0, clip_to_allocation: true,
        });
        Main.layoutManager.uiGroup.add_child(this._actor);
        this._scene = new STYLES[style](this._actor, monitor.width, monitor.height);
        this._label = new St.Label({
            style: 'font-size: 15px; font-weight: 600; color: rgba(255,255,255,0.75); text-shadow: 0 1px 6px rgba(0,0,0,0.6);',
        });
        this._actor.add_child(this._label);
        this._labelFn = label;
        this._placeLabel(monitor);

        const scene = this._scene;
        let last = GLib.get_monotonic_time(), t = 0;
        this._timeline = new Clutter.Timeline({actor: this._actor, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => {
            const now = GLib.get_monotonic_time();
            const dt = Math.min(0.05, (now - last) / 1e6);
            last = now;
            t += dt;
            scene.step(dt, t);
        });
        this._timeline.start();
        this._labelId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._placeLabel(monitor);
            return GLib.SOURCE_CONTINUE;
        });
        this._actor.ease({opacity: 255, duration: 700, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        // Gone the moment you touch anything, like a screensaver.
        const idle = global.backend.get_core_idle_monitor();
        this._activeId = idle.add_user_active_watch(() => {
            this._activeId = 0;
            this.hide();
        });
    }

    _placeLabel(monitor) {
        this._label.text = this._labelFn?.() ?? '';
        const [, natW] = this._label.get_preferred_width(-1);
        this._label.set_position(Math.round((monitor.width - natW) / 2), Math.round(monitor.height * 0.9));
    }

    hide(now = false) {
        if (this._activeId) {
            global.backend.get_core_idle_monitor().remove_watch(this._activeId);
            this._activeId = 0;
        }
        if (this._labelId) {
            GLib.source_remove(this._labelId);
            this._labelId = 0;
        }
        const actor = this._actor, timeline = this._timeline;
        this._actor = this._timeline = this._scene = this._label = null;
        this._style = null;
        if (!actor)
            return;
        const done = () => {
            timeline?.stop();
            actor.destroy();
        };
        if (now)
            done();
        else
            actor.ease({opacity: 0, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: done});
    }
}
