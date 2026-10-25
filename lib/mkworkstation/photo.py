"""Photo edits for MK Notes' image editor (Pillow): rotate, flip, crop,
resize, and a few Photo Booth style looks.

  thermal   a heat-camera palette: cold blues to hot yellows
  vignette, hue (shift), noir, retro (sepia), comic, neon, mirror, glow (dreamy)
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


_CACHE = {}


def _vignette_mask(w, h, start=0.45, strength=0.55):
    """A radial mask, dark at the corners; cached per size (live preview)."""
    key = ("vignette", w, h, start, strength)
    if key not in _CACHE:
        inner = Image.new("L", (max(1, w // 8), max(1, h // 8)))
        for y in range(inner.height):
            for x in range(inner.width):
                d = math.hypot((x + 0.5) / inner.width - 0.5, (y + 0.5) / inner.height - 0.5) / 0.7071
                inner.putpixel((x, y), round(255 * max(0, d - start) / (1 - start) * strength))
        _CACHE[key] = inner.resize((w, h), Image.Resampling.BICUBIC)
    return _CACHE[key]


def _paper(w, h, seed=7):
    """Off-white paper with a little grain; cached per size."""
    key = ("paper", w, h, seed)
    if key not in _CACHE:
        frame = Image.new("RGB", (w, h), (244, 241, 233))
        rand = random.Random(seed)
        grain = Image.new("L", (w // 3 + 1, h // 3 + 1))
        grain.putdata([rand.randint(0, 255) for _ in range(grain.width * grain.height)])
        grain = grain.resize((w, h)).filter(ImageFilter.GaussianBlur(0.6))
        _CACHE[key] = Image.composite(Image.new("RGB", (w, h), (222, 217, 205)), frame, grain.point(lambda v: v // 6))
    return _CACHE[key]


def polaroid_frame(photo):
    """The instant-photo frame: wider at the bottom (room for a caption).
    Returns (framed image, (x, y, w, h) of the caption area)."""
    w, h = photo.size
    side, top, bottom = round(w * 0.06), round(w * 0.06), round(w * 0.24)
    frame = _paper(w + 2 * side, h + top + bottom).copy()
    frame.paste(photo, (side, top))
    return frame, (side, top + h, w, bottom)


def polaroid_photo(img):
    """The Polaroid look on the photo itself, without the frame."""
    photo = rgb(img)
    photo.thumbnail((1400, 1400))
    # The vintage look: less saturated, warm, lifted blacks, soft corners.
    photo = ImageEnhance.Color(photo).enhance(0.75)
    warm = Image.new("RGB", photo.size, (255, 170, 90))
    photo = Image.blend(photo, ImageChops.multiply(photo, warm), 0.35)
    photo = photo.point(lambda v: 28 + v * (235 - 28) / 255)  # faded: no pure black or white
    photo = ImageEnhance.Contrast(photo).enhance(1.08)
    return Image.composite(Image.new("RGB", photo.size, (40, 25, 15)), photo, _vignette_mask(*photo.size))


@look("polaroid", "Polaroid")
def polaroid(img):
    return polaroid_frame(polaroid_photo(img))[0]


@look("vignette", "Vignette")
def vignette(img):
    photo = rgb(img)
    return Image.composite(Image.new("RGB", photo.size, (0, 0, 0)), photo, _vignette_mask(*photo.size, 0.3, 0.85))


@look("hue", "Hue Shift")
def hue_shift(img, degrees=120):
    hsv = rgb(img).convert("HSV")
    h, s_, v = hsv.split()
    shift = round(degrees / 360 * 255)
    return Image.merge("HSV", (h.point(lambda x: (x + shift) % 256), s_, v)).convert("RGB")


@look("noir", "Noir")
def noir(img):
    gray = ImageOps.autocontrast(rgb(img).convert("L"), cutoff=2)
    return ImageEnhance.Contrast(gray).enhance(1.35).convert("RGB")


@look("retro", "Retro")
def retro(img):
    """Warm sepia, slightly faded, like an old print."""
    gray = rgb(img).convert("L")
    sepia = ImageOps.colorize(gray, (40, 26, 13), (255, 238, 205))
    return sepia.point(lambda v: 20 + v * 0.9)


@look("comic", "Comic")
def comic(img):
    photo = rgb(img)
    flat = ImageOps.posterize(ImageEnhance.Color(photo).enhance(1.6), 3)
    edges = photo.convert("L").filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
    return Image.composite(Image.new("RGB", photo.size, (15, 15, 20)), flat, edges)


@look("neon", "Neon")
def neon(img):
    edges = rgb(img).convert("L").filter(ImageFilter.FIND_EDGES)
    edges = ImageOps.autocontrast(edges).filter(ImageFilter.GaussianBlur(0.8))
    return ImageOps.colorize(edges, (5, 0, 20), (60, 255, 230), mid=(255, 40, 200))


@look("mirror", "Mirror")
def mirror(img):
    photo = rgb(img)
    w, h = photo.size
    half = photo.crop((0, 0, w // 2, h))
    out = photo.copy()
    out.paste(ImageOps.mirror(half), (w - w // 2, 0))
    return out


@look("glow", "Dreamy")
def glow(img):
    photo = rgb(img)
    soft = photo.filter(ImageFilter.GaussianBlur(max(2, photo.width // 120)))
    return Image.blend(ImageChops.screen(photo, soft), photo, 0.35)


def apply(img, name):
    return FILTERS[name](img) if name in FILTERS else img
