#!/usr/bin/env python3
"""MK's own six wallpapers (assets/wallpapers), drawn from code so they're reproducible and MK's own
(MIT): dark, layered, with crisp shapes for the contour-trace transition to find. 1920x1080 JPEG.

  python3 scripts/make-wallpapers.py [OUT_DIR]     (default: assets/wallpapers)

  sable-desert-monolith.jpg    warm canyon rings around a black monolith and its long shadow, ink lines
  cyberpunk-rain-grid.jpg      an indigo synth grid to a cyan/magenta skyline, bokeh and rain
  kyoto-misty-peaks.jpg        ink-wash ridges in mist under a crimson sun, starlight grain
  gargantua-accretion-halo.jpg a black hole's lensed accretion ring, amber, brighter on its near side
  nordic-fjord-aurora.jpg      faceted ridges over a fjord under emerald and violet aurora curtains
  bauhaus-obsidian-topo.jpg    dense two-tone elevation contours on obsidian, with grid ticks
"""
import math
import random
import sys
from pathlib import Path

import cairo
import cv2
import numpy as np

W, H = 1920, 1080


def canvas():
    s = cairo.ImageSurface(cairo.FORMAT_RGB24, W, H)
    return s, cairo.Context(s)


def save(surface, path, grain=1.6):
    a = np.ndarray((H, W, 4), np.uint8, surface.get_data())[:, :, :3].astype(np.float32)
    a += np.random.default_rng(len(path.name)).normal(0, grain, a.shape[:2])[..., None]
    cv2.imwrite(str(path), np.clip(a, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])


def vgrad(cr, stops, y0=0, y1=H):
    g = cairo.LinearGradient(0, y0, 0, y1)
    for off, rgb in stops:
        g.add_color_stop_rgb(off, *rgb)
    cr.set_source(g)
    cr.rectangle(0, y0, W, y1 - y0)
    cr.fill()


def glow(cr, x, y, r, rgb, alpha):
    g = cairo.RadialGradient(x, y, 0, x, y, r)
    g.add_color_stop_rgba(0, *rgb, alpha)
    g.add_color_stop_rgba(1, *rgb, 0)
    cr.set_source(g)
    cr.arc(x, y, r, 0, 2 * math.pi)
    cr.fill()


def stars(cr, n, ymax, seed, tint=(1, 1, 1)):
    rnd = random.Random(seed)
    for _ in range(n):
        cr.set_source_rgba(*tint, rnd.uniform(0.15, 0.75))
        cr.arc(rnd.uniform(0, W), rnd.uniform(0, ymax), rnd.uniform(0.5, 1.5), 0, 2 * math.pi)
        cr.fill()


def ridge(rnd, base, amp, step, jag):
    pts, x = [], -40
    while x <= W + 80:
        pts.append((x, base - amp * (0.5 + 0.5 * math.sin(x / 210 + rnd.uniform(0, 0.4))) + rnd.uniform(-jag, jag)))
        x += rnd.uniform(step * 0.6, step * 1.4)
    return pts


def fill_ridge(cr, pts, rgb, alpha=1.0):
    cr.move_to(-40, H + 10)
    for x, y in pts:
        cr.line_to(x, y)
    cr.line_to(W + 80, H + 10)
    cr.close_path()
    cr.set_source_rgba(*rgb, alpha)
    cr.fill()


# 1. Sable Desert Monolith
def desert(path):
    s, cr = canvas()
    vgrad(cr, [(0, (0.07, 0.04, 0.06)), (0.45, (0.42, 0.18, 0.10)), (0.62, (0.72, 0.38, 0.18)), (1, (0.20, 0.08, 0.04))])
    glow(cr, W * 0.70, H * 0.47, 360, (1.0, 0.70, 0.40), 0.55)
    cr.set_source_rgba(1.0, 0.86, 0.62, 0.95)
    cr.arc(W * 0.70, H * 0.47, 46, 0, 2 * math.pi)
    cr.fill()
    cx, cy = W * 0.5, H * 0.80
    for i in range(14, 0, -1):                         # the canyon's terraces, isometric rings
        rx, ry = 120 + i * 78, 34 + i * 21
        t = i / 14
        cr.save()
        cr.translate(cx, cy + i * 6)
        cr.scale(rx, ry)
        cr.arc(0, 0, 1, 0, 2 * math.pi)
        cr.restore()
        cr.set_source_rgb(0.45 - t * 0.28, 0.20 - t * 0.13, 0.10 - t * 0.07)
        cr.fill_preserve()
        cr.set_source_rgba(0.08, 0.03, 0.02, 0.85)
        cr.set_line_width(1.6)
        cr.stroke()
    # the monolith's long shadow, then the monolith
    cr.set_source_rgba(0.03, 0.01, 0.01, 0.75)
    cr.move_to(cx - 26, cy + 20)
    cr.line_to(cx + 26, cy + 20)
    cr.line_to(cx - 520, cy + 120)
    cr.line_to(cx - 560, cy + 110)
    cr.close_path()
    cr.fill()
    cr.set_source_rgb(0.02, 0.015, 0.02)
    cr.rectangle(cx - 26, cy - 330, 52, 350)
    cr.fill()
    cr.set_source_rgba(1, 0.72, 0.45, 0.6)              # its lit edge
    cr.set_line_width(2)
    cr.move_to(cx + 26, cy - 330)
    cr.line_to(cx + 26, cy + 20)
    cr.stroke()
    save(s, path)


# 2. Cyberpunk Rain Grid
def cyber(path):
    s, cr = canvas()
    hy = H * 0.58
    vgrad(cr, [(0, (0.03, 0.02, 0.10)), (0.58, (0.20, 0.05, 0.32)), (1, (0.02, 0.01, 0.06))])
    glow(cr, W / 2, hy - 120, 300, (1.0, 0.25, 0.65), 0.55)
    cr.save()                                          # the striped sun, cut by the horizon
    cr.rectangle(0, 0, W, hy)
    cr.clip()
    g = cairo.LinearGradient(0, hy - 360, 0, hy)
    g.add_color_stop_rgb(0, 1.0, 0.85, 0.30)
    g.add_color_stop_rgb(1, 1.0, 0.20, 0.55)
    cr.set_source(g)
    cr.arc(W / 2, hy - 110, 230, 0, 2 * math.pi)
    cr.fill()
    cr.set_source_rgb(0.13, 0.04, 0.24)
    for k in range(7):
        cr.rectangle(W / 2 - 240, hy - 160 + k * 22, 480, 3 + k * 1.6)
        cr.fill()
    cr.restore()
    rnd = random.Random(21)
    x = 0                                              # the skyline, lit windows
    while x < W:
        w, h = rnd.uniform(40, 120), rnd.uniform(60, 300)
        if abs(x + w / 2 - W / 2) < 260:
            h *= 0.4
        cr.set_source_rgb(0.04, 0.02, 0.09)
        cr.rectangle(x, hy - h, w, h)
        cr.fill()
        for wy in range(int(hy - h + 10), int(hy - 6), 14):
            for wx in range(int(x + 6), int(x + w - 6), 12):
                if rnd.random() < 0.18:
                    cr.set_source_rgba(*(rnd.choice([(0.3, 0.95, 1.0), (1.0, 0.35, 0.8)])), rnd.uniform(0.5, 0.95))
                    cr.rectangle(wx, wy, 5, 6)
                    cr.fill()
        x += w + rnd.uniform(2, 14)
    vgrad(cr, [(0, (0.10, 0.02, 0.18)), (1, (0.01, 0.0, 0.03))], hy, H)
    cr.set_line_width(1.6)                             # the perspective grid
    for i in range(-30, 31):
        cr.set_source_rgba(1.0, 0.25, 0.75, 0.55)
        cr.move_to(W / 2 + i * 22, hy)
        cr.line_to(W / 2 + i * 260, H)
        cr.stroke()
    y, step = hy, 6
    while y < H:
        cr.set_source_rgba(0.35, 0.9, 1.0, 0.25 + 0.5 * (y - hy) / (H - hy))
        cr.move_to(0, y)
        cr.line_to(W, y)
        cr.stroke()
        step *= 1.25
        y += step
    for _ in range(36):                                # bokeh
        glow(cr, rnd.uniform(0, W), rnd.uniform(hy + 30, H), rnd.uniform(10, 34),
             rnd.choice([(0.3, 0.95, 1.0), (1.0, 0.35, 0.8)]), rnd.uniform(0.15, 0.35))
    cr.set_line_width(1)                               # rain
    for _ in range(420):
        x0, y0 = rnd.uniform(0, W), rnd.uniform(0, H)
        cr.set_source_rgba(0.7, 0.85, 1.0, rnd.uniform(0.05, 0.18))
        cr.move_to(x0, y0)
        cr.line_to(x0 - 6, y0 + rnd.uniform(18, 40))
        cr.stroke()
    save(s, path)


# 3. Kyoto Misty Peaks
def kyoto(path):
    s, cr = canvas()
    vgrad(cr, [(0, (0.05, 0.05, 0.08)), (0.6, (0.16, 0.13, 0.15)), (1, (0.06, 0.05, 0.07))])
    stars(cr, 220, H * 0.45, 3, (1, 0.95, 0.9))
    glow(cr, W * 0.66, H * 0.34, 280, (0.85, 0.15, 0.12), 0.35)
    cr.set_source_rgb(0.80, 0.14, 0.11)
    cr.arc(W * 0.66, H * 0.34, 110, 0, 2 * math.pi)
    cr.fill()
    rnd = random.Random(8)
    for layer in range(7):
        t = layer / 6
        pts = ridge(rnd, H * (0.46 + layer * 0.075), 210 - layer * 20, 70, 10 + layer * 2)
        fill_ridge(cr, pts, (0.22 - t * 0.19, 0.22 - t * 0.19, 0.30 - t * 0.25))
        mist = cairo.LinearGradient(0, H * (0.46 + layer * 0.075) - 40, 0, H * (0.46 + layer * 0.075) + 90)
        mist.add_color_stop_rgba(0, 0.85, 0.82, 0.86, 0)
        mist.add_color_stop_rgba(1, 0.85, 0.82, 0.86, 0.10)
        cr.set_source(mist)
        cr.rectangle(0, H * (0.46 + layer * 0.075) - 40, W, 130)
        cr.fill()
    save(s, path, grain=2.4)


# 4. Gargantua Accretion Halo
def gargantua(path):
    s, cr = canvas()
    cr.set_source_rgb(0.0, 0.0, 0.0)
    cr.paint()
    stars(cr, 380, H, 13, (1, 0.95, 0.88))
    cx, cy, rh = W / 2, H / 2, 150
    glow(cr, cx, cy, 620, (1.0, 0.55, 0.18), 0.22)

    def disc(back):
        for i in range(60):                            # the flat disc, edge-on, brighter on its left
            t = i / 59
            r = rh * 1.35 + t * 470
            cr.save()
            cr.translate(cx, cy)
            cr.scale(1, 0.13)
            g = cairo.LinearGradient(-r, 0, r, 0)
            a = (1 - t) ** 2.2 * (0.16 if back else 0.11)
            g.add_color_stop_rgba(0, 1.0, 0.86, 0.6, a)
            g.add_color_stop_rgba(0.5, 1.0, 0.55, 0.18, a * 0.6)
            g.add_color_stop_rgba(1, 0.9, 0.35, 0.10, a * 0.3)
            cr.set_source(g)
            cr.set_line_width(14)
            if back:
                cr.arc(0, 0, r, math.pi, 2 * math.pi)
            else:
                cr.arc(0, 0, r, 0, math.pi)
            cr.restore()
            cr.stroke()
    disc(True)
    for i in range(40):                                # the lensed halo: the disc's far side, bent over the top
        t = i / 39
        cr.set_source_rgba(1.0, 0.72 - t * 0.3, 0.32 - t * 0.2, (1 - t) ** 1.6 * 0.42)
        cr.set_line_width(3)
        cr.arc(cx, cy, rh * 1.15 + t * 120, 0, 2 * math.pi)
        cr.stroke()
    cr.set_source_rgb(0, 0, 0)                          # the shadow
    cr.arc(cx, cy, rh, 0, 2 * math.pi)
    cr.fill()
    cr.set_source_rgba(1.0, 0.93, 0.80, 0.95)          # the photon ring
    cr.set_line_width(2.4)
    cr.arc(cx, cy, rh * 1.03, 0, 2 * math.pi)
    cr.stroke()
    disc(False)
    save(s, path)


# 5. Nordic Fjord Aurora
def fjord(path):
    s, cr = canvas()
    vgrad(cr, [(0, (0.01, 0.03, 0.06)), (0.55, (0.03, 0.08, 0.12)), (1, (0.01, 0.02, 0.04))])
    stars(cr, 300, H * 0.6, 5)
    rnd = random.Random(4)
    for band, (col, y0, ph) in enumerate([((0.25, 0.95, 0.60), 0.26, 0.0), ((0.55, 0.40, 0.95), 0.18, 1.3),
                                          ((0.30, 0.85, 0.80), 0.33, 2.1)]):
        for x in range(0, W, 3):                       # curtains: vertical rays along a slow curve
            top = H * y0 + 70 * math.sin(x / 260 + ph) + 30 * math.sin(x / 90 + ph * 2)
            length = 160 + 120 * (0.5 + 0.5 * math.sin(x / 47 + ph * 3))
            a = 0.20 * (0.5 + 0.5 * math.sin(x / 33 + ph)) + 0.06
            g = cairo.LinearGradient(0, top, 0, top + length)
            g.add_color_stop_rgba(0, *col, 0)
            g.add_color_stop_rgba(0.25, *col, a)
            g.add_color_stop_rgba(1, *col, 0)
            cr.set_source(g)
            cr.rectangle(x, top, 3, length)
            cr.fill()
    horizon = H * 0.66
    for layer in range(3):                             # faceted peaks: a lit face and a shadow face each
        base = horizon + 40 + layer * 40
        top = 360 - layer * 110
        x, peak = -120, True
        pts = []
        while x < W + 240:
            pts.append((x, base - top * (rnd.uniform(0.6, 1.0) if peak else rnd.uniform(0.08, 0.3))))
            x += rnd.uniform(110, 230)
            peak = not peak
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            shade = 0.06 + layer * 0.025 + (0.07 if y1 < y0 else 0.0)
            cr.set_source_rgb(shade * 0.75, shade * 0.95, shade * 1.3)
            cr.move_to(x0, y0)
            cr.line_to(x1, y1)
            cr.line_to(x1, base + 200)
            cr.line_to(x0, base + 200)
            cr.close_path()
            cr.fill()
            cr.set_source_rgba(0.85, 0.95, 1.0, 0.25 if layer == 0 else 0.12)   # snow-lit ridge line
            cr.set_line_width(1.2)
            cr.move_to(x0, y0)
            cr.line_to(x1, y1)
            cr.stroke()
    vgrad(cr, [(0, (0.02, 0.05, 0.08)), (1, (0.0, 0.01, 0.02))], horizon + 120, H)
    cr.set_line_width(1)                               # the aurora on the water
    for _ in range(160):
        y = rnd.uniform(horizon + 130, H)
        x = rnd.uniform(0, W)
        cr.set_source_rgba(0.3, 0.9, 0.65, rnd.uniform(0.04, 0.16))
        cr.move_to(x, y)
        cr.line_to(x + rnd.uniform(30, 140), y)
        cr.stroke()
    save(s, path)


# 6. Bauhaus Obsidian Topo
def topo(path):
    s, cr = canvas()
    cr.set_source_rgb(0.035, 0.04, 0.05)
    cr.paint()
    rng = np.random.default_rng(42)                    # a height field: a handful of hills and hollows
    yy, xx = np.mgrid[0:H // 2, 0:W // 2].astype(np.float32)
    field = np.zeros_like(xx)
    for _ in range(14):
        cx, cy = rng.uniform(0, W / 2), rng.uniform(0, H / 2)
        sx = rng.uniform(60, 220)
        field += rng.uniform(-1, 1.4) * np.exp(-(((xx - cx) ** 2) + ((yy - cy) ** 2)) / (2 * sx * sx))
    field = cv2.normalize(field, None, 0, 1, cv2.NORM_MINMAX)
    for i, level in enumerate(np.linspace(0.04, 0.96, 46)):
        mask = (field > level).astype(np.uint8)
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        warm = i % 5 == 0
        cr.set_source_rgba(*((0.95, 0.62, 0.30) if warm else (0.40, 0.75, 0.85)), 0.85 if warm else 0.45)
        cr.set_line_width(1.6 if warm else 0.9)
        for c in contours:
            if len(c) < 8:
                continue
            pts = c[:, 0, :] * 2
            cr.move_to(*pts[0])
            for p in pts[1:]:
                cr.line_to(*p)
            cr.close_path()
            cr.stroke()
    cr.set_source_rgba(1, 1, 1, 0.22)                   # the coordinate grid's ticks and labels
    cr.set_line_width(1)
    cr.select_font_face("monospace", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
    cr.set_font_size(11)
    for x in range(0, W, 160):
        for y in range(0, H, 160):
            cr.move_to(x - 5, y)
            cr.line_to(x + 5, y)
            cr.move_to(x, y - 5)
            cr.line_to(x, y + 5)
            cr.stroke()
    for x in range(160, W, 320):
        cr.move_to(x + 4, 20)
        cr.show_text(f"{x // 16:03d}E")
    for y in range(160, H, 320):
        cr.move_to(8, y - 4)
        cr.show_text(f"{y // 16:03d}N")
    save(s, path, grain=1.2)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "assets/wallpapers")
    out.mkdir(parents=True, exist_ok=True)
    for name, draw in (("sable-desert-monolith", desert), ("cyberpunk-rain-grid", cyber), ("kyoto-misty-peaks", kyoto),
                       ("gargantua-accretion-halo", gargantua), ("nordic-fjord-aurora", fjord),
                       ("bauhaus-obsidian-topo", topo)):
        draw(out / f"{name}.jpg")
        print(f"{name}.jpg: {(out / f'{name}.jpg').stat().st_size // 1024} KB")
