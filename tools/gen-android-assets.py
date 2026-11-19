# -*- coding: utf-8 -*-
"""Generate FlowDay brand assets for the Capacitor Android project.

Replaces template launcher icons / adaptive foreground / splash screens with the
FlowDay brand gradient mark. Only writes inside android/app/src/main/res.
"""
import glob
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
ICON = os.path.join(ROOT, "public", "icons", "icon-512.png")

STOPS = [(0.0, (242, 164, 92)), (0.52, (201, 102, 143)), (1.0, (91, 92, 191))]

DPI_LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
DPI_FORE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    denom = (w - 1) + (h - 1) or 1
    for y in range(h):
        for x in range(w):
            t = (x + y) / denom
            for i in range(len(STOPS) - 1):
                t0, c0 = STOPS[i]
                t1, c1 = STOPS[i + 1]
                if t0 <= t <= t1:
                    px[x, y] = lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0)
                    break
            else:
                px[x, y] = STOPS[-1][1]
    return img


def white_glyph():
    """Extract the white 'F' glyph from the brand icon as an RGBA silhouette."""
    icon = Image.open(ICON).convert("RGB")
    px = icon.load()
    w, h = icon.size
    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            rr, gg, bb = px[x, y]
            if min(rr, gg, bb) > 235:
                ap[x, y] = 255
    glyph = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    glyph.putalpha(alpha)
    bbox = alpha.getbbox()
    return glyph.crop(bbox)


def main():
    icon = Image.open(ICON).convert("RGBA")
    glyph = white_glyph()
    print("glyph bbox size:", glyph.size)

    # 1) legacy launcher icons (rounded, transparent bg)
    for dpi, size in DPI_LEGACY.items():
        out_dir = os.path.join(RES, f"mipmap-{dpi}")
        os.makedirs(out_dir, exist_ok=True)
        resized = icon.resize((size, size), Image.LANCZOS)
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            resized.save(os.path.join(out_dir, name), "PNG")
        print("wrote", dpi, size)

    # 2) adaptive foreground: transparent canvas, glyph within 66% safe zone
    for dpi, size in DPI_FORE.items():
        out_dir = os.path.join(RES, f"mipmap-{dpi}")
        os.makedirs(out_dir, exist_ok=True)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        target = int(size * 0.60)
        gw, gh = glyph.size
        scale = target / max(gw, gh)
        g2 = glyph.resize((max(1, int(gw * scale)), max(1, int(gh * scale))), Image.LANCZOS)
        canvas.alpha_composite(g2, ((size - g2.width) // 2, (size - g2.height) // 2))
        canvas.save(os.path.join(out_dir, "ic_launcher_foreground.png"), "PNG")
    print("wrote adaptive foregrounds")

    # 3) splash screens: brand gradient + centered rounded mark
    for path in glob.glob(os.path.join(RES, "drawable*", "splash.png")):
        im = Image.open(path)
        w, h = im.size
        bg = gradient(w, h).convert("RGBA")
        mark_size = int(min(w, h) * 0.30)
        mark = icon.resize((mark_size, mark_size), Image.LANCZOS)
        # subtle white halo behind the mark for contrast
        halo = Image.new("RGBA", (mark_size + 24, mark_size + 24), (0, 0, 0, 0))
        ImageDraw.Draw(halo).rounded_rectangle(
            [0, 0, mark_size + 23, mark_size + 23], radius=int((mark_size + 24) * 0.28), fill=(255, 255, 255, 46)
        )
        bg.alpha_composite(halo, ((w - halo.width) // 2, (h - halo.height) // 2))
        bg.alpha_composite(mark, ((w - mark_size) // 2, (h - mark_size) // 2))
        bg.convert("RGB").save(path, "PNG")
        print("wrote splash", os.path.basename(os.path.dirname(path)), (w, h))


if __name__ == "__main__":
    main()
