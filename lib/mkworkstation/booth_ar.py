"""MK Photo Booth: AR effects and live frames (bin/camera-controls).

AR effects follow you on the live preview and in the photo:
  ar-hearts      Love Hearts AR: glossy pink and red hearts float up around you
  ar-hand-hearts Hand Heart Burst: the same, and raising your hands sends a puff of
                 hearts up from them; bringing both hands together near your face
                 (a hand heart) bursts a whole cloud
  ar-crown       a golden crown on your head, tilting with it
  ar-halo        a glowing neon halo above your head
  ar-orbit       emoji orbiting above your head (❤️ 🔥 ✨ 👑 🕷️)
  ar-spidey      Spidey-sense: comic halftone and wavy lines tingling around your head

Frames (live, and on the photo):
  frame-strip    Classic 4-Shot Photo Strip (the shutter takes four, a second apart)
  frame-polaroid Polaroid Instant Frame with a date stamp
  frame-sweetheart  macOS-style Sweetheart pink frame with hearts
  frame-neon     Cyberpunk Neon HUD frame (corner brackets, scanlines, REC)
  frame-35mm     Vintage 35mm film border

Tracking: your face with OpenCV's YuNet model (the one MK's face unlock uses,
/usr/local/share/mk-face) on a 320 px copy of the frame, smoothed; hands as
skin-coloured blobs away from the face (no hand model is installed, so a "hand
heart" is two hands close together near your face, not the exact shape). With
no OpenCV or no model, the effects sit where a face usually is.
Everything is drawn with cairo (colour emoji with Pango), and positions come
from the time and the tracker alone, so the live tiles, the preview and the
photo all show the same thing.
"""
import math
import os
import time

import numpy as np
from PIL import Image

import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
gi.require_foreign("cairo")
import cairo  # noqa: E402
from gi.repository import Pango, PangoCairo  # noqa: E402

try:
    import cv2
except ImportError:          # (no OpenCV: effects at a default place)
    cv2 = None

from mkworkstation import photo  # noqa: E402

YUNET = "/usr/local/share/mk-face/face_detection_yunet_2023mar.onnx"
AR_LOOKS = {"ar-hearts": "Love Hearts AR", "ar-hand-hearts": "Hand Heart Burst", "ar-crown": "Golden Crown",
            "ar-halo": "Neon Halo", "ar-orbit": "Emoji Orbit", "ar-spidey": "Spidey-Sense"}
FRAMES = {"frame-strip": "4-Shot Photo Strip", "frame-polaroid": "Polaroid + Date", "frame-sweetheart": "Sweetheart Pink",
          "frame-neon": "Cyberpunk Neon HUD", "frame-35mm": "Vintage 35mm"}
DEFAULT_FACE = (0.5, 0.42, 0.24, 0.38, 0.0)       # cx, cy, w, h (0-1 of the frame), roll (radians)


# ----------------------------------------------------------------- tracking
class Tracker:
    """Your face and hands, from each camera frame (call update), in 0-1 coordinates."""

    def __init__(self):
        self.det = None
        self.face = None             # (cx, cy, w, h, roll), smoothed
        self.missed = 0
        self.hands = []              # [(x, y)] raised hands
        self.bursts = []             # [(t0, x, y, big)]
        self._last_burst = 0.0
        self.ok = cv2 is not None and os.access(YUNET, os.R_OK)

    def update(self, img, now=None):
        now = time.monotonic() if now is None else now
        self.bursts = [b for b in self.bursts if now - b[0] < 2.6]
        if not self.ok:
            return
        w, h = img.size
        sw, sh = 320, max(1, round(320 * h / w))
        small = np.ascontiguousarray(np.asarray(img.resize((sw, sh), Image.Resampling.BILINEAR).convert("RGB"))[:, :, ::-1])
        try:
            if self.det is None:
                self.det = cv2.FaceDetectorYN.create(YUNET, "", (sw, sh), 0.7, 0.3, 1)
            self.det.setInputSize((sw, sh))
            _, faces = self.det.detect(small)
        except cv2.error:
            self.ok = False
            return
        if faces is not None and len(faces):
            f = faces[0]
            fx, fy, fw, fh = f[0] / sw, f[1] / sh, f[2] / sw, f[3] / sh
            roll = math.atan2(f[7] - f[5], f[6] - f[4])      # (right eye -> left eye)
            new = (fx + fw / 2, fy + fh / 2, fw, fh, roll)
            k = 0.5 if self.face else 1.0                     # (a quick ease, no jitter)
            self.face = tuple(a + (b - a) * k for a, b in zip(self.face or new, new))
            self.missed = 0
        else:
            self.missed += 1
            if self.missed > 12:
                self.face = None
        self._hands(small, now)

    def _hands(self, small, now):
        """Skin-coloured blobs away from the face, above the shoulders: raised hands."""
        sh, sw = small.shape[:2]
        ycrcb = cv2.cvtColor(small, cv2.COLOR_BGR2YCrCb)
        mask = cv2.inRange(ycrcb, (0, 138, 80), (255, 178, 128))
        cx, cy, fw, fh, _ = self.face or DEFAULT_FACE
        x1, x2 = int((cx - fw * 0.85) * sw), int((cx + fw * 0.85) * sw)
        y1, y2 = int((cy - fh * 0.9) * sh), int((cy + fh * 1.6) * sh)
        mask[max(0, y1):max(0, y2), max(0, x1):max(0, x2)] = 0         # (not the face and neck)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        blobs = sorted((c for c in contours if cv2.contourArea(c) > sw * sh * 0.008), key=cv2.contourArea, reverse=True)[:2]
        hands = []
        for c in blobs:
            m = cv2.moments(c)
            if m["m00"]:
                x, y = m["m10"] / m["m00"] / sw, m["m01"] / m["m00"] / sh
                if self.face is None or y < cy + fh * 0.9:               # (raised: no lower than the chin)
                    hands.append((x, y))
        self.hands = hands
        if self.face is None or not hands:
            return
        together = len(hands) == 2 and abs(hands[0][0] - hands[1][0]) < 0.24 and abs(hands[0][1] - hands[1][1]) < 0.18
        gap = 1.2 if together else 0.8
        if now - self._last_burst > gap:
            self._last_burst = now
            if together:
                mx, my = (hands[0][0] + hands[1][0]) / 2, (hands[0][1] + hands[1][1]) / 2
                self.bursts.append((now, mx, my, True))
            else:
                self.bursts.extend((now, x, y, False) for x, y in hands)


# ----------------------------------------------------------------- cairo <-> PIL
def _surface(img):
    arr = np.asarray(img.convert("RGB"))
    h, w = arr.shape[:2]
    bgra = np.empty((h, w, 4), np.uint8)
    bgra[..., 0], bgra[..., 1], bgra[..., 2], bgra[..., 3] = arr[..., 2], arr[..., 1], arr[..., 0], 255
    surface = cairo.ImageSurface.create_for_data(memoryview(bgra), cairo.FORMAT_ARGB32, w, h, w * 4)
    return surface, bgra


def _image(surface, bgra):
    surface.flush()
    return Image.fromarray(np.ascontiguousarray(bgra[..., 2::-1]), "RGB")


def heart(cr, x, y, size, rgb=(1.0, 0.25, 0.45), alpha=1.0, angle=0.0):
    """A glossy heart centred on (x, y): a soft shadow, a rounded gradient, a highlight."""
    cr.save()
    cr.translate(x, y)
    cr.rotate(angle)
    s = size / 2

    def path(dx=0.0, dy=0.0):
        cr.new_path()
        cr.move_to(dx, dy + s * 0.9)
        cr.curve_to(dx - s * 1.25, dy + s * 0.05, dx - s * 0.75, dy - s * 0.95, dx, dy - s * 0.35)
        cr.curve_to(dx + s * 0.75, dy - s * 0.95, dx + s * 1.25, dy + s * 0.05, dx, dy + s * 0.9)
        cr.close_path()
    path(s * 0.08, s * 0.1)
    cr.set_source_rgba(0.3, 0, 0.08, 0.28 * alpha)
    cr.fill()
    path()
    grad = cairo.RadialGradient(-s * 0.3, -s * 0.4, s * 0.1, 0, 0, s * 1.2)
    grad.add_color_stop_rgba(0, min(1, rgb[0] + 0.25), min(1, rgb[1] + 0.35), min(1, rgb[2] + 0.35), alpha)
    grad.add_color_stop_rgba(1, rgb[0] * 0.75, rgb[1] * 0.6, rgb[2] * 0.6, alpha)
    cr.set_source(grad)
    cr.fill()
    cr.new_path()
    cr.save()
    cr.translate(-s * 0.38, -s * 0.38)
    cr.scale(s * 0.3, s * 0.17)
    cr.arc(0, 0, 1, 0, 2 * math.pi)
    cr.restore()
    cr.set_source_rgba(1, 1, 1, 0.55 * alpha)
    cr.fill()
    cr.restore()


HEART_COLOURS = [(1.0, 0.25, 0.45), (1.0, 0.45, 0.65), (0.95, 0.12, 0.25), (1.0, 0.6, 0.78)]


def _floating(cr, w, h, t, count=16):
    """Hearts drifting up from the bottom, swaying: from the time alone."""
    for i in range(count):
        speed = 0.07 + (i * 37 % 11) / 160
        phase = (t * speed + i * 0.618) % 1.0
        x = ((i * 0.381) % 1.0) * w + math.sin(t * 1.6 + i) * w * 0.025
        y = h * (1.1 - phase * 1.3)
        size = w * (0.03 + (i * 13 % 7) / 260)
        alpha = min(1.0, phase * 4) * min(1.0, (1 - phase) * 3)
        heart(cr, x, y, size, HEART_COLOURS[i % 4], 0.85 * alpha, math.sin(t + i) * 0.25)


def _bursts(cr, w, h, t, bursts):
    for t0, bx, by, big in bursts:
        age = t - t0
        n = 22 if big else 7
        for k in range(n):
            ang = -math.pi / 2 + (k / max(1, n - 1) - 0.5) * (2.4 if big else 1.6)
            v = (0.18 if big else 0.12) * (0.7 + (k * 7 % 5) / 10)
            x = bx * w + math.cos(ang) * v * w * age
            y = by * h + math.sin(ang) * v * h * age * 1.3 - 0.05 * h * age * age
            alpha = max(0.0, 1 - age / 2.4)
            size = w * (0.035 if big else 0.028) * (1 + age * 0.4)
            heart(cr, x, y, size, HEART_COLOURS[k % 4], alpha, math.sin(age * 3 + k) * 0.3)


def _crown(cr, cx, top, width, roll):
    cr.save()
    cr.translate(cx, top)
    cr.rotate(roll)
    hgt = width * 0.55
    pts = [(-0.5, 0), (-0.5, -0.55), (-0.3, -0.25), (-0.15, -0.8), (0, -0.35), (0.15, -0.8), (0.3, -0.25),
           (0.5, -0.55), (0.5, 0)]
    cr.new_path()
    for i, (px, py) in enumerate(pts):
        (cr.line_to if i else cr.move_to)(px * width, py * hgt)
    cr.close_path()
    grad = cairo.LinearGradient(0, -hgt, 0, 0)
    grad.add_color_stop_rgb(0, 1.0, 0.9, 0.45)
    grad.add_color_stop_rgb(0.55, 0.98, 0.76, 0.18)
    grad.add_color_stop_rgb(1, 0.75, 0.5, 0.05)
    cr.set_source(grad)
    cr.fill_preserve()
    cr.set_source_rgba(0.45, 0.28, 0.0, 0.9)
    cr.set_line_width(max(1.5, width * 0.02))
    cr.stroke()
    cr.rectangle(-0.5 * width, -0.16 * hgt, width, 0.16 * hgt)       # the band
    cr.set_source_rgba(0.85, 0.6, 0.1, 1)
    cr.fill()
    for gx, colour in ((-0.3, (0.9, 0.1, 0.2)), (0, (0.1, 0.45, 0.95)), (0.3, (0.1, 0.75, 0.35))):
        cr.arc(gx * width, -0.08 * hgt, width * 0.045, 0, 2 * math.pi)
        cr.set_source_rgb(*colour)
        cr.fill()
    for px, py in ((-0.5, -0.55), (-0.15, -0.8), (0.15, -0.8), (0.5, -0.55)):   # pearls on the tips
        cr.arc(px * width, py * hgt, width * 0.035, 0, 2 * math.pi)
        cr.set_source_rgb(1, 0.97, 0.88)
        cr.fill()
    cr.restore()


def _halo(cr, cx, cy, width, roll, t):
    cr.save()
    cr.translate(cx, cy)
    cr.rotate(roll)
    cr.scale(1, 0.28)
    pulse = 0.85 + 0.15 * math.sin(t * 3)
    for lw, a in ((width * 0.16, 0.10), (width * 0.10, 0.18), (width * 0.05, 0.35), (width * 0.022, 0.95)):
        cr.new_path()
        cr.arc(0, 0, width / 2, 0, 2 * math.pi)
        cr.set_source_rgba(0.55, 0.95, 1.0, a * pulse)
        cr.set_line_width(lw)
        cr.stroke()
    cr.restore()


_GLYPHS = {}


def _emoji(cr, text, x, y, px):
    """A colour emoji centred on (x, y): drawn once per size into a small surface, then reused
    (shaping and rasterising colour glyphs every frame cost ~5 ms each)."""
    px = max(6, int(px) // 2 * 2)                     # (sizes in steps of 2: a small cache)
    key = (text, px)
    glyph = _GLYPHS.get(key)
    if glyph is None:
        probe = cairo.Context(cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1))
        layout = PangoCairo.create_layout(probe)
        layout.set_font_description(Pango.FontDescription.from_string(f"Noto Color Emoji {px}px"))
        layout.set_text(text, -1)
        ink, _logical = layout.get_pixel_extents()
        gw, gh = max(1, ink.width + 4), max(1, ink.height + 4)
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, gw, gh)
        gcr = cairo.Context(surface)
        glayout = PangoCairo.create_layout(gcr)
        glayout.set_font_description(layout.get_font_description())
        glayout.set_text(text, -1)
        gcr.move_to(2 - ink.x, 2 - ink.y)
        PangoCairo.show_layout(gcr, glayout)
        surface.flush()
        if len(_GLYPHS) > 200:
            _GLYPHS.clear()
        glyph = _GLYPHS[key] = surface
    cr.set_source_surface(glyph, x - glyph.get_width() / 2, y - glyph.get_height() / 2)
    cr.paint()


def _spidey(cr, cx, cy, fw, fh, w, t):
    """Comic 'tingling' lines either side of the head, wobbling."""
    cr.set_line_cap(cairo.LINE_CAP_ROUND)
    for side in (-1, 1):
        for k in range(3):
            r = fw * (0.62 + k * 0.17)
            cr.new_path()
            for j in range(24):
                a = (-0.55 + j / 23 * 1.1)
                wob = math.sin(j * 1.9 + t * 14 + k) * fw * 0.025
                x = cx + side * (r + wob) * math.cos(a)
                y = cy - fh * 0.25 + (r + wob) * math.sin(a) * 1.1
                (cr.line_to if j else cr.move_to)(x, y)
            for colour, lw in (((1, 1, 1), w * 0.011), ((0.05, 0.05, 0.08), w * 0.006)):
                cr.set_source_rgb(*colour)
                cr.set_line_width(lw)
                cr.stroke_preserve()
            cr.new_path()


def render(img, key, tracker, t=None):
    """IMG (PIL RGB) with the AR effect KEY, placed from TRACKER (or the usual spot)."""
    t = time.monotonic() if t is None else t
    if key == "ar-spidey":
        img = photo.apply(img, "comic") if "comic" in photo.FILTERS else img
    surface, buf = _surface(img)
    cr = cairo.Context(surface)
    w, h = img.size
    cx, cy, fw, fh, roll = tracker.face if tracker and tracker.face else DEFAULT_FACE
    cx, cy, fw, fh = cx * w, cy * h, fw * w, fh * h
    top = cy - fh * 0.62
    if key in ("ar-hearts", "ar-hand-hearts"):
        _floating(cr, w, h, t, 18 if key == "ar-hearts" else 10)
        if key == "ar-hand-hearts" and tracker:
            _bursts(cr, w, h, t, tracker.bursts)
    elif key == "ar-crown":
        _crown(cr, cx + math.sin(roll) * fh * 0.55, top, fw * 1.05, roll)
    elif key == "ar-halo":
        _halo(cr, cx + math.sin(roll) * fh * 0.7, top - fh * 0.12, fw * 1.0, roll, t)
    elif key == "ar-orbit":
        n = len(ORBIT_LIST)
        for i, e in enumerate(ORBIT_LIST):
            a = t * 1.3 + i * 2 * math.pi / n
            depth = 0.75 + 0.25 * math.sin(a)
            _emoji(cr, e, cx + math.cos(a) * fw * 0.75, top - fh * 0.12 + math.sin(a) * fh * 0.14, fw * 0.24 * depth)
    elif key == "ar-spidey":
        _spidey(cr, cx, cy, fw, fh, w, t)
        layout = PangoCairo.create_layout(cr)
        layout.set_font_description(Pango.FontDescription.from_string(f"Bangers, Impact, Sans Bold {max(10, int(w * 0.045))}px"))
        layout.set_text("SPIDEY-SENSE!", -1)
        tw, th = layout.get_pixel_size()
        cr.move_to(cx - tw / 2, max(4, top - fh * 0.55))
        PangoCairo.layout_path(cr, layout)
        cr.set_source_rgb(0.05, 0.05, 0.08)
        cr.set_line_width(max(2, w * 0.006))
        cr.stroke_preserve()
        cr.set_source_rgb(1, 0.85, 0.1)
        cr.fill()
    return _image(surface, buf)


ORBIT_LIST = ["❤️", "🔥", "✨", "👑", "🕷️"]


# ----------------------------------------------------------------- frames
def _text(cr, text, x, y, px, rgb, font="Sans Bold", anchor="center"):
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription.from_string(f"{font} {max(6, int(px))}px"))
    layout.set_text(text, -1)
    tw, th = layout.get_pixel_size()
    ox = {"center": tw / 2, "left": 0, "right": tw}[anchor]
    cr.move_to(x - ox, y - th / 2)
    cr.set_source_rgb(*rgb)
    PangoCairo.show_layout(cr, layout)


def frame(img, key, stamp=None, shots=None):
    """IMG framed by KEY (a FRAMES key). STAMP: the date for the Polaroid; SHOTS: the four
    photos of a strip (the live preview passes none and shows the strip's look)."""
    if key == "frame-35mm":
        return photo.film_frame(img)[0]
    if key == "frame-polaroid":
        framed, _photo_box, (cx, cy, cw, ch) = photo.polaroid_frame(img)
        surface, buf = _surface(framed)
        cr = cairo.Context(surface)
        _text(cr, stamp or time.strftime("%d %b %Y"), cx + cw * 0.96, cy + ch * 0.55, cw * 0.06, (0.2, 0.18, 0.22),
              "Permanent Marker, Patrick Hand, Sans Bold", "right")
        return _image(surface, buf)
    if key == "frame-strip":
        return strip(shots or [img])
    w, h = img.size
    surface, buf = _surface(img)
    cr = cairo.Context(surface)
    if key == "frame-sweetheart":
        b = w * 0.045
        cr.rectangle(0, 0, w, h)
        cr.rectangle(b, b, w - 2 * b, h - 2 * b)
        cr.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
        grad = cairo.LinearGradient(0, 0, w, h)
        grad.add_color_stop_rgb(0, 1.0, 0.62, 0.78)
        grad.add_color_stop_rgb(1, 0.98, 0.42, 0.62)
        cr.set_source(grad)
        cr.fill()
        cr.set_fill_rule(cairo.FILL_RULE_WINDING)
        n = 14
        for i in range(n):                             # hearts along the border
            u = i / n
            for (x, y) in ((u * w, b / 2), ((1 - u) * w, h - b / 2), (b / 2, (u + 0.5 / n) * h), (w - b / 2, (u + 0.5 / n) * h)):
                heart(cr, x, y, b * 0.75, (1, 1, 1), 0.9)
        _text(cr, "♥ with love", w / 2, h - b * 2.2, w * 0.035, (1, 1, 1), "Pacifico, Z003, Sans Bold Italic")
    elif key == "frame-neon":
        rows = buf[::3]                                # scanlines: every third row a little darker
        rows[..., :3] = (rows[..., :3] * 0.78).astype(np.uint8)
        surface.mark_dirty()
        L, m = w * 0.08, w * 0.03
        cr.set_line_width(max(2, w * 0.006))
        for (x, y, dx, dy, colour) in ((m, m, 1, 1, (0.13, 0.83, 0.93)), (w - m, m, -1, 1, (0.85, 0.27, 0.94)),
                                       (m, h - m, 1, -1, (0.85, 0.27, 0.94)), (w - m, h - m, -1, -1, (0.13, 0.83, 0.93))):
            cr.move_to(x, y + dy * L)
            cr.line_to(x, y)
            cr.line_to(x + dx * L, y)
            cr.set_source_rgb(*colour)
            cr.stroke()
        cr.arc(m + w * 0.03, m + w * 0.045, w * 0.009, 0, 2 * math.pi)
        cr.set_source_rgb(1, 0.15, 0.2)
        cr.fill()
        _text(cr, "REC", m + w * 0.05, m + w * 0.045, w * 0.026, (1, 1, 1), "JetBrains Mono, Monospace Bold", "left")
        _text(cr, time.strftime("%H:%M:%S"), w - m - w * 0.02, m + w * 0.045, w * 0.024, (0.13, 0.83, 0.93),
              "JetBrains Mono, Monospace Bold", "right")
        _text(cr, "MK // NEON", w / 2, h - m - w * 0.02, w * 0.024, (0.85, 0.27, 0.94), "JetBrains Mono, Monospace Bold")
    return _image(surface, buf)


def strip(shots):
    """Up to four photos down a white strip, with an MK BOOTH footer and the date."""
    shots = [s.convert("RGB") for s in shots][:4]
    cw = 600
    ch = round(cw * 0.66)
    cells = [photo.fit(s, cw / ch) for s in shots]
    pad, foot = 28, 110
    n = max(1, len(cells))
    W, H = cw + pad * 2, pad + n * (ch + pad) + foot
    out = Image.new("RGB", (W, H), (250, 248, 244))
    for i, c in enumerate(cells):
        out.paste(c.resize((cw, ch)), (pad, pad + i * (ch + pad)))
    surface, buf = _surface(out)
    cr = cairo.Context(surface)
    _text(cr, "MK BOOTH", W / 2, H - foot * 0.6, 34, (0.15, 0.13, 0.16), "Bebas Neue, Oswald, Sans Bold")
    _text(cr, time.strftime("%d · %m · %Y"), W / 2, H - foot * 0.25, 18, (0.45, 0.42, 0.45), "Courier Prime, Monospace")
    return _image(surface, buf)
