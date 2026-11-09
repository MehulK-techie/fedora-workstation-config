"""Photo edits for MK Notes' image editor (Pillow): rotate, flip, crop,
resize, and a few Photo Booth style looks.

  thermal   a heat-camera palette: cold blues to hot yellows
  vignette, hue (shift), noir, retro (sepia), comic, neon, mirror, glow (dreamy)
  popart    four posterised copies in bright duotones, 2 x 2
  warps     fish-eye bulge (distort), pinch, twirl, stretch & squeeze,
            kaleidoscope: real optical distortions (a mesh transform)
  polaroid  a warm, faded vintage print (lifted blacks, grain in the
            shadows, a slightly soft plastic lens) on an instant-photo card:
            3:4, a square photo recessed in the card, a thick bottom edge;
            white, cream or noir card stock (FRAME_COLOURS)
  light_leak(img, kind)  layered film light: warm amber streak, 35mm red
            edge burn, prism flare, anamorphic streak (screen / add blends,
            with fine grain), or dust and scratches (LEAKS)

Every function takes a PIL image and returns a new one; nothing is written
to disk here.
"""
import math
import random

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps

try:                                  # (faster warps when OpenCV is there; Pillow otherwise)
    import cv2 as _cv2
    import numpy as _np
except ImportError:
    _cv2 = _np = None

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


_MESHES = {}


def _warp(img, source, grid=32):
    """IMG remapped: each output point (x, y) shows the source at
    source(x, y, w, h). A mesh of GRID x GRID quads (Pillow interpolates
    inside each), so smooth warps stay smooth at any size. The mesh depends only
    on the warp and the size, so it's worked out once and reused (the live
    preview asks for the same one 30 times a second)."""
    src = rgb(img)
    w, h = src.size
    key = (source.__code__, tuple(c.cell_contents for c in source.__closure__ or ()), w, h, grid)
    if _cv2 is not None:
        # OpenCV: the warp sampled on the grid's corners once, spread to every pixel (two float
        # maps, made once per warp and size), then one remap a frame: ~10x faster than the mesh
        maps = _MESHES.get(("cv2",) + key)
        if maps is None:
            xs = [w * gx / grid for gx in range(grid + 1)]
            ys = [h * gy / grid for gy in range(grid + 1)]
            pts = [[source(x, y, w, h) for x in xs] for y in ys]
            mx = _np.array([[p[0] for p in row] for row in pts], _np.float32)
            my = _np.array([[p[1] for p in row] for row in pts], _np.float32)
            maps = (_cv2.resize(mx, (w, h), interpolation=_cv2.INTER_LINEAR),
                    _cv2.resize(my, (w, h), interpolation=_cv2.INTER_LINEAR))
            if len(_MESHES) > 96:
                _MESHES.clear()
            _MESHES[("cv2",) + key] = maps
        out = _cv2.remap(_np.asarray(src), maps[0], maps[1], _cv2.INTER_LINEAR, borderMode=_cv2.BORDER_REFLECT)
        return Image.fromarray(out, "RGB")
    mesh = _MESHES.get(key)
    if mesh is None:
        mesh = []
        for gy in range(grid):
            for gx in range(grid):
                x0, x1 = w * gx / grid, w * (gx + 1) / grid
                y0, y1 = h * gy / grid, h * (gy + 1) / grid
                quad = (*source(x0, y0, w, h), *source(x0, y1, w, h), *source(x1, y1, w, h), *source(x1, y0, w, h))
                mesh.append(((round(x0), round(y0), round(x1), round(y1)), quad))
        if len(_MESHES) > 96:
            _MESHES.clear()
        _MESHES[key] = mesh
    return src.transform((w, h), Image.Transform.MESH, mesh, Image.Resampling.BICUBIC)


def _radial(power):
    """A radial remap inside the circle around the middle: d ** POWER (with d
    the distance over the radius). POWER > 1 magnifies the middle (bulge),
    < 1 squeezes it (pinch)."""
    def source(x, y, w, h):
        cx, cy, radius = w / 2, h / 2, min(w, h) / 2
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy) / radius
        if d >= 1 or d == 0:
            return x, y
        k = d ** power / d
        return cx + dx * k, cy + dy * k
    return source


@look("distort", "Fish-Eye Bulge")
def distort(img, strength=0.55, grid=32):
    """Fisheye bulge: each output point looks closer to the middle of the source."""
    return _warp(img, _radial(1 + strength), grid)


@look("pinch", "Pinch")
def pinch(img, strength=0.45):
    """The middle pulled in, as if sucked toward a point."""
    return _warp(img, _radial(1 - strength))


@look("twirl", "Twirl")
def twirl(img, turns=0.45):
    """A vortex: points near the middle turned furthest (TURNS of a full turn), none at the edge."""
    def source(x, y, w, h):
        cx, cy, radius = w / 2, h / 2, min(w, h) / 2
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy) / radius
        if d >= 1:
            return x, y
        a = 2 * math.pi * turns * (1 - d) ** 2
        c, s_ = math.cos(a), math.sin(a)
        return cx + dx * c - dy * s_, cy + dx * s_ + dy * c
    return _warp(img, source, 40)


@look("squeeze", "Stretch & Squeeze")
def squeeze(img):
    """A funhouse mirror: wide through the middle, narrow at the top and bottom,
    with a gentle wave down the sides."""
    def source(x, y, w, h):
        cx = w / 2
        widen = 1 + 0.38 * math.sin(math.pi * y / h)          # 1.38x in the middle row
        sx = cx + (x - cx) / widen
        sy = y + 0.035 * h * math.sin(2 * math.pi * x / w)
        return min(w - 1, max(0, sx)), min(h - 1, max(0, sy))
    return _warp(img, source)


@look("kaleido", "Kaleidoscope")
def kaleidoscope(img):
    """The top-left quarter, reflected into all four: a mirrored-quadrant pattern."""
    photo = rgb(img)
    w, h = photo.size
    qw, qh = w // 2, h // 2
    q = photo.crop((w // 4, h // 4, w // 4 + qw, h // 4 + qh))    # the middle, where faces are
    out = Image.new("RGB", (2 * qw, 2 * qh))
    out.paste(q, (0, 0))
    out.paste(ImageOps.mirror(q), (qw, 0))
    out.paste(ImageOps.flip(q), (0, qh))
    out.paste(ImageOps.flip(ImageOps.mirror(q)), (qw, qh))
    return out.resize((w, h))


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
FRAME_COLOURS = {"white": ("Polaroid Classic 600", (244, 241, 233), (222, 217, 205)),
                 "aged": ("Aged paper", (226, 211, 178), (196, 176, 136)),
                 "noir": ("Matte noir", (30, 29, 32), (46, 44, 48)),
                 "cream": ("Pastel cream", (246, 236, 210), (226, 214, 184)),
                 "blush": ("Pastel blush", (246, 222, 222), (228, 198, 200)),
                 "mint": ("Pastel mint", (220, 240, 228), (196, 222, 206)),
                 "rainbow": ("Rainbow stripe", (244, 241, 233), (222, 217, 205))}
RAINBOW = ((230, 70, 60), (245, 150, 50), (245, 205, 60), (90, 180, 90), (60, 130, 210))


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


def square(photo, offset=(0.5, 0.5)):
    """A square of PHOTO: the middle one, or OFFSET (0-1 across and down the
    part that doesn't fit) to frame it differently."""
    return fit(photo, 1.0, offset)


def fit(photo, aspect, offset=(0.5, 0.5)):
    """The largest ASPECT (width / height) part of PHOTO, placed by OFFSET."""
    w, h = photo.size
    cw, ch = (w, round(w / aspect)) if w / h < aspect else (round(h * aspect), h)
    x = round((w - cw) * min(1.0, max(0.0, offset[0])))
    y = round((h - ch) * min(1.0, max(0.0, offset[1])))
    return photo.crop((x, y, x + cw, y + ch))


# The frame's shape: (label, aspect). None is each frame's own (the Polaroid's square, the film strip's 3:2...).
RATIOS = {"classic": ("Classic (the frame's own)", None), "auto": ("Auto (follow the camera)", "auto"),
          "wide": ("16:9 Wide", 16 / 9), "standard": ("4:3 Standard", 4 / 3), "square": ("Square", 1.0)}


def auto_ratio(photo):
    """The nearest of 16:9, 4:3 and square to the camera's own shape, so a wide
    camera frame gets a wide frame (a shape match, not face detection)."""
    r = photo.width / photo.height
    return 16 / 9 if r >= 1.55 else 4 / 3 if r >= 1.15 else 1.0


def metal(w, h):
    """Dark brushed metal for the bars of a full-image (contain) frame."""
    key = ("metal", w, h)
    if key not in _CACHE:
        from PIL import ImageChops, ImageOps
        base = ImageOps.colorize(Image.linear_gradient("L").resize((w, h)), (46, 49, 58), (22, 24, 30))
        streaks = Image.effect_noise((16, h), 40).resize((w, h), Image.Resampling.BILINEAR)
        streaks = streaks.filter(ImageFilter.GaussianBlur(0.6)).point(lambda v: v // 12)
        _CACHE[key] = ImageChops.add(base, Image.merge("RGB", (streaks,) * 3), 1.0, -9)
    return _CACHE[key]


def shape(photo, aspect, offset=(0.5, 0.5), contain=False):
    """PHOTO as an ASPECT (width / height) picture. Crop (the default): the
    largest part of it, placed by OFFSET (fit). Contain: all of it, set on
    dark metal bars (top and bottom, or the sides) so nobody is cut out."""
    if not contain:
        return fit(photo, aspect, offset)
    w, h = photo.size
    cw, ch = (w, round(w / aspect)) if w / h > aspect else (round(h * aspect), h)
    if (cw, ch) == (w, h):
        return photo
    out = metal(cw, ch).copy()
    out.paste(photo.convert("RGB"), (round((cw - w) * min(1.0, max(0.0, offset[0]))),
                                      round((ch - h) * min(1.0, max(0.0, offset[1])))))
    return out


def watermark(img):
    """The MK footer for a saved print: a dark metal strip under the picture
    with the booth's name and its maker."""
    from PIL import ImageDraw, ImageFont
    w, h = img.size
    bar = max(34, round(w * 0.034))
    out = Image.new("RGB", (w, h + bar))
    out.paste(img, (0, 0))
    out.paste(metal(w, bar), (0, h))
    d = ImageDraw.Draw(out)
    d.rectangle((0, h, w, h + max(1, bar // 28)), fill=(34, 211, 238))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", round(bar * 0.38))
    except OSError:
        font = ImageFont.load_default()
    pad = round(bar * 0.5)
    d.text((pad, h + bar / 2), "MK PHOTO BOOTH", fill=(236, 244, 248), font=font, anchor="lm")
    d.text((w - pad, h + bar / 2), "MK Workstation · made by Mehul", fill=(34, 211, 238), font=font, anchor="rm")
    return out


def plain(photo, ratio=None, offset=(0.5, 0.5), contain=False):
    """No frame: PHOTO as it is, or in RATIO (see shape). Returns (image, photo box, None)."""
    if ratio == "auto":
        ratio = auto_ratio(photo)
    img = shape(photo, ratio, offset, contain) if ratio else photo
    return img, (0, 0, img.width, img.height), None


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


def polaroid_frame(photo, colour="white", offset=(0.5, 0.5), ratio=None, contain=False):
    """The instant-photo card, 3:4 with the classic square photo: the photo
    set into the card (a soft shadow inside the cutout, a light edge on the
    card), with a thick bottom edge for a caption. With a RATIO the card
    widens to hold it (borders still sized by the shorter side). Returns
    (card, (x, y, w, h) of the photo, (x, y, w, h) of the caption area)."""
    photo = shape(photo, ratio or 1.0, offset, contain)
    pw, ph = photo.size
    s = min(pw, ph)
    side = top = round(s * 0.06)
    card_w = pw + 2 * side
    bottom = round(card_w * 4 / 3) - top - ph if pw == ph else round(s * 0.4333)
    card_h = top + ph + bottom
    card = _paper(card_w, card_h, colour=colour).copy()
    shaded = Image.composite(Image.new("RGB", photo.size, (0, 0, 0)), photo, _recess(pw, ph))
    card.paste(shaded, (side, top))
    # the cut edge of the card catches the light along the bottom and right
    edge = (255, 255, 255) if colour != "noir" else (90, 88, 94)
    lip = max(1, round(s * 0.003))
    card.paste(Image.new("RGB", (pw + lip, lip), edge), (side, top + ph))
    card.paste(Image.new("RGB", (lip, ph), edge), (side + pw, top))
    if colour == "aged":  # weathered: darker, tea-stained edges and a few spots
        mask = _vignette_mask(card_w, card_h, 0.3, 0.75)
        card = Image.composite(Image.new("RGB", card.size, (150, 118, 72)), card, mask)
        card.paste(shaded, (side, top))  # the stains stay on the card, not the photo
        from PIL import ImageDraw
        rand = random.Random(card_w)
        d = ImageDraw.Draw(card, "RGBA")
        for _ in range(14):
            x, y, r = rand.uniform(0, card_w), rand.uniform(top + ph, card_h), rand.uniform(2, card_w * 0.02)
            d.ellipse((x - r, y - r, x + r, y + r), fill=(120, 90, 50, rand.randint(20, 60)))
    elif colour == "rainbow":  # the 70s/80s instant-film stripe along the bottom
        band = max(2, round(bottom * 0.05))
        y0 = card_h - round(bottom * 0.34)
        for i, rgb in enumerate(RAINBOW):
            card.paste(Image.new("RGB", (card_w - 2 * side, band), rgb), (side, y0 + i * band))
    return card, (side, top, pw, ph), (side, top + ph, pw, bottom - (round(bottom * 0.3) if colour == "rainbow" else 0))


# Frames beyond the instant-photo card: (label, function)
FRAME_STYLES_EXTRA = {"instax": "Polaroid Wide / Instax Wide", "film": "35mm film strip",
                      "matte": "Studio matte", "dual": "Dual border", "postcard": "Postcard stamp"}


def frame(photo, style, offset=(0.5, 0.5), ratio=None, contain=False):
    """PHOTO in frame STYLE (a FRAME_COLOURS card or a FRAME_STYLES_EXTRA
    one), the photo placed by OFFSET, in RATIO (a width / height, "auto", or
    None for the frame's own) and, with CONTAIN, whole on metal bars instead
    of cropped. Returns (image, photo box, caption box or None)."""
    if ratio == "auto":
        ratio = auto_ratio(photo)
    if style == "dual":
        return dual_frame(photo, offset, ratio, contain)
    if style == "film":
        return film_frame(photo, offset, ratio, contain)
    if style == "postcard":
        return postcard_frame(photo, offset, ratio, contain)
    if style == "instax":
        return instax_wide_frame(photo, offset, ratio, contain)
    if style == "matte":
        return matte_frame(photo, offset, ratio, contain)
    return polaroid_frame(photo, style, offset, ratio, contain)


def dual_frame(photo, offset=(0.5, 0.5), ratio=None, contain=False):
    """Minimal: a wide white mat, a hairline dark rule a little way out
    from the photo, equal borders all round (4:5)."""
    from PIL import ImageDraw
    photo = shape(photo, ratio or 4 / 5, offset, contain)
    w, h = photo.size
    m = min(w, h)
    pad = round(m * 0.09)
    card = Image.new("RGB", (w + 2 * pad, h + 2 * pad), (248, 247, 244))
    card.paste(photo, (pad, pad))
    d = ImageDraw.Draw(card)
    gap, line = round(pad * 0.35), max(1, round(m * 0.003))
    d.rectangle((pad - gap, pad - gap, pad + w + gap - 1, pad + h + gap - 1), outline=(40, 40, 46), width=line)
    return card, (pad, pad, w, h), None


def film_frame(photo, offset=(0.5, 0.5), ratio=None, contain=False):
    """A 35mm negative strip: black film, a row of rounded sprocket holes
    along the top and bottom, edge print, the photo 3:2 in the middle."""
    from PIL import ImageDraw, ImageFont
    photo = shape(photo, ratio or 3 / 2, offset, contain)
    w, h = photo.size
    band = round(min(w, h) * 0.17)
    side = round(min(w, h) * 0.06)
    card = Image.new("RGB", (w + 2 * side, h + 2 * band), (18, 16, 15))
    card.paste(photo, (side, band))
    d = ImageDraw.Draw(card)
    hole_w, hole_h = round(band * 0.42), round(band * 0.5)
    step = round(hole_w * 1.9)
    r = max(1, hole_h // 5)
    for x in range(round(step * 0.4), card.width - hole_w, step):
        for y in ((band - hole_h) // 2, card.height - band + (band - hole_h) // 2):
            d.rounded_rectangle((x, y, x + hole_w, y + hole_h), radius=r, fill=(236, 232, 224))
    try:
        font = ImageFont.truetype("DejaVuSansMono-Bold.ttf", max(8, round(band * 0.2)))
    except OSError:
        font = ImageFont.load_default()
    d.text((side, card.height - round(band * 0.24)), "MK 400   ▸ 24A", fill=(232, 160, 60), font=font, anchor="ls")
    return card, (side, band, w, h), None


def instax_wide_frame(photo, offset=(0.5, 0.5), ratio=None, contain=False):
    """A wide instant print: the photo 16:9 (unless a RATIO is picked), set into
    white card stock with narrow sides and top and a deep chin for a caption."""
    photo = shape(photo, ratio or 16 / 9, offset, contain)
    pw, ph = photo.size
    side = top = round(ph * 0.09)
    chin = round(ph * 0.34)
    card = _paper(pw + 2 * side, top + ph + chin).copy()
    card.paste(Image.composite(Image.new("RGB", photo.size, (0, 0, 0)), photo, _recess(pw, ph)), (side, top))
    lip = max(1, round(ph * 0.003))
    card.paste(Image.new("RGB", (pw + lip, lip), (255, 255, 255)), (side, top + ph))
    return card, (side, top, pw, ph), (side, top + ph, pw, chin)


def matte_frame(photo, offset=(0.5, 0.5), ratio=None, contain=False):
    """A gallery mount: a wide off-white matte (a touch deeper below), a fine
    bevel line around the opening; the photo in its own shape or RATIO."""
    from PIL import ImageDraw
    if ratio:
        photo = shape(photo, ratio, offset, contain)
    pw, ph = photo.size
    m = min(pw, ph)
    side = round(m * 0.13)
    bottom = round(m * 0.17)
    card = Image.new("RGB", (pw + 2 * side, side + ph + bottom), (246, 244, 239))
    d = ImageDraw.Draw(card)
    bevel = max(2, round(m * 0.008))
    d.rectangle((side - bevel, side - bevel, side + pw + bevel - 1, side + ph + bevel - 1), fill=(255, 254, 250))
    d.rectangle((side - bevel, side - bevel, side + pw + bevel - 1, side + ph + bevel - 1),
                outline=(214, 210, 200), width=1)
    card.paste(photo, (side, side))
    return card, (side, side, pw, ph), (side, side + ph + bevel, pw, bottom - bevel)


def postcard_frame(photo, offset=(0.5, 0.5), ratio=None, contain=False):
    """A postage stamp: a white border with a perforated (scalloped) edge,
    on a soft shadow, the photo 4:5."""
    from PIL import ImageDraw
    photo = shape(photo, ratio or 4 / 5, offset, contain)
    w, h = photo.size
    m = min(w, h)
    border = round(m * 0.07)
    tooth = max(4, round(m * 0.022))     # the perforation's radius
    margin = tooth * 2
    cw, ch = w + 2 * border, h + 2 * border
    mask = Image.new("L", (cw + 2 * margin, ch + 2 * margin), 0)
    d = ImageDraw.Draw(mask)
    d.rectangle((margin, margin, margin + cw - 1, margin + ch - 1), fill=255)
    for x in range(margin, margin + cw + 1, tooth * 3):  # bites out of every edge
        for y in (margin, margin + ch):
            d.ellipse((x - tooth, y - tooth, x + tooth, y + tooth), fill=0)
    for y in range(margin, margin + ch + 1, tooth * 3):
        for x in (margin, margin + cw):
            d.ellipse((x - tooth, y - tooth, x + tooth, y + tooth), fill=0)
    out = Image.new("RGB", mask.size, (232, 226, 214))
    shadow = mask.filter(ImageFilter.GaussianBlur(tooth))
    out.paste((180, 172, 158), (round(tooth * 0.6), round(tooth * 0.8)), shadow)
    out.paste((252, 251, 248), (0, 0), mask)
    out.paste(photo, (margin + border, margin + border))
    return out, (margin + border, margin + border, w, h), None


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

LEAKS = {"amber": "Warm amber streak", "redburn": "35mm red edge burn", "prism": "Prism flare",
         "anamorphic": "Anamorphic streak", "dust": "Dust & scratches"}
LEAK_RES = (192, 128)       # light is built small (it's all soft) and scaled up


def _light(kind, w, h):
    """The light of leak KIND as an RGB layer (black: no light), w x h; cached.
    Several soft layers each, like light through a camera's seams."""
    key = ("light", kind, w, h)
    if key in _CACHE:
        return _CACHE[key]
    lw, lh = LEAK_RES
    px = []
    for y in range(lh):
        v = y / (lh - 1)
        for x in range(lw):
            u = x / (lw - 1)
            if kind == "amber":       # two leaning bands from the left edge: amber, then a paler gold
                a = math.exp(-((u + 0.35 * v - 0.28) / 0.11) ** 2)
                b = 0.55 * math.exp(-((u + 0.35 * v - 0.5) / 0.07) ** 2)
                edge = max(0.0, 1 - u / 0.22) ** 2
                px.append((min(255, round(255 * (a + b * 0.9 + edge * 0.7))), round(150 * a + 210 * b + 90 * edge),
                           round(40 * a + 120 * b + 20 * edge)))
            elif kind == "redburn":   # the film's edge burned: red at the very edge, orange inside it
                d = min(u, 1 - u)
                burn = max(0.0, 1 - d / 0.16) ** 2.2 * (0.75 + 0.25 * math.sin(v * 9 + u * 3))
                halo = max(0.0, 1 - d / 0.3) ** 3
                px.append((min(255, round(240 * burn + 200 * halo)), round(30 * burn + 90 * halo), round(10 * burn)))
            elif kind == "prism":     # a rainbow arc off the top-right corner, and its glow
                r = math.hypot((u - 0.92) * 1.5, v + 0.1)
                ring = math.exp(-((r - 0.62) / 0.09) ** 2)
                hue = (r - 0.5) * 2.4
                rr, gg, bb = (0.5 + 0.5 * math.cos(2 * math.pi * (hue + k)) for k in (0, -1 / 3, 1 / 3))
                glow = 0.5 * math.exp(-(r / 0.35) ** 2)
                px.append((round(255 * min(1, ring * rr + glow)), round(255 * min(1, ring * gg + glow * 0.85)),
                           round(255 * min(1, ring * bb + glow * 0.6))))
            else:                     # anamorphic: a long, thin, blue streak with a hot core
                band = math.exp(-((v - 0.42) / 0.025) ** 2)
                along = 0.35 + 0.65 * math.exp(-((u - 0.55) / 0.3) ** 2)
                core = math.exp(-((u - 0.55) / 0.04) ** 2 - ((v - 0.42) / 0.05) ** 2)
                i_ = band * along
                px.append((min(255, round(90 * i_ + 255 * core)), min(255, round(180 * i_ + 245 * core)),
                           min(255, round(255 * i_ + 235 * core))))
    small = Image.new("RGB", LEAK_RES)
    small.putdata(px)
    layer = small.resize((w, h), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(max(1, w / 300)))
    _CACHE[key] = layer
    return layer


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
    """IMG with a light leak (LEAKS): the light screened over the photo (the
    edge burn added, so it scorches), then fine analog grain over it all;
    or dust and scratches."""
    photo = rgb(img)
    w, h = photo.size
    if kind == "dust":
        light, dark = _dust(w, h)
        photo = Image.composite(Image.new("RGB", (w, h), (250, 246, 236)), photo, light)
        return Image.composite(Image.new("RGB", (w, h), (20, 16, 14)), photo, dark)
    if kind not in LEAKS:
        return photo
    light = _light(kind, w, h)
    lit = ImageChops.add(photo, light) if kind == "redburn" else ImageChops.screen(photo, light)
    return ImageChops.overlay(lit, Image.merge("RGB", [_grain((w, h), seed=9)] * 3).point(lambda v: 128 + (v - 128) // 2))


@look("flash", "High-Contrast Flash")
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


@look("film", "90s Film")
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


@look("portra", "Portrait 400")
def portra(img):
    """Portrait colour film: warm, gentle contrast, creamy skin, soft greens."""
    photo = ImageEnhance.Contrast(rgb(img)).enhance(0.9)
    r, g, b = photo.split()
    r = r.point(lambda v: min(255, round(v * 1.05 + 6)))
    g = g.point(lambda v: min(255, round(v * 1.01 + 3)))
    b = b.point(lambda v: round(v * 0.93 + 10))
    photo = ImageEnhance.Color(Image.merge("RGB", (r, g, b))).enhance(0.92)
    return photo.point(lambda v: 12 + v * (246 - 12) / 255)


@look("cyberpunk", "Cyberpunk Bloom")
def cyberpunk(img):
    """Teal shadows, magenta highlights, a neon glow over the bright parts."""
    photo = ImageEnhance.Contrast(rgb(img)).enhance(1.2)
    grey = photo.convert("L")
    toned = ImageOps.colorize(grey, (10, 20, 60), (255, 80, 200), mid=(40, 200, 220))
    photo = Image.blend(photo, toned, 0.6)
    bright = grey.point(lambda v: 255 if v > 170 else 0).filter(ImageFilter.GaussianBlur(max(2, photo.width / 80)))
    return ImageChops.screen(photo, Image.merge("RGB", (bright, bright.point(lambda v: v // 3), bright)))


@look("duotone", "Duotone")
def duotone(img):
    """Two inks: deep blue shadows, coral highlights."""
    return ImageOps.colorize(ImageOps.autocontrast(rgb(img).convert("L")), (24, 30, 90), (255, 140, 120))


@look("vhs", "VHS Glitch")
def vhs(img):
    """A worn tape: colour bleeding sideways, scanlines and a glitch band."""
    photo = rgb(img)
    w, h = photo.size
    r, g, b = photo.split()
    shift = max(2, w // 160)
    r = ImageChops.offset(r, shift, 0)
    b = ImageChops.offset(b, -shift, 0)
    photo = ImageEnhance.Color(Image.merge("RGB", (r, g, b))).enhance(1.2)
    key = ("scan", w, h)
    if key not in _CACHE:
        lines = Image.new("L", (1, h))
        lines.putdata([200 if y % 3 == 0 else 255 for y in range(h)])
        _CACHE[key] = lines.resize((w, h))
    photo = ImageChops.multiply(photo, Image.merge("RGB", [_CACHE[key]] * 3))
    band_y = int(h * 0.62)
    band = photo.crop((0, band_y, w, band_y + max(4, h // 18)))
    photo.paste(ImageChops.offset(band, w // 25, 0), (0, band_y))
    return photo


@look("pixel", "8-Bit Arcade")
def pixel(img):
    """Big pixels in a small arcade palette."""
    photo = rgb(img)
    w, h = photo.size
    block = max(4, w // 80)
    small = photo.resize((max(1, w // block), max(1, h // block)), Image.Resampling.BILINEAR)
    small = small.quantize(colors=16, method=Image.Quantize.MEDIANCUT).convert("RGB")
    return small.resize((w, h), Image.Resampling.NEAREST)


@look("stretch", "Stretch Fun")
def stretch(img):
    """The middle pulled tall, like a funhouse mirror for group photos."""
    photo = rgb(img)
    w, h = photo.size
    third = w // 3
    middle = photo.crop((third, 0, 2 * third, h)).resize((third, int(h * 1.5)))
    out = photo.copy()
    out.paste(middle.crop((0, int(h * 0.25), third, int(h * 0.25) + h)), (third, 0))
    return out


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


@look("noir", "Monochrome Noir")
def noir(img):
    gray = ImageOps.autocontrast(rgb(img).convert("L"), cutoff=2)
    return ImageEnhance.Contrast(gray).enhance(1.35).convert("RGB")


@look("retro", "Warm Sepia")
def retro(img):
    """Warm sepia, slightly faded, like an old print."""
    gray = rgb(img).convert("L")
    sepia = ImageOps.colorize(gray, (40, 26, 13), (255, 238, 205))
    return sepia.point(lambda v: 20 + v * 0.9)


@look("comic", "Comic Halftone")
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
