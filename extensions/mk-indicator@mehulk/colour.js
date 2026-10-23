// Colour helpers shared by the dock glow (per-app colour) and the accent
// (colour from the wallpaper).

export function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r)
            h = ((g - b) / d) % 6;
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h *= 60;
        if (h < 0)
            h += 360;
    }
    return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(n => Math.round(n * 255));
}

// The dominant vivid hue of an image: a hue histogram weighted by saturation,
// brightness and opacity, so a coloured subject wins over a black or grey
// background. Returns the hue in degrees, or null for grey/monochrome images.
export function dominantHue(pixbuf, minWeight = 0.5) {
    const w = pixbuf.get_width(), h = pixbuf.get_height();
    const pixels = pixbuf.get_pixels(), stride = pixbuf.get_rowstride(), n = pixbuf.get_n_channels();
    const buckets = new Array(36).fill(0).map(() => ({w: 0, h: 0}));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * stride + x * n;
            const a = n === 4 ? pixels[i + 3] / 255 : 1;
            const [hue, s, v] = rgbToHsv(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255);
            const weight = a * s * s * v;
            if (weight < 0.02)
                continue;
            const bucket = buckets[Math.floor(hue / 10) % 36];
            bucket.w += weight;
            bucket.h += hue * weight;
        }
    }
    const best = buckets.reduce((p, q) => (q.w > p.w ? q : p));
    return best.w > minWeight * (w * h) / 576 ? best.h / best.w : null;
}
