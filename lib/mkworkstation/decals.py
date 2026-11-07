"""Vector stamps and decals for MK Photo Booth, drawn with cairo (no emoji, no
image files, so they stay sharp at any size and any rotation).

DECALS maps a key to (label, group, aspect, draw): `aspect` is width / height,
and draw(cr, w, h) paints the decal into a w x h box with its top left at the
origin. Badges and crests are shields and a crown; the stamps are the short
words people shout at a photo.
"""
import getpass
import math
import socket

import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402

CYAN = (0.13, 0.83, 0.93)
INK = (0.07, 0.09, 0.13)


def _text(cr, text, cx, cy, size, rgb, weight="Bold", width=None, alpha=1.0, spacing=0):
    """TEXT centred on (cx, cy), SIZE px tall; shrunk to fit WIDTH if given."""
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription.from_string(f"Sans {weight} {max(4, round(size))}px"))
    if spacing:
        attrs = Pango.AttrList()
        attrs.insert(Pango.attr_letter_spacing_new(round(spacing * Pango.SCALE)))
        layout.set_attributes(attrs)
    layout.set_text(text, -1)
    tw, th = layout.get_pixel_size()
    if width and tw > width:
        return _text(cr, text, cx, cy, size * width / tw, rgb, weight, None, alpha, spacing)
    cr.save()
    cr.move_to(cx - tw / 2, cy - th / 2)
    cr.set_source_rgba(*rgb, alpha)
    PangoCairo.show_layout(cr, layout)
    cr.restore()


def _round_rect(cr, x, y, w, h, r):
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()


def _shield_path(cr, x, y, w, h):
    """A heater shield: flat top, straight sides, a curve down to a point."""
    cr.new_path()
    cr.move_to(x, y)
    cr.line_to(x + w, y)
    cr.line_to(x + w, y + h * 0.5)
    cr.curve_to(x + w, y + h * 0.78, x + w * 0.66, y + h * 0.93, x + w * 0.5, y + h)
    cr.curve_to(x + w * 0.34, y + h * 0.93, x, y + h * 0.78, x, y + h * 0.5)
    cr.close_path()


def _shield(cr, w, h, edge, top, bottom):
    """The shield's body (a gradient), a bold edge, a fine inner rule."""
    pad = min(w, h) * 0.04
    _shield_path(cr, pad, pad, w - 2 * pad, h - 2 * pad)
    grad = cairo_linear(cr, 0, 0, 0, h, top, bottom)
    cr.set_source(grad)
    cr.fill_preserve()
    cr.set_source_rgb(*edge)
    cr.set_line_width(min(w, h) * 0.05)
    cr.set_line_join(1)
    cr.stroke()
    inset = pad + min(w, h) * 0.07
    _shield_path(cr, inset, inset, w - 2 * inset, h - 2 * inset - min(w, h) * 0.02)
    cr.set_source_rgba(1, 1, 1, 0.22)
    cr.set_line_width(max(1, min(w, h) * 0.012))
    cr.stroke()


def cairo_linear(cr, x0, y0, x1, y1, c0, c1):
    import cairo
    g = cairo.LinearGradient(x0, y0, x1, y1)
    g.add_color_stop_rgb(0, *c0)
    g.add_color_stop_rgb(1, *c1)
    return g


def _bolt(cr, cx, cy, h, rgb):
    """A lightning bolt, H tall, centred on (cx, cy)."""
    w = h * 0.55
    pts = [(0.62, 0.0), (0.0, 0.58), (0.42, 0.58), (0.3, 1.0), (1.0, 0.38), (0.56, 0.38)]
    cr.new_path()
    for i, (px, py) in enumerate(pts):
        (cr.move_to if i == 0 else cr.line_to)(cx - w / 2 + px * w, cy - h / 2 + py * h)
    cr.close_path()
    cr.set_source_rgb(*rgb)
    cr.fill()


def mk_crest(cr, w, h):
    _shield(cr, w, h, CYAN, (0.09, 0.17, 0.26), (0.04, 0.08, 0.14))
    _text(cr, "MK", w / 2, h * 0.34, h * 0.34, (0.92, 0.98, 1.0), "Heavy", w * 0.6, spacing=2)
    _bolt(cr, w / 2, h * 0.62, h * 0.2, CYAN)
    _text(cr, "WORKSTATION", w / 2, h * 0.755, h * 0.05, CYAN, "Bold", w * 0.5, 0.9, 0.5)


def havoc_shield(cr, w, h):
    red = (0.96, 0.25, 0.37)
    _shield(cr, w, h, red, (0.17, 0.07, 0.1), (0.08, 0.04, 0.06))
    # a stick figure, arms up, over two slashes of lightning
    for dx in (-0.2, 0.2):
        _bolt(cr, w * (0.5 + dx), h * 0.4, h * 0.34, (0.55, 0.15, 0.22))
    cr.set_source_rgb(0.97, 0.97, 0.98)
    cr.set_line_width(h * 0.035)
    cr.set_line_cap(1)
    cx, hy = w / 2, h * 0.24
    cr.arc(cx, hy, h * 0.055, 0, 2 * math.pi)
    cr.stroke()
    for pts in (((cx, hy + h * 0.055), (cx, h * 0.5)), ((cx, h * 0.34), (cx - w * 0.17, h * 0.25)),
                ((cx, h * 0.34), (cx + w * 0.17, h * 0.25)), ((cx, h * 0.5), (cx - w * 0.11, h * 0.64)),
                ((cx, h * 0.5), (cx + w * 0.11, h * 0.64))):
        cr.move_to(*pts[0])
        cr.line_to(*pts[1])
        cr.stroke()
    _text(cr, "HAVOC", w / 2, h * 0.77, h * 0.1, (0.98, 0.9, 0.9), "Heavy", w * 0.62, spacing=1.5)


def crown_1st(cr, w, h):
    gold0, gold1, dark = (0.99, 0.9, 0.54), (0.85, 0.47, 0.04), (0.35, 0.2, 0.02)
    base_y, top_y = h * 0.62, h * 0.12
    cr.new_path()
    cr.move_to(w * 0.12, base_y)
    cr.line_to(w * 0.06, top_y + h * 0.08)
    cr.line_to(w * 0.3, h * 0.4)
    cr.line_to(w * 0.5, top_y)
    cr.line_to(w * 0.7, h * 0.4)
    cr.line_to(w * 0.94, top_y + h * 0.08)
    cr.line_to(w * 0.88, base_y)
    cr.close_path()
    cr.set_source(cairo_linear(cr, 0, top_y, 0, base_y, gold0, gold1))
    cr.fill_preserve()
    cr.set_source_rgb(*dark)
    cr.set_line_width(h * 0.025)
    cr.set_line_join(1)
    cr.stroke()
    for x, y in ((0.06, top_y + h * 0.08), (0.5, top_y), (0.94, top_y + h * 0.08)):   # the points' pearls
        cr.arc(w * x, y, h * 0.045, 0, 2 * math.pi)
        cr.set_source_rgb(0.99, 0.95, 0.8)
        cr.fill_preserve()
        cr.set_source_rgb(*dark)
        cr.set_line_width(h * 0.015)
        cr.stroke()
    cr.rectangle(w * 0.12, base_y, w * 0.76, h * 0.07)            # the band
    cr.set_source(cairo_linear(cr, 0, base_y, 0, base_y + h * 0.07, gold1, (0.6, 0.32, 0.02)))
    cr.fill()
    _round_rect(cr, w * 0.2, h * 0.74, w * 0.6, h * 0.22, h * 0.05)   # the ribbon
    cr.set_source_rgb(*INK)
    cr.fill_preserve()
    cr.set_source_rgb(*gold0)
    cr.set_line_width(h * 0.02)
    cr.stroke()
    _text(cr, "1ST", w / 2, h * 0.85, h * 0.15, gold0, "Heavy", w * 0.46, spacing=1)


def _word_stamp(word, rgb):
    """A rubber-stamp word: a double rule in a rounded box, the word in capitals."""
    def draw(cr, w, h):
        line = h * 0.045
        _round_rect(cr, line, line, w - 2 * line, h - 2 * line, h * 0.18)
        cr.set_source_rgba(*INK, 0.78)
        cr.fill_preserve()
        cr.set_source_rgb(*rgb)
        cr.set_line_width(line)
        cr.stroke()
        _round_rect(cr, line * 3.2, line * 3.2, w - 6.4 * line, h - 6.4 * line, h * 0.12)
        cr.set_source_rgba(*rgb, 0.55)
        cr.set_line_width(max(1, line * 0.35))
        cr.stroke()
        _text(cr, word, w / 2, h / 2, h * 0.5, rgb, "Heavy", w * 0.78, spacing=1.5)
    return draw


def station_name():
    """Whose workstation: the computer's name ("MK" -> "MK"), or the user's when
    the computer has a generic one; MK when neither will do."""
    host = socket.gethostname().split(".")[0].strip().upper()
    if host and host not in ("LOCALHOST", "FEDORA", "LOCALHOST-LIVE") and len(host) <= 12:
        return host
    user = (getpass.getuser() or "").strip().upper()
    return user if user and len(user) <= 12 else "MK"


def _plate_path(cr, x, y, w, h, cut):
    """A plate with its corners cut at 45 degrees."""
    cr.new_path()
    cr.move_to(x + cut, y)
    cr.line_to(x + w - cut, y)
    cr.line_to(x + w, y + cut)
    cr.line_to(x + w, y + h - cut)
    cr.line_to(x + w - cut, y + h)
    cr.line_to(x + cut, y + h)
    cr.line_to(x, y + h - cut)
    cr.line_to(x, y + cut)
    cr.close_path()


def workstation_plate(cr, w, h):
    """"{NAME} WORKSTATION" on a cut-corner plate, laser-etched: a dark core,
    the edge printed twice off-register (red one way, cyan the other, the
    comic-book misprint), a crisp white rule, fine scanlines."""
    pad, cut = h * 0.08, h * 0.22
    x, y, pw, ph = pad, pad, w - 2 * pad, h - 2 * pad
    _plate_path(cr, x, y, pw, ph, cut)
    cr.set_source(cairo_linear(cr, 0, y, 0, y + ph, (0.08, 0.06, 0.12), (0.02, 0.02, 0.05)))
    cr.fill()
    cr.save()                                   # scanlines, inside the plate only
    _plate_path(cr, x, y, pw, ph, cut)
    cr.clip()
    cr.set_source_rgba(1, 1, 1, 0.05)
    step = max(2.0, h * 0.045)
    yy = y
    while yy < y + ph:
        cr.rectangle(x, yy, pw, step * 0.4)
        yy += step
    cr.fill()
    cr.restore()
    line = max(1.0, h * 0.035)
    off = max(1.0, h * 0.03)
    cr.set_line_join(0)
    for dx, rgb in ((-off, (0.96, 0.16, 0.3)), (off, CYAN)):
        _plate_path(cr, x + dx, y - dx * 0.4, pw, ph, cut)
        cr.set_source_rgba(*rgb, 0.9)
        cr.set_line_width(line)
        cr.stroke()
    _plate_path(cr, x, y, pw, ph, cut)
    cr.set_source_rgb(0.97, 0.98, 1.0)
    cr.set_line_width(line * 0.6)
    cr.stroke()
    name = station_name()
    for dx, rgb, alpha in ((-off, (0.96, 0.16, 0.3), 0.85), (off, CYAN, 0.85), (0, (0.97, 0.98, 1.0), 1.0)):
        _text(cr, name, w / 2 + dx, h * 0.42, h * 0.36, rgb, "Heavy", pw * 0.8, alpha, spacing=h * 0.03)
    _text(cr, "WORKSTATION", w / 2, h * 0.72, h * 0.13, (0.97, 0.98, 1.0), "Bold", pw * 0.72, 0.95,
          spacing=h * 0.045)


DECALS = {
    "mk_crest": ("MK Crest", "badges", 0.84, mk_crest),
    "workstation": ("Workstation plate", "badges", 2.6, workstation_plate),
    "havoc_shield": ("Stick Havoc Shield", "badges", 0.84, havoc_shield),
    "crown_1st": ("1st Place Crown", "badges", 1.0, crown_1st),
    "gg": ("GG", "stamps", 1.7, _word_stamp("GG", (0.13, 0.83, 0.93))),
    "clutch": ("CLUTCH", "stamps", 3.1, _word_stamp("CLUTCH", (0.98, 0.75, 0.14))),
    "mvp": ("MVP", "stamps", 2.1, _word_stamp("MVP", (0.96, 0.45, 0.71))),
    "squad": ("SQUAD", "stamps", 2.9, _word_stamp("SQUAD", (0.64, 0.9, 0.21))),
}


def draw(cr, key, w, h):
    """Paint decal KEY into the w x h box at the origin of CR."""
    DECALS[key][3](cr, w, h)
