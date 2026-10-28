"""Full-screen screensaver scenes, drawn with cairo: used by mk-screensaver
(when you step away from the computer) and by the focus timer.

  aurora   soft light drifting over a dark sky, rising sparks
  web      a brick-built masked hero in red and blue hangs upside down from a
           web line beside a skyscraper with a neon MK sign, over the city
           (two parallax layers); now and then lightning, and Stan Lee's
           silhouette in the clouds with his line
  knight   a brick-built caped knight stands on a stone gargoyle in the rain;
           the cape moves in the wind, a searchlight sweeps the clouds and
           lights him from behind, lightning
  matrix   a cyberpunk terminal: hexadecimal code rain in cyan and amber,
           with the time decoding itself in the middle

Each scene is a class with draw(cr, w, h, t) (t in seconds). Anything that
doesn't move (sky, skyline, moon) is drawn once into a cached surface, so a
frame only paints what changes. Full-screen players call burn_in_shift()
first: the whole picture wanders a few pixels over minutes, so nothing (the
clock, a skyline) sits on the same pixels for hours on an OLED screen.
"""
import math
import os
import random
import time

import cairo

SCENES = {}


def scene(name, label):
    def register(cls):
        cls.name, cls.label = name, label
        SCENES[name] = cls
        return cls
    return register


LAST_FILE = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"),
                         "mk-workstation", "scene-last")


def choose(name):
    """The scene name to show: NAME itself, or for random (shuffle) any scene
    but the one shown last time, remembered across runs and apps."""
    if name in SCENES:
        return name
    try:
        with open(LAST_FILE) as f:
            last = f.read().strip()
    except OSError:
        last = ""
    name = random.choice([n for n in SCENES if n != last] or list(SCENES))
    try:
        os.makedirs(os.path.dirname(LAST_FILE), exist_ok=True)
        with open(LAST_FILE, "w") as f:
            f.write(name + "\n")
    except OSError:
        pass
    return name


def pick(name):
    """A scene by name; random picks one of them (never the last one)."""
    return SCENES[choose(name)]()


class Scene:
    def __init__(self):
        self._cache = None
        self._size = None
        self._rand = random.Random(7)

    def background(self, w, h):
        """The still part, drawn once per size."""
        if self._size != (w, h):
            self._size = (w, h)
            self._cache = cairo.ImageSurface(cairo.FORMAT_RGB24, w, h)
            self.paint_background(cairo.Context(self._cache), w, h)
        return self._cache

    def paint_background(self, cr, w, h):
        cr.set_source_rgb(0, 0, 0)
        cr.paint()

    def draw(self, cr, w, h, t):
        cr.set_source_surface(self.background(w, h), 0, 0)
        cr.paint()


# ---------------------------------------------------------------- shared pieces

def burn_in_shift(cr, w, h, t, amplitude=6):
    """Move the whole scene up to AMPLITUDE pixels along a slow Lissajous path
    (periods of minutes: invisible as motion), slightly enlarged so the edges
    never show."""
    dx = amplitude * math.sin(2 * math.pi * t / 397)
    dy = amplitude * math.sin(2 * math.pi * t / 541 + 1.3)
    zoom = 1 + 2 * amplitude / max(1, min(w, h))
    cr.translate(w / 2 + dx, h / 2 + dy)
    cr.scale(zoom, zoom)
    cr.translate(-w / 2, -h / 2)


def sky(cr, w, h, top, bottom):
    grad = cairo.LinearGradient(0, 0, 0, h)
    grad.add_color_stop_rgb(0, *top)
    grad.add_color_stop_rgb(1, *bottom)
    cr.set_source(grad)
    cr.paint()


def moon(cr, x, y, r, glow=(0.85, 0.9, 1.0)):
    # The glow fades out along an ease-out curve, so it has no visible rim.
    halo = cairo.RadialGradient(x, y, r * 0.95, x, y, r * 4.0)
    for k in range(9):
        u = k / 8
        halo.add_color_stop_rgba(u, *glow, 0.26 * (1 - u) ** 2.4)
    cr.set_source(halo)
    cr.arc(x, y, r * 4.0, 0, 2 * math.pi)
    cr.fill()
    body = cairo.RadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
    body.add_color_stop_rgb(0, 1, 1, 0.97)
    body.add_color_stop_rgb(1, 0.82, 0.85, 0.9)
    cr.set_source(body)
    cr.arc(x, y, r, 0, 2 * math.pi)
    cr.fill()
    cr.set_source_rgba(0.6, 0.65, 0.72, 0.25)
    for dx, dy, cr_ in ((-0.3, -0.1, 0.18), (0.25, 0.3, 0.12), (0.1, -0.4, 0.09)):
        cr.arc(x + dx * r, y + dy * r, cr_ * r, 0, 2 * math.pi)
        cr.fill()


def skyline(rand, w, base, height, color, lit=None, count=None):
    """Buildings as (x, top, width) plus lit windows; drawn by draw_skyline."""
    out, x = [], -20
    while x < w + 20:
        bw = rand.uniform(40, 120)
        bh = rand.uniform(0.25, 1.0) * height
        out.append((x, base - bh, bw))
        x += bw + rand.uniform(-6, 8)
    return out


def draw_skyline(cr, rand, buildings, base, color, window=None, offset=0.0):
    cr.set_source_rgb(*color)
    for x, top, bw in buildings:
        cr.rectangle(x + offset, top, bw, base - top + 2)
        if rand.random() < 0.25:  # antenna
            cr.rectangle(x + offset + bw * 0.5, top - 18, 2, 18)
    cr.fill()
    if window:
        for x, top, bw in buildings:
            for wy in range(int(top) + 10, int(base) - 8, 16):
                for wx in range(int(x + 6), int(x + bw - 8), 12):
                    if rand.random() < 0.18:
                        cr.set_source_rgba(*window, rand.uniform(0.35, 0.9))
                        cr.rectangle(wx + offset, wy, 5, 7)
                        cr.fill()


SHOW_CAPTION = True  # off on the lock screen, which shows its own clock


def caption(cr, w, h, lines):
    """The time (or a countdown) in the corner, quiet."""
    if not SHOW_CAPTION:
        return
    cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    y = h - 70
    for i, (text, size, alpha) in enumerate(lines):
        cr.set_font_size(size)
        cr.set_source_rgba(1, 1, 1, alpha)
        cr.move_to(56, y)
        cr.show_text(text)
        y += size + 8
        cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)


# ---------------------------------------------------------------- aurora

@scene("aurora", "Aurora")
class Aurora(Scene):
    def __init__(self):
        super().__init__()
        self.sparks = [[random.random(), random.random(), random.uniform(0.6, 2.2),
                        random.uniform(0.004, 0.018), random.uniform(0, 6.28)] for _ in range(70)]
        self.last = None

    def paint_background(self, cr, w, h):
        cr.set_source_rgb(0.012, 0.025, 0.07)
        cr.paint()

    def draw(self, cr, w, h, t):
        dt = min(0.1, t - self.last) if self.last is not None else 0
        self.last = t
        # The light is soft anyway: draw it at a quarter of the size, scale up.
        q = 4
        small = cairo.ImageSurface(cairo.FORMAT_RGB24, w // q + 1, h // q + 1)
        sc = cairo.Context(small)
        sc.set_source_rgb(0.012, 0.025, 0.07)
        sc.paint()
        pools = (((0.0, 0.82, 1.0), 0.28, 0.32, 0.55), ((0.25, 0.35, 1.0), 0.72, 0.58, 0.60),
                 ((0.50, 0.30, 1.0), 0.48, 0.88, 0.45))
        for i, (col, sx, sy, r) in enumerate(pools):
            cx = w / q * (sx + 0.08 * math.sin(t * 0.07 + i * 2.1))
            cy = h / q * (sy + 0.06 * math.cos(t * 0.05 + i * 1.3))
            rad = max(w, h) / q * r
            glow = cairo.RadialGradient(cx, cy, 0, cx, cy, rad)
            glow.add_color_stop_rgba(0, *col, 0.18 + 0.05 * math.sin(t * 0.4 + i))
            glow.add_color_stop_rgba(1, *col, 0)
            sc.set_source(glow)
            sc.paint()
        cr.save()
        cr.scale(q, q)
        cr.set_source_surface(small, 0, 0)
        cr.get_source().set_filter(cairo.FILTER_BILINEAR)
        cr.paint()
        cr.restore()
        for p in self.sparks:
            p[1] -= p[3] * dt * 6
            if p[1] < -0.02:
                p[0], p[1] = random.random(), 1.02
            cr.set_source_rgba(0.8, 0.93, 1.0, 0.15 + 0.45 * abs(math.sin(t * 1.3 + p[4])))
            cr.arc(p[0] * w, p[1] * h, p[2], 0, 2 * math.pi)
            cr.fill()


# ---------------------------------------------------------------- web

@scene("web", "Web Hang")
class WebHang(Scene):
    """A masked hero hanging upside down from a web line over the city."""

    def __init__(self):
        super().__init__()
        self.layers = None

    def paint_background(self, cr, w, h):
        sky(cr, w, h, (0.03, 0.04, 0.12), (0.16, 0.08, 0.24))
        rand = random.Random(3)
        for _ in range(140):  # stars
            cr.set_source_rgba(1, 1, 1, rand.uniform(0.2, 0.8))
            cr.arc(rand.uniform(0, w), rand.uniform(0, h * 0.55), rand.uniform(0.4, 1.4), 0, 2 * math.pi)
            cr.fill()
        city_far(cr, w, h, h * 0.62, random.Random(9))
        tower(cr, w, h)
        self.layers = None

    def _city(self, w, h):
        if self.layers is None or self.layers[0] != (w, h):
            rand = random.Random(11)
            back = skyline(rand, w + 120, h, h * 0.42, None)
            front = skyline(rand, w + 160, h, h * 0.30, None)
            surfaces = []
            for buildings, color, window, pad in ((back, (0.10, 0.07, 0.20), (0.9, 0.75, 0.5), 120),
                                                  (front, (0.04, 0.03, 0.09), (1.0, 0.85, 0.55), 160)):
                surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w + pad, h)
                draw_skyline(cairo.Context(surf), random.Random(5), buildings, h, color, window)
                surfaces.append((surf, pad))
            self.layers = ((w, h), surfaces)
        return self.layers[1]

    def draw(self, cr, w, h, t):
        super().draw(cr, w, h, t)
        # parallax: the far city drifts less than the near one
        for (surf, pad), depth in zip(self._city(w, h), (0.35, 1.0)):
            cr.set_source_surface(surf, -pad / 2 + math.sin(t * 0.05) * pad / 2 * depth, 0)
            cr.paint()

        # The web hangs from the cornice of the rooftop at the top of the view.
        anchor_x, length = w * 0.40, h * 0.30
        ledge = h * 0.07
        swing = 0.10 * math.sin(t * 0.7) + 0.02 * math.sin(t * 1.9)
        end_x = anchor_x + math.sin(swing) * length
        end_y = math.cos(swing) * length
        # the web line, with a faint shimmer
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.set_source_rgba(0.95, 0.97, 1, 0.85)
        cr.set_line_width(2)
        end_y += ledge
        cr.move_to(anchor_x, ledge)
        cr.curve_to(anchor_x, ledge + length * 0.4, end_x, ledge + length * 0.6, end_x, end_y)
        cr.stroke()
        glint = (t * 0.25) % 1
        cr.set_source_rgba(1, 1, 1, 0.9 * math.sin(glint * math.pi))
        cr.arc(anchor_x + (end_x - anchor_x) * glint, ledge + (end_y - ledge) * glint, 2.5, 0, 2 * math.pi)
        cr.fill()
        cornice(cr, w, ledge, anchor_x)

        neon_sign(cr, w * 0.65, h * 0.37, h * 0.075, t)
        self._tribute(cr, w, h, t)

        cr.save()
        cr.translate(end_x, end_y)
        cr.rotate(-swing)
        self._hero(cr, min(w, h) / 1080 * 1.45, t)
        cr.restore()
        caption(cr, w, h, [(time.strftime("%H:%M"), 44, 0.85), (time.strftime("%A, %d %B"), 16, 0.5)])

    TRIBUTE_EVERY = 75  # seconds; the first one 20 s in

    def _tribute(self, cr, w, h, t):
        """Now and then lightning: a double flash, a bolt, and in the clouds a
        silhouette of Stan Lee (1922-2018) with his line, fading out."""
        if t < 20:
            return
        cycle, p = divmod(t - 20, self.TRIBUTE_EVERY)
        if p > 10:
            return
        flash = max(0.0, 1 - abs(p - 0.08) / 0.08) + 0.7 * max(0.0, 1 - abs(p - 0.32) / 0.1)
        if flash > 0:
            rand = random.Random(int(cycle))
            x, y = w * rand.uniform(0.08, 0.3), 0.0
            cr.move_to(x, y)
            while y < h * 0.45:
                x += rand.uniform(-40, 40)
                y += rand.uniform(30, 60)
                cr.line_to(x, y)
            cr.set_source_rgba(0.85, 0.9, 1, 0.9 * min(1, flash))
            cr.set_line_width(2.5)
            cr.stroke()
            cr.set_source_rgba(0.8, 0.85, 1, 0.3 * min(1, flash))
            cr.paint()
        # the face in the clouds: in over 1.5 s, held, out by 10 s
        a = min(1.0, max(0.0, (p - 0.3) / 1.5)) * min(1.0, max(0.0, (10 - p) / 2.5))
        if a <= 0:
            return
        r = h * 0.085
        stan_lee(cr, w * 0.17, h * 0.2, r, a)
        cr.select_font_face("Serif", cairo.FONT_SLANT_ITALIC, cairo.FONT_WEIGHT_NORMAL)
        cr.set_font_size(max(14, h * 0.022))
        cr.set_source_rgba(0.92, 0.94, 1, 0.85 * a)
        cr.move_to(w * 0.17 - r * 1.6, h * 0.2 + r * 1.75)
        cr.show_text("With great power comes great responsibility.")
        cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
        cr.set_font_size(max(11, h * 0.014))
        cr.set_source_rgba(0.85, 0.88, 0.95, 0.6 * a)
        cr.move_to(w * 0.17 - r * 1.6, h * 0.2 + r * 1.75 + max(22, h * 0.03))
        cr.show_text("Excelsior!  — Stan Lee, 1922–2018")

    def _hero(self, cr, s, t):
        """A plastic brick-style minifigure, upside down: feet at the origin (on
        the web), head towards the ground. Flat blocks with a soft plastic
        shine, the spider emblem on the chest."""
        red, blue = (0.84, 0.10, 0.12), (0.12, 0.26, 0.70)
        cr.scale(s * 1.3, s * 1.3)
        sway = 0.10 * math.sin(t * 1.4 + 0.6)

        def block(x, y, bw, bh, color, radius=4):
            plastic(cr, x, y, bw, bh, color, radius)

        # boots and legs (two blocks, the web wrapped round the boots)
        for side in (-1, 1):
            x = -30 if side < 0 else 2
            block(x, 0, 28, 14, red, 3)
            block(x, 13, 28, 66, blue, 3)
        cr.set_source_rgba(0.95, 0.97, 1, 0.9)  # web loops round the ankles
        cr.set_line_width(2)
        for k in range(3):
            cr.move_to(-32, 3 + k * 4)
            cr.line_to(32, 6 + k * 4)
        cr.stroke()
        block(-32, 78, 64, 16, blue, 3)  # hips
        # torso: wider at the waist (here, near the hips), narrower at the shoulders
        cr.save()
        cr.move_to(-40, 94)
        cr.line_to(40, 94)
        cr.line_to(31, 172)
        cr.line_to(-31, 172)
        cr.close_path()
        cr.clip()
        block(-40, 94, 80, 78, red, 0)
        cr.set_source_rgb(*blue)  # side panels
        for side in (-1, 1):
            cr.move_to(side * 40, 94)
            cr.line_to(side * 28, 94)
            cr.line_to(side * 22, 172)
            cr.line_to(side * 31, 172)
            cr.close_path()
            cr.fill()
        cr.set_source_rgba(0, 0, 0, 0.45)  # web pattern
        cr.set_line_width(1.1)
        for x in range(-30, 31, 12):
            cr.move_to(x * 0.9, 94)
            cr.line_to(x * 0.7, 172)
        for y in range(104, 172, 14):
            cr.move_to(-30, y)
            cr.curve_to(-10, y + 5, 10, y + 5, 30, y)
        cr.stroke()
        cr.restore()
        cr.save()  # the emblem, upside down with the figure
        cr.translate(0, 142)
        cr.rotate(math.pi)
        spider_emblem(cr, 0, 0, 13, (0.05, 0.05, 0.07))
        cr.restore()
        # arms hang towards the ground and sway, C-shaped hands
        for side, phase in ((-1, 0.0), (1, 1.3)):
            a = sway * side + 0.06 * math.sin(t * 1.4 + phase)
            cr.save()
            cr.translate(side * 33, 164)
            cr.rotate(-a - side * 0.25)
            block(-9, 0, 18, 46, red, 8)
            cr.translate(0, 50)
            cr.set_source_rgb(*red)  # hand: a C opening downwards
            cr.set_line_width(7)
            cr.arc(0, 4, 8, -0.35 * math.pi, 1.35 * math.pi)
            cr.stroke()
            cr.restore()
        block(-10, 172, 20, 8, red, 2)  # neck
        # head: a cylinder with a stud, mask and big white lenses
        cr.save()
        cr.translate(0, 180)
        cr.rotate(sway * 0.5)
        block(-27, 0, 54, 50, red, 12)
        block(-15, 49, 30, 10, red, 3)  # the stud on top (below, upside down)
        cr.set_source_rgba(0, 0, 0, 0.4)
        cr.set_line_width(1)
        for k in range(1, 4):
            cr.move_to(-27, k * 12)
            cr.curve_to(-9, k * 12 + 4, 9, k * 12 + 4, 27, k * 12)
        cr.move_to(0, 0)
        cr.line_to(0, 50)
        cr.stroke()
        for side in (-1, 1):  # lenses: upside down, so near the chin end
            cr.save()
            cr.translate(side * 11, 17)
            cr.rotate(side * 0.4)
            cr.scale(1, 0.7)
            cr.arc(0, 0, 9, 0, 2 * math.pi)
            cr.restore()
            cr.set_source_rgb(0.98, 0.99, 1)
            cr.fill_preserve()
            cr.set_source_rgb(0.05, 0.05, 0.07)
            cr.set_line_width(2.5)
            cr.stroke()
        cr.restore()


def neon_sign(cr, cx, cy, size, t):
    """"MK" in neon tubes on a dark board, with a glow; it flickers now and then."""
    tick = int(t * 12)
    flicker = 0.35 if (tick * 2654435761) % 97 < 3 else 1.0
    cr.save()
    cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    cr.set_font_size(size)
    ext = cr.text_extents("MK")
    bx, by = cx - ext.width / 2 - size * 0.3, cy - ext.height / 2 - size * 0.25
    bw, bh = ext.width + size * 0.6, ext.height + size * 0.5
    cr.set_source_rgba(0.03, 0.02, 0.06, 0.92)  # the board, and its two mounts
    cr.rectangle(bx, by, bw, bh)
    cr.fill()
    cr.rectangle(bx + bw * 0.2, by + bh, 3, size * 0.25)
    cr.rectangle(bx + bw * 0.8, by + bh, 3, size * 0.25)
    cr.fill()
    cr.move_to(cx - ext.width / 2 - ext.x_bearing, cy + ext.height / 2)
    cr.text_path("MK")
    path = cr.copy_path()
    cr.new_path()
    for width, alpha in ((size * 0.42, 0.06), (size * 0.24, 0.12), (size * 0.12, 0.25)):  # glow
        cr.append_path(path)
        cr.set_source_rgba(1.0, 0.18, 0.42, alpha * flicker)
        cr.set_line_width(width)
        cr.stroke()
    cr.append_path(path)
    cr.set_line_width(max(1.5, size * 0.045))
    cr.set_source_rgba(1.0, 0.55, 0.72, 0.95 * flicker)  # the tube
    cr.stroke_preserve()
    cr.set_line_width(max(0.8, size * 0.015))
    cr.set_source_rgba(1.0, 0.92, 0.96, flicker)  # its hot core
    cr.stroke()
    cr.restore()


def stan_lee(cr, x, y, r, alpha):
    """A stylized silhouette facing right, lit by the lightning: swept-back
    hair, the big tinted glasses, the moustache. R is the head's radius."""
    cr.save()
    cr.translate(x, y)
    pale = (0.80, 0.84, 0.95)
    cr.set_source_rgba(*pale, 0.38 * alpha)
    cr.save()  # head
    cr.scale(0.82, 1.0)
    cr.arc(0, 0, r, 0, 2 * math.pi)
    cr.restore()
    cr.fill()
    cr.move_to(-r * 0.85, -r * 0.15)  # hair, swept back in a wave
    cr.curve_to(-r * 0.95, -r * 1.25, r * 0.35, -r * 1.45, r * 0.85, -r * 0.62)
    cr.curve_to(r * 0.55, -r * 0.82, r * 0.05, -r * 0.78, -r * 0.2, -r * 0.55)
    cr.close_path()
    cr.set_source_rgba(*pale, 0.55 * alpha)
    cr.fill()
    cr.move_to(r * 0.72, -r * 0.12)  # nose
    cr.line_to(r * 1.0, r * 0.18)
    cr.line_to(r * 0.74, r * 0.24)
    cr.close_path()
    cr.set_source_rgba(*pale, 0.38 * alpha)
    cr.fill()
    cr.move_to(-r * 0.1, r * 0.75)  # neck and shoulders
    cr.line_to(r * 0.35, r * 0.75)
    cr.curve_to(r * 0.5, r * 1.2, r * 1.3, r * 1.25, r * 1.5, r * 1.6)
    cr.line_to(-r * 1.4, r * 1.6)
    cr.curve_to(-r * 1.1, r * 1.2, -r * 0.4, r * 1.2, -r * 0.1, r * 0.75)
    cr.close_path()
    cr.fill()
    for gx in (r * 0.05, r * 0.5):  # the glasses: two big dark lenses and a bridge
        cr.rectangle(gx - r * 0.2, -r * 0.18, r * 0.36, r * 0.3)
    cr.set_source_rgba(0.05, 0.06, 0.12, 0.8 * alpha)
    cr.fill()
    cr.move_to(r * 0.16, -r * 0.08)
    cr.line_to(r * 0.3, -r * 0.08)
    cr.move_to(-r * 0.15, -r * 0.1)
    cr.line_to(-r * 0.6, -r * 0.02)  # the arm to the ear
    cr.set_line_width(max(1.0, r * 0.04))
    cr.stroke()
    cr.set_source_rgba(1, 1, 1, 0.5 * alpha)  # a glint of lightning on a lens
    cr.rectangle(r * 0.38, -r * 0.15, r * 0.06, r * 0.1)
    cr.fill()
    cr.move_to(r * 0.38, r * 0.32)  # moustache
    cr.curve_to(r * 0.55, r * 0.24, r * 0.82, r * 0.28, r * 0.88, r * 0.38)
    cr.curve_to(r * 0.7, r * 0.42, r * 0.5, r * 0.42, r * 0.38, r * 0.32)
    cr.set_source_rgba(0.08, 0.09, 0.16, 0.75 * alpha)
    cr.fill()
    cr.restore()


def plastic(cr, x, y, w, h, color, radius=4):
    """A toy-brick block: flat colour, a soft shine down one side, a dark edge."""
    def path():
        r = min(radius, w / 2, h / 2)
        cr.new_sub_path()
        cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
        cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
        cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
        cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
        cr.close_path()
    path()
    cr.set_source_rgb(*color)
    cr.fill()
    shine = cairo.LinearGradient(x, 0, x + w, 0)
    shine.add_color_stop_rgba(0, 1, 1, 1, 0.0)
    shine.add_color_stop_rgba(0.22, 1, 1, 1, 0.28)
    shine.add_color_stop_rgba(0.45, 1, 1, 1, 0.0)
    shine.add_color_stop_rgba(1, 0, 0, 0, 0.22)
    path()
    cr.set_source(shine)
    cr.fill()
    path()
    cr.set_source_rgba(0, 0, 0, 0.35)
    cr.set_line_width(1)
    cr.stroke()


def spider_emblem(cr, x, y, size, color):
    """A spider: round body, small head, eight bent legs. Points up."""
    cr.save()
    cr.translate(x, y)
    cr.set_source_rgb(*color)
    cr.save()
    cr.scale(0.55, 1)
    cr.arc(0, size * 0.25, size * 0.6, 0, 2 * math.pi)
    cr.restore()
    cr.fill()
    cr.arc(0, -size * 0.5, size * 0.28, 0, 2 * math.pi)
    cr.fill()
    cr.set_line_width(max(1.0, size * 0.11))
    cr.set_line_cap(cairo.LINE_CAP_ROUND)
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    for side in (-1, 1):
        for k, (ky, kx, ty) in enumerate(((-0.2, 0.9, -1.2), (0.0, 1.1, -0.4), (0.2, 1.1, 0.6), (0.4, 0.9, 1.3))):
            cr.move_to(side * size * 0.2, size * ky)
            cr.line_to(side * size * kx, size * (ky - 0.35 if k < 2 else ky + 0.1))
            cr.line_to(side * size * (kx + 0.35), size * ty)
        cr.stroke()
    cr.restore()


def cornice(cr, w, bottom, anchor_x):
    """The high-rise's rooftop edge across the top of the view, seen from
    below: a stone cornice with dentils, the web tied round a flagpole bracket."""
    right = w * 0.58
    stone = cairo.LinearGradient(0, 0, 0, bottom)
    stone.add_color_stop_rgb(0, 0.10, 0.09, 0.14)
    stone.add_color_stop_rgb(1, 0.17, 0.15, 0.22)
    cr.set_source(stone)
    cr.move_to(0, 0)
    cr.line_to(right + bottom * 0.6, 0)
    cr.line_to(right, bottom)
    cr.line_to(0, bottom)
    cr.close_path()
    cr.fill()
    cr.set_source_rgba(0, 0, 0, 0.45)  # dentils under the cornice
    step = max(10, int(bottom * 0.35))
    for x in range(4, int(right) - step, step):
        cr.rectangle(x, bottom - bottom * 0.28, step * 0.55, bottom * 0.28)
    cr.fill()
    cr.set_source_rgba(0.6, 0.65, 0.9, 0.35)  # city glow catching its lower edge
    cr.rectangle(0, bottom - 2, right, 2)
    cr.fill()
    cr.set_source_rgb(0.22, 0.2, 0.26)  # the bracket the web is tied to
    cr.rectangle(anchor_x - 5, bottom - 4, 10, 10)
    cr.fill()


def tower(cr, w, h):
    """The skyscraper the hero hangs beside: setbacks, a spire, rows of lit
    windows, a cool rim light down one edge."""
    rand = random.Random(29)
    x, base = w * 0.55, h
    tiers = [(w * 0.20, h * 0.30), (w * 0.15, h * 0.16), (w * 0.10, h * 0.08)]  # width, top y
    body = cairo.LinearGradient(x, 0, x + tiers[0][0], 0)
    body.add_color_stop_rgb(0, 0.10, 0.10, 0.20)
    body.add_color_stop_rgb(0.7, 0.06, 0.06, 0.13)
    body.add_color_stop_rgb(1, 0.04, 0.04, 0.09)
    for i, (tw, top) in enumerate(tiers):
        tx = x + (tiers[0][0] - tw) / 2
        bottom = base if i == 0 else tiers[i - 1][1]
        cr.set_source(body)
        cr.rectangle(tx, top, tw, bottom - top)
        cr.fill()
        cr.set_source_rgba(0.55, 0.65, 0.95, 0.35)  # rim light
        cr.rectangle(tx, top, 2, bottom - top)
        cr.fill()
        for wy in range(int(top) + 14, int(bottom) - 10, 18):  # window rows
            for wx in range(int(tx + 8), int(tx + tw - 10), 14):
                if rand.random() < 0.32:
                    warm = rand.random() < 0.8
                    cr.set_source_rgba(*((1.0, 0.85, 0.55) if warm else (0.6, 0.85, 1.0)), rand.uniform(0.35, 0.85))
                    cr.rectangle(wx, wy, 7, 9)
                    cr.fill()
    sx = x + tiers[0][0] / 2
    cr.set_source_rgb(0.08, 0.08, 0.16)  # spire
    cr.move_to(sx - 10, tiers[2][1])
    cr.line_to(sx, tiers[2][1] - h * 0.07)
    cr.line_to(sx + 10, tiers[2][1])
    cr.close_path()
    cr.fill()
    beacon = cairo.RadialGradient(sx, tiers[2][1] - h * 0.07, 0, sx, tiers[2][1] - h * 0.07, 18)
    beacon.add_color_stop_rgba(0, 1, 0.25, 0.25, 0.9)
    beacon.add_color_stop_rgba(1, 1, 0.25, 0.25, 0)
    cr.set_source(beacon)
    cr.arc(sx, tiers[2][1] - h * 0.07, 18, 0, 2 * math.pi)
    cr.fill()


# ---------------------------------------------------------------- knight

@scene("knight", "Night Watch")
class NightWatch(Scene):
    """A brick-built caped knight on a gargoyle, rain, lightning, a searchlight."""

    def __init__(self):
        super().__init__()
        r = random.Random(17)
        self.drops = [[r.random(), r.random(), r.uniform(0.6, 1.0)] for _ in range(360)]
        self.flash_at = time.monotonic() + 6
        self.flash = 0.0
        self.last = None
        self.bats = []

    def paint_background(self, cr, w, h):
        sky(cr, w, h, (0.02, 0.03, 0.06), (0.08, 0.10, 0.16))
        moon(cr, w * 0.22, h * 0.22, min(w, h) * 0.09, glow=(0.9, 0.9, 0.8))
        dither(cr, w, h)  # breaks up the banding in the dark moon glow
        rand = random.Random(23)
        buildings = skyline(rand, w, h, h * 0.45, None)
        draw_skyline(cr, random.Random(4), buildings, h, (0.03, 0.035, 0.05), (0.95, 0.8, 0.45))

    def draw(self, cr, w, h, t):
        super().draw(cr, w, h, t)
        dt = min(0.1, t - self.last) if self.last is not None else 0
        self.last = t
        # clouds drifting across the moon: one soft sprite, painted five times
        sprite = self._cloud()
        for i in range(5):
            x = ((t * (8 + i * 3) + i * 400) % (w + 600)) - 300
            y = h * (0.12 + 0.07 * i)
            cr.set_source_surface(sprite, x - sprite.get_width() / 2, y - sprite.get_height() / 2)
            cr.paint()
        # searchlight sweeping the clouds, from a projector on the roof
        sc = min(w, h) / 1080 * 1.6
        roof_y = h * 0.42 + 120 * sc
        bx, by = w * 0.60 + (w - w * 0.60) * 0.42, roof_y - 34 * sc
        ang = -math.pi / 2 - 0.25 + 0.30 * math.sin(t * 0.18)
        tip_x, tip_y = bx + math.cos(ang) * h * 1.1, by + math.sin(ang) * h * 1.1
        beam = cairo.LinearGradient(bx, by, tip_x, tip_y)
        beam.add_color_stop_rgba(0, 1, 0.95, 0.75, 0.22)
        beam.add_color_stop_rgba(1, 1, 0.95, 0.75, 0.02)
        cr.set_source(beam)
        spread = 0.06
        cr.move_to(bx - 8, by)
        cr.line_to(bx + math.cos(ang - spread) * h * 1.1, by + math.sin(ang - spread) * h * 1.1)
        cr.line_to(bx + math.cos(ang + spread) * h * 1.1, by + math.sin(ang + spread) * h * 1.1)
        cr.line_to(bx + 8, by)
        cr.close_path()
        cr.fill()
        projector(cr, bx, by, sc, ang)
        # Where the beam meets the clouds: a glowing oval with the MK monogram.
        sx, sy = tip_x, tip_y + h * 0.28
        signal(cr, sx, sy, min(w, h) * 0.11, ang)
        # bats now and then
        if not self.bats or (len(self.bats) < 4 and random.random() < dt * 0.15):
            self.bats.append([-0.05, random.uniform(0.1, 0.45), random.uniform(0.06, 0.12), random.uniform(0, 6)])
        cr.set_source_rgb(0.01, 0.01, 0.02)
        for bat in self.bats:
            bat[0] += bat[2] * dt
            x, y = bat[0] * w, bat[1] * h + math.sin(t * 2 + bat[3]) * 20
            flap = math.sin(t * 14 + bat[3]) * 7
            cr.move_to(x, y)
            cr.curve_to(x - 8, y - 6 - flap, x - 16, y - flap, x - 22, y + 2 - flap)
            cr.curve_to(x - 14, y + 2, x - 8, y + 4, x, y + 3)
            cr.curve_to(x + 8, y + 4, x + 14, y + 2, x + 22, y + 2 - flap)
            cr.curve_to(x + 16, y - flap, x + 8, y - 6 - flap, x, y)
            cr.fill()
        self.bats = [b for b in self.bats if b[0] < 1.1]
        self._ledge(cr, w, h, t)
        # rain
        cr.set_source_rgba(0.7, 0.75, 0.85, 0.35)
        cr.set_line_width(1.1)
        for d in self.drops:
            d[1] += d[2] * dt * 1.4
            if d[1] > 1.02:
                d[0], d[1] = random.random(), -0.02
            x, y = d[0] * w, d[1] * h
            cr.move_to(x, y)
            cr.line_to(x - 6, y + 22 * d[2])
        cr.stroke()
        # lightning
        if time.monotonic() > self.flash_at:
            self.flash = 1.0
            self.flash_at = time.monotonic() + random.uniform(9, 20)
        if self.flash > 0:
            cr.set_source_rgba(0.85, 0.9, 1, 0.35 * self.flash * (0.6 + 0.4 * math.sin(t * 60)))
            cr.paint()
            self.flash = max(0, self.flash - dt * 2.2)
        caption(cr, w, h, [(time.strftime("%H:%M"), 44, 0.85), (time.strftime("%A, %d %B"), 16, 0.5)])

    def _cloud(self):
        """A soft elliptical cloud. The gradient is made inside the squashed
        space, so it fades to nothing at every edge: built outside it, it was
        still a circle and the ellipse cut it off in hard bands."""
        if getattr(self, "_cloud_sprite", None) is None:
            rx, ry = 468, 117
            self._cloud_sprite = cairo.ImageSurface(cairo.FORMAT_ARGB32, rx * 2, ry * 2)
            c = cairo.Context(self._cloud_sprite)
            c.translate(rx, ry)
            c.scale(rx / 260, ry / 260)
            soft = cairo.RadialGradient(0, 0, 0, 0, 0, 260)
            for k in range(9):  # ease-out, like the moon's glow: no visible rim
                u = k / 8
                soft.add_color_stop_rgba(u, 0.16, 0.18, 0.24, 0.55 * (1 - u) ** 1.8)
            c.set_source(soft)
            c.paint()
            c.identity_matrix()
            c.set_operator(cairo.OPERATOR_ATOP)  # grain only where there's cloud
            dither(c, rx * 2, ry * 2)
        return self._cloud_sprite

    def _ledge(self, cr, w, h, t):
        s = min(w, h) / 1080 * 1.6
        x0, y0 = w * 0.60, h * 0.42
        stone = (0.10, 0.105, 0.125)
        cr.set_source_rgb(*stone)
        cr.rectangle(x0 - 40 * s, y0 + 120 * s, w - x0 + 60 * s, h - y0)  # the building edge
        cr.fill()
        cr.set_source_rgba(0.75, 0.78, 0.85, 0.35)  # moonlight catching the edge
        cr.rectangle(x0 - 40 * s, y0 + 120 * s, w - x0 + 60 * s, 3 * s)
        cr.fill()
        rooftop(cr, x0 - 40 * s, y0 + 120 * s, w, h, s, t)
        cr.set_source_rgb(*stone)
        # gargoyle: a crouched beast's head and wings jutting out from the ledge
        cr.move_to(x0 - 10 * s, y0 + 120 * s)
        cr.curve_to(x0 - 70 * s, y0 + 110 * s, x0 - 130 * s, y0 + 90 * s, x0 - 150 * s, y0 + 70 * s)
        cr.line_to(x0 - 175 * s, y0 + 78 * s)
        cr.line_to(x0 - 160 * s, y0 + 92 * s)
        cr.curve_to(x0 - 120 * s, y0 + 130 * s, x0 - 60 * s, y0 + 150 * s, x0, y0 + 160 * s)
        cr.close_path()
        cr.fill()
        cr.move_to(x0 - 90 * s, y0 + 100 * s)
        cr.line_to(x0 - 70 * s, y0 + 40 * s)
        cr.line_to(x0 - 40 * s, y0 + 105 * s)
        cr.fill()
        cr.set_source_rgba(0.75, 0.78, 0.85, 0.30)  # rim light on the gargoyle's back
        cr.set_line_width(2 * s)
        cr.move_to(x0 - 10 * s, y0 + 120 * s)
        cr.curve_to(x0 - 70 * s, y0 + 110 * s, x0 - 130 * s, y0 + 90 * s, x0 - 150 * s, y0 + 70 * s)
        cr.stroke()
        self._minifig(cr, x0 + 40 * s, y0 + 120 * s, s * 1.05, t)

    def _minifig(self, cr, fx, fy, s, t):
        # A contact shadow under the boots and cape: he stands on the roof.
        shade = cairo.RadialGradient(fx, fy + 2 * s, 0, fx, fy + 2 * s, 60 * s)
        shade.add_color_stop_rgba(0, 0, 0, 0, 0.55)
        shade.add_color_stop_rgba(1, 0, 0, 0, 0)
        cr.save()
        cr.translate(fx, fy + 2 * s)
        cr.scale(1, 0.18)
        cr.translate(-fx, -(fy + 2 * s))
        cr.set_source(shade)
        cr.arc(fx, fy + 2 * s, 60 * s, 0, 2 * math.pi)
        cr.fill()
        cr.restore()
        """A brick-built caped knight standing on the ledge (feet at fx, fy):
        plastic blocks, a cowl with ears, a cape that ripples in the wind, a
        yellow belt and chest emblem, rim-lit by the searchlight."""
        dark, grey, gold = (0.10, 0.10, 0.12), (0.22, 0.23, 0.27), (0.98, 0.78, 0.15)
        cr.save()
        cr.translate(fx, fy)
        cr.scale(s, s)
        breathe = math.sin(t * 1.6) * 1.2
        cr.translate(0, -breathe * 0.3)
        # cape behind: cloth simulated as a rippling curtain, wind from the left
        wind = math.sin(t * 1.3) * 0.5 + math.sin(t * 3.1) * 0.2
        cr.set_source_rgb(0.05, 0.05, 0.07)
        cr.move_to(-30, -150)
        cr.line_to(30, -150)
        edge = []
        for k in range(9):
            u = k / 8
            edge.append((30 + 70 * u + wind * 40 * u + math.sin(t * 4 + u * 6) * 8 * u,
                         -150 + 150 * u + math.sin(t * 3 + u * 5) * 6 * u))
        for px, py in edge:
            cr.line_to(px, py)
        cr.line_to(-40 - wind * 10, 0)
        cr.close_path()
        cr.fill()
        for side in (-1, 1):  # legs and boots
            x = -28 if side < 0 else 2
            plastic(cr, x, -66, 26, 58, grey, 3)
            plastic(cr, x, -12, 26, 12, dark, 3)
        plastic(cr, -30, -80, 60, 16, dark, 3)  # hips
        plastic(cr, -30, -86, 60, 8, gold, 2)  # utility belt
        cr.save()  # torso, wider at the waist
        cr.move_to(-36, -86)
        cr.line_to(36, -86)
        cr.line_to(28, -150)
        cr.line_to(-28, -150)
        cr.close_path()
        cr.clip()
        plastic(cr, -36, -150, 72, 64, grey, 0)
        cr.restore()
        cr.set_source_rgb(*gold)  # chest emblem: a yellow oval with a dark winged shape
        cr.save()
        cr.translate(0, -122)
        cr.scale(1.6, 1)
        cr.arc(0, 0, 10, 0, 2 * math.pi)
        cr.restore()
        cr.fill()
        cr.set_source_rgb(*dark)
        cr.move_to(-13, -124)
        cr.curve_to(-8, -130, -4, -126, 0, -130)
        cr.curve_to(4, -126, 8, -130, 13, -124)
        cr.curve_to(6, -122, 3, -116, 0, -118)
        cr.curve_to(-3, -116, -6, -122, -13, -124)
        cr.fill()
        for side, phase in ((-1, 0.0), (1, 1.1)):  # arms, one resting, one on the hip
            cr.save()
            cr.translate(side * 31, -146)
            cr.rotate(side * (0.18 + 0.04 * math.sin(t * 1.6 + phase)))
            plastic(cr, -8, 0, 16, 44, grey, 7)
            cr.set_source_rgb(*dark)
            cr.set_line_width(6)
            cr.arc(0, 52, 7, -0.3 * math.pi, 1.3 * math.pi)
            cr.stroke()
            cr.restore()
        plastic(cr, -9, -158, 18, 8, dark, 2)  # neck
        # head and cowl with pointed ears
        plastic(cr, -24, -204, 48, 46, dark, 10)
        cr.set_source_rgb(*dark)
        for side in (-1, 1):
            cr.move_to(side * 10, -202)
            cr.line_to(side * 18, -228)
            cr.line_to(side * 23, -200)
            cr.close_path()
            cr.fill()
        cr.set_source_rgb(0.93, 0.80, 0.62)  # the jaw the cowl leaves open
        cr.rectangle(-16, -176, 32, 14)
        cr.fill()
        cr.set_source_rgba(0.98, 0.99, 1, 0.95)  # white eye slits
        for side in (-1, 1):
            cr.rectangle(side * 11 - 5, -190, 10, 3.5)
        cr.fill()
        # rim light: the searchlight behind catches his right-hand edges
        cr.set_source_rgba(1, 0.95, 0.75, 0.55)
        cr.set_line_width(2)
        for x1, y1, x2, y2 in ((28, -66, 28, -2), (36, -86, 28, -150), (24, -200, 24, -162), (23, -200, 18, -228)):
            cr.move_to(x1, y1)
            cr.line_to(x2, y2)
        cr.stroke()
        cr.restore()


_DITHER = None


def dither(cr, w, h):
    """Fine noise over the sky, so slow dark gradients don't show bands."""
    global _DITHER
    if _DITHER is None:
        rand = random.Random(1)
        tile = cairo.ImageSurface(cairo.FORMAT_ARGB32, 128, 128)
        data = tile.get_data()
        for i in range(0, len(data), 4):
            v = rand.randrange(0, 7)  # premultiplied white, alpha 0-6
            data[i:i + 4] = bytes((v, v, v, v))
        tile.mark_dirty()
        _DITHER = cairo.SurfacePattern(tile)
        _DITHER.set_extend(cairo.EXTEND_REPEAT)
    cr.set_source(_DITHER)
    cr.paint()


def projector(cr, x, y, s, angle):
    """The searchlight on the roof: a drum on a stand, aimed along ANGLE."""
    cr.save()
    cr.set_source_rgb(0.09, 0.09, 0.11)
    cr.move_to(x - 16 * s, y + 34 * s)
    cr.line_to(x - 4 * s, y + 6 * s)
    cr.line_to(x + 4 * s, y + 6 * s)
    cr.line_to(x + 16 * s, y + 34 * s)
    cr.close_path()
    cr.fill()
    cr.translate(x, y)
    cr.rotate(angle + math.pi / 2)
    cr.rectangle(-14 * s, -10 * s, 28 * s, 26 * s)
    cr.fill()
    lens = cairo.RadialGradient(0, -10 * s, 0, 0, -10 * s, 14 * s)
    lens.add_color_stop_rgba(0, 1, 0.97, 0.85, 1)
    lens.add_color_stop_rgba(1, 1, 0.9, 0.6, 0.2)
    cr.set_source(lens)
    cr.save()
    cr.scale(1, 0.35)
    cr.arc(0, -10 * s / 0.35, 14 * s, 0, 2 * math.pi)
    cr.restore()
    cr.fill()
    cr.restore()


def signal(cr, x, y, r, angle):
    """A searchlight's oval on the clouds, with an MK monogram in it."""
    cr.save()
    cr.translate(x, y)
    cr.rotate((angle + math.pi / 2) * 0.35)  # the oval leans with the beam
    cr.scale(1.45, 1)
    glow = cairo.RadialGradient(0, 0, r * 0.2, 0, 0, r * 1.6)
    glow.add_color_stop_rgba(0, 1, 0.95, 0.75, 0.42)
    glow.add_color_stop_rgba(0.55, 1, 0.95, 0.75, 0.22)
    glow.add_color_stop_rgba(1, 1, 0.95, 0.75, 0)
    cr.set_source(glow)
    cr.arc(0, 0, r * 1.6, 0, 2 * math.pi)
    cr.fill()
    cr.set_source_rgba(1, 0.96, 0.8, 0.30)
    cr.arc(0, 0, r, 0, 2 * math.pi)
    cr.fill()
    cr.restore()
    # The monogram: dark letters, as if cut out of the light.
    cr.save()
    cr.translate(x, y)
    cr.rotate((angle + math.pi / 2) * 0.35)
    cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    cr.set_font_size(r * 0.9)
    ext = cr.text_extents("MK")
    cr.move_to(-ext.width / 2 - ext.x_bearing, ext.height / 2)
    cr.set_source_rgba(0.04, 0.05, 0.08, 0.75)
    cr.show_text("MK")
    cr.restore()


def rooftop(cr, left, top, w, h, s, t):
    """Details on the knight's roof: brick courses, a water tower, vents and a
    blinking aircraft light, with rain splashes on the ledge."""
    rand = random.Random(41)
    cr.set_source_rgba(0, 0, 0, 0.25)  # brick courses
    cr.set_line_width(1)
    for k, y in enumerate(range(int(top + 26 * s), int(h), int(18 * s))):
        cr.move_to(left, y)
        cr.line_to(w, y)
        for x in range(int(left + (k % 2) * 22 * s), int(w), int(44 * s)):
            cr.move_to(x, y)
            cr.line_to(x, y + 18 * s)
    cr.stroke()
    # water tower on legs
    tx, tb = left + (w - left) * 0.62, top
    cr.set_source_rgb(0.07, 0.07, 0.09)
    for dx in (-30, 30):
        cr.rectangle(tx + dx * s - 2 * s, tb - 60 * s, 4 * s, 60 * s)
    cr.rectangle(tx - 46 * s, tb - 150 * s, 92 * s, 90 * s)
    cr.fill()
    cr.move_to(tx - 52 * s, tb - 150 * s)
    cr.line_to(tx, tb - 190 * s)
    cr.line_to(tx + 52 * s, tb - 150 * s)
    cr.close_path()
    cr.fill()
    cr.set_source_rgba(0.75, 0.78, 0.85, 0.18)  # moonlight on its staves
    for k in range(5):
        cr.rectangle(tx - 40 * s + k * 18 * s, tb - 148 * s, 1.5 * s, 86 * s)
    cr.fill()
    # vents and a chimney
    cr.set_source_rgb(0.08, 0.08, 0.1)
    for vx, vw, vh in ((0.86, 26, 34), (0.92, 18, 54), (0.40, 30, 22)):
        x = left + (w - left) * vx
        cr.rectangle(x, top - vh * s, vw * s, vh * s)
    cr.fill()
    # a red aircraft light on the antenna, blinking
    ax = left + (w - left) * 0.92 + 9 * s
    cr.set_source_rgb(0.08, 0.08, 0.1)
    cr.rectangle(ax - 1.5 * s, top - 140 * s, 3 * s, 86 * s)
    cr.fill()
    on = (t % 2.2) < 0.25
    light = cairo.RadialGradient(ax, top - 142 * s, 0, ax, top - 142 * s, 16 * s)
    light.add_color_stop_rgba(0, 1, 0.2, 0.15, 0.95 if on else 0.25)
    light.add_color_stop_rgba(1, 1, 0.2, 0.15, 0)
    cr.set_source(light)
    cr.arc(ax, top - 142 * s, 16 * s, 0, 2 * math.pi)
    cr.fill()
    # rain splashing on the ledge
    cr.set_source_rgba(0.75, 0.8, 0.9, 0.5)
    cr.set_line_width(1)
    for k in range(14):
        phase = (t * 3 + k * 0.37) % 1
        x = left + (w - left) * rand.random()
        rr = 2 + 6 * phase
        cr.save()
        cr.translate(x, top + 2)
        cr.scale(1, 0.35)
        cr.arc(0, 0, rr * s, math.pi, 2 * math.pi)
        cr.restore()
        cr.stroke()


def city_far(cr, w, h, horizon, rand):
    """The far city: a band of tiny lights fading into haze toward the horizon."""
    haze = cairo.LinearGradient(0, horizon - h * 0.12, 0, h)
    haze.add_color_stop_rgba(0, 0.30, 0.20, 0.45, 0)
    haze.add_color_stop_rgba(0.35, 0.30, 0.20, 0.45, 0.35)
    haze.add_color_stop_rgba(1, 0.10, 0.06, 0.18, 0.6)
    cr.set_source(haze)
    cr.rectangle(0, horizon - h * 0.12, w, h)
    cr.fill()
    for _ in range(int(w * 0.9)):
        y = horizon + (h - horizon) * rand.random() ** 1.8
        depth = (y - horizon) / max(1, h - horizon)
        cr.set_source_rgba(1, 0.82 if rand.random() < 0.8 else 0.95, 0.55, 0.25 + 0.5 * depth)
        size = 0.6 + 1.6 * depth
        cr.rectangle(rand.uniform(0, w), y, size, size)
        cr.fill()


# ---------------------------------------------------------------- matrix

@scene("matrix", "Terminal Stream")
class NeonCascade(Scene):
    """A cyberpunk terminal: hexadecimal rain in cyan and amber, glowing
    heads, faint scanlines; the time decodes itself in the middle."""
    KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ"
    ASCII = "0123456789ABCDEF<>/{}[]=+*$#@%&"
    SIZE = 20

    @staticmethod
    def _font():
        """Japanese half-width katakana if a font has them, else plain ASCII."""
        import subprocess
        try:
            found = subprocess.run(["fc-list", ":lang=ja", "family"], capture_output=True, text=True,
                                   timeout=3).stdout
        except (OSError, subprocess.SubprocessError):
            found = ""
        return ("Noto Sans Mono CJK JP", NeonCascade.KANA + NeonCascade.ASCII) \
            if "Noto Sans Mono CJK JP" in found else ("Monospace", NeonCascade.ASCII)

    def __init__(self):
        super().__init__()
        self.trail = None
        self.columns = []
        self.last = None
        self.decoded = ""
        self.decode_at = 0.0
        self.family, self.GLYPHS = "Monospace", "0123456789ABCDEF"
        self.scan = None

    def draw(self, cr, w, h, t):
        dt = min(0.1, t - self.last) if self.last is not None else 0
        self.last = t
        if self.trail is None or self.trail.get_width() != w or self.trail.get_height() != h:
            # Trails come from fading the previous frame, so each frame only
            # draws the leading glyph of each column.
            self.trail = cairo.ImageSurface(cairo.FORMAT_RGB24, w, h)
            self.columns = [[random.uniform(-h, 0), random.uniform(140, 420)] for _ in range(w // self.SIZE + 1)]
        tc = cairo.Context(self.trail)
        tc.set_source_rgba(0, 0, 0, min(1, dt * 1.6))
        tc.paint()
        tc.select_font_face(self.family, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        tc.set_font_size(self.SIZE)
        for i, col in enumerate(self.columns):
            before = int(col[0] // self.SIZE)
            col[0] += col[1] * dt
            after = int(col[0] // self.SIZE)
            for row in range(before + 1, after + 1):
                y = row * self.SIZE
                if y < 0:
                    continue
                if i % 5 == 2:
                    tc.set_source_rgb(1.0, 0.68, 0.18)   # amber
                else:
                    tc.set_source_rgb(0.12, 0.82, 1.0)   # cyan
                tc.move_to(i * self.SIZE, y)
                tc.show_text(random.choice(self.GLYPHS))
            if col[0] > h + random.uniform(0, h):
                col[0], col[1] = random.uniform(-200, 0), random.uniform(140, 420)
        cr.set_source_surface(self.trail, 0, 0)
        cr.paint()
        # bright heads with a soft glow
        cr.select_font_face(self.family, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        cr.set_font_size(self.SIZE)
        for i, col in enumerate(self.columns):
            if col[0] > 0:
                x, y = i * self.SIZE, int(col[0] // self.SIZE) * self.SIZE
                amber = i % 5 == 2
                glow = cairo.RadialGradient(x + 6, y - 7, 0, x + 6, y - 7, 18)
                glow.add_color_stop_rgba(0, *((1.0, 0.7, 0.2) if amber else (0.2, 0.85, 1.0)), 0.35)
                glow.add_color_stop_rgba(1, 0, 0, 0, 0)
                cr.set_source(glow)
                cr.arc(x + 6, y - 7, 18, 0, 2 * math.pi)
                cr.fill()
                cr.set_source_rgb(*((1.0, 0.92, 0.75) if amber else (0.85, 0.98, 1.0)))
                cr.move_to(x, y)
                cr.show_text(random.choice(self.GLYPHS))
        # faint scanlines, drawn once per size
        if self.scan is None or self.scan.get_width() != w or self.scan.get_height() != h:
            self.scan = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
            sc = cairo.Context(self.scan)
            sc.set_source_rgba(0, 0, 0, 0.18)
            for yy in range(0, h, 3):
                sc.rectangle(0, yy, w, 1)
            sc.fill()
        cr.set_source_surface(self.scan, 0, 0)
        cr.paint()
        # the time, decoding: random glyphs settle into the real characters
        target = time.strftime("%H:%M")
        if target != self.decoded:
            self.decoded, self.decode_at = target, t
        progress = min(1, (t - self.decode_at) / 1.6)
        shown = "".join(ch if k < progress * len(target) * 1.2 or ch == ":" else random.choice(self.ASCII[:10])
                        for k, ch in enumerate(target))
        cr.select_font_face("Monospace", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        cr.set_font_size(min(w, h) * 0.16)
        ext = cr.text_extents(shown)
        x, y = (w - ext.width) / 2 - ext.x_bearing, h / 2 + ext.height / 2
        cr.set_source_rgba(0, 0, 0, 0.55)
        cr.rectangle(x - 40, y - ext.height - 30, ext.width + 80, ext.height + 60)
        cr.fill()
        cr.set_source_rgba(0.2, 0.85, 1.0, 0.25)  # glow behind the digits
        for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
            cr.move_to(x + dx, y + dy)
            cr.show_text(shown)
        cr.set_source_rgb(0.8, 0.97, 1.0)
        cr.move_to(x, y)
        cr.show_text(shown)
        cr.set_font_size(18)
        sub = time.strftime("%A, %d %B")
        ext2 = cr.text_extents(sub)
        cr.set_source_rgba(1.0, 0.72, 0.25, 0.75)
        cr.move_to((w - ext2.width) / 2, y + 44)
        cr.show_text(sub)
