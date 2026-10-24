"""Full-screen screensaver scenes, drawn with cairo: used by mk-screensaver
(when you step away from the computer) and by the focus timer.

  aurora   soft light drifting over a dark sky, rising sparks
  web      a masked hero in red and blue hangs upside down from a web line,
           swinging gently over a moonlit city (two parallax layers)
  knight   a caped figure crouches on a stone gargoyle in the rain; the cape
           moves in the wind, a searchlight sweeps the clouds, lightning
  matrix   neon code rain, with the time decoding itself in the middle

Each scene is a class with draw(cr, w, h, t) (t in seconds). Anything that
doesn't move (sky, skyline, moon) is drawn once into a cached surface, so a
frame only paints what changes.
"""
import math
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


def pick(name):
    """A scene by name; random picks one of them."""
    if name not in SCENES:
        name = random.choice(list(SCENES))
    return SCENES[name]()


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
        moon(cr, w * 0.78, h * 0.2, min(w, h) * 0.08)
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
        """Upside down: feet at the origin (on the web), head towards the ground."""
        red, blue, dark = (0.80, 0.08, 0.12), (0.10, 0.22, 0.62), (0.05, 0.05, 0.08)
        cr.scale(s, s)
        sway = 0.08 * math.sin(t * 1.4 + 0.6)

        def limb(x1, y1, x2, y2, width, color):
            cr.set_source_rgb(*color)
            cr.set_line_width(width)
            cr.move_to(x1, y1)
            cr.line_to(x2, y2)
            cr.stroke()

        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        # legs: one wrapped around the line, one bent
        limb(-6, 0, -10, 70, 26, blue)
        limb(-10, 70, -14, 130, 30, blue)
        limb(10, 18, 34, 70, 26, blue)
        limb(34, 70, 14, 130, 30, blue)
        limb(-6, -2, -8, 18, 24, red)     # boots
        limb(10, 16, 18, 34, 24, red)
        # torso
        cr.set_source_rgb(*red)
        cr.move_to(-30, 128)
        cr.curve_to(-38, 170, -36, 220, -26, 250)
        cr.line_to(26, 250)
        cr.curve_to(36, 220, 38, 170, 30, 128)
        cr.close_path()
        cr.fill()
        cr.set_source_rgb(*blue)  # side panels
        for side in (-1, 1):
            cr.move_to(side * 30, 128)
            cr.curve_to(side * 38, 170, side * 36, 215, side * 28, 240)
            cr.line_to(side * 22, 236)
            cr.curve_to(side * 26, 200, side * 26, 160, side * 22, 130)
            cr.close_path()
            cr.fill()
        # suit lines
        cr.set_source_rgba(*dark, 0.55)
        cr.set_line_width(1.4)
        for y in range(140, 250, 18):
            cr.move_to(-24, y)
            cr.curve_to(-8, y + 6, 8, y + 6, 24, y)
        cr.move_to(0, 130)
        cr.line_to(0, 250)
        cr.stroke()
        # arms hanging down, swaying a little
        for side, phase in ((-1, 0), (1, 1.2)):
            a = sway * (1 if side < 0 else -1) + 0.05 * math.sin(t * 1.4 + phase)
            sx, sy = side * 30, 240
            ex = sx + side * 14 + math.sin(a) * 90
            ey = sy + math.cos(a) * 90
            limb(sx, sy, ex, ey, 20, red)
            limb(ex, ey, ex + math.sin(a) * 50, ey + math.cos(a) * 50, 18, red)
            cr.set_source_rgb(*red)
            cr.arc(ex + math.sin(a) * 58, ey + math.cos(a) * 58, 11, 0, 2 * math.pi)
            cr.fill()
        # head, mask and eye lenses (upside down: eyes below the forehead)
        cr.save()
        cr.translate(0, 290)
        cr.rotate(sway * 0.6)
        cr.set_source_rgb(*red)
        cr.save()
        cr.scale(1, 1.22)
        cr.arc(0, 0, 34, 0, 2 * math.pi)
        cr.restore()
        cr.fill()
        cr.set_source_rgba(*dark, 0.5)
        cr.set_line_width(1.2)
        for k in range(8):  # mask seams radiating from the face's centre
            ang = k * math.pi / 4
            cr.move_to(0, 6)
            cr.line_to(math.cos(ang) * 34, 6 + math.sin(ang) * 40)
        for rr in (14, 26):
            cr.arc(0, 6, rr, 0, 2 * math.pi)
        cr.stroke()
        for side in (-1, 1):  # lenses: white, outlined, angled
            cr.save()
            cr.translate(side * 13, 12)
            cr.rotate(side * -0.45)
            cr.scale(1, 0.62)
            cr.arc(0, 0, 11, 0, 2 * math.pi)
            cr.restore()
            cr.set_source_rgb(0.97, 0.98, 1)
            cr.fill_preserve()
            cr.set_source_rgb(*dark)
            cr.set_line_width(3)
            cr.stroke()
        cr.restore()


# ---------------------------------------------------------------- knight

@scene("knight", "Night Watch")
class NightWatch(Scene):
    """A caped figure on a gargoyle, rain, lightning and a searchlight."""

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
        # the figure: crouched, cowl with pointed ears, cape in the wind
        fx, fy = x0 + 40 * s, y0 + 120 * s
        black = (0.0, 0.0, 0.01)
        cr.set_source_rgb(*black)
        wind = math.sin(t * 1.3) * 0.5 + math.sin(t * 3.1) * 0.2
        cape = [(fx + 30 * s, fy - 170 * s)]
        for k in range(1, 9):  # trailing edge, rippling
            u = k / 8
            cape.append((fx + (30 - 220 * u) * s, fy - (170 - 175 * u) * s
                         + math.sin(t * 4 + u * 6) * 16 * u * s + wind * 30 * u * s))
        cr.move_to(fx + 40 * s, fy - 175 * s)
        for px, py in cape:
            cr.line_to(px, py)
        cr.line_to(fx - 20 * s, fy)
        cr.line_to(fx + 60 * s, fy)
        cr.close_path()
        cr.fill()
        # body crouch
        cr.move_to(fx - 10 * s, fy)
        cr.curve_to(fx - 5 * s, fy - 90 * s, fx + 20 * s, fy - 150 * s, fx + 45 * s, fy - 165 * s)
        cr.curve_to(fx + 70 * s, fy - 150 * s, fx + 80 * s, fy - 80 * s, fx + 70 * s, fy)
        cr.close_path()
        cr.fill()
        # head and ears
        hx, hy = fx + 52 * s, fy - 188 * s
        cr.arc(hx, hy, 22 * s, 0, 2 * math.pi)
        cr.fill()
        for side in (-1, 1):
            cr.move_to(hx + side * 8 * s, hy - 14 * s)
            cr.line_to(hx + side * 16 * s, hy - 42 * s)
            cr.line_to(hx + side * 20 * s, hy - 10 * s)
            cr.fill()
        # eyes catching the light
        cr.set_source_rgba(0.95, 0.97, 1, 0.9)
        for side in (-1, 1):
            cr.rectangle(hx + side * 9 * s - 3 * s, hy - 3 * s, 6 * s, 2.2 * s)
        cr.fill()


# ---------------------------------------------------------------- matrix

@scene("matrix", "Neon Cascade")
class NeonCascade(Scene):
    """Falling glowing glyphs; the time decodes itself in the middle."""
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
        self.family, self.GLYPHS = self._font()

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
                tc.set_source_rgb(0.1, 0.95, 0.75 if i % 3 else 0.95)
                tc.move_to(i * self.SIZE, y)
                tc.show_text(random.choice(self.GLYPHS))
            if col[0] > h + random.uniform(0, h):
                col[0], col[1] = random.uniform(-200, 0), random.uniform(140, 420)
        cr.set_source_surface(self.trail, 0, 0)
        cr.paint()
        # bright heads
        cr.select_font_face(self.family, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        cr.set_font_size(self.SIZE)
        cr.set_source_rgb(0.85, 1, 0.97)
        for i, col in enumerate(self.columns):
            if col[0] > 0:
                cr.move_to(i * self.SIZE, int(col[0] // self.SIZE) * self.SIZE)
                cr.show_text(random.choice(self.GLYPHS))
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
        cr.set_source_rgb(0.75, 1, 0.92)
        cr.move_to(x, y)
        cr.show_text(shown)
        cr.set_font_size(18)
        sub = time.strftime("%A, %d %B")
        ext2 = cr.text_extents(sub)
        cr.set_source_rgba(0.6, 1, 0.9, 0.6)
        cr.move_to((w - ext2.width) / 2, y + 44)
        cr.show_text(sub)
