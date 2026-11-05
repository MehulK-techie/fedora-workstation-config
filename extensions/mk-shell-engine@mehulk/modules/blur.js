// MK Shell Engine: native blur. Mutter's own GPU blur (Shell.BlurEffect, the
// one GNOME uses behind the overview) behind the top bar and the dock, with
// rounded corners where the glass is rounded. Every blur pauses while the
// monitor it's on shows a full-screen window (a game, a film), so it costs the
// GPU nothing then. Stands aside while Blur my Shell is on.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BLUR_MY_SHELL, isActive, watch } from './conflicts.js';

export const PANEL_GLASS = {sigma: 36, brightness: 0.68};
export const DOCK_GLASS = {sigma: 32, brightness: 0.62};

const live = new Set();        // every blur effect made here: [actor, effects]

// Cuts the blurred picture to a rounded rectangle (Shell.BlurEffect has no
// corners of its own): a fragment snippet that fades out everything past the
// rounded corners. GNOME 51 builds it on Clutter.ShaderEffect (with a Cogl
// snippet, as GNOME's own lightbox does); GNOME 48-50 on Shell.GLSLEffect,
// which 51 removed. Made on first use, so if a future GNOME changes this
// again, the blur goes square instead of the engine failing to start.
const CORNERS_DECLARATIONS = 'uniform vec2 mk_size;\nuniform float mk_radius;\n';
const CORNERS_CODE = `
vec2 mk_p = cogl_tex_coord_in[0].xy * mk_size;
vec2 mk_q = abs(mk_p - mk_size * 0.5) - (mk_size * 0.5 - mk_radius);
float mk_d = length(max(mk_q, 0.0)) - mk_radius;
cogl_color_out *= clamp(0.5 - mk_d, 0.0, 1.0);`;

// keep the uniforms in step with the actor's size
function trackSize(effect, actor) {
    if (effect._sizeId)
        effect._sized?.disconnect(effect._sizeId);
    effect._sized = actor;
    effect._sizeId = actor?.connect('notify::size', () => effect._sync()) ?? 0;
    effect._sync();
}

let RoundedCorners = null;
function roundedCorners(radius) {
    if (!RoundedCorners && Shell.GLSLEffect) {
        RoundedCorners = GObject.registerClass(
        class MKRoundedCornersGLSL extends Shell.GLSLEffect {
            _init(r) {
                this._radius = r;
                super._init();
            }

            vfunc_build_pipeline() {
                this.add_glsl_snippet((Shell.SnippetHook ?? Cogl.SnippetHook).FRAGMENT, CORNERS_DECLARATIONS, CORNERS_CODE, false);
            }

            vfunc_set_actor(actor) {
                super.vfunc_set_actor(actor);
                trackSize(this, actor);
            }

            _sync() {
                if (!this.actor)
                    return;
                this.set_uniform_float(this.get_uniform_location('mk_size'), 2, [this.actor.width, this.actor.height]);
                this.set_uniform_float(this.get_uniform_location('mk_radius'), 1, [this._radius]);
                this.queue_repaint();
            }
        });
    }
    RoundedCorners ??= GObject.registerClass(
    class MKRoundedCorners extends Clutter.ShaderEffect {
        _init(r) {
            this._radius = r;
            super._init();
        }

        vfunc_get_static_snippet() {
            return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, CORNERS_DECLARATIONS, CORNERS_CODE);
        }

        vfunc_set_actor(actor) {
            super.vfunc_set_actor(actor);
            trackSize(this, actor);
        }

        _sync() {
            if (!this.actor)
                return;
            this.set_uniform_float('mk_size', 2, [Math.max(1, this.actor.width), Math.max(1, this.actor.height)]);
            this.set_uniform_float('mk_radius', 1, [this._radius]);
            this.queue_repaint();
        }
    });
    return new RoundedCorners(radius);
}

function pauseForFullscreen() {
    for (const [actor, effects] of live) {
        let full = false;
        try {
            full = global.display.get_monitor_in_fullscreen(Main.layoutManager.findIndexForActor(actor));
        } catch {
            full = false;
        }
        for (const e of effects)
            e.enabled = !full;
    }
}

let fullscreenId = 0;

// Blur behind ACTOR (GLASS: sigma and brightness), cut to RADIUS px corners if
// given. Returns a function that takes it off again.
export function addGlass(actor, glass, radius = 0) {
    // (Clutter runs a later effect around an earlier one: the corners go on
    // first, so they cut the blurred picture, not only what's drawn over it)
    const effects = [];
    if (radius > 0) {
        try {
            const corners = roundedCorners(radius);
            actor.add_effect_with_name('mk-blur-corners', corners);
            effects.push(corners);
        } catch (e) {
            console.warn(`mk-shell-engine: rounded blur: ${e.message}`);    // square corners, still blurred
        }
    }
    const blur = new Shell.BlurEffect({radius: glass.sigma, brightness: glass.brightness, mode: Shell.BlurMode.BACKGROUND});
    actor.add_effect_with_name('mk-blur', blur);
    effects.push(blur);
    live.add([actor, effects]);
    fullscreenId ||= global.display.connect('in-fullscreen-changed', pauseForFullscreen);
    pauseForFullscreen();
    return () => {
        for (const entry of live) {
            if (entry[0] === actor)
                live.delete(entry);
        }
        for (const e of effects)
            actor.remove_effect(e);
        if (!live.size && fullscreenId) {
            global.display.disconnect(fullscreenId);
            fullscreenId = 0;
        }
    };
}

// Wallpaper glass, the way Blur my Shell blurs the top bar: a pane behind
// TARGET holding a blurred copy of the desktop background, lined up so the
// part showing is the part behind TARGET, cut to RADIUS px corners. Shell's
// BACKGROUND blur (addGlass above) reads the screen behind an actor, which
// on the top bar and dock left the wallpaper sharp under a tint; this blurs
// a copy of the wallpaper itself (ACTOR mode), which always works. It's exact
// wherever only the wallpaper is behind: the top bar, and the dock (which
// steps aside when a window would be behind it).
// The pane follows TARGET: position, size, opacity, sliding, hiding. It sits
// just below ANCHOR (TARGET's top-level actor in the shell's UI) and is gone
// while the screen shows a full-screen window. Returns a function that takes
// it away again.
// SOURCE: what's copied; the wallpaper by default, or a function that builds
// the copy (desktopCopy below, for glass that floats over windows).
export function addWallpaperGlass(target, anchor, glass, radius = 0, source = Main.layoutManager._backgroundGroup) {
    const layer = Main.layoutManager.uiGroup;
    const pane = new Clutter.Actor({clip_to_allocation: true, reactive: false, visible: false});
    const copy = typeof source === 'function' ? source() : new Clutter.Clone({source});
    copy.add_effect_with_name('mk-blur', new Shell.BlurEffect({
        mode: Shell.BlurMode.ACTOR, radius: glass.sigma, brightness: glass.brightness}));
    pane.add_child(copy);
    if (radius > 0) {
        try {
            pane.add_effect_with_name('mk-blur-corners', roundedCorners(radius));
        } catch (e) {
            console.warn(`mk-shell-engine: rounded glass: ${e.message}`);    // square corners, still blurred
        }
    }
    layer.insert_child_below(pane, anchor);

    // placed just before the next frame is drawn, once everything has its final place
    // (an allocation signal arrives while the parents are still being laid out)
    let later = 0;
    const queue = () => {
        if (later)
            return;
        later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            later = 0;
            sync();
            return GLib.SOURCE_REMOVE;
        });
    };
    const sync = () => {
        if (!target.get_stage() || !target.is_mapped() || target.width <= 0 ||
            global.display.get_monitor_in_fullscreen(Main.layoutManager.findIndexForActor(target))) {
            pane.hide();
            return;
        }
        const [x, y] = target.get_transformed_position();
        const [w, h] = target.get_transformed_size();
        if (![x, y, w, h].every(Number.isFinite)) {       // (not laid out yet: the next allocation brings it)
            pane.hide();
            return;
        }
        pane.set_position(Math.round(x), Math.round(y));
        pane.set_size(Math.round(w), Math.round(h));
        copy.set_position(-Math.round(x), -Math.round(y));
        pane.opacity = target.get_paint_opacity();
        pane.show();
    };
    // the target and everything above it: moving, sliding, fading, showing, hiding
    const ids = [];
    for (let a = target; a && a !== layer; a = a.get_parent()) {
        for (const signal of ['notify::allocation', 'notify::translation-x', 'notify::translation-y',
            'notify::opacity', 'notify::mapped', 'notify::visible'])
            ids.push([a, a.connect(signal, queue)]);
    }
    ids.push([global.display, global.display.connect('in-fullscreen-changed', queue)]);
    ids.push([Main.layoutManager, Main.layoutManager.connect('monitors-changed', queue)]);
    queue();
    return () => {
        if (later)
            global.compositor.get_laters().remove(later);
        for (const [object, id] of ids)
            object.disconnect(id);
        pane.destroy();
    };
}

// A live copy of the whole desktop as it is now: the wallpaper and every window
// showing on it, each in its place (GNOME's window group has no size of its
// own, so it can't be copied in one piece). For glass over windows.
export function desktopCopy() {
    const scene = new Clutter.Actor({width: global.stage.width, height: global.stage.height});
    scene.add_child(new Clutter.Clone({source: Main.layoutManager._backgroundGroup}));
    for (const actor of global.get_window_actors()) {
        const win = actor.meta_window;
        if (!actor.visible || !win || win.minimized || !win.showing_on_its_workspace())
            continue;
        scene.add_child(new Clutter.Clone({source: actor, x: actor.x, y: actor.y}));
    }
    return scene;
}

export const blurAllowed = settings => settings.get_boolean('blur') && !isActive(BLUR_MY_SHELL);

// The whole top bar's blur, on and off with the setting and with Blur my Shell
// (the islands top bar, panel.js, blurs each island itself instead).
export class Blur {
    constructor(settings) {
        this._settings = settings;
        this._off = null;
        this._unwatch = watch(() => this._sync());
        this._settingsId = settings.connect('changed::blur', () => this._sync());
        this._sync();
    }

    _sync() {
        const want = blurAllowed(this._settings);
        if (want && !this._off)
            this._off = addGlass(Main.panel, PANEL_GLASS);
        else if (!want && this._off)
            this._drop();
    }

    _drop() {
        this._off?.();
        this._off = null;
    }

    destroy() {
        this._unwatch();
        this._settings.disconnect(this._settingsId);
        this._drop();
    }
}
