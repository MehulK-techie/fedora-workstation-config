#!/usr/bin/env python3
"""MK's own three wallpapers (assets/wallpapers), drawn from code so they're reproducible and
MK's own (MIT): dark, quiet, with clear shapes for the contour-trace transition to find.

  python3 scripts/make-wallpapers.py [OUT_DIR]     (default: assets/wallpapers)

  obsidian-aurora.jpg   aurora ribbons, teal into violet, over a night gradient
  blueprint-peaks.jpg   layered indigo ridges under a pale moon
  ember-orbit.jpg       glowing rings around a dark planet, warm amber on black
"""
import math
import random
import sys
from pathlib import Path

import cairo
import cv2
import numpy as np

W, H = 2560, 1600


def finish(surface, path):
    """Cairo ARGB -> BGR, a whisper of grain (no banding in the dark gradients), JPEG."""
    a = np.ndarray((H, W, 4), np.uint8, surface.get_data())[:, :, :3].astype(np.float32)
    rng = np.random.default_rng(7)
    a += rng.normal(0, 1.6, a.shape[:2])[..., None]
    cv2.imwrite(str(path), np.clip(a, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 86])


def background(cr, top, bottom):
    g = cairo.LinearGradient(0, 0, 0, H)
    g.add_color_stop_rgb(0, *top)
    g.add_color_stop_rgb(1, *bottom)
    cr.set_source(g)
    cr.paint()


def aurora(path):
    s = cairo.ImageSurface(cairo.FORMAT_RGB24, W, H)
    cr = cairo.Context(s)
    background(cr, (0.02, 0.03, 0.06), (0.01, 0.01, 0.02))
    random.seed(3)
    for _ in range(260):                                          # stars
        cr.set_source_rgba(1, 1, 1, random.uniform(0.15, 0.6))
        cr.arc(random.uniform(0, W), random.uniform(0, H * 0.55), random.uniform(0.6, 1.6), 0, 2 * math.pi)
        cr.fill()
    for i, (col, y0, amp) in enumerate([((0.15, 0.85, 0.75), 0.42, 120), ((0.35, 0.55, 0.95), 0.50, 150),
                                        ((0.55, 0.30, 0.85), 0.58, 110)]):
        for layer in range(22):                                   # soft ribbon: many faint strokes
            cr.set_source_rgba(*col, 0.035)
            cr.set_line_width(140 - layer * 5)
            cr.move_to(-50, H * y0)
            for x in range(-50, W + 100, 40):
                y = H * y0 + amp * math.sin(x / 380 + i * 1.7) + 40 * math.sin(x / 120 + i)
                cr.line_to(x, y - layer * 6)
            cr.stroke()
    # a dark ridge to anchor it
    cr.set_source_rgb(0.01, 0.012, 0.02)
    cr.move_to(0, H)
    for x in range(0, W + 40, 40):
        cr.line_to(x, H * 0.8 + 60 * math.sin(x / 300) + 30 * math.sin(x / 90))
    cr.line_to(W, H)
    cr.close_path()
    cr.fill()
    finish(s, path)


def peaks(path):
    s = cairo.ImageSurface(cairo.FORMAT_RGB24, W, H)
    cr = cairo.Context(s)
    background(cr, (0.05, 0.06, 0.14), (0.02, 0.02, 0.05))
    moon = cairo.RadialGradient(W * 0.72, H * 0.26, 0, W * 0.72, H * 0.26, 420)
    moon.add_color_stop_rgba(0, 0.85, 0.88, 1, 0.9)
    moon.add_color_stop_rgba(0.18, 0.75, 0.8, 1, 0.55)
    moon.add_color_stop_rgba(1, 0.3, 0.35, 0.7, 0)
    cr.set_source(moon)
    cr.paint()
    random.seed(11)
    for layer in range(6):
        shade = 0.15 - layer * 0.022                              # (nearer ridges darker)
        cr.set_source_rgb(shade * 0.6, shade * 0.7, shade * 1.6)
        base = H * (0.48 + layer * 0.085)
        cr.move_to(0, H)
        x, y = 0, base
        while x <= W + 60:
            cr.line_to(x, y)
            x += random.uniform(40, 120)
            y = base - abs(math.sin(x / (260 + layer * 40))) * (220 - layer * 25) + random.uniform(-25, 25)
        cr.line_to(W, H)
        cr.close_path()
        cr.fill()
    finish(s, path)


def orbit(path):
    s = cairo.ImageSurface(cairo.FORMAT_RGB24, W, H)
    cr = cairo.Context(s)
    background(cr, (0.03, 0.015, 0.01), (0.0, 0.0, 0.0))
    cx, cy = W * 0.38, H * 0.56
    for i in range(9):                                            # rings, tilted
        cr.save()
        cr.translate(cx, cy)
        cr.scale(1, 0.32)
        cr.rotate(-0.12)
        r = 420 + i * 70
        cr.set_source_rgba(1.0, 0.55 - i * 0.03, 0.18, 0.55 - i * 0.05)
        cr.set_line_width(3 + (i % 3) * 2)
        cr.arc(0, 0, r, 0, 2 * math.pi)
        cr.stroke()
        cr.restore()
    glow = cairo.RadialGradient(cx, cy, 200, cx, cy, 760)
    glow.add_color_stop_rgba(0, 1, 0.45, 0.12, 0.35)
    glow.add_color_stop_rgba(1, 1, 0.3, 0.05, 0)
    cr.set_source(glow)
    cr.paint()
    planet = cairo.RadialGradient(cx - 90, cy - 110, 40, cx, cy, 330)
    planet.add_color_stop_rgb(0, 0.16, 0.08, 0.05)
    planet.add_color_stop_rgb(1, 0.01, 0.005, 0.0)
    cr.set_source(planet)
    cr.arc(cx, cy, 320, 0, 2 * math.pi)
    cr.fill()
    cr.set_source_rgba(1, 0.6, 0.3, 0.55)                         # its lit rim
    cr.set_line_width(3)
    cr.arc(cx, cy, 320, math.pi * 1.05, math.pi * 1.6)
    cr.stroke()
    random.seed(5)
    for _ in range(180):
        cr.set_source_rgba(1, 0.9, 0.8, random.uniform(0.1, 0.5))
        cr.arc(random.uniform(0, W), random.uniform(0, H), random.uniform(0.5, 1.4), 0, 2 * math.pi)
        cr.fill()
    finish(s, path)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "assets/wallpapers")
    out.mkdir(parents=True, exist_ok=True)
    aurora(out / "obsidian-aurora.jpg")
    peaks(out / "blueprint-peaks.jpg")
    orbit(out / "ember-orbit.jpg")
    for p in sorted(out.glob("*.jpg")):
        print(f"{p.name}: {p.stat().st_size // 1024} KB")
