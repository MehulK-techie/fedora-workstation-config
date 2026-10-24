"""Photo edits for MK Notes' image editor (Pillow): rotate, flip, crop,
resize, and a few Photo Booth style looks.

  thermal   a heat-camera palette: cold blues to hot yellows
  popart    four posterised copies in bright duotones, 2 x 2
  distort   a fisheye bulge from the middle
  polaroid  a warm, faded vintage print on a white instant-photo frame
            with a wider bottom edge and a little paper grain

Every function takes a PIL image and returns a new one; nothing is written
to disk here.
"""
import math
import random

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps

FILTERS = {}


def look(name, label):
    def register(fn):
        fn.label = label
        FILTERS[name] = fn
        return fn
    return register


def rgb(img):
    """Flatten transparency onto white, the way notes show images."""
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        base = Image.new("RGB", img.size, (255, 255, 255))
        base.paste(img, mask=img.split()[-1])
        return base
    return img.convert("RGB")


def rotate(img, clockwise=True):
    return img.transpose(Image.Transpose.ROTATE_270 if clockwise else Image.Transpose.ROTATE_90)


def flip(img):
    return img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)


def crop(img, box):
    """box: (left, top, right, bottom) in image pixels, clamped to the image."""
    left, top, right, bottom = box
    left, right = sorted((max(0, min(img.width, int(left))), max(0, min(img.width, int(right)))))
    top, bottom = sorted((max(0, min(img.height, int(top))), max(0, min(img.height, int(bottom)))))
    if right - left < 4 or bottom - top < 4:
        return img
    return img.crop((left, top, right, bottom))


def resize(img, percent):
    scale = max(5, min(400, percent)) / 100
    return img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))),
                      Image.Resampling.LANCZOS)


def _palette(stops):
    """A 256-colour palette blended between (position 0-1, (r, g, b)) stops."""
    out = []
    for i in range(256):
        t = i / 255
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                u = (t - p0) / (p1 - p0) if p1 > p0 else 0
                out.extend(round(a + (b - a) * u) for a, b in zip(c0, c1))
                break
    return out


@look("thermal", "Thermal")
def thermal(img):
    gray = ImageOps.autocontrast(rgb(img).convert("L"), cutoff=1).filter(ImageFilter.GaussianBlur(1.2))
    gray.putpalette(_palette([(0, (8, 0, 40)), (0.25, (40, 20, 200)), (0.45, (190, 30, 170)),
                              (0.65, (240, 60, 30)), (0.85, (255, 200, 20)), (1, (255, 255, 230))]))
    return gray.convert("RGB")


@look("popart", "Pop Art")
def popart(img):
    small = rgb(img)
    small.thumbnail((900, 900))
    # Equalised first, so dark photos still split into clear light and dark areas.
    gray = ImageOps.posterize(ImageOps.equalize(small.convert("L")).convert("RGB"), 2).convert("L")
    pairs = [((255, 0, 128), (255, 235, 0)), ((0, 60, 255), (0, 255, 200)),
             ((255, 90, 0), (120, 255, 60)), ((120, 0, 255), (255, 140, 220))]
    w, h = small.size
    out = Image.new("RGB", (w * 2, h * 2))
    for i, (dark, light) in enumerate(pairs):
        out.paste(ImageOps.colorize(gray, dark, light), ((i % 2) * w, (i // 2) * h))
    return out


@look("distort", "Distort")
def distort(img, strength=0.55, grid=24):
    """Fisheye bulge: each output point looks closer to the middle of the source."""
    src = rgb(img)
    w, h = src.size
    cx, cy, radius = w / 2, h / 2, min(w, h) / 2

    def source(x, y):
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy) / radius
        if d >= 1 or d == 0:
            return x, y
        k = d ** (1 + strength) / d  # < 1 near the middle: magnified
        return cx + dx * k, cy + dy * k

    mesh = []
    for gy in range(grid):
        for gx in range(grid):
            x0, x1 = w * gx / grid, w * (gx + 1) / grid
            y0, y1 = h * gy / grid, h * (gy + 1) / grid
            quad = (*source(x0, y0), *source(x0, y1), *source(x1, y1), *source(x1, y0))
            mesh.append(((round(x0), round(y0), round(x1), round(y1)), quad))
    return src.transform((w, h), Image.Transform.MESH, mesh, Image.Resampling.BICUBIC)


@look("polaroid", "Polaroid")
def polaroid(img, seed=7):
    photo = rgb(img)
    photo.thumbnail((1400, 1400))
    # The vintage look: less saturated, warm, lifted blacks, soft corners.
    photo = ImageEnhance.Color(photo).enhance(0.75)
    warm = Image.new("RGB", photo.size, (255, 170, 90))
    photo = Image.blend(photo, ImageChops.multiply(photo, warm), 0.35)
    photo = photo.point(lambda v: 28 + v * (235 - 28) / 255)  # faded: no pure black or white
    photo = ImageEnhance.Contrast(photo).enhance(1.08)
    w, h = photo.size
    vignette = Image.new("L", (w, h), 0)
    inner = vignette.resize((max(1, w // 8), max(1, h // 8)))
    for y in range(inner.height):
        for x in range(inner.width):
            d = math.hypot((x + 0.5) / inner.width - 0.5, (y + 0.5) / inner.height - 0.5) / 0.7071
            inner.putpixel((x, y), round(255 * max(0, d - 0.45) / 0.55 * 0.55))
    vignette = inner.resize((w, h), Image.Resampling.BICUBIC)
    photo = Image.composite(Image.new("RGB", (w, h), (40, 25, 15)), photo, vignette)
    # The frame: wider at the bottom, off-white paper with a little grain.
    side, top, bottom = round(w * 0.06), round(w * 0.06), round(w * 0.24)
    frame = Image.new("RGB", (w + 2 * side, h + top + bottom), (244, 241, 233))
    rand = random.Random(seed)
    grain = Image.new("L", (frame.width // 3 + 1, frame.height // 3 + 1))
    grain.putdata([rand.randint(0, 255) for _ in range(grain.width * grain.height)])
    grain = grain.resize(frame.size).filter(ImageFilter.GaussianBlur(0.6))
    frame = Image.composite(Image.new("RGB", frame.size, (222, 217, 205)), frame, grain.point(lambda v: v // 6))
    frame.paste(photo, (side, top))
    return frame


def apply(img, name):
    return FILTERS[name](img) if name in FILTERS else img
