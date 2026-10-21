import GLib from "gi://GLib";
import { SignalManager } from "./signalManager.js";
const MIN_SCALE = 1.0;
const LERP_FACTOR = 0.25; // smoothing factor per tick
export class Magnification {
    _signals;
    _container;
    _enabled;
    _maxScale;
    _falloffDistance;
    _framerate;
    _pollId = null;
    _currentScales = [];
    _pivotX = 0.5;
    _pivotY = 1.0;
    _paused = false;
    constructor(container, enabled, maxScale, falloffDistance = 100, framerate = 60) {
        this._signals = new SignalManager();
        this._container = container;
        this._enabled = enabled;
        this._maxScale = maxScale;
        this._falloffDistance = falloffDistance;
        this._framerate = framerate;
    }
    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled)
            this._resetAll();
    }
    setMaxScale(scale) {
        this._maxScale = scale;
    }
    setFalloffDistance(distance) {
        this._falloffDistance = distance;
    }
    setFramerate(fps) {
        this._framerate = fps;
        this._restartPoll();
    }
    setPivotPoint(x, y) {
        this._pivotX = x;
        this._pivotY = y;
    }
    /**
     * Freeze magnification and snap all icons back to scale 1.0. Used while a
     * drag-reorder is in progress so icon geometry stays stable for drop-index
     * math. The poll keeps running but returns early while paused.
     */
    pause() {
        if (this._paused)
            return;
        this._paused = true;
        this._snapAllToMin();
    }
    resume() {
        if (!this._paused)
            return;
        this._paused = false;
        // Icons may have been reordered while paused; drop stale per-index scales.
        this._currentScales = [];
    }
    start() {
        this._signals.connect(this._container, "leave-event", () => {
            this._resetAll();
        });
        this._startPoll();
    }
    stop() {
        this._signals.disconnectAll();
        this._stopPoll();
        this._paused = false;
        this._resetAll();
    }
    _startPoll() {
        this._stopPoll();
        const interval = Math.round(1000 / this._framerate);
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }
    _stopPoll() {
        if (this._pollId !== null) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
    }
    _restartPoll() {
        if (this._pollId !== null) {
            this._startPoll();
        }
    }
    _update() {
        if (!this._enabled)
            return;
        if (this._paused)
            return;
        if (!this._container.visible)
            return;
        const [px, py] = global.get_pointer();
        const [dx, dy] = this._container.get_position();
        const [, dh] = this._container.get_size();
        const localX = px - dx;
        const localY = py - dy;
        if (localY < -40 || localY > dh + 20) {
            this._resetAll();
            return;
        }
        const children = this._container.get_children();
        if (children.length === 0)
            return;
        // Ensure pivot-point and currentScales array are sized.
        for (const child of children) {
            if (child.get_pivot_point()[0] !== this._pivotX ||
                child.get_pivot_point()[1] !== this._pivotY) {
                child.set_pivot_point(this._pivotX, this._pivotY);
            }
        }
        while (this._currentScales.length < children.length) {
            this._currentScales.push(MIN_SCALE);
        }
        // Find closest icon to pointer.
        let focalIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
            const [cx] = children[i].get_position();
            const [cw] = children[i].get_size();
            const d = Math.abs(localX - (cx + cw / 2));
            if (d < bestDist) {
                bestDist = d;
                focalIdx = i;
            }
        }
        if (bestDist > this._falloffDistance * 1.5) {
            this._resetAll();
            return;
        }
        // Compute target scales and interpolate.
        const [fx] = children[focalIdx].get_position();
        const [fw] = children[focalIdx].get_size();
        const focalCenter = fx + fw / 2;
        for (let i = 0; i < children.length; i++) {
            const [cx] = children[i].get_position();
            const [cw] = children[i].get_size();
            const dist = Math.abs(cx + cw / 2 - focalCenter);
            const t = Math.max(0, 1 - dist / this._falloffDistance);
            const smooth = t * t * (3 - 2 * t);
            const target = MIN_SCALE + (this._maxScale - MIN_SCALE) * smooth;
            // Lerp towards target.
            const prev = this._currentScales[i] ?? MIN_SCALE;
            const next = prev + (target - prev) * LERP_FACTOR;
            this._currentScales[i] = next;
            children[i].scale_x = next;
            children[i].scale_y = next;
        }
    }
    _resetAll() {
        if (this._paused)
            return;
        const children = this._container.get_children();
        for (let i = 0; i < children.length; i++) {
            const prev = this._currentScales[i] ?? MIN_SCALE;
            if (Math.abs(prev - MIN_SCALE) < 0.001)
                continue;
            const next = prev + (MIN_SCALE - prev) * LERP_FACTOR;
            this._currentScales[i] = next;
            children[i].scale_x = next;
            children[i].scale_y = next;
        }
    }
    /**
     * Immediately set every icon back to scale 1.0 (no interpolation) and
     * forget the cached per-index scales.
     */
    _snapAllToMin() {
        const children = this._container.get_children();
        for (const child of children) {
            child.scale_x = MIN_SCALE;
            child.scale_y = MIN_SCALE;
        }
        this._currentScales = [];
    }
}
