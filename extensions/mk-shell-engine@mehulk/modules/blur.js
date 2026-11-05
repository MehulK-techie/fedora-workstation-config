// MK Shell Engine: native blur. Mutter's own GPU blur (Shell.BlurEffect, the
// one GNOME uses behind the overview) behind the top bar and the dock, with
// rounded corners where the glass is rounded. Every blur pauses while the
// monitor it's on shows a full-screen window (a game, a film), so it costs the
// GPU nothing then. Stands aside while Blur my Shell is on.
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BLUR_MY_SHELL, isActive, watch } from './conflicts.js';

export const PANEL_GLASS = {sigma: 32, brightness: 0.62};
export const DOCK_GLASS = {sigma: 32, brightness: 0.62};

const live = new Set();        // every blur effect made here: [actor, effects]

// Cuts the blurred picture to a rounded rectangle (Shell.BlurEffect has no corners of its own).
const RoundedCorners = GObject.registerClass(
class MKRoundedCorners extends Shell.GLSLEffect {
    _init(radius) {
        super._init();
        this._radius = radius;
    }

    vfunc_build_pipeline() {
        const hook = (Shell.SnippetHook ?? Cogl.SnippetHook).FRAGMENT;
        this.add_glsl_snippet(hook, 'uniform vec2 mk_size; uniform float mk_radius;', `
            vec2 p = cogl_tex_coord_in[0].xy * mk_size;
            vec2 q = abs(p - mk_size * 0.5) - (mk_size * 0.5 - mk_radius);
            float d = length(max(q, 0.0)) - mk_radius;
            cogl_color_out *= clamp(0.5 - d, 0.0, 1.0);`, false);
    }

    vfunc_set_actor(actor) {
        this._sizeId && this.actor?.disconnect(this._sizeId);
        super.vfunc_set_actor(actor);
        this._sizeId = actor?.connect('notify::size', () => this._sync()) ?? 0;
        this._sync();
    }

    _sync() {
        if (!this.actor)
            return;
        this.set_uniform_float(this.get_uniform_location('mk_size'), 2, [this.actor.width, this.actor.height]);
        this.set_uniform_float(this.get_uniform_location('mk_radius'), 1, [this._radius]);
        this.queue_repaint();
    }
});

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
            const corners = new RoundedCorners(radius);
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
