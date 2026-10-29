"""Photo edits for MK Notes' image editor (Pillow): rotate, flip, crop,
resize, and a few Photo Booth style looks.

  thermal   a heat-camera palette: cold blues to hot yellows
  vignette, hue (shift), noir, retro (sepia), comic, neon, mirror, glow (dreamy)
  popart    four posterised copies in bright duotones, 2 x 2
  distort   a fisheye bulge from the middle
  polaroid  a warm, faded vintage print (lifted blacks, grain in the
            shadows, a slightly soft plastic lens) on an instant-photo card:
            3:4, a square photo recessed in the card, a thick bottom edge;
            white, cream or noir card stock (FRAME_COLOURS)
  light_leak(img, kind)  warm streak, corner flare, red burn, or dust and
            scratches (LEAKS)

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


# Card stock: (paper, its grain) colours.
FRAME_COLOURS = {"white": ("Classic white", (244, 241, 233), (222, 217, 205)),
                 "cream": ("Vintage cream", (238, 227, 202), (215, 200, 170)),
                 "noir": ("Matte noir", (30, 29, 32), (46, 44, 48))}


def _paper(w, h, seed=7, colour="white"):
    """Card stock with a little grain; cached per size and colour."""
    key = ("paper", w, h, seed, colour)
    if key not in _CACHE:
        _label, base, fleck = FRAME_COLOURS.get(colour, FRAME_COLOURS["white"])
        frame = Image.new("RGB", (w, h), base)
        rand = random.Random(seed)
        grain = Image.new("L", (w // 3 + 1, h // 3 + 1))
        grain.putdata([rand.randint(0, 255) for _ in range(grain.width * grain.height)])
        grain = grain.resize((w, h)).filter(ImageFilter.GaussianBlur(0.6))
        _CACHE[key] = Image.composite(Image.new("RGB", (w, h), fleck), frame, grain.point(lambda v: v // 6))
    return _CACHE[key]


def square(photo):
    """The middle square of PHOTO."""
    w, h = photo.size
    side = min(w, h)
    return photo.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))


def _recess(w, h):
    """An L mask darkest along the cutout's top and left edges: the photo sits
    a little below the card, so the card's edge casts a shadow on it."""
    key = ("recess", w, h)
    if key not in _CACHE:
        depth = max(2, round(w * 0.022))
        small = Image.new("L", (w // 4 + 1, h // 4 + 1), 0)
        d = max(1, depth // 4)
        for i in range(d):
            v = round(150 * (1 - i / d) ** 2)
            for x in range(small.width):
                small.putpixel((x, i), max(small.getpixel((x, i)), v))
            for y in range(small.height):
                small.putpixel((i, y), max(small.getpixel((i, y)), v))
        _CACHE[key] = small.resize((w, h), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(depth / 3))
    return _CACHE[key]


def polaroid_frame(photo, colour="white"):
    """The instant-photo card, 3:4: the photo cut square and set into the
    card (a soft shadow inside the cutout, a light edge on the card), with a
    thick bottom edge for a caption. Returns (card, (x, y, w, h) of the
    photo, (x, y, w, h) of the caption area)."""
    photo = square(photo)
    s = photo.width
    side = top = round(s * 0.06)
    card_w = s + 2 * side
    card_h = round(card_w * 4 / 3)
    bottom = card_h - top - s
    card = _paper(card_w, card_h, colour=colour).copy()
    shaded = Image.composite(Image.new("RGB", photo.size, (0, 0, 0)), photo, _recess(s, s))
    card.paste(shaded, (side, top))
    # the cut edge of the card catches the light along the bottom and right
    edge = (255, 255, 255) if colour != "noir" else (90, 88, 94)
    lip = max(1, round(s * 0.003))
    card.paste(Image.new("RGB", (s + lip, lip), edge), (side, top + s))
    card.paste(Image.new("RGB", (lip, s), edge), (side + s, top))
    return card, (side, top, s, s), (side, top + s, s, bottom)


def _grain(size, seed=5):
    """Mid-grey film grain (128 = no change) for an overlay; cached."""
    key = ("film-grain", size, seed)
    if key not in _CACHE:
        rand = random.Random(seed)
        w, h = size
        noise = Image.new("L", (w // 2 + 1, h // 2 + 1))
        noise.putdata([rand.randint(96, 160) for _ in range(noise.width * noise.height)])
        _CACHE[key] = noise.resize(size, Image.Resampling.BILINEAR)
    return _CACHE[key]


def polaroid_photo(img):
    """The Polaroid look on the photo itself, without the frame: instant
    film chemistry. Charcoal (lifted) blacks, muted warm highlights, skin
    kept rich, grain mostly in the shadows, and a plastic lens's softness."""
    photo = rgb(img)
    photo.thumbnail((1400, 1400))
    photo = ImageEnhance.Color(photo).enhance(0.8)
    r, g, b = photo.split()
    # warm mids (skin), highlights held back from pure white, cool-ish shadows
    r = r.point(lambda v: min(255, round(v * 1.04 + 10 * math.sin(math.pi * v / 255))))
    g = g.point(lambda v: round(v * 0.99 + 4 * math.sin(math.pi * v / 255)))
    b = b.point(lambda v: round(v * 0.86 + 14 * (1 - v / 255)))
    photo = Image.merge("RGB", (r, g, b))
    photo = photo.point(lambda v: 30 + v * (232 - 30) / 255)  # charcoal blacks, creamy whites
    photo = ImageEnhance.Contrast(photo).enhance(1.06)
    # grain where it's dark: an overlay of noise, masked by the shadows
    shadows = ImageOps.invert(photo.convert("L")).point(lambda v: max(0, v - 60))
    grainy = ImageChops.overlay(photo, Image.merge("RGB", [_grain(photo.size)] * 3))
    photo = Image.composite(grainy, photo, shadows)
    # the plastic lens: about 1.5 % softer
    soft = photo.filter(ImageFilter.GaussianBlur(max(0.6, photo.width * 0.0015)))
    photo = Image.blend(photo, soft, 0.5)
    return Image.composite(Image.new("RGB", photo.size, (40, 25, 15)), photo, _vignette_mask(*photo.size))


@look("polaroid", "Polaroid")
def polaroid(img):
    return polaroid_frame(polaroid_photo(img))[0]


# ---------------------------------------------------------------- light leaks

LEAKS = {"warm": "Warm streak", "flare": "Corner flare", "burn": "Red burn", "dust": "Dust & scratches"}


def _leak_mask(kind, w, h):
    key = ("leak", kind, w, h)
    if key in _CACHE:
        return _CACHE[key]
    if kind == "warm":  # a soft band down the left third, leaning
        band = Image.linear_gradient("L").rotate(90).resize((64, 64))
        band = band.point(lambda v: round(255 * max(0, 1 - abs(v - 200) / 70) ** 1.5))
        mask = band.rotate(-14, resample=Image.Resampling.BICUBIC, expand=False).resize((w, h), Image.Resampling.BICUBIC)
    elif kind == "flare":  # a glow from the top-right corner
        glow = ImageOps.invert(Image.radial_gradient("L")).resize((128, 128))
        mask = Image.new("L", (128, 128))
        mask.paste(glow.point(lambda v: min(255, round(v * 1.25))), (40, -40))
        mask = mask.resize((w, h), Image.Resampling.BICUBIC)
    else:  # burn: the bottom edge and a corner, burned red
        ramp = Image.linear_gradient("L").resize((64, 64))
        mask = ramp.point(lambda v: round(255 * max(0, (v - 150) / 105) ** 1.6)).resize((w, h), Image.Resampling.BICUBIC)
    mask = mask.filter(ImageFilter.GaussianBlur(max(1, w / 60)))
    _CACHE[key] = mask
    return mask


def _dust(w, h, seed=11):
    """Specks of dust and a few fine scratches: (light, dark) L masks."""
    key = ("dust", w, h, seed)
    if key not in _CACHE:
        from PIL import ImageDraw
        rand = random.Random(seed)
        light, dark = Image.new("L", (w, h)), Image.new("L", (w, h))
        dl, dd = ImageDraw.Draw(light), ImageDraw.Draw(dark)
        for _ in range(int(w * h / 9000) + 20):
            x, y, r = rand.uniform(0, w), rand.uniform(0, h), rand.uniform(0.4, 1.6) * w / 900
            (dl if rand.random() < 0.6 else dd).ellipse((x - r, y - r, x + r, y + r), fill=rand.randint(90, 200))
        for _ in range(5):
            x = rand.uniform(0.05, 0.95) * w
            y0, y1 = rand.uniform(0, 0.4) * h, rand.uniform(0.6, 1) * h
            dl.line((x, y0, x + rand.uniform(-0.03, 0.03) * w, y1), fill=rand.randint(70, 130),
                    width=max(1, round(w / 1200)))
        _CACHE[key] = (light.filter(ImageFilter.GaussianBlur(0.5)), dark.filter(ImageFilter.GaussianBlur(0.5)))
    return _CACHE[key]


def light_leak(img, kind):
    """IMG with a light leak (warm, flare, burn) or dust and scratches."""
    photo = rgb(img)
    w, h = photo.size
    if kind == "dust":
        light, dark = _dust(w, h)
        photo = Image.composite(Image.new("RGB", (w, h), (250, 246, 236)), photo, light)
        return Image.composite(Image.new("RGB", (w, h), (20, 16, 14)), photo, dark)
    colour = {"warm": (255, 150, 60), "flare": (255, 214, 140), "burn": (235, 40, 25)}.get(kind)
    if not colour:
        return photo
    lit = ImageChops.screen(photo, Image.new("RGB", (w, h), colour))
    return Image.composite(lit, photo, _leak_mask(kind, w, h).point(lambda v: round(v * 0.85)))


@look("flash", "Flash")
def flash(img):
    """Direct flash in a party booth: bright faces, deep shadows, crisp."""
    photo = rgb(img)
    photo = ImageEnhance.Contrast(photo).enhance(1.55)
    photo = ImageEnhance.Brightness(photo).enhance(1.08)
    photo = ImageEnhance.Color(photo).enhance(0.9)
    # light falls off from the middle, like a flash on the camera
    photo = Image.composite(Image.new("RGB", photo.size, (0, 0, 0)), photo, _vignette_mask(*photo.size, 0.35, 0.65))
    return ImageEnhance.Sharpness(photo).enhance(1.6)


@look("instant", "Instant 600")
def instant(img):
    """Instant film: a warm golden wash, soft skin, cyan in the shadows."""
    photo = ImageEnhance.Contrast(rgb(img)).enhance(0.92)
    r, g, b = photo.split()
    r = r.point(lambda v: min(255, int(v * 1.06 + 8)))
    g = g.point(lambda v: min(255, int(v * 1.02 + 4)))
    b = b.point(lambda v: int(v * 0.86 + 22 * (1 - v / 255)))  # cooler in the shadows only
    photo = Image.merge("RGB", (r, g, b))
    photo = photo.point(lambda v: 18 + v * (240 - 18) / 255)  # milky blacks and highlights
    return photo.filter(ImageFilter.GaussianBlur(0.6))


@look("film", "Film")
def film(img):
    """Analog film: organic warmth, muted greens, gentle grain."""
    photo = rgb(img)
    h, s_, v = photo.convert("HSV").split()
    # greens (hue around 85/255) lose saturation; everything else a little
    greens = h.point(lambda x: 255 if 60 < x < 120 else 0)
    s_ = Image.composite(s_.point(lambda x: int(x * 0.55)), s_.point(lambda x: int(x * 0.85)), greens)
    photo = Image.merge("HSV", (h, s_, v)).convert("RGB")
    warm = Image.new("RGB", photo.size, (255, 214, 170))
    photo = Image.blend(photo, ImageChops.multiply(photo, warm), 0.25)
    photo = photo.point(lambda x: 14 + x * (246 - 14) / 255)
    key = ("grain", photo.size)
    if key not in _CACHE:
        rand = random.Random(3)
        noise = Image.new("L", (photo.width // 2 + 1, photo.height // 2 + 1))
        noise.putdata([rand.randint(100, 156) for _ in range(noise.width * noise.height)])
        _CACHE[key] = noise.resize(photo.size).convert("RGB")
    return ImageChops.overlay(photo, _CACHE[key])


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
