"""Full-screen screensaver scenes, drawn with cairo: used by mk-screensaver
(when you step away from the computer) and by the focus timer.

  aurora   soft light drifting over a dark sky, rising sparks
  web      a brick-built masked hero in red and blue hangs upside down from a
           web line beside a skyscraper, over the city (two parallax layers)
  knight   a brick-built caped knight stands on a stone gargoyle in the rain;
           the cape moves in the wind, a searchlight sweeps the clouds and
           lights him from behind, lightning
  matrix   a cyberpunk terminal: hexadecimal code rain in cyan and amber,
           with the time decoding itself in the middle

Each scene is a class with draw(cr, w, h, t) (t in seconds). Anything that
doesn't move (sky, skyline, moon) is drawn once into a cached surface, so a
frame only paints what changes.
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

def sky(cr, w, h, top, bottom):
    grad = cairo.LinearGradient(0, 0, 0, h)
    grad.add_color_stop_rgb(0, *top)
    grad.add_color_stop_rgb(1, *bottom)
    cr.set_source(grad)
    cr.paint()


def moon(cr, x, y, r, glow=(0.85, 0.9, 1.0)):
    halo = cairo.RadialGradient(x, y, r * 0.9, x, y, r * 3.2)
    halo.add_color_stop_rgba(0, *glow, 0.30)
    halo.add_color_stop_rgba(1, *glow, 0)
    cr.set_source(halo)
    cr.arc(x, y, r * 3.2, 0, 2 * math.pi)
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


def caption(cr, w, h, lines):
    """The time (or a countdown) in the corner, quiet."""
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

        anchor_x, length = w * 0.40, h * 0.30
        swing = 0.10 * math.sin(t * 0.7) + 0.02 * math.sin(t * 1.9)
        end_x = anchor_x + math.sin(swing) * length
        end_y = math.cos(swing) * length
        # the web line, with a faint shimmer
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.set_source_rgba(0.95, 0.97, 1, 0.85)
        cr.set_line_width(2)
        cr.move_to(anchor_x, -5)
        cr.curve_to(anchor_x, length * 0.4, end_x, length * 0.6, end_x, end_y)
        cr.stroke()
        glint = (t * 0.25) % 1
        cr.set_source_rgba(1, 1, 1, 0.9 * math.sin(glint * math.pi))
        cr.arc(anchor_x + (end_x - anchor_x) * glint, end_y * glint, 2.5, 0, 2 * math.pi)
        cr.fill()

        cr.save()
        cr.translate(end_x, end_y)
        cr.rotate(-swing)
        self._hero(cr, min(w, h) / 1080 * 1.45, t)
        cr.restore()
        caption(cr, w, h, [(time.strftime("%H:%M"), 44, 0.85), (time.strftime("%A, %d %B"), 16, 0.5)])

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
        rand = random.Random(23)
        buildings = skyline(rand, w, h, h * 0.45, None)
        draw_skyline(cr, random.Random(4), buildings, h, (0.03, 0.035, 0.05), (0.95, 0.8, 0.45))

    def draw(self, cr, w, h, t):
        super().draw(cr, w, h, t)
        dt = min(0.1, t - self.last) if self.last is not None else 0
        self.last = t
        # clouds drifting across the moon
        for i in range(5):
            x = ((t * (8 + i * 3) + i * 400) % (w + 600)) - 300
            y = h * (0.12 + 0.07 * i)
            cloud = cairo.RadialGradient(x, y, 10, x, y, 260)
            cloud.add_color_stop_rgba(0, 0.16, 0.18, 0.24, 0.55)
            cloud.add_color_stop_rgba(1, 0.16, 0.18, 0.24, 0)
            cr.set_source(cloud)
            cr.save()
            cr.translate(x, y)
            cr.scale(1.8, 0.45)
            cr.arc(0, 0, 260, 0, 2 * math.pi)
            cr.restore()
            cr.fill()
        # searchlight sweeping the clouds
        ang = -math.pi / 2 + 0.45 * math.sin(t * 0.18)
        bx, by = w * 0.62, h
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
        spot = cairo.RadialGradient(tip_x, tip_y + h * 0.28, 0, tip_x, tip_y + h * 0.28, 120)
        spot.add_color_stop_rgba(0, 1, 0.95, 0.75, 0.30)
        spot.add_color_stop_rgba(1, 1, 0.95, 0.75, 0)
        cr.set_source(spot)
        cr.arc(tip_x, tip_y + h * 0.28, 120, 0, 2 * math.pi)
        cr.fill()
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
