// MK Shell Engine: the wallpaper carousel (Super+W), like Alt+Tab for wallpapers.
//
// A frosted glass strip of your pictures (Pictures/Wallpapers, the pictures directly in Pictures,
// MK's own), the current one picked. The picked card sits in the middle at 1.08x with an accent edge,
// its name and four colours from it underneath; the others at 0.88x. Moving glides the strip
// (220 ms, EASE_OUT_CUBIC):
//   W again while Super is held, Right / Tab, the wheel down: next     Left / Shift+W, wheel up: back
//   let go of Super, or Enter, or click a card: that one (the contour-trace transition)
//   Esc, or a click outside: nothing changes
// Opened with Super already let go (a quick tap), it stays until Enter, a click or Esc.
// The thumbnails and colours come from `mk-wallpaper list --json` (cached: instant after the first).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { accentRGB } from './colour.js';

const HELPER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-wallpaper']);
const CARD_W = 240, CARD_H = 150, GAP = 22;
const PICKED = 1.08, OTHER = 0.88, GLIDE = 220;
const SUPER_KEYS = [Clutter.KEY_Super_L, Clutter.KEY_Super_R, Clutter.KEY_Meta_L, Clutter.KEY_Meta_R];

export class WallpaperCarousel {
    constructor(onPick) {
        this._onPick = onPick;
    }

    get shown() {
        return Boolean(this._actor);
    }

    open() {
        if (this._actor || this._loading)
            return;
        // Super held as it opened? Then letting go of it picks (as Alt+Tab)
        const [, , mods] = global.get_pointer();
        this._held = Boolean(mods & Clutter.ModifierType.MOD4_MASK);
        this._loading = true;
        this._cancel = new Gio.Cancellable();
        let proc;
        try {
            proc = Gio.Subprocess.new([HELPER, 'list', '--json'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            this._loading = false;
            Main.panel._mkIsland?.show({icon: 'preferences-desktop-wallpaper-symbolic', text: 'mk-wallpaper is missing: run mk sync'});
            return;
        }
        proc.communicate_utf8_async(null, this._cancel, (p, res) => {
            this._loading = false;
            let items = [];
            try {
                items = JSON.parse(p.communicate_utf8_finish(res)[1]);
            } catch {}
            if (this._cancel?.is_cancelled())
                return;
            if (!items.length) {
                Main.panel._mkIsland?.show({icon: 'preferences-desktop-wallpaper-symbolic', text: 'No pictures: add some to Pictures/Wallpapers'});
                return;
            }
            // (Super let go while it loaded: a tap after all)
            const [, , now] = global.get_pointer();
            if (this._held && !(now & Clutter.ModifierType.MOD4_MASK))
                this._held = false;
            try {
                this._build(items);
            } catch (e) {
                console.warn(`mk-shell-engine: wallpaper carousel: ${e.message}`);
                this.close();
            }
        });
    }

    _build(items) {
        this._items = items;
        const current = items.findIndex(i => i.current);
        this._index = current >= 0 ? (current + 1) % items.length : 0;   // (the next one, ready)
        const m = Main.layoutManager.primaryMonitor;
        const [r, g, b] = accentRGB() ?? [120, 170, 255];
        this._accent = `${r},${g},${b}`;

        // the backdrop takes the clicks outside the panel (they close it)
        this._actor = new St.Widget({reactive: true, x: m.x, y: m.y, width: m.width, height: m.height,
            style: 'background-color: rgba(0,0,0,0.28);', opacity: 0});
        this._actor.connect('button-press-event', (_a, event) => {
            if (event.get_source() === this._actor)
                this.close();
            return Clutter.EVENT_STOP;
        });
        const width = Math.min(m.width - 120, CARD_W * 5 + GAP * 6);
        this._panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mk-wall-carousel',
            reactive: true, width});
        this._panel.set_position(Math.round((m.width - width) / 2), Math.round(m.height * 0.32));
        this._viewport = new St.Widget({clip_to_allocation: true, height: Math.round(CARD_H * PICKED) + 28, x_expand: true});
        this._strip = new St.Widget({y: 14});
        this._viewport.add_child(this._strip);
        this._cards = items.map((item, i) => {
            const card = new St.Button({style_class: 'mk-wall-card', reactive: true, can_focus: false,
                width: CARD_W, height: CARD_H, x: GAP + i * (CARD_W + GAP),
                style: `background-image: url("${Gio.File.new_for_path(item.thumb).get_uri()}"); background-size: cover;`});
            card.set_pivot_point(0.5, 0.5);
            card.connect('clicked', () => {
                this._select(i);
                this._pick();
            });
            this._strip.add_child(card);
            return card;
        });
        this._panel.add_child(this._viewport);
        this._title = new St.Label({style_class: 'mk-wall-title', x_align: Clutter.ActorAlign.CENTER});
        this._dots = new St.BoxLayout({style_class: 'mk-wall-dots', x_align: Clutter.ActorAlign.CENTER});
        this._panel.add_child(this._title);
        this._panel.add_child(this._dots);
        this._panel.add_child(new St.Label({style_class: 'mk-wall-hint', x_align: Clutter.ActorAlign.CENTER,
            text: this._held ? 'W or ← →  ·  let go of Super to set it  ·  Esc' : '← →  ·  Enter to set it  ·  Esc'}));
        this._actor.add_child(this._panel);
        Main.layoutManager.addTopChrome(this._actor);
        this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
        this._actor.connect('key-press-event', (_a, e) => this._key(e));
        this._actor.connect('key-release-event', (_a, e) => this._release(e));
        this._actor.connect('scroll-event', (_a, e) => this._scroll(e));
        this._actor.grab_key_focus();
        this._select(this._index, false);
        this._actor.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._panel.set_pivot_point(0.5, 0.5);
        this._panel.set_scale(0.96, 0.96);
        this._panel.ease({scale_x: 1, scale_y: 1, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    _select(i, animate = true) {
        const n = this._cards.length;
        this._index = ((i % n) + n) % n;
        const viewW = this._panel.width;
        const target = Math.round(viewW / 2 - (GAP + this._index * (CARD_W + GAP) + CARD_W / 2));
        const duration = animate ? GLIDE : 0;
        this._strip.ease({x: target, duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._cards.forEach((card, k) => {
            const picked = k === this._index;
            card.ease({scale_x: picked ? PICKED : OTHER, scale_y: picked ? PICKED : OTHER,
                opacity: picked ? 255 : Math.max(110, 230 - Math.abs(k - this._index) * 45),
                duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            card.style = card.style.replace(/border:[^;]*;|box-shadow:[^;]*;/g, '') +
                (picked ? `border: 2px solid rgba(${this._accent},0.95); box-shadow: 0 0 22px 2px rgba(${this._accent},0.45);` : '');
        });
        const item = this._items[this._index];
        this._title.text = item.name;
        this._dots.destroy_all_children();
        for (const colour of item.palette ?? [])
            this._dots.add_child(new St.Widget({style_class: 'mk-wall-dot', style: `background-color: ${colour};`}));
    }

    _key(event) {
        const key = event.get_key_symbol(), shift = event.get_state() & Clutter.ModifierType.SHIFT_MASK;
        if (key === Clutter.KEY_Escape)
            this.close();
        else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space)
            this._pick();
        else if (key === Clutter.KEY_Right || key === Clutter.KEY_Tab || ((key === Clutter.KEY_w || key === Clutter.KEY_W) && !shift))
            this._select(this._index + 1);
        else if (key === Clutter.KEY_Left || key === Clutter.KEY_ISO_Left_Tab || ((key === Clutter.KEY_w || key === Clutter.KEY_W) && shift))
            this._select(this._index - 1);
        return Clutter.EVENT_STOP;
    }

    _release(event) {
        if (this._held && SUPER_KEYS.includes(event.get_key_symbol()))
            this._pick();
        return Clutter.EVENT_STOP;
    }

    _scroll(event) {
        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
            this._select(this._index + 1);
        else if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
            this._select(this._index - 1);
        return Clutter.EVENT_STOP;
    }

    _pick() {
        const item = this._items?.[this._index];
        this.close();
        if (item && !item.current)
            this._onPick(item.path);
    }

    close() {
        this._cancel?.cancel();
        this._loading = false;
        if (!this._actor)
            return;
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
        const actor = this._actor;
        this._actor = this._panel = this._strip = this._cards = this._items = null;
        actor.ease({opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                Main.layoutManager.removeChrome(actor);
                actor.destroy();
            }});
    }

    destroy() {
        if (this._actor) {
            this._actor.remove_all_transitions();
            const actor = this._actor;
            this.close();
            actor.remove_all_transitions();
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._cancel?.cancel();
    }
}
